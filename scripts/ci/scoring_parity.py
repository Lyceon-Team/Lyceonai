#!/usr/bin/env python3
"""
Scoring parity gate — Python reference == PL/pgSQL production, bit-exact.

@spec [Doc-04B_V4.3, §3.1 (bit-exact determinism), §6 (formula), §6.3
       (rounding), §11.2, §18.3, §21.1 "Reference parity tests", §28 (worked
       examples); OWNER RULING 2026-09-24 overriding §21.2 (run per deploy)]
@implemented [2026-09-24]

plain English: the oracle is the committed evidence packet
  (scripts/ci/fixtures/scoring-v1.0/validation_sweep.py and its CSVs, whose
  bytes scripts/ci/scoring-evidence-packet-check.sh pins to hash 29c3e0fd…).
  `gen` prints the SQL that drives every scenario through TWO production paths:
    F  compute_scaled_score_from_counts()      (the pure §6 function), and
    S  a real session per scenario — form items, sections, answers (with
       blanks, NULLs, wrong values, mismatched question ids and never-presented
       noise), an outbox event — scored by score_test_session_from_outbox(),
       i.e. compute_section_scaled_score()'s counting, difficulty mapping and
       presented-item filter end to end.
  `check` parses psql's output and requires, for every scenario:
    scaled         == the reference's compute_section_scaled_score() == the CSV
    decomposition  == the reference's float intermediates (|Δ| <= 1e-9) and the
                      CSV's 1-dp values (|Δ| <= 0.05), for the 1,313 sweep rows
    counts / path  == the scenario inputs (S path only)
  and prints the first mismatches on failure. It also runs the Doc 04B §28
  worked examples (W) through the session path and prints expected vs actual.

edge cases: the reference hardcodes the v1.0 routing thresholds (T_RW=18,
  T_MATH=15) and N; the production thresholds come from the form, so the
  harness builds its forms with exactly those thresholds. §28.8 needs a form
  with T_RW=19 (it routes 18/27 to 2A); for that one reference call the module
  global T_RW is set to 19 (thresholds are form-level, §5.13).

  WHAT THIS DOES NOT COVER: it sees only a database built from this repo's
  migrations. A function or constant edited directly in production (SQL
  editor) is invisible to it. The owner deferred a production-side check.

stdlib only.
"""

import csv
import json
import math
import os
import sys
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
PACKET = os.path.join(HERE, "fixtures", "scoring-v1.0")
LIB = os.path.join(HERE, "lib")
sys.path.insert(0, PACKET)
sys.dont_write_bytecode = True  # never leave __pycache__ inside the hash-pinned packet
import validation_sweep as ref  # noqa: E402  (the canonical reference, committed)

SECTION_N = {"rw": (27, 54), "math": (22, 44)}
SECTION_T = {"rw": 18, "math": 15}
FORM_MAIN = "00000000-0000-0000-0000-0000000e4f18"
FORM_T19 = "00000000-0000-0000-0000-0000000e4f19"
STUDENT = "00000000-0000-0000-0000-0000000e4a01"


def sid(key: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "lyceon-scoring-parity:" + key))


def ref_decomp(section, r1, r2, ne, nm, nh, t):
    """Reference intermediates, full float precision, exactly as sweep_section() computes them."""
    n1, ntot = SECTION_N[section]
    ceiling = max(ref.CEILING_FLOOR, ref.CEILING_MAX * (r1 / n1) ** ref.ALPHA)
    deductions = ref.D_EASY * ne + ref.D_MEDIUM * nm + ref.D_HARD * nh
    raw_floor = ref.RAW_FLOOR_BASE + ref.RAW_FLOOR_MULT * (r1 + r2) / ntot
    if r1 >= t:
        path_floor = min(ref.PATH_B_FLOOR_CAP, ref.PATH_B_FLOOR_BASE + ref.PATH_B_FLOOR_BONUS * (r1 - t))
    else:
        path_floor = ref.PATH_A_FLOOR
    return {
        "ceiling": ceiling, "deduction": deductions, "raw_floor": raw_floor,
        "path_floor": path_floor, "effective_floor": max(raw_floor, path_floor),
        "s_raw": ceiling - deductions,
    }


