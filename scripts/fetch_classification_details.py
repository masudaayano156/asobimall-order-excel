#!/usr/bin/env python3
"""Cache official public details for the unclassified-product review queue.

Only /products/{verified catalog slug} is requested. No accounts, orders,
customer profiles, alternative protected URLs or classification edits are used.
Evidence stays under ignored references/ and .verification/ directories.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import socket
import sys
import time
import urllib.error
import urllib.parse

sys.dont_write_bytecode = True
from crawl_catalog import API, STOREFRONT, PublicCatalogClient


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def digest(value):
    return hashlib.sha256(value).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(path)


class DescriptionText(HTMLParser):
    BLOCKS = {"p", "div", "br", "li", "ul", "ol", "tr", "td", "th", "h1", "h2", "h3", "h4", "section", "article"}
    SKIP = {"script", "style", "noscript", "iframe", "object", "embed"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip_depth = 0
        self.image_alts = []

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip_depth += 1
        if self.skip_depth:
            return
        if tag in self.BLOCKS:
            self.parts.append("\n")
        if tag == "img":
            alt = dict(attrs).get("alt", "").strip()
            if alt:
                self.image_alts.append(alt)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag in self.SKIP:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            self.skip_depth = max(0, self.skip_depth - 1)
        elif not self.skip_depth and tag in self.BLOCKS:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skip_depth:
            self.parts.append(data)

    def text(self):
        lines = [re.sub(r"[\t \u3000\xa0]+", " ", line).strip() for line in "".join(self.parts).splitlines()]
        return "\n".join(line for line in lines if line)


EXPLICIT_LABELS = {
    "素材", "材質", "サイズ", "寸法", "商品説明", "商品内容", "セット内容", "内容物", "内容", "仕様",
    "商品仕様", "容量", "内容量", "商品詳細", "注意事項", "ご注意事項", "販売期間", "購入制限",
    "発送予定", "配送予定", "受注期間", "Material", "Materials", "Size", "Dimensions", "Contents",
}


def heading(line):
    match = re.match(r"^[【［\[]([^】］\]]{1,60})[】］\]]\s*[:：]?\s*(.*)$", line)
    if match:
        return match[1].strip(), match[2].strip()
    match = re.match(r"^[■◆◇●◎]\s*([^:：]{1,40})[:：]\s*(.*)$", line)
    if match:
        return match[1].strip(), match[2].strip()
    stripped = re.sub(r"^[■◆◇●◎]\s*", "", line).strip()
    if stripped in EXPLICIT_LABELS:
        return stripped, ""
    match = re.match(r"^((?:本体|表面|裏面|本体部分|印刷部)?(?:素材|材質)|サイズ|寸法|セット内容|商品内容|内容物|商品説明|仕様|容量|内容量|Material(?:s)?|Size|Dimensions)\s*[:：]\s*(.*)$", line, re.I)
    return (match[1].strip(), match[2].strip()) if match else None


def extract_description(html):
    parser = DescriptionText()
    parser.feed(html)
    parser.close()
    text = parser.text()
    sections = []
    current = None
    for line in text.splitlines():
        label = heading(line)
        if label:
            current = {"label": label[0], "lines": [label[1]] if label[1] else []}
            sections.append(current)
        elif current is not None:
            current["lines"].append(line)
    material = [{"label": section["label"], "text": "\n".join(section["lines"])} for section in sections
                if re.search(r"素材|材質|materials?", section["label"], re.I)]
    size = [{"label": section["label"], "text": "\n".join(section["lines"])} for section in sections
            if re.search(r"サイズ|寸法|size|dimensions", section["label"], re.I)]
    return text, sections, material, size, parser.image_alts


def expected_path(product):
    slug = str(product.get("slug") or "")
    if not slug or any(character in slug for character in "/?#"):
        raise ValueError("Inventory product has an invalid source slug")
    product_id = product.get("id")
    if not isinstance(product_id, int) or product_id <= 0:
        raise ValueError("Inventory product has an invalid numeric ID")
    api_path = "/products/" + urllib.parse.quote(slug, safe="")
    if product.get("productUrl") != STOREFRONT + api_path:
        raise ValueError("Inventory URL does not match the known public product route")
    return api_path


def identity(detail, product):
    path = expected_path(product)
    href = detail.get("_links", {}).get("self", {}).get("href", "")
    parsed = urllib.parse.urlsplit(href)
    valid_origin = not parsed.netloc or f"{parsed.scheme}://{parsed.netloc}" in (API, STOREFRONT)
    self_matches = valid_origin and not parsed.query and not parsed.fragment and urllib.parse.unquote(parsed.path) == urllib.parse.unquote(path)
    matches = {"idMatches": detail.get("id") == product["id"], "selfMatches": self_matches,
               "catalogNameMatches": detail.get("name") == product.get("name")}
    if not matches["idMatches"] or not matches["selfMatches"]:
        raise ValueError("Public product identity did not match inventory ID and canonical self path")
    return matches


def valid_cache(path, product):
    try:
        cache = json.loads(path.read_text(encoding="utf-8"))
        if cache.get("id") != product["id"] or cache.get("slug") != product["slug"] or cache.get("productUrl") != product["productUrl"]:
            return None
        identity(cache["detail"], product)
        html = cache["detail"].get("description") or ""
        if cache.get("source", {}).get("descriptionHtmlSha256") != digest(html.encode("utf-8")):
            return None
        return cache
    except (OSError, ValueError, TypeError, KeyError):
        return None


def retry_after(headers):
    raw = headers.get("Retry-After") if headers else None
    if not raw:
        return 0
    try:
        return max(0, float(raw))
    except ValueError:
        try:
            date = parsedate_to_datetime(raw)
            return max(0, (date - datetime.now(timezone.utc)).total_seconds())
        except (ValueError, TypeError):
            return 0


def fetch_one(client, product, retries, max_retry_wait):
    api_path = expected_path(product)
    for attempt in range(retries + 1):
        try:
            raw = client.read(API + api_path, use_site_code=True)
            if raw.lstrip().startswith(b"<"):
                return None, {"kind": "non-json-public-api-response", "stopQueue": True}
            detail = json.loads(raw)
            guard = identity(detail, product)
            return {"raw": raw, "detail": detail, "identity": guard, "attempts": attempt + 1}, None
        except urllib.error.HTTPError as error:
            status = error.code
            transient = status in (408, 425, 429, 500, 502, 503, 504)
            wait = max(2 ** (attempt + 1), retry_after(error.headers))
            stop = status in (401, 403, 429)
            if transient and attempt < retries and wait <= max_retry_wait:
                time.sleep(wait)
                continue
            return None, {"kind": "http-error", "status": status, "attempts": attempt + 1,
                          "retryAfterSeconds": wait if transient else None, "stopQueue": stop}
        except (urllib.error.URLError, TimeoutError, socket.timeout) as error:
            if attempt < retries:
                time.sleep(min(2 ** (attempt + 1), max_retry_wait))
                continue
            return None, {"kind": "transport-error", "errorType": type(error).__name__, "attempts": attempt + 1, "stopQueue": False}
        except (ValueError, TypeError, KeyError) as error:
            return None, {"kind": "identity-or-json-error", "message": str(error), "attempts": attempt + 1, "stopQueue": False}


def snapshot(product, position, fetched):
    detail = fetched["detail"]
    html = detail.get("description") or ""
    text, sections, material, size, alts = extract_description(html)
    return {
        "schemaVersion": 1, "position": position, "catalogIndex": product.get("index"),
        "id": product["id"], "slug": product["slug"], "name": detail.get("name"),
        "catalogName": product.get("name"), "enName": product.get("enName"),
        "productUrl": product["productUrl"], "imageUrl": product.get("imageUrl"),
        "fetchedAt": timestamp(), "identity": fetched["identity"],
        "source": {"pageUrl": product["productUrl"], "apiUrl": API + expected_path(product), "status": 200,
                   "siteCode": "asobisystem", "responseSha256": digest(fetched["raw"]),
                   "descriptionHtmlSha256": digest(html.encode("utf-8"))},
        "descriptionHtml": html, "descriptionText": text, "explicitSections": sections,
        "material": material, "size": size, "descriptionImageAlts": alts,
        "sourceCategories": detail.get("_embedded", {}).get("primaryCategory", []),
        "catalogClassification": product.get("classification"), "detail": detail,
    }


def main():
    base = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=base / ".verification/unclassified-products.json")
    parser.add_argument("--cache-dir", type=Path, default=base / "references/classification-details")
    parser.add_argument("--report", type=Path, default=base / ".verification/detail-fetch-report.json")
    parser.add_argument("--delay", type=float, default=1.05)
    parser.add_argument("--retries", type=int, default=2, choices=range(3))
    parser.add_argument("--max-retry-wait", type=float, default=30)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive")
    if not 1 <= args.max_retry_wait <= 60:
        parser.error("--max-retry-wait must be 1..60 seconds")
    inventory = json.loads(args.input.read_text(encoding="utf-8"))
    all_products = inventory.get("products", [])
    if not all_products or inventory.get("pendingCount") != len(all_products):
        raise RuntimeError("Expected a complete, explicit unclassified-product inventory")
    if len({product["id"] for product in all_products}) != len(all_products):
        raise RuntimeError("Inventory contains duplicate product IDs")
    for product in all_products:
        expected_path(product)
    products = all_products[:args.limit] if args.limit else all_products
    report = {"schemaVersion": 1, "startedAt": timestamp(), "updatedAt": timestamp(),
              "input": str(args.input.resolve()), "inventorySha256": digest(args.input.read_bytes()),
              "catalogTotal": inventory.get("total"), "expectedCount": len(all_products), "selectedCount": len(products),
              "cacheDirectory": str(args.cache_dir.resolve()), "status": "running", "complete": False,
              "summary": {}, "robots": [], "minimumRequestIntervalSeconds": max(1.05, args.delay), "records": []}
    args.cache_dir.mkdir(parents=True, exist_ok=True)

    def checkpoint(status="running"):
        records = report["records"]
        ready = [record for record in records if record["status"] in ("fetched", "cached")]
        failed = [record for record in records if record["status"] == "failed"]
        report.update({"updatedAt": timestamp(), "status": status,
                       "summary": {"processed": len(records), "ready": len(ready),
                                   "fetched": sum(record["status"] == "fetched" for record in records),
                                   "reusedCache": sum(record["status"] == "cached" for record in records),
                                   "failed": len(failed), "pending": len(all_products) - len(records)},
                       "complete": len(ready) == len(all_products) and not failed})
        write_json(args.report, report)

    checkpoint()
    client = PublicCatalogClient(max(1.05, args.delay))
    try:
        client.load_robots(STOREFRONT)
        client.load_robots(API)
        config = client.json("/site_configs/asobisystem.shop", site_code=False)
        client.site_code = str(config.get("slug") or "")
        if client.site_code != "asobisystem" or config.get("mallId") != 99:
            raise RuntimeError("Public site identity differs from ASOBIMALL")
        report["robots"] = client.robots_report
        report["minimumRequestIntervalSeconds"] = client.delay
        checkpoint()
        consecutive_failures = 0
        stopped = False
        for position, product in enumerate(products, 1):
            cache_path = args.cache_dir / f"{product['id']}.json"
            cached = valid_cache(cache_path, product) if cache_path.exists() else None
            record = {"position": position, "catalogIndex": product.get("index"), "id": product["id"],
                      "slug": product["slug"], "productUrl": product["productUrl"], "cachePath": str(cache_path.resolve())}
            if cached is not None:
                record.update({"status": "cached", "cacheSha256": digest(cache_path.read_bytes()),
                               "responseSha256": cached["source"]["responseSha256"],
                               "catalogNameMatches": cached["identity"]["catalogNameMatches"]})
                consecutive_failures = 0
            else:
                fetched, error = fetch_one(client, product, args.retries, args.max_retry_wait)
                if error:
                    record.update({"status": "failed", "error": error})
                    consecutive_failures += 1
                    stopped = error.get("stopQueue", False) or consecutive_failures >= 5
                else:
                    cached = snapshot(product, position, fetched)
                    write_json(cache_path, cached)
                    record.update({"status": "fetched", "cacheSha256": digest(cache_path.read_bytes()),
                                   "responseSha256": cached["source"]["responseSha256"], "attempts": fetched["attempts"],
                                   "catalogNameMatches": cached["identity"]["catalogNameMatches"]})
                    consecutive_failures = 0
            report["records"].append(record)
            report["requests"] = client.requests
            if position % 25 == 0 or position == len(products) or stopped:
                checkpoint("stopped" if stopped else "running")
                counts = report["summary"]
                print(f"DETAIL_PROGRESS {position}/{len(all_products)} ready={counts['ready']} fetched={counts['fetched']} cached={counts['reusedCache']} failed={counts['failed']}", flush=True)
            if position % 50 == 0:
                print(f"REVIEW_READY through_position={position} cache_dir={args.cache_dir.resolve()}", flush=True)
            if stopped:
                break
        checkpoint("complete" if len(report["records"]) == len(all_products) and not any(record["status"] == "failed" for record in report["records"]) else "incomplete")
        print(json.dumps({"report": str(args.report.resolve()), "complete": report["complete"],
                          "summary": report["summary"], "requests": client.requests,
                          "failures": [{"position": record["position"], "id": record["id"], "slug": record["slug"], "error": record["error"]} for record in report["records"] if record["status"] == "failed"]}, ensure_ascii=False), flush=True)
        return 0 if report["complete"] else 1
    except BaseException:
        report["requests"] = client.requests
        checkpoint("interrupted-or-blocked")
        raise


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        raise SystemExit(main())
    except (urllib.error.URLError, OSError, ValueError, RuntimeError) as error:
        print(f"Public detail fetch stopped: {type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(1)
