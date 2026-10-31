"""Remove personal document metadata from the distributable template copies.

This script only updates this project's dist/templates/*.xlsx. Spreadsheet cells,
styles, instructions, relationships and all other ZIP part bytes are preserved.
The source XLSX files outside the project are never opened for writing.
"""

from __future__ import annotations

import io
from pathlib import Path
import re
import tempfile
import xml.etree.ElementTree as ET
from zipfile import ZipFile


TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "dist" / "templates"
METADATA_PARTS = {"docProps/core.xml", "xl/workbook.xml"}
PERSONAL_ELEMENT = re.compile(
    r"<(?P<tag>(?:[A-Za-z_][\w.-]*:)?(?:creator|lastModifiedBy))\b"
    r"(?P<attributes>[^>]*?)(?:/>|>[\s\S]*?</(?P=tag)>)"
)
ABS_PATH = re.compile(
    r"<(?P<tag>(?:[A-Za-z_][\w.-]*:)?absPath)\b[^>]*?"
    r"(?:/>|>[\s\S]*?</(?P=tag)>)"
)
ALTERNATE_CONTENT = re.compile(
    r"<(?P<tag>(?:[A-Za-z_][\w.-]*:)?AlternateContent)\b[^>]*>"
    r"[\s\S]*?</(?P=tag)>"
)
EMPTY_COMPATIBILITY_WRAPPERS = re.compile(
    r"</?(?:[A-Za-z_][\w.-]*:)?(?:AlternateContent|Choice|Fallback)\b[^>]*>"
)


def sanitize_workbook_xml(text: str) -> str:
    def clean_alternate_content(match: re.Match[str]) -> str:
        original = match.group(0)
        cleaned = ABS_PATH.sub("", original)
        if cleaned != original and not EMPTY_COMPATIBILITY_WRAPPERS.sub("", cleaned).strip():
            return ""
        return cleaned

    text = ALTERNATE_CONTENT.sub(clean_alternate_content, text)
    return ABS_PATH.sub("", text)


def sanitize_template(path: Path) -> list[str]:
    path = path.resolve(strict=True)
    if path.parent != TEMPLATES_DIR.resolve(strict=True) or path.suffix.lower() != ".xlsx":
        raise ValueError("Only project dist/templates XLSX copies may be sanitized.")

    with ZipFile(path) as source:
        parts = {info.filename: source.read(info.filename) for info in source.infolist()}
        replacements = dict(parts)
        if "docProps/core.xml" in parts:
            text = parts["docProps/core.xml"].decode("utf-8")
            replacements["docProps/core.xml"] = PERSONAL_ELEMENT.sub(
                lambda match: f'<{match.group("tag")}{match.group("attributes")}/>', text
            ).encode("utf-8")
        if "xl/workbook.xml" in parts:
            replacements["xl/workbook.xml"] = sanitize_workbook_xml(
                parts["xl/workbook.xml"].decode("utf-8")
            ).encode("utf-8")

        changed = [name for name in parts if replacements[name] != parts[name]]
        if not set(changed).issubset(METADATA_PARTS):
            raise AssertionError("Unexpected content change outside document metadata.")

        output = io.BytesIO()
        with ZipFile(output, "w") as target:
            target.comment = source.comment
            for info in source.infolist():
                target.writestr(info, replacements[info.filename])

    with ZipFile(io.BytesIO(output.getvalue())) as verified:
        if verified.testzip() is not None or set(verified.namelist()) != set(parts):
            raise AssertionError("Template ZIP verification failed.")
        for name, original in parts.items():
            if name not in METADATA_PARTS and verified.read(name) != original:
                raise AssertionError(f"Non-metadata ZIP part changed: {name}")
        for name in METADATA_PARTS & parts.keys():
            root = ET.fromstring(verified.read(name))
            for element in root.iter():
                local_name = element.tag.split("}")[-1]
                if local_name in {"creator", "lastModifiedBy"} and (element.text or "").strip():
                    raise AssertionError("Personal creator metadata remains.")
                if local_name == "absPath":
                    raise AssertionError("Local absolute path metadata remains.")

    if changed:
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(prefix=f".{path.stem}-", suffix=".tmp", dir=path.parent, delete=False) as handle:
                temporary = Path(handle.name)
                handle.write(output.getvalue())
            temporary.replace(path)
        finally:
            if temporary is not None and temporary.exists():
                temporary.unlink()
    return changed


def main() -> None:
    for path in sorted(TEMPLATES_DIR.glob("*.xlsx")):
        changed = sanitize_template(path)
        print(f"{path.name}: sanitized {len(changed)} metadata part(s); all worksheet/style and other part bytes unchanged")


if __name__ == "__main__":
    main()