def ref_scaled(section, r1, r2, ne, nm, nh, t):
    attr = "T_RW" if section == "rw" else "T_MATH"
    saved = getattr(ref, attr)
    setattr(ref, attr, t)
    try:
        return ref.compute_section_scaled_score(r1, r2, ne, nm, nh, section)
    finally:
        setattr(ref, attr, saved)


def load_scenarios():
    """Every CSV row of the packet, as a scenario dict."""
    out = []
    with open(os.path.join(PACKET, "validation_results.csv"), newline="") as f:
        for row in csv.DictReader(f):
            s = row["section"]
            out.append({
                "id": f"sweep:{s}:{row['r1']}:{row['r2']}", "kind": "sweep", "section": s,
                "path": row["path"], "r1": int(row["r1"]), "r2": int(row["r2"]),
                "ne": int(row["n_e_m2"]), "nm": int(row["n_m_m2"]), "nh": int(row["n_h_m2"]),
                "t": SECTION_T[s], "csv_scaled": int(row["lyceon_scaled"]),
                "csv": {k: float(row[c]) for k, c in (
                    ("ceiling", "ceiling"), ("deduction", "deductions"), ("raw_floor", "raw_floor"),
                    ("path_floor", "path_floor"), ("effective_floor", "effective_floor"), ("s_raw", "s_raw"))},
            })
    with open(os.path.join(PACKET, "validation_targeted_fixtures.csv"), newline="") as f:
        for row in csv.DictReader(f):
            s = row["section"]
            out.append({
                "id": f"fixture:{s}:{row['path']}:{row['pattern']}:{row['r1']}", "kind": "fixture",
                "section": s, "path": row["path"], "r1": int(row["r1"]), "r2": int(row["r2"]),
                "ne": int(row["n_e_m2"]), "nm": int(row["n_m_m2"]), "nh": int(row["n_h_m2"]),
                "t": SECTION_T[s], "csv_scaled": int(row["lyceon_scaled"]), "csv": None,
            })
    return out


def spec_json(section_row):
    if section_row is None:
        return "NULL"
    d = {k: section_row[k] for k in ("path", "r1", "ne", "nm", "nh")}
    for k in ("b1", "b2"):
        if k in section_row:
            d[k] = section_row[k]
    return "'" + json.dumps(d, sort_keys=True) + "'::jsonb"


# Doc 04B §28 — inputs as the document states them. doc = the document's
# stated scaled value(s); None where the document states none.
def worked_examples():
    pw = ref.proportional_wrongs
    return [
        {"id": "28.1", "form": FORM_MAIN, "t": (18, 15),
         "rw": {"path": "B", "r1": 24, "ne": 1, "nm": 2, "nh": 2},
         "m": {"path": "B", "r1": 20, "ne": 1, "nm": 1, "nh": 2},
         "doc": {"rw": 710, "m": 730, "total": 1440, "rw_ded": 45, "m_ded": 36}},
        {"id": "28.2", "form": FORM_MAIN, "t": (18, 15),
         "rw": {"path": "A", "r1": 14, "ne": 7, "nm": 4, "nh": 2}, "m": None,
         "doc": {"rw": 420, "rw_ded": 153}},
        {"id": "28.3", "form": FORM_MAIN, "t": (18, 15),
         "rw": {"path": "A", "r1": 0, "ne": 0, "nm": 0, "nh": 0}, "m": None,
         "doc": {"rw": 430, "rw_ded": 0}},
        {"id": "28.4", "form": FORM_MAIN, "t": (18, 15),
         "rw": {"path": "B", "r1": 27, "ne": 0, "nm": 0, "nh": 0},
         "m": {"path": "B", "r1": 22, "ne": 0, "nm": 0, "nh": 0},
         "doc": {"rw": 800, "m": 800, "total": 1600}},
        {"id": "28.5", "form": FORM_MAIN, "t": (18, 15),
         "rw": {"path": "B", "r1": 25, "ne": 3, "nm": 7, "nh": 10}, "m": None,
         "doc": {"rw": 600, "rw_ded": 168}},
        {"id": "28.6", "form": FORM_MAIN, "t": (18, 15),
         "rw": {"path": "A", "r1": 0, "ne": 14, "nm": 9, "nh": 4}, "m": None,
         "doc": {"rw": 200, "rw_ded": 315}},
        # §28.7 states 22/27 + 22/27 M2B = 670 without a difficulty split. 670
        # holds for e.g. (2 easy, 1 medium, 2 hard) wrong; the packet's own
        # proportional split for 5 wrong on M2B is (1, 2, 2) = 680
        # (validation_results.csv rw,22,22). Both are run; see the PR log.
        {"id": "28.7", "form": FORM_MAIN, "t": (18, 15),
         "rw": {"path": "B", "r1": 22, "ne": 2, "nm": 1, "nh": 2}, "m": None,
         "doc": {"rw": 670, "partial": 670}},
        {"id": "28.7-proportional", "form": FORM_MAIN, "t": (18, 15),
         "rw": dict(zip(("ne", "nm", "nh"), pw(5, ref.DIST_RW["M2B"])), path="B", r1=22), "m": None,
         "doc": {}},
        # §28.8: 25 answered + 2 blank in M1 (18 correct); routed to 2A with 18
        # correct, so the form's T_RW must exceed 18: T_RW = 19. M2A: 20
        # answered + 7 blank, 14 correct, 13 wrong split by the M2A composition.
        {"id": "28.8", "form": FORM_T19, "t": (19, 15),
         "rw": dict(zip(("ne", "nm", "nh"), pw(13, ref.DIST_RW["M2A"])), path="A", r1=18, b1=2, b2=7),
         "m": None, "doc": {}},
    ]


