#!/usr/bin/env python3
"""
Build the committed reference snapshots (colleges, high schools) from the raw federal files.

@spec [Brief 8 ruling 3 (2026-10-01): ref_colleges from College Scorecard keyed by IPEDS UNITID,
      currently operating degree-granting four-year institutions; ref_high_schools from NCES CCD
      (public) + PSS (private) keyed `nces:` / `pss:`, schools offering grade 12; loaded from a
      committed filtered snapshot with a manifest of source URL, vintage, filter rules and SHA-256]
| @implemented [2026-10-01]

plain English: reads the three raw downloads exactly as published (the zips, never a
hand-edited CSV), applies the filter rules written in FILTERS below, and writes:
  content/reference/colleges.csv       id,name,city,state  (id = UNITID)
  content/reference/high_schools.csv   id,name,city,state  (id = nces:NCESSCH | pss:PPIN)
  content/reference/manifest.json      sources, filters, row counts, SHA-256 of every file
Rows are sorted by id and written with LF endings, so the same inputs always produce the same
bytes and the same hashes. The import script (import-reference-data.ts) refuses a snapshot whose
hash disagrees with the manifest.

Standard library only (no dependency change). Usage:
  python3 scripts/reference-data/build-reference-snapshot.py \
    --scorecard <Most-Recent-Cohorts-Institution_*.zip> \
    --ccd <ccd_sch_029_*.zip> \
    --pss <pss*_pu_csv.zip>
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "content" / "reference"

SOURCES = {
    "college_scorecard": {
        "publisher": "U.S. Department of Education, College Scorecard",
        "dataset": "Most Recent Institution-Level Data",
        "url": "https://ed-public-download.scorecard.network/downloads/Most-Recent-Cohorts-Institution_06102026.zip",
        "landing_page": "https://collegescorecard.ed.gov/data/",
        "vintage": "data page last updated 2026-06-10; CSV member dated 2026-05-26",
        "member": "Most-Recent-Cohorts-Institution.csv",
    },
    "nces_ccd": {
        "publisher": "NCES Common Core of Data",
        "dataset": "Public school directory (school-level, file 029), school year 2024-25, version 1a",
        "url": "https://nces.ed.gov/ccd/Data/zip/ccd_sch_029_2425_w_1a_073025.zip",
        "landing_page": "https://nces.ed.gov/ccd/files.asp",
        "vintage": "SY 2024-25, version 1a (file stamp 073025)",
        "member": "ccd_sch_029_2425_w_1a_073025.csv",
    },
    "nces_pss": {
        "publisher": "NCES Private School Universe Survey",
        "dataset": "2023-24 PSS public-use data file (CSV)",
        "url": "https://nces.ed.gov/surveys/pss/zip/pss2324_pu_csv.zip",
        "landing_page": "https://nces.ed.gov/surveys/pss/pssdata.asp",
        "vintage": "2023-24 survey; CSV member dated 2026-08-28",
        "member": "pss2324_pu.csv",
    },
}

# CCD statuses that mean the school is operating in the file's year:
# 1 Open, 3 New, 4 Added, 5 Changed boundary/agency, 8 Reopened.
# Excluded: 2 Closed, 6 Inactive, 7 Future.
CCD_OPERATING = {"1", "3", "4", "5", "8"}
# PSS HIGR2024 code 17 = "Highest grade in school is 12th grade" (2023-24 SAS formats file).
PSS_HIGHEST_GRADE_12 = "17"

FILTERS = {
    "colleges": [
        "CURROPER = 1 (currently operating)",
        "ICLEVEL = 1 (four-year or above)",
        "HIGHDEG IN (3, 4) (highest award is a bachelor's or a graduate degree: degree-granting)",
    ],
    "high_schools_nces": [
        "G_12_OFFERED = 'Yes' (offers grade 12)",
        "UPDATED_STATUS IN (1, 3, 4, 5, 8) (Open, New, Added, Changed boundary/agency, Reopened)",
    ],
    "high_schools_pss": [
        "HIGR2024 = 17 (highest grade in school is 12th grade)",
    ],
}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_member(zip_path: Path, member: str) -> tuple[bytes, list[dict[str, str]]]:
    with zipfile.ZipFile(zip_path) as zf:
        raw = zf.read(member)
    text = raw.decode("utf-8-sig")
    return raw, list(csv.DictReader(io.StringIO(text)))


def clean(value: str) -> str:
    return " ".join(value.split())


def write_snapshot(path: Path, rows: list[tuple[str, str, str, str]]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(["id", "name", "city", "state"])
    for row in sorted(rows):
        writer.writerow(row)
    data = buf.getvalue().encode("utf-8")
    path.write_bytes(data)
    return data


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scorecard", type=Path, required=True)
    parser.add_argument("--ccd", type=Path, required=True)
    parser.add_argument("--pss", type=Path, required=True)
    args = parser.parse_args()

    zips = {"college_scorecard": args.scorecard, "nces_ccd": args.ccd, "nces_pss": args.pss}
    source_entries = {}
    parsed: dict[str, list[dict[str, str]]] = {}
    for key, zip_path in zips.items():
        meta = SOURCES[key]
        member_bytes, rows = read_member(zip_path, meta["member"])
        parsed[key] = rows
        source_entries[key] = {
            **meta,
            "zip_sha256": sha256_bytes(zip_path.read_bytes()),
            "member_sha256": sha256_bytes(member_bytes),
            "member_rows": len(rows),
        }

    colleges = [
        (r["UNITID"], clean(r["INSTNM"]), clean(r["CITY"]), r["STABBR"].strip())
        for r in parsed["college_scorecard"]
        if r["CURROPER"] == "1" and r["ICLEVEL"] == "1" and r["HIGHDEG"] in ("3", "4")
    ]
    public = [
        (f"nces:{r['NCESSCH']}", clean(r["SCH_NAME"]), clean(r["LCITY"]), r["LSTATE"].strip())
        for r in parsed["nces_ccd"]
        if r["G_12_OFFERED"] == "Yes" and r["UPDATED_STATUS"] in CCD_OPERATING
    ]
    private = [
        (f"pss:{r['PPIN']}", clean(r["PINST"]), clean(r["PCITY"]), r["PSTABB"].strip())
        for r in parsed["nces_pss"]
        if r["HIGR2024"] == PSS_HIGHEST_GRADE_12
    ]

    for label, rows in (("colleges", colleges), ("high schools", public + private)):
        ids = [row[0] for row in rows]
        if len(ids) != len(set(ids)):
            raise SystemExit(f"duplicate ids in {label}: the source key is not unique")
        if any(not row[1] for row in rows):
            raise SystemExit(f"a {label} row has no name")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    college_bytes = write_snapshot(OUT_DIR / "colleges.csv", colleges)
    school_bytes = write_snapshot(OUT_DIR / "high_schools.csv", public + private)

    manifest = {
        "built_on": "2026-10-01",
        "builder": "scripts/reference-data/build-reference-snapshot.py",
        "sources": source_entries,
        "snapshots": {
            "colleges": {
                "file": "content/reference/colleges.csv",
                "table": "ref_colleges",
                "key": "IPEDS UNITID",
                "from": ["college_scorecard"],
                "filters": FILTERS["colleges"],
                "rows": len(colleges),
                "sha256": sha256_bytes(college_bytes),
            },
            "high_schools": {
                "file": "content/reference/high_schools.csv",
                "table": "ref_high_schools",
                "key": "nces:<NCESSCH> for public schools, pss:<PPIN> for private schools",
                "from": ["nces_ccd", "nces_pss"],
                "filters": {
                    "nces": FILTERS["high_schools_nces"],
                    "pss": FILTERS["high_schools_pss"],
                },
                "rows": len(public) + len(private),
                "rows_by_source": {"nces": len(public), "pss": len(private)},
                "sha256": sha256_bytes(school_bytes),
            },
        },
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v["rows"] for k, v in manifest["snapshots"].items()}))


if __name__ == "__main__":
    main()
