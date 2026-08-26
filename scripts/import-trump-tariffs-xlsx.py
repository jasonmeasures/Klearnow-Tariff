#!/usr/bin/env python3
"""
Import HTS lists from Trump_Tariffs_Summary workbook into tariff-rules/data/.

Usage (repo root):
  python3 scripts/import-trump-tariffs-xlsx.py [path/to/workbook.xlsx]
"""
from __future__ import annotations

import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_XLSX = ROOT / "Trump_Tariffs_Summary_20260824 1.xlsx"
DATA = ROOT / "tariff-rules" / "data"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

CHINA_LEGACY = {
    "9903.88.01": "list_1",
    "9903.88.02": "list_2",
    "9903.88.03": "list_3",
    "9903.88.15": "list_4a",
}
CHINA_LEGACY_RATES = {
    "list_1": 25,
    "list_2": 25,
    "list_3": 25,
    "list_4a": 7.5,
}
CHINA_LEGACY_CH99 = {
    "list_1": "9903.88.01",
    "list_2": "9903.88.02",
    "list_3": "9903.88.03",
    "list_4a": "9903.88.15",
}

# Note 31 headings from col C (not legacy 9903.88.xx)
NOTE31_HEADINGS = {
    "9903.91.01",
    "9903.91.02",
    "9903.91.03",
    "9903.91.04",
    "9903.91.05",
    "9903.91.06",
    "9903.91.07",
    "9903.91.08",
    "9903.91.09",
    "9903.91.10",
    "9903.91.11",
    "9903.92.10",
    "9903.92.80",
}

FL_AUTO_HEADINGS = frozenset({"9903.05.86", "9903.05.87"})
FL_AIRCRAFT = "9903.05.88"
FL_PHARMA = "9903.05.89"
FL_BILATERAL_PREFIX = "9903.06."


def norm_hts(raw: str) -> str | None:
    s = str(raw or "").strip().replace("\xa0", "")
    if not s or s.lower() in ("primary hts", "hts", "none"):
        return None
    s = s.strip("'\"")
    d = re.sub(r"\D", "", s)
    if len(d) < 4:
        return None
    if len(d) <= 8:
        d = d.ljust(8, "0")
        return f"{d[:4]}.{d[4:6]}.{d[6:8]}"
    d = d.ljust(10, "0")[:10]
    return f"{d[:4]}.{d[4:6]}.{d[6:10]}"


def stem_key(hts: str) -> str:
    return re.sub(r"\D", "", hts)


def compress_stems(hts_list: list[str]) -> list[str]:
    """Keep minimal prefix set: drop stems that are extensions of another."""
    keys = sorted({stem_key(h) for h in hts_list if stem_key(h)}, key=len)
    kept: list[str] = []
    for k in keys:
        if any(k != p and k.startswith(p) for p in kept):
            continue
        kept.append(k)
    return kept


class XlsxReader:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._shared: list[str] = []
        self._sheets: dict[str, str] = {}

    def __enter__(self) -> "XlsxReader":
        self._z = zipfile.ZipFile(self.path)
        ss_root = ET.fromstring(self._z.read("xl/sharedStrings.xml"))
        self._shared = []
        for si in ss_root.findall("m:si", NS):
            parts = []
            for t in si.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"):
                if t.text:
                    parts.append(t.text)
            self._shared.append("".join(parts))
        wb = ET.fromstring(self._z.read("xl/workbook.xml"))
        rels = ET.fromstring(self._z.read("xl/_rels/workbook.xml.rels"))
        rid_map = {
            r.get("Id"): (
                "xl/" + r.get("Target").lstrip("/")
                if not (r.get("Target") or "").startswith("xl/")
                else r.get("Target")
            )
            for r in rels
        }
        for s in wb.find("m:sheets", NS).findall("m:sheet", NS):
            rid = s.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
            self._sheets[s.get("name") or ""] = rid_map[rid]
        return self

    def __exit__(self, *args) -> None:
        self._z.close()

    def read_sheet(self, name: str) -> dict[int, dict[str, str]]:
        path = self._sheets[name]
        root = ET.fromstring(self._z.read(path))
        rows: dict[int, dict[str, str]] = {}
        for row in root.findall(".//m:sheetData/m:row", NS):
            rnum = int(row.get("r") or 0)
            for c in row.findall("m:c", NS):
                ref = c.get("r") or ""
                m = re.match(r"([A-Z]+)(\d+)", ref)
                if not m:
                    continue
                col = m.group(1)
                t = c.get("t")
                v = c.find("m:v", NS)
                if v is None or v.text is None:
                    is_el = c.find("m:is", NS)
                    if is_el is not None:
                        val = "".join(
                            tnode.text or ""
                            for tnode in is_el.iter(
                                "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"
                            )
                        )
                    else:
                        val = ""
                elif t == "s":
                    val = self._shared[int(v.text)]
                else:
                    val = v.text
                rows.setdefault(rnum, {})[col] = str(val).strip()
        return rows


