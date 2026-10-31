#!/usr/bin/env python3
"""Build offline thumbnails from the public catalog's approved image URLs.

Only canonical images.groobee.com/images/asobisystem/ URLs from catalog.json
are requested. Priority order text is read locally only to match those URLs;
neither pasted text nor customer information is sent over the network.
"""
from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import hashlib
import io
import json
from pathlib import Path
import re
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
import warnings

try:
    from PIL import Image, ImageOps, features
except ImportError:
    raise SystemExit("Pillow is unavailable. No installation attempted; thumbnail build cannot run.")

ORIGIN = "https://images.groobee.com"
USER_AGENT = "OrderExcelThumbnails/1.0 (+manual public catalog image cache; max 4 concurrent)"
MAX_IMAGE_BYTES = 12 * 1024 * 1024
MAX_DECODE_PIXELS = 32_000_000
# Large public JPEGs can be header-inspected and draft-decoded at 1/8 scale.
# Other raster formats must stay within the smaller decoded-bitmap bound.
Image.MAX_IMAGE_PIXELS = 200_000_000


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def sha(value):
    return hashlib.sha256(value).hexdigest()


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(path)


def safe_image_url(value):
    if not isinstance(value, str):
        raise ValueError("Image URL must be a catalog string")
    url = urllib.parse.urlsplit(value)
    if url.scheme != "https" or url.hostname != "images.groobee.com" or url.username or url.password or url.port or url.query or url.fragment:
        raise ValueError("Only query-free HTTPS public catalog image URLs are allowed")
    if not re.fullmatch(r"/images/asobisystem/[A-Za-z0-9_.-]+\.(?:jpe?g|png|gif|webp|avif)", url.path, re.I):
        raise ValueError("Unexpected image path or non-raster extension")
    if ".." in url.path.split("/"):
        raise ValueError("Path traversal is not allowed")
    return value


class ImageRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        safe_image_url(newurl)
        return super().redirect_request(request, fp, code, msg, headers, newurl)


class Pace:
    def __init__(self, interval):
        self.interval = max(0.15, interval)
        self.next_start = 0
        self.pause_until = 0
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.denied_streak = 0

    def wait(self):
        while not self.stop.is_set():
            with self.lock:
                current = time.monotonic()
                delay = max(self.next_start, self.pause_until) - current
                if delay <= 0:
                    self.next_start = current + self.interval
                    return
            time.sleep(min(delay, 0.25))
        raise RuntimeError("Queue stopped after access denial or persistent throttling")

    def pause(self, seconds):
        with self.lock:
            self.pause_until = max(self.pause_until, time.monotonic() + seconds)

    def outcome(self, denied=False):
        with self.lock:
            self.denied_streak = self.denied_streak + 1 if denied else 0
            if self.denied_streak >= 3:
                self.stop.set()


def robots_policy(pace):
    url = ORIGIN + "/robots.txt"
    policy = urllib.robotparser.RobotFileParser(url)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": USER_AGENT}), timeout=20) as response:
            body = response.read(512 * 1024).decode("utf-8", "replace")
        policy.parse(body.splitlines())
        crawl_delay = policy.crawl_delay(USER_AGENT) or policy.crawl_delay("*")
        rate = policy.request_rate(USER_AGENT) or policy.request_rate("*")
        if crawl_delay:
            pace.interval = max(pace.interval, float(crawl_delay))
        if rate and rate.requests:
            pace.interval = max(pace.interval, rate.seconds / rate.requests)
        report = {"url": url, "status": 200, "policy": "parseable allow/disallow, crawl-delay and request-rate honored", "sha256": sha(body.encode())}
    except urllib.error.HTTPError as error:
        if error.code in (401, 429) or not 400 <= error.code <= 499:
            raise RuntimeError(f"robots.txt unavailable with blocking status {error.code}; no bulk image requests attempted") from error
        policy.parse([])
        report = {"url": url, "status": error.code, "policy": "unavailable (HTTP 4xx); public resources permitted by RFC 9309 section 2.3.1.3", "standard": "https://www.rfc-editor.org/rfc/rfc9309.html#section-2.3.1.3"}
    return policy, report


def priority_urls(path, known_urls):
    if not path.exists():
        return []
    # Do not emit, persist, translate or transmit the pasted document. Only
    # equality against already-public catalog image paths influences ordering.
    text = path.read_text(encoding="utf-8")
    known_by_path = {(urllib.parse.urlsplit(url).hostname, urllib.parse.urlsplit(url).path): url for url in known_urls}
    selected = []
    for candidate in re.findall(r"https?://[^\s<>\)\]\"']+", text):
        parsed = urllib.parse.urlsplit(candidate)
        canonical = known_by_path.get((parsed.hostname, parsed.path))
        if canonical and canonical not in selected:
            selected.append(canonical)
    return selected


