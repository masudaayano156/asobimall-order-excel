#!/usr/bin/env python3
"""Index the English titles displayed by ASOBIMALL's own Google widget.

Run after crawl_catalog.py. Only public catalog product titles are sent to the
same public translation transport used by ASOBIMALL's language selector.
The public widget key is read dynamically, kept in memory, never logged/saved.
Successful batches checkpoint under ignored references/, and catalog.json is
replaced only after every current product has an English display title.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import html
import json
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.request

BOOTSTRAP = "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit2"
TRANSPORT = "https://translate-pa.googleapis.com/v1/translateHtml"
METHOD = "asobimall-google-translate-widget"
GOLDENS = {
    "CS-0084": "CUTIE STREET OFFICIAL FAN LIGHT (AAA batteries included)",
    "CS-0293": "CUTIE STREET Member-Specific Acrylic Stands - Tweed Outfit Version -",
}


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(path)


def decode_js_url(value):
    value = re.sub(r"\\x([0-9a-fA-F]{2})", lambda match: chr(int(match[1], 16)), value)
    value = re.sub(r"\\u([0-9a-fA-F]{4})", lambda match: chr(int(match[1], 16)), value)
    return value.replace(r"\/", "/")


def apply_display_aliases(catalog, path):
    """Apply captured display variants only to matching public identities."""
    if not path.exists():
        return {"applied": [], "skipped": []}
    overrides = json.loads(path.read_text(encoding="utf-8")).get("overrides", [])
    by_slug = {product["slug"]: product for product in catalog["products"]}
    result = {"applied": [], "skipped": []}
    for entry in overrides:
        product = by_slug.get(entry["slug"])
        if not product or any(product.get(key) != entry.get(source_key) for key, source_key in
                              [("id", "id"), ("name", "sourceName"), ("productUrl", "productUrl")]):
            result["skipped"].append({"slug": entry["slug"], "reason": "Public source identity missing or changed"})
            continue
        aliases = product.setdefault("aliases", [])
        evidence = product.setdefault("enAliasSources", [])
        for alias in entry.get("aliases", []):
            if not isinstance(alias, str) or not alias.strip():
                raise RuntimeError("Captured display alias must be a nonempty string")
            if alias not in aliases:
                aliases.append(alias)
            if not any(item.get("alias") == alias for item in evidence):
                evidence.append({"alias": alias, "method": entry["method"],
                                 "observedAt": entry["observedAt"], "sourceName": entry["sourceName"],
                                 "verifiedProductUrl": entry["productUrl"], "verifiedImageUrl": entry["imageUrl"],
                                 "evidence": entry["evidence"]})
        result["applied"].append(entry["slug"])
    return result


class WidgetClient:
    def __init__(self, delay):
        self.delay = max(1.0, delay)
        self.last_request = 0
        self.requests = 0
        self.key = None
        self.widget_url = None

    def read(self, url, *, body=None, headers=None):
        wait = self.delay - (time.monotonic() - self.last_request)
        if wait > 0:
            time.sleep(wait)
        request_headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://asobisystem.shop/"}
        request_headers.update(headers or {})
        request = urllib.request.Request(url, data=body, headers=request_headers, method="POST" if body else "GET")
        self.last_request = time.monotonic()
        self.requests += 1
        with urllib.request.urlopen(request, timeout=35) as response:
            raw = response.read(6 * 1024 * 1024 + 1)
            if len(raw) > 6 * 1024 * 1024:
                raise RuntimeError("Public widget response exceeded expected size")
            return raw.decode("utf-8", "replace")

    def initialize(self):
        bootstrap = self.read(BOOTSTRAP)
        match = re.search(r"_loadJs\('([^']+)'\)", bootstrap)
        if not match:
            raise RuntimeError("Official Google widget bootstrap format changed; no alternate endpoint attempted")
        self.widget_url = decode_js_url(match[1])
        if not self.widget_url.startswith("https://translate.googleapis.com/_/translate_http/"):
            raise RuntimeError("Unexpected Google widget implementation host")
        implementation = self.read(self.widget_url)
        match = re.search(r'path:"/v1/translateHtml".{0,240}"X-goog-api-key":"([^"]+)"', implementation, re.S)
        if not match:
            raise RuntimeError("Public widget transport configuration changed; no alternate key/endpoint attempted")
        self.key = match[1]

    def translate(self, names):
        if not self.key:
            raise RuntimeError("Public widget has not initialized")
        # translateHtml receives HTML text; escape catalog titles so product-name
        # punctuation cannot become markup. No order/profile information enters.
        body = json.dumps([[[html.escape(name) for name in names], "ja", "en"], "te"], ensure_ascii=False).encode("utf-8")
        result = json.loads(self.read(TRANSPORT, body=body, headers={
            "Content-Type": "application/json+protobuf", "X-goog-api-key": self.key,
            "Origin": "https://asobisystem.shop",
        }))
        outputs = result[0] if isinstance(result, list) and result else None
        if not isinstance(outputs, list) or len(outputs) != len(names) or not all(isinstance(item, str) and item.strip() for item in outputs):
            raise RuntimeError("Widget translation count/type did not match public title inputs")
        return [re.sub(r"\s+", " ", html.unescape(value)).strip() for value in outputs]


def batches(names, max_chars, max_items):
    batch, count = [], 0
    for name in names:
        length = len(html.escape(name))
        if length > max_chars:
            raise RuntimeError("A public product title exceeds the configured widget batch size")
        if batch and (count + length > max_chars or len(batch) >= max_items):
            yield batch
            batch, count = [], 0
        batch.append(name)
        count += length
    if batch:
        yield batch


def main():
    base = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=base / "dist/catalog.json")
    parser.add_argument("--cache", type=Path, default=base / "references/catalog-english-cache.json")
    parser.add_argument("--overrides", type=Path, default=base / "scripts/catalog-english-overrides.json")
    parser.add_argument("--apply-overrides-only", action="store_true", help="Apply verified screenshot display aliases without network requests")
    parser.add_argument("--delay", type=float, default=1.05)
    parser.add_argument("--max-chars", type=int, default=3000)
    parser.add_argument("--max-items", type=int, default=60)
    parser.add_argument("--max-batches", type=int, default=100)
    args = parser.parse_args()
    if not 1 <= args.max_chars <= 3000 or not 1 <= args.max_items <= 60 or args.max_batches < 1:
        parser.error("Use 1..3000 chars, 1..60 items, and a positive batch bound")
    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    products = catalog.get("products")
    if not isinstance(products, list) or not products or catalog.get("source") != "https://asobisystem.shop":
        raise RuntimeError("Expected the public ASOBIMALL catalog")
    if args.apply_overrides_only:
        applied = apply_display_aliases(catalog, args.overrides)
        if "englishCoverage" in catalog:
            catalog["englishCoverage"]["capturedDisplayAliases"] = sum(len(product.get("enAliasSources", [])) for product in products)
            catalog["englishCoverage"]["capturedAliasesUpdatedAt"] = now()
        atomic_json(args.catalog, catalog)
        print(json.dumps({"catalog": str(args.catalog), "displayAliasOverrides": applied}, ensure_ascii=False), flush=True)
        return 0
    cache = json.loads(args.cache.read_text(encoding="utf-8")) if args.cache.exists() else {"method": METHOD, "entries": {}}
    if cache.get("method") != METHOD:
        raise RuntimeError("Cache has a different translation source")
    entries = cache["entries"]
    names = list(dict.fromkeys(product["name"] for product in products))
    # Exact unchanged ASCII source titles already constitute English aliases;
    # the site's widget has no Japanese text to translate in those strings.
    for name in names:
        if name.isascii() and name not in entries:
            entries[name] = {"enName": name, "translatedAt": now(), "method": "unchanged-ascii-catalog-title"}
    for product in products:
        if product.get("enName") and product.get("enSourceName") == product["name"] and product["name"] not in entries:
            entries[product["name"]] = {"enName": product["enName"], "translatedAt": product.get("enTranslation", {}).get("translatedAt", now()), "method": METHOD}
    client = WidgetClient(args.delay)
    client.initialize()
    by_slug = {product["slug"]: product for product in products}
    golden_products = [by_slug[slug] for slug in GOLDENS if slug in by_slug]
    golden_outputs = client.translate([product["name"] for product in golden_products])
    for product, output in zip(golden_products, golden_outputs):
        if output != GOLDENS[product["slug"]]:
            raise RuntimeError(f"Official English-title regression changed for {product['slug']}; catalog preserved")
        entries[product["name"]] = {"enName": output, "translatedAt": now(), "method": METHOD}
    atomic_json(args.cache, cache)
    pending = [name for name in names if name not in entries]
    pending_batches = list(batches(pending, args.max_chars, args.max_items))
    if len(pending_batches) > args.max_batches:
        raise RuntimeError(f"Translation needs {len(pending_batches)} batches, exceeding explicit bound; catalog preserved")
    print(f"Public titles: {len(products)} products / {len(names)} unique; {len(pending)} names in {len(pending_batches)} batches pending", flush=True)
    for index, batch in enumerate(pending_batches, 1):
        outputs = client.translate(batch)
        timestamp = now()
        for name, output in zip(batch, outputs):
            entries[name] = {"enName": output, "translatedAt": timestamp, "method": METHOD}
        cache["updatedAt"] = timestamp
        atomic_json(args.cache, cache)
        print(f"English widget batch {index}/{len(pending_batches)}: {sum(name in entries for name in names)}/{len(names)} unique public titles ready", flush=True)
    for product in products:
        translation = entries.get(product["name"])
        if not translation or not translation.get("enName"):
            raise RuntimeError("Not every current product has an English alias; catalog preserved")
        product["enName"] = translation["enName"]
        product["enSourceName"] = product["name"]
        product["enTranslation"] = {"method": translation["method"], "sourceLanguage": "ja", "targetLanguage": "en", "translatedAt": translation["translatedAt"]}
        aliases = list(product.get("aliases") or [])
        if product["enName"] not in aliases:
            aliases.append(product["enName"])
        product["aliases"] = aliases
    applied = apply_display_aliases(catalog, args.overrides)
    timestamp = now()
    catalog["englishCoverage"] = {
        "complete": True, "updatedAt": timestamp, "expectedProducts": len(products),
        "indexedProducts": sum(bool(product.get("enName")) for product in products),
        "uniqueSourceTitles": len(names), "sourceLanguage": "ja", "targetLanguage": "en",
        "method": METHOD, "officialSelector": "ASOBIMALL GTranslateTagManager / doGTranslate('ja|en')",
        "widgetBootstrapUrl": BOOTSTRAP, "widgetImplementationUrl": client.widget_url,
        "transportUrl": TRANSPORT, "translationRequestsThisRun": client.requests - 2,
        "minimumRequestIntervalSeconds": client.delay, "publicTitlesOnly": True,
        "unchangedAsciiTitles": sum(entries[name]["method"] == "unchanged-ascii-catalog-title" for name in names),
        "verifiedSamples": [{"slug": product["slug"], "productUrl": product["productUrl"], "enName": product["enName"]} for product in golden_products],
        "failures": [],
        "capturedDisplayAliases": sum(len(product.get("enAliasSources", [])) for product in products),
        "displayAliasOverrides": applied,
    }
    catalog["matchingNotes"] = [note for note in catalog.get("matchingNotes", []) if not note.startswith("Aliases contain official names")]
    catalog["matchingNotes"].append("English aliases are captured from the same Google translation widget transport used by ASOBIMALL's English selector; original ASCII titles are retained unchanged. No order/profile text is transmitted.")
    atomic_json(args.catalog, catalog)
    print(json.dumps({"catalog": str(args.catalog), "products": len(products), "englishAliases": catalog["englishCoverage"]["indexedProducts"], "complete": True, "verifiedSamples": catalog["englishCoverage"]["verifiedSamples"]}, ensure_ascii=False, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        raise SystemExit(main())
    except (urllib.error.URLError, ValueError, RuntimeError, OSError) as error:
        # Never dump headers, request objects, HTML/bootstrap text or widget keys.
        print(f"English catalog enrichment stopped: {type(error).__name__}: {error}. Existing final catalog preserved; successful public-title batches remain in the ignored cache.", file=sys.stderr)
        raise SystemExit(1)