def import_fl_except(reader: XlsxReader) -> dict:
    rows = reader.read_sheet("Sec 301 FL Except")
    by_heading: dict[str, set[str]] = defaultdict(set)
    for r, cols in rows.items():
        if r == 1:
            continue
        hts = norm_hts(cols.get("A", ""))
        heading = cols.get("B", "").strip()
        if not hts or not re.match(r"9903\.\d{2}\.\d{2}", heading):
            continue
        by_heading[heading].add(hts)

    out: dict = {
        "version": "1.0.0",
        "as_of": str(date.today()),
        "source": f"{reader.path.name} — Sec 301 FL Except",
        "source_csms": "69326983",
        "by_heading": {},
    }
    for heading in sorted(by_heading):
        hts_sorted = sorted(by_heading[heading], key=stem_key)
        out["by_heading"][heading] = {
            "heading": heading,
            "hts_count": len(hts_sorted),
            "stems": compress_stems(hts_sorted),
            "hts10": [h for h in hts_sorted if len(stem_key(h)) >= 10],
        }
    return out


def import_brazil_annex(reader: XlsxReader) -> dict:
    rows = reader.read_sheet("Sec 301 Brazil")
    by_heading: dict[str, set[str]] = defaultdict(set)
    for r, cols in rows.items():
        if r == 1:
            continue
        hts = norm_hts(cols.get("A", ""))
        heading = cols.get("B", "").strip()
        if not hts or not heading.startswith("9903.05."):
            continue
        by_heading[heading].add(hts)

    annex = sorted(by_heading.get("9903.05.03", set()), key=stem_key)
    return {
        "version": "1.0.0",
        "as_of": str(date.today()),
        "source": f"{reader.path.name} — Sec 301 Brazil",
        "source_csms": "69302472",
        "by_heading": {
            h: {
                "heading": h,
                "hts_count": len(sorted(v, key=stem_key)),
                "stems": compress_stems(sorted(v, key=stem_key)),
            }
            for h, v in sorted(by_heading.items())
        },
        "annex_9903_05_03": {
            "heading": "9903.05.03",
            "hts_count": len(annex),
            "stems": compress_stems(annex),
        },
    }


def norm_hts_from_china_row(cols: dict[str, str]) -> str | None:
    """Prefer TS-format col B ('01012100) over dotted col A."""
    raw_b = str(cols.get("B", "") or "").strip().strip("'\"")
    if raw_b:
        d = re.sub(r"\D", "", raw_b)
        if len(d) >= 8:
            if len(d) >= 10:
                d = d[:10]
                return f"{d[:4]}.{d[4:6]}.{d[6:10]}"
            d = d[:8]
            return f"{d[:4]}.{d[4:6]}.{d[6:8]}"
    return norm_hts(cols.get("A", ""))