def gen():
    sc = load_scenarios()
    p = print
    p("\\set ON_ERROR_STOP 1")
    p("SET client_min_messages = warning;")
    p(f"\\i {os.path.join(LIB, 'exam-form-fixture.sql')}")
    p(f"\\i {os.path.join(LIB, 'scoring-session-fixture.sql')}")
    p("BEGIN;")
    p(f"SELECT pg_temp.exam_fixture_make_form('{FORM_MAIN}', 'P1', 18, 15);")
    p(f"SELECT pg_temp.exam_fixture_make_form('{FORM_T19}', 'P2', 19, 15);")
    p(f"UPDATE public.test_forms SET status = 'published', published_at = now() WHERE id IN ('{FORM_MAIN}', '{FORM_T19}');")
    p(f"INSERT INTO auth.users (id, email) VALUES ('{STUDENT}', 'scoring-parity@example.com');")
    p("CREATE TEMP TABLE sc (id text, section text, path text, r1 int, r2 int, ne int, nm int, nh int,"
      " t int, n1 int, ntot int, session uuid, form uuid, rw jsonb, m jsonb);")
    rows = []
    for s in sc:
        n1, ntot = SECTION_N[s["section"]]
        spec = spec_json(s)
        rw, m = (spec, "NULL") if s["section"] == "rw" else ("NULL", spec)
        rows.append(f"('{s['id']}','{s['section']}','{s['path']}',{s['r1']},{s['r2']},{s['ne']},{s['nm']},{s['nh']},"
                    f"{s['t']},{n1},{ntot},'{sid(s['id'])}','{FORM_MAIN}',{rw},{m})")
    for w in worked_examples():
        rows.append(f"('W{w['id']}',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'{sid('W' + w['id'])}',"
                    f"'{w['form']}',{spec_json(w['rw'])},{spec_json(w['m'])})")
    for i in range(0, len(rows), 200):
        p("INSERT INTO sc VALUES\n  " + ",\n  ".join(rows[i:i + 200]) + ";")
    # F: the pure formula path.
    p("SELECT 'F', sc.id, f.scaled, f.ceiling, f.deduction, f.raw_floor, f.path_floor, f.effective_floor, f.s_raw"
      " FROM sc, public.compute_scaled_score_from_counts('v1.0', sc.r1, sc.r2, sc.ne, sc.nm, sc.nh, sc.n1, sc.ntot, sc.t) f"
      " WHERE sc.section IS NOT NULL ORDER BY sc.id;")
    # S and W: one real session per scenario, scored through the orchestrator
    # as service_role (the only role holding EXECUTE).
    p("CREATE TEMP TABLE ev (id text, event uuid);")
    p("GRANT SELECT ON sc TO service_role; GRANT ALL ON ev TO service_role;")
    p("INSERT INTO ev SELECT id, pg_temp.scoring_fixture_session(session, "
      f"'{STUDENT}', form, rw, m) FROM sc ORDER BY id;")
    p("SET ROLE service_role;")
    p("CREATE TEMP TABLE runs AS SELECT ev.id, public.score_test_session_from_outbox(ev.event) AS run FROM ev ORDER BY ev.id;")
    p("RESET ROLE;")
    cols = []
    for pre in ("rw", "math"):
        cols += [f"r.{pre}_scaled", f"r.{pre}_module1_correct", f"r.{pre}_module2_correct", f"r.{pre}_module2_path",
                 f"r.{pre}_m2_easy_wrong", f"r.{pre}_m2_medium_wrong", f"r.{pre}_m2_hard_wrong",
                 f"r.{pre}_ceiling", f"r.{pre}_deduction", f"r.{pre}_raw_floor", f"r.{pre}_path_floor",
                 f"r.{pre}_effective_floor", f"r.{pre}_s_raw"]
    p("SELECT 'S', runs.id, " + ", ".join(cols) + ", r.total_scaled, r.partial_display_scaled"
      " FROM runs JOIN public.score_runs r ON r.id = runs.run ORDER BY runs.id;")
    p("ROLLBACK;")


