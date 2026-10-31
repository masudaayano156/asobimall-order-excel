#!/usr/bin/env python3
"""Manually refresh ASOBIMALL's unauthenticated public product catalog.

Run: python scripts/crawl_catalog.py
Only public site configuration, product search, product details and product
images are accessed. No login, account, cart, order or fan-club data is read.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import html
import json
import math
from pathlib import Path
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser

STOREFRONT = "https://asobisystem.shop"
API = "https://shop.api.groobee.com"
USER_AGENT = "OrderExcelCatalog/1.0 (+manual public product catalog refresh)"
TARGET_IMAGES = (
    "Z51Ta2ununni5HhHxUwRFLTR5lC7SZ4m9vBKMMJZ.jpg",
    "Z2zS54WGCRVYa06W8PjlEW2afy5rMF5nQDhLzF7b.jpg",
)


class PublicCatalogClient:
    def __init__(self, delay: float):
        self.delay = max(0.5, delay)
        self.last_request = {}
        self.robots = {}
        self.robots_report = []
        self.requests = 0
        self.site_code = None

    def read(self, url: str, use_site_code=False) -> bytes:
        parsed = urllib.parse.urlsplit(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin not in (STOREFRONT, API):
            raise ValueError(f"Unexpected catalog host: {origin}")
        if parsed.path != "/robots.txt":
            policy = self.robots.get(origin)
            if policy is None or not policy.can_fetch(USER_AGENT, url):
                raise RuntimeError(f"robots.txt not verified or access disallowed: {url}")
        wait = self.delay - (time.monotonic() - self.last_request.get(origin, 0))
        if wait > 0:
            time.sleep(wait)
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json,text/plain;q=0.9"}
        if use_site_code:
            if not self.site_code:
                raise RuntimeError("Public site slug must be loaded before catalog search")
            headers.update({"X-Bet-Site-Code": self.site_code,
                            "X-Requested-With": "XMLHttpRequest",
                            "Origin": STOREFRONT, "Referer": STOREFRONT + "/products"})
        self.requests += 1
        self.last_request[origin] = time.monotonic()
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as response:
            final = urllib.parse.urlsplit(response.url)
            if f"{final.scheme}://{final.netloc}" not in (STOREFRONT, API):
                raise RuntimeError("Unexpected redirect outside public storefront/API")
            limit = 12 * 1024 * 1024
            body = response.read(limit + 1)
            if len(body) > limit:
                raise RuntimeError("Catalog response exceeded 12 MB")
            return body

    def load_robots(self, origin: str):
        url = origin + "/robots.txt"
        policy = urllib.robotparser.RobotFileParser(url)
        try:
            body = self.read(url).decode("utf-8", "replace")
        except urllib.error.HTTPError as error:
            if error.code in (404, 410):
                policy.parse([])
                self.robots_report.append({"url": url, "status": error.code, "policy": "not published"})
            else:
                raise RuntimeError(f"Could not verify robots.txt ({error.code}); crawl stopped") from error
        else:
            policy.parse(body.splitlines())
            self.robots_report.append({"url": url, "status": 200, "policy": "obeyed"})
            crawl_delay = policy.crawl_delay(USER_AGENT) or policy.crawl_delay("*")
            if crawl_delay:
                self.delay = max(self.delay, float(crawl_delay))
            request_rate = policy.request_rate(USER_AGENT) or policy.request_rate("*")
            if request_rate and request_rate.requests:
                self.delay = max(self.delay, request_rate.seconds / request_rate.requests)
        self.robots[origin] = policy

    def json(self, path: str, site_code=True):
        if not path.startswith("/"):
            raise ValueError("Expected absolute public API path")
        return json.loads(self.read(API + path, use_site_code=site_code))


def clean_name(value):
    return re.sub(r"\s+", " ", html.unescape(str(value or ""))).strip()


def normalized_name(value):
    text = unicodedata.normalize("NFKC", clean_name(value)).casefold()
    return "".join(character for character in text if character.isalnum())


def safe_image(value):
    url = str(value or "").strip()
    parsed = urllib.parse.urlsplit(url)
    return url if parsed.scheme == "https" and parsed.hostname == "images.groobee.com" else ""


def product_record(raw):
    slug = str(raw.get("slug") or "").strip()
    if not slug or any(character in slug for character in "/?#"):
        raise ValueError("Public catalog product is missing valid official slug")
    name = clean_name(raw.get("name"))
    if not name:
        raise ValueError(f"Public catalog product {slug} has no name")
    code = str(raw.get("code") or slug)
    image = safe_image(raw.get("imageUrl"))
    aliases = [name]
    stripped = re.sub(r"\s*[（(]全\s*\d+\s*種[）)]\s*$", "", name).strip()
    if stripped and stripped != name:
        aliases.append(stripped)
    if code not in aliases:
        aliases.append(code)
    return {
        "id": raw.get("id"), "slug": slug, "code": code, "name": name,
        # Verified public client route /products/:slug, with slug from live API.
        "productUrl": STOREFRONT + "/products/" + urllib.parse.quote(slug, safe=""),
        "imageUrl": image, "images": [image] if image else [],
        "aliases": aliases, "normalizedName": normalized_name(name),
    }


def collect_image_urls(value):
    found = []
    if isinstance(value, dict):
        for key, child in value.items():
            candidates = [safe_image(child)] if key == "imageUrl" else collect_image_urls(child)
            for image in candidates:
                if image and image not in found:
                    found.append(image)
    elif isinstance(value, list):
        for child in value:
            for image in collect_image_urls(child):
                if image not in found:
                    found.append(image)
    return found


def crawl(args):
    client = PublicCatalogClient(args.delay)
    client.load_robots(STOREFRONT)
    client.load_robots(API)
    config = client.json("/site_configs/asobisystem.shop", site_code=False)
    client.site_code = str(config.get("slug") or "")
    if client.site_code != "asobisystem":
        raise RuntimeError("Unexpected public site identity; crawl stopped")
    next_path = "/products/search?" + urllib.parse.urlencode({"per_page": args.page_size, "current_page": 1})
    seen_pages, products, failures, pagination_fallbacks = set(), {}, [], []
    pages, expected = 0, 0
    while next_path:
        if pages >= args.max_pages or next_path in seen_pages:
            failures.append({"url": API + next_path, "error": "Pagination bound or repeated page reached"})
            break
        parsed = urllib.parse.urlsplit(next_path)
        if parsed.path != "/products/search" or parsed.netloc:
            raise RuntimeError("Unexpected catalog pagination path")
        seen_pages.add(next_path)
        try:
            data = client.json(next_path)
        except (urllib.error.URLError, ValueError, RuntimeError) as error:
            failures.append({"url": API + next_path, "error": str(error)})
            break
        pages += 1
        expected = max(expected, int(data.get("total") or 0))
        batch = data.get("_embedded", {}).get("products")
        if not isinstance(batch, list):
            raise RuntimeError("Public API did not return product list")
        for raw in batch:
            try:
                record = product_record(raw)
            except ValueError as error:
                failures.append({"page": pages, "error": str(error)})
                continue
            products[record["slug"]] = record
        page_total = math.ceil(expected / max(1, int(data.get("perPage") or args.page_size)))
        print(f"Catalog page {pages}/{page_total}: {len(products)}/{expected} unique products", flush=True)
        next_path = data.get("_links", {}).get("next", {}).get("href")
        # The live API can omit its next link on the penultimate page even
        # while total/perPage and the explicit last-page link report more.
        # Follow that published pagination contract with a bounded next page.
        last_href = data.get("_links", {}).get("last", {}).get("href")
        last_query = urllib.parse.parse_qs(urllib.parse.urlsplit(last_href or "").query)
        current_query = urllib.parse.parse_qs(parsed.query)
        current_page = int(current_query.get("current_page", [pages])[0])
        reported_last = int(last_query.get("current_page", [0])[0])
        if not next_path and batch and len(products) < expected and current_page < reported_last:
            current_query["current_page"] = [str(current_page + 1)]
            next_path = "/products/search?" + urllib.parse.urlencode(current_query, doseq=True)
            pagination_fallbacks.append({"afterPage": current_page, "nextPage": current_page + 1,
                                         "reason": "Missing next link despite published last-page link"})
        if next_path and not batch:
            failures.append({"page": pages, "error": "Empty page with next-page link"})
            break
    detail_verified, target_matches = [], []
    for fingerprint in TARGET_IMAGES:
        for record in products.values():
            if fingerprint not in record["imageUrl"]:
                continue
            path = "/products/" + urllib.parse.quote(record["slug"], safe="")
            try:
                detail = client.json(path)
                if detail.get("_links", {}).get("self", {}).get("href") != path or detail.get("id") != record["id"]:
                    raise RuntimeError("Product detail identity did not match catalog")
                detail_verified.append(record["productUrl"])
                images = client.json(path + "/images")
                for image in collect_image_urls(images.get("_embedded", {})):
                    if image not in record["images"]:
                        record["images"].append(image)
            except (urllib.error.URLError, ValueError, RuntimeError) as error:
                failures.append({"url": API + path, "error": str(error), "kind": "target-detail"})
            target_matches.append({key: record[key] for key in ("id", "name", "productUrl", "imageUrl")} | {"imageFingerprint": fingerprint})
    if len(products) != expected:
        failures.append({"error": f"Expected {expected} products, collected {len(products)} unique products"})
    return {
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "source": STOREFRONT,
        "scope": "All products exposed by ASOBIMALL's unauthenticated public catalog search, including sold-out/ended products.",
        "products": list(products.values()),
        "coverage": {
            "complete": not failures, "expectedProducts": expected, "indexedProducts": len(products),
            "productsWithPrimaryImage": sum(bool(record["imageUrl"]) for record in products.values()),
            "pagesFetched": pages, "requests": client.requests,
            "minimumRequestIntervalSeconds": client.delay,
            "apiSearch": API + "/products/search", "publicSiteCode": client.site_code,
            "robots": client.robots_report, "targetMatches": target_matches,
            "paginationFallbacks": pagination_fallbacks,
            "detailVerifiedProductUrls": detail_verified, "failures": failures,
        },
        "matchingNotes": [
            "Prefer exact image URL or image filename. Shared images may match multiple products; do not silently choose an ambiguous match.",
            "Name fallback should normalize Unicode width, whitespace, punctuation and case, then require a unique match.",
            "Aliases contain official names, count-suffix-free names when applicable and product codes; no translated names are invented.",
            "Primary images are indexed for all products; public gallery images are included for the two target products.",
            "Manual snapshot: refresh by running scripts/crawl_catalog.py; no scheduled job is installed.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "dist" / "catalog.json")
    parser.add_argument("--delay", type=float, default=1.0, help="Minimum request interval per host; at least 0.5 seconds")
    parser.add_argument("--page-size", type=int, default=100, choices=range(1, 101), metavar="1..100")
    parser.add_argument("--max-pages", type=int, default=60)
    parser.add_argument("--allow-partial", action="store_true", help="Explicitly allow incomplete replacement")
    args = parser.parse_args()
    if args.max_pages < 1:
        parser.error("--max-pages must be positive")
    result = crawl(args)
    coverage = result["coverage"]
    if not coverage["complete"] and not args.allow_partial:
        print(json.dumps(coverage, ensure_ascii=False, indent=2), file=sys.stderr)
        print("Incomplete crawl; existing catalog preserved. --allow-partial explicitly permits incomplete snapshots.", file=sys.stderr)
        return 1
    # Preserve verified English aliases when a public product's source name has
    # not changed. New/renamed titles are enriched separately through the same
    # Google widget used by the storefront, never guessed during the crawl.
    if args.output.exists():
        previous = json.loads(args.output.read_text(encoding="utf-8"))
        previous_products = {str(product.get("id")): product for product in previous.get("products", [])}
        retained = 0
        for product in result["products"]:
            old = previous_products.get(str(product.get("id")))
            if not old or old.get("name") != product.get("name") or old.get("enSourceName") != product.get("name") or not old.get("enName"):
                continue
            for field in ("enName", "enSourceName", "enTranslation", "enAliasSources"):
                if field in old:
                    product[field] = old[field]
            product["aliases"] = list(dict.fromkeys([*product["aliases"], *(old.get("aliases") or []), old["enName"]]))
            retained += 1
        if retained:
            result["englishCoverage"] = {**previous.get("englishCoverage", {}),
                "complete": retained == len(result["products"]), "expectedProducts": len(result["products"]),
                "indexedProducts": retained, "retainedFromPreviousSnapshot": True,
                "capturedDisplayAliases": sum(len(product.get("enAliasSources", [])) for product in result["products"]),
                "needsRefresh": retained < len(result["products"])}
            result["matchingNotes"].append("Verified English aliases are preserved for unchanged source product titles. Run scripts/enrich_catalog_english.py after crawling to cover new or renamed titles.")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(args.output)
    print(json.dumps({"output": str(args.output), "complete": coverage["complete"],
                      "products": coverage["indexedProducts"], "pages": coverage["pagesFetched"],
                      "failures": coverage["failures"], "targets": coverage["targetMatches"]}, ensure_ascii=False, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        raise SystemExit(main())
    except (urllib.error.URLError, ValueError, RuntimeError) as error:
        print(f"Public catalog refresh stopped: {error}", file=sys.stderr)
        raise SystemExit(1)