def import_china(reader: XlsxReader) -> dict:
    rows = reader.read_sheet("Sec 301 (China)")
    legacy: dict[str, set[str]] = {k: set() for k in CHINA_LEGACY_RATES}

    for r, cols in rows.items():
        if r == 1:
            continue
        hts = norm_hts_from_china_row(cols)
        ch99 = cols.get("C", "").strip()
        if not hts or not ch99.startswith("9903."):
            continue
        if ch99 in CHINA_LEGACY:
            legacy[CHINA_LEGACY[ch99]].add(hts)

    lists_out = {
        "version": "1.1.0",
        "as_of": str(date.today()),
        "source": (
            f"{reader.path.name} — Sec 301 (China); "
            "List 1/2/3/4A from U.S. note 20; imported from workbook col C"
        ),
        "lists": {
            lid: {
                "ch99": CHINA_LEGACY_CH99[lid],
                "rate_pct": CHINA_LEGACY_RATES[lid],
                "hts8": sorted({norm_hts(h) for h in legacy[lid] if norm_hts(h)}, key=stem_key),
            }
            for lid in CHINA_LEGACY_RATES
        },
    }
    return lists_out


def import_metals_matrix(reader: XlsxReader) -> dict:
    rows = reader.read_sheet("Sec 232 Metals")
    # Row 2 = heading labels per column D-AE
    hdr = rows.get(2, {})
    col_heading: dict[str, str] = {}
    for col, label in hdr.items():
        if col in ("A", "B", "C", "AF"):
            continue
        m = re.search(r"(9903\.\d{2}\.\d{2})", str(label))
        if m:
            col_heading[col] = m.group(1)

    entries: list[dict] = []
    for r, cols in rows.items():
        if r <= 2:
            continue
        hts_raw = cols.get("A", "").strip()
        if not hts_raw or hts_raw.lower() == "hts":
            continue
        provision = cols.get("B", "")
        metal = cols.get("C", "")
        applicable: list[str] = []
        for col, heading in col_heading.items():
            if cols.get(col, "").lower() == "x":
                applicable.append(heading)
        if not applicable:
            continue
        entries.append(
            {
                "hts": hts_raw,
                "provision": provision,
                "metal": metal,
                "headings": sorted(set(applicable)),
            }
        )

    return {
        "version": "1.0.0",
        "as_of": str(date.today()),
        "source": f"{reader.path.name} — Sec 232 Metals",
        "source_csms": "68253075",
        "row_count": len(entries),
        "heading_columns": col_heading,
        "entries": entries,
    }


def write_json(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8")
    print(f"  wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB)")


def main() -> int:
    xlsx = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_XLSX
    if not xlsx.exists():
        print(f"Workbook not found: {xlsx}", file=sys.stderr)
        return 1

    print(f"Importing from {xlsx.name}...")
    with XlsxReader(xlsx) as reader:
        fl = import_fl_except(reader)
        br = import_brazil_annex(reader)
        cn_lists = import_china(reader)
        metals = import_metals_matrix(reader)

    write_json(DATA / "s301fl_except_hts.json", fl)
    write_json(DATA / "s301_brazil_hts.json", br)

    # Expand pharma file from FL except .89 list
    pharma = fl["by_heading"].get(FL_PHARMA, {})
    write_json(
        DATA / "s301fl_pharma_hts.json",
        {
            "heading": FL_PHARMA,
            "basis": "pharmaceutical applications — US Note 52(e)",
            "claim_flag": "s301fl_pharma",
            "notes": f"Imported {pharma.get('hts_count', 0)} provisions from workbook Sec 301 FL Except.",
            "source": fl["source"],
            "stems": pharma.get("stems", []),
            "hts10": pharma.get("hts10", []),
        },
    )

    write_json(DATA / "s301_china_lists.json", cn_lists)
    write_json(DATA / "s232_metals_matrix.json", metals)

    print("\nCounts:")
    for h, block in sorted(fl["by_heading"].items()):
        print(f"  FL {h}: {block['hts_count']} HTS, {len(block['stems'])} stems")
    print(f"  Brazil annex .03: {br['annex_9903_05_03']['hts_count']} HTS")
    for lid in CHINA_LEGACY_RATES:
        print(f"  China {lid}: {len(cn_lists['lists'][lid]['hts8'])} hts8")
    print(f"  Metals matrix rows: {metals['row_count']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