def make_thumbnail(raw, width, quality):
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(raw)) as source:
            source.seek(0)
            source_size = source.size
            if source.width * source.height > Image.MAX_IMAGE_PIXELS:
                raise ValueError("Image exceeds the bounded metadata pixel limit")
            # JPEG draft decoding reduces large official poster/product photos
            # before RGBA allocation. Other formats keep the hard pixel bound.
            if source.format in ("JPEG", "MPO"):
                source.draft("RGB", (width * 2, width * 2))
            if source.width * source.height > MAX_DECODE_PIXELS:
                raise ValueError("Image exceeds the 32 MP decoded-bitmap limit after optional JPEG draft scaling")
            image = ImageOps.exif_transpose(source).convert("RGBA")
            image.thumbnail((width, width), Image.Resampling.LANCZOS, reducing_gap=3.0)
            canvas = Image.new("RGBA", (width, width), (255, 255, 255, 0))
            canvas.alpha_composite(image, ((width - image.width) // 2, (width - image.height) // 2))
            output = io.BytesIO()
            canvas.save(output, format="WEBP", quality=quality, method=4, exact=True)
            return output.getvalue(), source_size


def cache_paths(directory, url, width, quality):
    key = sha(f"{url}|square={width}|quality={quality}|webp-v1".encode())
    return directory / f"{key}.webp", directory / f"{key}.json"


def load_cache(webp_path, metadata_path, url, width, quality):
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        raw = webp_path.read_bytes()
        if metadata.get("url") != url or metadata.get("width") != width or metadata.get("quality") != quality or metadata.get("webpSha256") != sha(raw):
            return None
        with Image.open(io.BytesIO(raw)) as image:
            if image.format != "WEBP" or image.size != (width, width):
                return None
        return raw, metadata
    except (OSError, ValueError, KeyError):
        return None


def process_image(url, args, pace, policy):
    webp_path, metadata_path = cache_paths(args.cache_dir, url, args.width, args.quality)
    cached = load_cache(webp_path, metadata_path, url, args.width, args.quality)
    if cached:
        return {"url": url, "status": "cached", "raw": cached[0], "metadata": cached[1]}
    if not policy.can_fetch(USER_AGENT, url):
        return {"url": url, "status": "failed", "error": "robots-disallowed"}
    opener = urllib.request.build_opener(ImageRedirect())
    for attempt in range(args.retries + 1):
        try:
            pace.wait()
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "image/*"})
            with opener.open(request, timeout=args.timeout) as response:
                safe_image_url(response.url)
                content_type = response.headers.get("Content-Type", "").split(";", 1)[0]
                if not content_type.startswith("image/"):
                    raise ValueError("Public image URL did not return an image content type")
                original = response.read(MAX_IMAGE_BYTES + 1)
            if len(original) > MAX_IMAGE_BYTES:
                raise ValueError("Source image exceeds the 12 MiB download limit")
            webp, dimensions = make_thumbnail(original, args.width, args.quality)
            metadata = {"url": url, "fetchedAt": now(), "width": args.width, "quality": args.quality,
                        "originalDimensions": list(dimensions), "originalBytes": len(original),
                        "originalSha256": sha(original), "webpBytes": len(webp), "webpSha256": sha(webp)}
            temporary = webp_path.with_suffix(".webp.tmp")
            temporary.write_bytes(webp)
            temporary.replace(webp_path)
            atomic_json(metadata_path, metadata)
            pace.outcome()
            return {"url": url, "status": "created", "raw": webp, "metadata": metadata}
        except urllib.error.HTTPError as error:
            transient = error.code in (408, 425, 429, 500, 502, 503, 504)
            if error.code in (401, 403):
                pace.outcome(denied=True)
            if transient and attempt < args.retries:
                retry_after = error.headers.get("Retry-After", "0")
                try:
                    retry_seconds = float(retry_after)
                except ValueError:
                    try:
                        retry_seconds = max(0, (parsedate_to_datetime(retry_after) - datetime.now(timezone.utc)).total_seconds())
                    except (TypeError, ValueError):
                        retry_seconds = 5
                delay = max(2 ** (attempt + 1), retry_seconds)
                if delay > 30:
                    pace.stop.set()
                    return {"url": url, "status": "failed", "error": "retry-after-exceeds-bounded-wait", "httpStatus": error.code}
                pace.pause(delay)
                continue
            if error.code == 429:
                pace.stop.set()
            return {"url": url, "status": "failed", "error": "http-error", "httpStatus": error.code, "attempts": attempt + 1}
        except (urllib.error.URLError, TimeoutError, socket.timeout) as error:
            if attempt < args.retries:
                pace.pause(2 ** (attempt + 1))
                continue
            return {"url": url, "status": "failed", "error": type(error).__name__, "attempts": attempt + 1}
        except (ValueError, OSError, RuntimeError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
            return {"url": url, "status": "failed", "error": type(error).__name__ + ": " + str(error)}


def main():
    base = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=base / "dist/catalog.json")
    parser.add_argument("--output", type=Path, default=base / "dist/thumbnails.json")
    parser.add_argument("--cache-dir", type=Path, default=base / "references/thumbnails-cache")
    parser.add_argument("--priority", type=Path, default=base / ".verification/markdown-order-12.txt")
    parser.add_argument("--report", type=Path, default=base / ".verification/thumbnails-build-report.json")
    parser.add_argument("--workers", type=int, choices=range(1, 5), default=4)
    parser.add_argument("--width", type=int, choices=(128, 144), default=144)
    parser.add_argument("--quality", type=int, default=48)
    parser.add_argument("--interval", type=float, default=0.15)
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--retries", type=int, choices=range(3), default=2)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    if not 1 <= args.quality <= 90 or not 1 <= args.timeout <= 30 or args.limit is not None and args.limit < 1:
        parser.error("Use quality 1..90, timeout 1..30 and a positive optional limit")
    if not features.check("webp"):
        raise RuntimeError("Installed Pillow has no WebP encoder; no installation attempted")
    catalog_bytes = args.catalog.read_bytes()
    catalog = json.loads(catalog_bytes)
    groups, invalid = {}, []
    for product in catalog["products"]:
        try:
            url = safe_image_url(product.get("imageUrl"))
            groups.setdefault(url, []).append(str(product["id"]))
        except ValueError as error:
            invalid.append({"id": str(product["id"]), "error": str(error)})
    priority = priority_urls(args.priority, groups)
    ordered = [*priority, *[url for url in groups if url not in set(priority)]]
    if args.limit:
        ordered = ordered[:args.limit]
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    pace = Pace(args.interval)
    policy, robots = robots_policy(pace)
    output = {"schemaVersion": 1, "width": args.width, "products": {}}
    report = {"schemaVersion": 1, "startedAt": now(), "catalogSha256": sha(catalog_bytes),
              "expectedProducts": len(catalog["products"]), "uniqueImageUrls": len(groups),
              "width": args.width, "quality": args.quality, "workers": args.workers,
              "minimumRequestIntervalSeconds": pace.interval, "robots": robots,
              "priorityProductIds": [pid for url in priority for pid in groups[url]],
              "invalidCatalogImages": invalid, "records": [], "failures": [], "complete": False}
    last_checkpoint = time.monotonic()

    def checkpoint(status):
        nonlocal last_checkpoint
        report.update({"updatedAt": now(), "status": status, "processedUniqueImages": len(report["records"]),
                       "productsWithThumbnails": len(output["products"]),
                       "missingProducts": len(catalog["products"]) - len(output["products"]),
                       "createdUniqueImages": sum(record["status"] == "created" for record in report["records"]),
                       "reusedUniqueImages": sum(record["status"] == "cached" for record in report["records"]),
                       "complete": len(output["products"]) == len(catalog["products"])})
        output["products"] = dict(sorted(output["products"].items(), key=lambda item: int(item[0])))
        atomic_json(args.output, output)
        report["outputBytes"] = args.output.stat().st_size
        atomic_json(args.report, report)
        last_checkpoint = time.monotonic()

    def consume(result):
        raw = result.pop("raw", None)
        if raw is not None:
            data = "data:image/webp;base64," + base64.b64encode(raw).decode("ascii")
            for product_id in groups[result["url"]]:
                output["products"][product_id] = data
        result["productIds"] = groups[result["url"]]
        report["records"].append(result)
        if result["status"] == "failed":
            report["failures"].append(result)
        processed = len(report["records"])
        if processed % 100 == 0 or time.monotonic() - last_checkpoint >= 30:
            checkpoint("running")
            print(f"THUMBNAIL_PROGRESS {processed}/{len(groups)} urls products={len(output['products'])}/{len(catalog['products'])} failures={len(report['failures'])}", flush=True)

    def run_phase(urls):
        queue = iter(urls)
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            active = {}
            def fill():
                while len(active) < args.workers * 2 and not pace.stop.is_set():
                    try:
                        url = next(queue)
                    except StopIteration:
                        return
                    active[executor.submit(process_image, url, args, pace, policy)] = url
            fill()
            while active:
                finished, _ = wait(active, return_when=FIRST_COMPLETED)
                for future in finished:
                    url = active.pop(future)
                    try:
                        result = future.result()
                    except Exception as error:
                        result = {"url": url, "status": "failed", "error": type(error).__name__ + ": " + str(error)}
                    consume(result)
                fill()

    selected_priority = [url for url in priority if url in ordered]
    run_phase(selected_priority)
    checkpoint("priority-ready")
    print(json.dumps({"event": "THUMBNAIL_PRIORITY_READY", "priorityUrls": len(selected_priority), "priorityProductIds": report["priorityProductIds"], "availableProducts": len(output["products"]), "output": str(args.output), "failures": len(report["failures"])}, ensure_ascii=False), flush=True)
    run_phase([url for url in ordered if url not in set(selected_priority)])
    checkpoint("complete" if len(output["products"]) == len(catalog["products"]) else "complete-with-missing" if not pace.stop.is_set() else "stopped")
    print(json.dumps({"output": str(args.output), "report": str(args.report), "products": len(output["products"]),
                      "expected": len(catalog["products"]), "uniqueImages": len(report["records"]),
                      "failures": len(report["failures"]), "invalid": len(invalid), "outputBytes": report["outputBytes"],
                      "complete": report["complete"], "stopped": pace.stop.is_set()}, ensure_ascii=False), flush=True)
    return 1 if pace.stop.is_set() else 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, urllib.error.URLError) as error:
        print(f"Public thumbnail build stopped: {type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(1)
