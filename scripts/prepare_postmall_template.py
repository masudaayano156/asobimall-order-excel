#!/usr/bin/env python3
"""Inspect and prepare a private-data-free Postmall horizontal template copy.

The user-supplied original is read only. Rows 1..3, styles, column geometry,
header comments and machine field names are preserved. Example input values,
unreferenced example strings, stale sample hyperlinks and author/path metadata
are removed from the new distributable copy. No network or publishing is used.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
from zipfile import ZipFile

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
ROW_RE = re.compile(r"<row\b[^>]*?(?:/>|>[\s\S]*?</row>)")
CELL_RE = re.compile(r"<c\b[^>]*?(?:/>|>[\s\S]*?</c>)")
SI_RE = re.compile(r"<si\b[^>]*?(?:/>|>[\s\S]*?</si>)")
COMMON_FIELDS = [
    "SHPR_NM", "SHPR_TEL", "ORDER_NO", "SOCIAL_ID", "CNEE_NM", "CNEE_ZIP", "CNEE_ZIP_ADDR", "CNEE_MEMO", "CNEE_TEL", "CARGO_REPORT_TYPE",
    "INSPECTION", "BUBBLE_WRAP", "REINFORCEMENT", "BUSINESS_CLEARANCE", "FTA_CLEARANCE", "BOX_REMOVAL", "REMOVE_INVOICE", "REMOVE_HANGER", "AUTO_OUTPUT", "SPLIT_DELIVERY", "SPLIT_DELIVERY_POLYBAG",
]
ITEM_FIELDS = ["ITEM_NM", "ITEM_BRAND", "ITEM_COLOR", "ITEM_SIZE", "ITEM_QTY", "ITEM_PRICE", "ITEM_AMT", "ITEM_HS_CD", "ITEM_IMAGE_URL", "ITEM_PRODUCT_URL", "ITEM_TRACKING_NO"]
COMMON_KEYS = ["senderName", "senderPhone", "merchantOrderNo", "customs", "recipient", "postal", "address", "courierNote", "phone", "cargoReportType", "inspection", "bubbleWrap", "reinforcement", "businessClearance", "ftaClearance", "packagingMode", "removeInvoice", "removeHanger", "autoOutput", "splitDeliveryBox", "splitDeliveryPolybag"]
ITEM_KEYS = ["name", "brand", "color", "size", "quantity", "unitPrice", "lineTotal", "hsCode", "imageUrl", "productUrl", "tracking"]


def sha(value):
    return hashlib.sha256(value).hexdigest()


def column(number):
    text = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        text = chr(65 + remainder) + text
    return text


def attribute(text, name):
    found = re.search(r"\b" + re.escape(name) + r'="([^"]*)"', text)
    return found[1] if found else None


def cell_value(cell, strings):
    value = cell.find("m:v", NS)
    text = value.text if value is not None and value.text else ""
    if cell.attrib.get("t") == "s" and text:
        return strings[int(text)]
    if cell.attrib.get("t") == "inlineStr":
        return "".join(node.text or "" for node in cell.findall(".//m:t", NS))
    return text


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def inspect_source(parts):
    workbook = ET.fromstring(parts["xl/workbook.xml"])
    sheets = workbook.findall("m:sheets/m:sheet", NS)
    if len(sheets) != 1 or sheets[0].attrib.get("name") != "Sheet1":
        raise ValueError("Expected the verified single-sheet Postmall horizontal layout")
    sheet = ET.fromstring(parts["xl/worksheets/sheet1.xml"])
    sst = ET.fromstring(parts["xl/sharedStrings.xml"])
    strings = ["".join(t.text or "" for t in entry.findall(".//m:t", NS)) for entry in sst.findall("m:si", NS)]
    cells = {cell.attrib["r"]: cell for cell in sheet.findall("m:sheetData/m:row/m:c", NS)}
    expected = [*COMMON_FIELDS, *[f"{field}_{slot}" for slot in range(1, 21) for field in ITEM_FIELDS]]
    if any(cell_value(cells[f"{column(index)}1"], strings) != field for index, field in enumerate(expected, 1)):
        raise ValueError("Machine headers do not match the verified 21 + 20x11 Postmall layout")
    if sheet.findall(".//m:f", NS):
        raise ValueError("This template revision contains formulas and needs a new preservation review")
    comments_root = ET.fromstring(parts["xl/comments1.xml"])
    comments = {comment.attrib["ref"]: "".join(t.text or "" for t in comment.findall(".//m:t", NS)) for comment in comments_root.findall("m:commentList/m:comment", NS)}
    headers = [{"column": column(index), "code": field, "label": cell_value(cells[f"{column(index)}3"], strings),
                "style": cells.get(f"{column(index)}4", cells[f"{column(index)}3"]).attrib.get("s"),
                "requiredByTemplate": None} for index, field in enumerate(expected, 1)]
    slots = [{"slot": slot, "startColumn": column(22 + (slot - 1) * 11), "endColumn": column(32 + (slot - 1) * 11),
              "columns": {key: column(22 + (slot - 1) * 11 + offset) for offset, key in enumerate(ITEM_KEYS)}} for slot in range(1, 21)]
    config = {
        "schemaVersion": 1, "provider": "postmall", "sourceFile": "Postmall-v2.1-horizontal.xlsx",
        "officialSite": "https://www.postmall.net/", "officialHsFinderUrl": "https://www.postmall.net/hs-finder",
        "sheet": "Sheet1", "sheetPath": "xl/worksheets/sheet1.xml", "columnsRange": "A:IG", "columnCount": 241,
        "machineHeaderRow": 1, "groupHeaderRow": 2, "labelHeaderRow": 3, "headerRows": [1, 2, 3], "startRow": 4,
        "maxItemsPerRow": 20, "maxItemsPerRequest": 20, "itemFieldCount": 11, "commonFieldCount": 21,
        "preformattedLastRow": 300, "preformattedRequestRows": 297,
        "preformattedRowLimitIsServerLimit": False,
        "grouping": "One application per row; its products occupy up to 20 horizontal slots. Do not silently split a 21st product into a second application.",
        "headers": headers, "commonColumns": dict(zip(COMMON_KEYS, [column(i) for i in range(1, 22)])),
        "itemSlots": slots, "comments": comments, "formulas": {}, "lists": {},
        "hasEmbeddedCodebook": False, "hasDropdowns": bool(sheet.findall("m:dataValidations/m:dataValidation", NS)),
        "classification": {"field": "ITEM_HS_CD_n", "label": "HS CODE", "requiredByTemplate": None,
                           "embeddedCodes": [], "sampleCodeFormat": "six decimal digits", "sampleCode": "640299",
                           "allowedPatternByTemplate": None, "sourceUrl": "https://www.postmall.net/hs-finder",
                           "publicFinderBundleUrl": "https://www.postmall.net/_next/static/chunks/pages/hs-finder-8a9db0e617358f2c0c8a.js",
                           "observedSearchRoute": "/api/hscodes", "observedSearchParams": {"tag": True, "q": "user-entered public finder query"},
                           "observedMinimumQueryLength": 2, "wholeCodebookEmbeddedInFinderBundle": False,
                           "runtimeAutoSearchConfigured": False,
                           "guidance": "No Postmall item codebook is embedded. Do not reuse Jimpass or Hoottown list IDs. Missing codes are draft values; the template does not explicitly state that HS may be omitted."},
        "requiredFields": {"explicitlyMarkedRequired": [], "requirednessSpecified": False,
                           "explicitBlankAllowed": ["cargoReportType", "items[].tracking"],
                           "note": "Headers have no required-star markers. Only the report-type and tracking comments explicitly allow blanks; absence of a marker does not prove that other inputs are optional."},
        "cargoReportType": {"values": [{"code": "F", "label": "일반통관"}, {"code": "B", "label": "목록통관"}], "default": "", "blankAllowed": True, "sourceCell": "J3"},
        "optionTrueTokens": ["T", "TRUE"], "optionDefault": "",
        "booleanOptions": [key for key in COMMON_KEYS[10:] if key not in ["packagingMode", "ftaClearance"]],
        "packagingMode": {"column": "P", "default": "", "values": [{"code": "A", "label": "그대로 발송"}, {"code": "B", "label": "폴리백 포장"}, {"code": "C", "label": "박스 재포장"}], "sourceCell": "P3", "isBoolean": False},
        "ftaClearance": {"column": "O", "default": "", "trueToken": "TRUE", "onlyCountryByTemplate": "Canada", "onlyOriginCountryByTemplate": "Canada", "sourceCell": "O3", "japanDefault": ""},
        "defaults": {key: "" for key in COMMON_KEYS[9:]},
        "phone": {"templateSampleHasHyphens": True, "requiredPattern": None, "maxLength": None, "formatRestrictionSpecified": False},
        "productName": {"languageRequirementSpecifiedByTemplate": False, "allowedPattern": None, "maxLength": None, "sampleContainsApostropheAndHyphen": True},
        "senderRecipientName": {"maxLength": None, "allowedPattern": None, "restrictionSpecified": False},
        "upstreamSelections": {"countryColumn": None, "centerColumn": None, "currencyColumn": None, "carrierColumn": None,
                               "note": "Country, center, currency and carrier are not columns in this workbook. Confirm them in the Postmall application interface."},
        "amounts": {"quantityKey": "ITEM_QTY_n", "unitPriceKey": "ITEM_PRICE_n", "lineTotalKey": "ITEM_AMT_n", "lineTotalCalculation": "quantity * unitPrice", "originalFormula": False},
        "notes": ["ORDER_NO is described as the purchasing-agent business order reference, not the carrier tracking number.",
                  "G contains the complete recipient address; F is a separate postal code.",
                  "P is an A/B/C packing mode despite the technical key BOX_REMOVAL; do not write Y/N.",
                  "Do not import institution-specific Jimpass or Hoottown category IDs into ITEM_HS_CD.",
                  "The sanitized copy has all input/example values removed from row4 onward. Header styles and comments are preserved."],
    }
    return config, sheet, cells, strings


def sanitize(parts):
    result = dict(parts)
    original_sheet = parts["xl/worksheets/sheet1.xml"].decode("utf-8")
    input_rows_with_values = sum(
        int(attribute(row, "r") or 0) >= 4 and bool(re.search(r"<v>[^<]+</v>|<is\b|<f\b", row))
        for row in ROW_RE.findall(original_sheet)
    )

    def blank_row(match):
        row = match[0]
        if int(attribute(row, "r") or 0) < 4:
            return row
        def blank_cell(cell_match):
            cell = cell_match[0]
            opening = re.match(r"<c\b[^>]*", cell)[0]
            opening = re.sub(r'\s+t="[^"]*"', "", opening)
            return opening.rstrip("/") + "/>"
        return CELL_RE.sub(blank_cell, row)

    sheet = ROW_RE.sub(blank_row, original_sheet)
    sheet = re.sub(r"<hyperlinks\b[^>]*>[\s\S]*?</hyperlinks>", "", sheet)
    used = []
    for cell in CELL_RE.findall(sheet):
        if attribute(cell, "t") == "s":
            match = re.search(r"<v>(\d+)</v>", cell)
            if match:
                used.append(int(match[1]))
    old_sst = parts["xl/sharedStrings.xml"].decode("utf-8")
    entries = SI_RE.findall(old_sst)
    selected = sorted(set(used))
    remap = {old: new for new, old in enumerate(selected)}
    if any(index >= len(entries) for index in selected):
        raise ValueError("Shared string reference is out of range")
    def reindex(match):
        cell = match[0]
        return re.sub(r"<v>(\d+)</v>", lambda value: f"<v>{remap[int(value[1])]}</v>", cell) if attribute(cell, "t") == "s" else cell
    sheet = CELL_RE.sub(reindex, sheet)
    opening = re.search(r"<sst\b[^>]*>", old_sst)
    tag = re.sub(r'\bcount="\d+"', f'count="{len(used)}"', opening[0])
    tag = re.sub(r'\buniqueCount="\d+"', f'uniqueCount="{len(selected)}"', tag)
    new_sst = old_sst[:opening.start()] + tag + "".join(entries[index] for index in selected) + "</sst>"
    result["xl/sharedStrings.xml"] = new_sst.encode("utf-8")
    result["xl/worksheets/sheet1.xml"] = sheet.encode("utf-8")
    rel_path = "xl/worksheets/_rels/sheet1.xml.rels"
    if rel_path in result:
        text = result[rel_path].decode("utf-8")
        result[rel_path] = re.sub(r'<Relationship\b[^>]*\bType="[^"]*/hyperlink"[^>]*/>', "", text).encode("utf-8")
    for name in ["docProps/core.xml", "docProps/app.xml"]:
        if name not in result:
            continue
        text = result[name].decode("utf-8")
        text = re.sub(r'<((?:[\w.-]+:)?(?:creator|lastModifiedBy|Company|Manager|HyperlinkBase))\b([^>]*?)(?:/>|>[\s\S]*?</\1>)', lambda value: f"<{value[1]}{value[2]}/>", text)
        result[name] = text.encode("utf-8")
    text = result["xl/workbook.xml"].decode("utf-8")
    result["xl/workbook.xml"] = re.sub(r'<(?:[\w.-]+:)?absPath\b[^>]*(?:/>|>[\s\S]*?</(?:[\w.-]+:)?absPath>)', "", text).encode("utf-8")
    if "xl/comments1.xml" in result:
        text = result["xl/comments1.xml"].decode("utf-8")
        result["xl/comments1.xml"] = re.sub(r"<author\b[^>]*>[\s\S]*?</author>", "<author/>", text).encode("utf-8")
    # With the verified template, header shared-string indices are unchanged.
    original_headers = [row for row in ROW_RE.findall(original_sheet) if int(attribute(row, "r") or 0) < 4]
    sanitized_headers = [row for row in ROW_RE.findall(sheet) if int(attribute(row, "r") or 0) < 4]
    if original_headers != sanitized_headers:
        raise ValueError("Unexpected header XML change; review the new template version")
    return result, {"removedInputRowsWithValues": input_rows_with_values, "removedUnusedStrings": len(entries) - len(selected), "keptHeaderStrings": len(selected)}


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=root.parent / "Postmall-v2.1-horizontal.xlsx")
    parser.add_argument("--template", type=Path, default=root / "dist/templates/postmall.xlsx")
    parser.add_argument("--config", type=Path, default=root / "dist/postmall-config.json")
    parser.add_argument("--report", type=Path, default=root / ".verification/postmall-template-audit.json")
    args = parser.parse_args()
    if args.source.resolve() == args.template.resolve():
        raise ValueError("The original input must never be overwritten")
    original = args.source.read_bytes()
    before_sha = sha(original)
    with ZipFile(io.BytesIO(original)) as source:
        parts = {info.filename: source.read(info.filename) for info in source.infolist()}
        unsafe = [name for name in parts if re.search(r"vbaProject|activeX|externalLinks|connections\.xml|embeddings", name, re.I)]
        if unsafe:
            raise ValueError("Template has active/external data parts requiring a separate review")
        config, _, _, _ = inspect_source(parts)
        sanitized, changes = sanitize(parts)
        output = io.BytesIO()
        with ZipFile(output, "w") as target:
            for info in source.infolist():
                target.writestr(info, sanitized[info.filename])
    with ZipFile(io.BytesIO(output.getvalue())) as checked:
        if checked.testzip() is not None:
            raise ValueError("Sanitized template ZIP is invalid")
        for name in checked.namelist():
            if name.endswith((".xml", ".rels")):
                ET.fromstring(checked.read(name))
        sheet = ET.fromstring(checked.read("xl/worksheets/sheet1.xml"))
        if any(cell.find("m:v", NS) is not None or cell.find("m:is", NS) is not None or cell.find("m:f", NS) is not None for row in sheet.findall("m:sheetData/m:row", NS) if int(row.attrib["r"]) >= 4 for cell in row.findall("m:c", NS)):
            raise ValueError("Example or input data remains in the distributable template")
    args.template.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.template.with_suffix(args.template.suffix + ".tmp")
    temporary.write_bytes(output.getvalue())
    temporary.replace(args.template)
    config.update({"sourceSha256": before_sha, "sanitizedTemplateSha256": sha(output.getvalue()), "sanitizedTemplateFile": "templates/postmall.xlsx"})
    write_json(args.config, config)
    after_sha = sha(args.source.read_bytes())
    if after_sha != before_sha:
        raise AssertionError("Original template bytes changed")
    report = {"originalPath": str(args.source.resolve()), "originalBytes": len(original), "originalSha256Before": before_sha,
              "originalSha256After": after_sha, "originalUnchanged": True, "templatePath": str(args.template.resolve()),
              "templateBytes": len(output.getvalue()), "templateSha256": sha(output.getvalue()), "layout": {"sheets": 1, "headers": 3, "dataStartRow": 4, "columns": 241, "productSlots": 20},
              "sanitization": changes, "headerXmlBytePreserved": True, "examplesRemoved": True, "formulaCount": 0, "dropdownCount": 0,
              "hasEmbeddedItemCodebook": False, "privacy": {"inputValuesRemoved": True, "unreferencedSampleStringsRemoved": True, "staleSampleHyperlinksRemoved": True, "authorAndLocalPathMetadataRemoved": True},
              "note": "Source example names resembled standard dummy names; no example contact, address, ID or tracking value is included in config/report or the sanitized copy."}
    write_json(args.report, report)
    print(json.dumps({"config": str(args.config), "template": str(args.template), "report": str(args.report), "sourceUnchanged": True,
                      "startRow": 4, "productSlots": 20, "columns": 241, "sanitization": changes}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