FIELDS = ["scaled", "module1_correct", "module2_correct", "module2_path", "m2_easy_wrong", "m2_medium_wrong",
          "m2_hard_wrong", "ceiling", "deduction", "raw_floor", "path_floor", "effective_floor", "s_raw"]
DEC = ["ceiling", "deduction", "raw_floor", "path_floor", "effective_floor", "s_raw"]


def parse(path):
    f_rows, s_rows = {}, {}
    with open(path) as fh:
        for line in fh:
            parts = line.rstrip("\n").split("|")
            if parts[0] == "F" and len(parts) == 9:
                f_rows[parts[1]] = dict(zip(["scaled"] + DEC, parts[2:]))
            elif parts[0] == "S" and len(parts) == 2 + 26 + 2:
                d = {"rw": dict(zip(FIELDS, parts[2:15])), "math": dict(zip(FIELDS, parts[15:28])),
                     "total": parts[28], "partial": parts[29]}
                s_rows[parts[1]] = d
    return f_rows, s_rows


def num(x):
    return None if x == "" else float(x)


def check(psql_out):
    sc = load_scenarios()
    f_rows, s_rows = parse(psql_out)
    bad = []

    def compare_dec(tag, s, got):
        r = ref_decomp(s["section"], s["r1"], s["r2"], s["ne"], s["nm"], s["nh"], s["t"])
        for k in DEC:
            g = num(got[k])
            if g is None or abs(g - r[k]) > 1e-9:
                bad.append(f"{tag} {s['id']}: {k} pg={got[k]} python={r[k]!r}")
            if s["csv"] is not None and (g is None or abs(g - s["csv"][k]) > 0.05 + 1e-9):
                bad.append(f"{tag} {s['id']}: {k} pg={got[k]} csv={s['csv'][k]}")

    n_f = n_s = 0
    for s in sc:
        py = ref_scaled(s["section"], s["r1"], s["r2"], s["ne"], s["nm"], s["nh"], s["t"])
        if py != s["csv_scaled"]:
            bad.append(f"REF {s['id']}: python {py} != packet csv {s['csv_scaled']} (packet drift)")
        f = f_rows.get(s["id"])
        if f is None:
            bad.append(f"F {s['id']}: no production row")
        else:
            n_f += 1
            if int(f["scaled"]) != py:
                bad.append(f"F {s['id']}: scaled pg={f['scaled']} python={py}")
            compare_dec("F", s, f)
        srow = s_rows.get(s["id"])
        if srow is None:
            bad.append(f"S {s['id']}: no score_runs row")
            continue
        n_s += 1
        sec = srow[s["section"]]
        other = srow["math" if s["section"] == "rw" else "rw"]
        m2_total = SECTION_N[s["section"]][1] - SECTION_N[s["section"]][0]
        want = {"scaled": str(py), "module1_correct": str(s["r1"]), "module2_correct": str(m2_total - s["ne"] - s["nm"] - s["nh"]),
                "module2_path": s["path"], "m2_easy_wrong": str(s["ne"]), "m2_medium_wrong": str(s["nm"]),
                "m2_hard_wrong": str(s["nh"])}
        for k, v in want.items():
            if sec[k] != v:
                bad.append(f"S {s['id']}: {k} pg={sec[k]} want={v}")
        if int(sec["module2_correct"] or -1) != s["r2"]:
            bad.append(f"S {s['id']}: module2_correct pg={sec['module2_correct']} scenario r2={s['r2']}")
        compare_dec("S", s, sec)
        if other["scaled"] != "" or srow["total"] != "" or srow["partial"] != str(py):
            bad.append(f"S {s['id']}: partial shape wrong total={srow['total']!r} partial={srow['partial']!r}")

    # §28 worked examples
    print("==> Doc 04B §28 worked examples (session path; expected = document, python = reference)")
    n_w = 0
    for w in worked_examples():
        srow = s_rows.get("W" + w["id"])
        if srow is None:
            bad.append(f"W {w['id']}: no score_runs row")
            continue
        n_w += 1
        parts = []
        for key, sec_name, t in (("rw", "rw", w["t"][0]), ("m", "math", w["t"][1])):
            spec = w[key]
            if spec is None:
                continue
            m2_total = SECTION_N[sec_name][1] - SECTION_N[sec_name][0]
            r2 = m2_total - spec["ne"] - spec["nm"] - spec["nh"]
            py = ref_scaled(sec_name, spec["r1"], r2, spec["ne"], spec["nm"], spec["nh"], t)
            dec = ref_decomp(sec_name, spec["r1"], r2, spec["ne"], spec["nm"], spec["nh"], t)
            got = srow[sec_name]
            doc = w["doc"].get(key)
            doc_ded = w["doc"].get(key + "_ded")
            parts.append(f"{sec_name}: doc={doc if doc is not None else '-'} python={py} pg={got['scaled']}"
                         f" | deduction doc={doc_ded if doc_ded is not None else '-'} pg={num(got['deduction']):g}"
                         f" | s_raw pg={num(got['s_raw']):.4f}")
            if int(got["scaled"]) != py:
                bad.append(f"W {w['id']} {sec_name}: pg={got['scaled']} python={py}")
            if doc is not None and int(got["scaled"]) != doc:
                bad.append(f"W {w['id']} {sec_name}: pg={got['scaled']} document={doc}")
            if doc_ded is not None and num(got["deduction"]) != doc_ded:
                bad.append(f"W {w['id']} {sec_name}: deduction pg={got['deduction']} document={doc_ded}")
            if abs(num(got["s_raw"]) - dec["s_raw"]) > 1e-9:
                bad.append(f"W {w['id']} {sec_name}: s_raw pg={got['s_raw']} python={dec['s_raw']}")
        for k, col in (("total", "total"), ("partial", "partial")):
            if k in w["doc"] and srow[col] != str(w["doc"][k]):
                bad.append(f"W {w['id']}: {k} pg={srow[col]!r} document={w['doc'][k]}")
        print(f"    §{w['id']:<18} " + " || ".join(parts)
              + f" || total pg={srow['total'] or 'NULL'} partial_display pg={srow['partial'] or 'NULL'}")

    n_sweep = sum(1 for s in sc if s["kind"] == "sweep")
    n_fix = sum(1 for s in sc if s["kind"] == "fixture")
    if n_sweep != 1313 or n_fix != 60:
        bad.append(f"COUNT: packet has {n_sweep} sweep + {n_fix} fixtures (want 1313 + 60)")
    if n_f != len(sc) or n_s != len(sc) or n_w != len(worked_examples()):
        bad.append(f"COUNT: compared F={n_f} S={n_s} W={n_w} of {len(sc)} scenarios / {len(worked_examples())} examples")

    if bad:
        print(f"SCORING PARITY: FAIL — {len(bad)} disagreement(s); first 25:")
        for b in bad[:25]:
            print("    " + b)
        return 1
    print(f"SCORING PARITY: PASS — formula path {n_f} ({n_sweep} sweep + {n_fix} targeted), "
          f"session path {n_s} ({n_sweep} + {n_fix}), §28 examples {n_w}; scaled bit-exact, "
          f"decomposition |Δ|<=1e-9 vs reference")
    return 0


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "gen":
        gen()
    elif len(sys.argv) >= 4 and sys.argv[1] == "check" and sys.argv[2] == "--psql-out":
        sys.exit(check(sys.argv[3]))
    else:
        print("usage: scoring_parity.py gen | check --psql-out <file>", file=sys.stderr)
        sys.exit(2)
