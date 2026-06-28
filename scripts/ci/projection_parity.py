#!/usr/bin/env python3
# @spec [Doc-05C_V1 §5 (compute_section_projection State A) / §6 (formula + §6.7 worked
#   examples) / §4 (projection constants) / §13 (stress fixture, State-A subset);
#   contract ws3-05b-05c §D1 / §G3] | @implemented [2026-06-13]
# plain English: the INDEPENDENT Python reference for the STATE-A section-projection formula
#   (blend_denominator=1, mastery term alone — no full-lengths pre-WS-4). It re-derives the
#   §6 formula from a LOCAL constants dict matching the seeded mastery_constants values, over
#   Doc 05C §6.7 worked-example fixtures (at minimum Example 2 Math 480 (380-580), plus a
#   zero-evidence widest-band case and a high-mastery case). The 05c-projection-gates.sh
#   orchestrator runs the PL/pgSQL compute_section_projection over the SAME fixtures and asserts
#   three-way bit-exact equality: PL/pgSQL == this Python reference == §6 expected (mid/low/high
#   exact integers after round-to-10).
#
#   round_to_step uses Python's Decimal ROUND_HALF_UP (away from zero) to mirror Postgres numeric
#   ROUND (banker's rounding is NOT used; §6.4). evidence band, clamp, and the [200,800] affine
#   mastery-term map are the §6.5 formula verbatim. STATES B/C are deferred (WS-4) and are NOT
#   modelled here.
#
# subcommands:
#   gen   — emit the seed+compute SQL (domain mastery rows + section KPI + compute calls) for the
#           orchestrator to run against the PL/pgSQL function.
#   check — read the PL/pgSQL output and assert three-way parity vs this reference + §6 expected.

from __future__ import annotations
import argparse
import json
import sys
import uuid
from decimal import Decimal, ROUND_HALF_UP

# ── LOCAL projection constants (MUST match the seeded mastery_constants values, Doc 05C §4) ──
CONSTANTS = {
    "TARGET_QCOUNT": 500,
    "MIN_DELTA": Decimal("25"),
    "MAX_DELTA": Decimal("100"),
    "MID_ROUND": 10,
    "BOUND_ROUND": 10,
    "SECTION_MAX": 800,
    "SECTION_MIN": 200,
}

# Domain weights per section (Doc 05C §4.2/§4.3) — byte-identical canonical strings (RB-05C-V1-04).
WEIGHTS = {
    "M": {
        "Algebra": Decimal("0.350000"),
        "Advanced Math": Decimal("0.350000"),
        "Problem Solving and Data Analysis": Decimal("0.150000"),
        "Geometry and Trigonometry": Decimal("0.150000"),
    },
    "RW": {
        "Information and Ideas": Decimal("0.260000"),
        "Craft and Structure": Decimal("0.280000"),
        "Expression of Ideas": Decimal("0.200000"),
        "Standard English Conventions": Decimal("0.260000"),
    },
}

MIN_EVENTS = 5  # mastery_min_events() value (MIN_EVENTS_FOR_MASTERY) — used only to seed the gate.

_NS = uuid.UUID("05c05c05-0000-0000-0000-00000000d011")
_QID = "SATM1CCCCCC"


def round_to_step(value: Decimal, step: int) -> int:
    """Round to the nearest multiple of step, HALF-AWAY-FROM-ZERO (mirrors Postgres numeric ROUND)."""
    quotient = (value / Decimal(step)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(quotient * Decimal(step))


def clamp(value: Decimal, lo: int, hi: int) -> Decimal:
    return min(max(value, Decimal(lo)), Decimal(hi))


def compute_state_a(section: str, masteries: dict, relevant_qcount: int) -> dict:
    """The Doc 05C §6 State-A formula (blend_denominator=1)."""
    c = CONSTANTS
    weighted = sum(masteries[d] * WEIGHTS[section][d] for d in WEIGHTS[section])
    mastery_term = Decimal(c["SECTION_MIN"]) + weighted * (Decimal(c["SECTION_MAX"]) - Decimal(c["SECTION_MIN"]))
    blended_raw = mastery_term / Decimal(1)  # State A

    evidence_ratio = min(max(Decimal(relevant_qcount) / Decimal(c["TARGET_QCOUNT"]), Decimal(0)), Decimal(1))
    delta = c["MAX_DELTA"] - ((c["MAX_DELTA"] - c["MIN_DELTA"]) * evidence_ratio)

    mid = round_to_step(clamp(blended_raw, c["SECTION_MIN"], c["SECTION_MAX"]), c["MID_ROUND"])
    low = round_to_step(clamp(Decimal(mid) - delta, c["SECTION_MIN"], c["SECTION_MAX"]), c["BOUND_ROUND"])
    high = round_to_step(clamp(Decimal(mid) + delta, c["SECTION_MIN"], c["SECTION_MAX"]), c["BOUND_ROUND"])
    return {
        "weighted_mastery": weighted,
        "mastery_term": mastery_term,
        "mid": mid,
        "low": low,
        "high": high,
        "range_width": high - low,
        "blend_denominator": 1,
        "fl_count_used": 0,
    }


# ── Fixtures (Doc 05C §6.7 worked examples + §13 range-edge cases, State-A subset) ──
# Each fixture: 4 Math-domain masteries, relevant_question_count, and the §6 EXPECTED mid/low/high.
FIXTURES = {
    # Example 2 (§6.7): all-equal masteries 0.467 -> weighted 0.467 -> mastery_term 480.2;
    # 20 relevant questions -> delta 97 -> 480 (380-580). The canonical parity fixture.
    "EX2_STATE_A": {
        "section": "M",
        "masteries": {
            "Algebra": Decimal("0.467"),
            "Advanced Math": Decimal("0.467"),
            "Problem Solving and Data Analysis": Decimal("0.467"),
            "Geometry and Trigonometry": Decimal("0.467"),
        },
        "relevant_qcount": 20,
        "expected": {"mid": 480, "low": 380, "high": 580},
    },
    # Zero-evidence widest band: weighted 0.50 -> mastery_term 500; 0 relevant -> delta MAX_DELTA 100
    # -> 500 (400-600), widest possible band.
    "ZERO_EVIDENCE_WIDEST": {
        "section": "M",
        "masteries": {
            "Algebra": Decimal("0.5"),
            "Advanced Math": Decimal("0.5"),
            "Problem Solving and Data Analysis": Decimal("0.5"),
            "Geometry and Trigonometry": Decimal("0.5"),
        },
        "relevant_qcount": 0,
        "expected": {"mid": 500, "low": 400, "high": 600},
    },
    # High mastery, full evidence: weighted 0.90 -> mastery_term 740; >= target (500) -> delta MIN 25
    # -> mid 740; low round_to_step(715,10)=720 (71.5 half-up -> 72); high round_to_step(765,10)=770
    # (76.5 half-up -> 77). Asserts MIN_DELTA at full evidence + half-away-from-zero rounding.
    "HIGH_MASTERY_FULL_EVIDENCE": {
        "section": "M",
        "masteries": {
            "Algebra": Decimal("0.90"),
            "Advanced Math": Decimal("0.90"),
            "Problem Solving and Data Analysis": Decimal("0.90"),
            "Geometry and Trigonometry": Decimal("0.90"),
        },
        "relevant_qcount": 500,
        "expected": {"mid": 740, "low": 720, "high": 770},
    },
}


def _student(fid: str) -> str:
    return str(uuid.uuid5(_NS, f"student:{fid}"))


def _lit(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def selfcheck() -> int:
    """Reference == Doc 05C §6 expected. Run before three-way comparison."""
    ok = True
    for fid, fx in FIXTURES.items():
        r = compute_state_a(fx["section"], fx["masteries"], fx["relevant_qcount"])
        exp = fx["expected"]
        for k in ("mid", "low", "high"):
            if r[k] != exp[k]:
                print(f"  SELFCHECK FAIL {fid}.{k}: reference={r[k]} expected={exp[k]}", file=sys.stderr)
                ok = False
        # range coherence (INV-05C-15)
        if not (r["low"] <= r["mid"] <= r["high"] and r["range_width"] == r["high"] - r["low"]):
            print(f"  SELFCHECK FAIL {fid}: range incoherent {r}", file=sys.stderr)
            ok = False
    if not ok:
        return 1
    print(f"PROJECTION SELFCHECK: PASS (reference == Doc 05C §6 expected over {len(FIXTURES)} State-A fixtures)")
    return 0


def cmd_gen() -> int:
    """Emit seed + compute SQL for the orchestrator. Domain mastery rows (all 8 domains so the Q4
    gate passes), the section KPI events_total (relevant_question_count source), and the compute
    call. Each fixture's RW domains are seeded at/above threshold with a fixed mastery so the
    whole-student 8-domain gate passes; only the fixture's M section is asserted."""
    out: list[str] = ["SET search_path = public, pg_temp;"]
    out.append(
        "INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, "
        "stem, options, correct_answer, explanation) VALUES "
        f"({_lit(_QID)}, 'M', 1, 'Algebra', ARRAY['s'], 2, 'stem', "
        f"'[{{\"key\":\"A\",\"text\":\"a\"}},{{\"key\":\"B\",\"text\":\"b\"}},{{\"key\":\"C\",\"text\":\"c\"}},{{\"key\":\"D\",\"text\":\"d\"}}]'::jsonb, 'A', 'expl') "
        "ON CONFLICT (id) DO NOTHING;"
    )

    rw_fixed = Decimal("0.5")  # RW masteries (gate filler; not asserted)

    for fid, fx in FIXTURES.items():
        sid = _student(fid)
        section = fx["section"]
        out.append(f"INSERT INTO auth.users (id, email) VALUES ({_lit(sid)}, {_lit(fid+'@cid')}) ON CONFLICT (id) DO NOTHING;")
        out.append(f"INSERT INTO public.profiles (id, email) VALUES ({_lit(sid)}, {_lit(fid+'@cid')}) ON CONFLICT (id) DO NOTHING;")

        # Seed ALL 8 domains at/above threshold so the whole-student Q4 gate passes (event_count_total
        # >= MIN_EVENTS). M domains use the fixture masteries; RW domains use the filler.
        for dom, m in fx["masteries"].items():
            out.append(
                "INSERT INTO public.student_domain_mastery "
                "(student_id, section, domain, mastery_score, mastery_pct, mastery_level, "
                " event_count_total, mastery_model_version, constants_snapshot_hash, computed_at) VALUES ("
                f"{_lit(sid)}, {_lit(section)}, {_lit(dom)}, {m}, {(m*100).quantize(Decimal('0.01'))}, 2, "
                f"{MIN_EVENTS}, 'v1.0', 'ci', now()) "
                "ON CONFLICT (student_id, section, domain) DO UPDATE SET "
                "mastery_score=EXCLUDED.mastery_score, event_count_total=EXCLUDED.event_count_total;"
            )
        # RW filler domains (the other section) so the whole-student gate passes.
        other = "RW" if section == "M" else "M"
        for dom in WEIGHTS[other]:
            out.append(
                "INSERT INTO public.student_domain_mastery "
                "(student_id, section, domain, mastery_score, mastery_pct, mastery_level, "
                " event_count_total, mastery_model_version, constants_snapshot_hash, computed_at) VALUES ("
                f"{_lit(sid)}, {_lit(other)}, {_lit(dom)}, {rw_fixed}, {(rw_fixed*100).quantize(Decimal('0.01'))}, 2, "
                f"{MIN_EVENTS}, 'v1.0', 'ci', now()) "
                "ON CONFLICT (student_id, section, domain) DO UPDATE SET "
                "mastery_score=EXCLUDED.mastery_score, event_count_total=EXCLUDED.event_count_total;"
            )

        # Section KPI events_total = relevant_question_count for the asserted section.
        out.append(
            "INSERT INTO public.student_section_kpi "
            "(student_id, section, events_total, refreshed_at_t_now) VALUES ("
            f"{_lit(sid)}, {_lit(section)}, {fx['relevant_qcount']}, now()) "
            "ON CONFLICT (student_id, section) DO UPDATE SET events_total=EXCLUDED.events_total;"
        )

        # Compute the projection with a FIXED p_t_now for determinism, then emit a tagged result row.
        out.append(
            "SELECT 'PARITY|' || {fid} || '|' || section || '|' "
            "|| COALESCE(projected_score_mid::text,'NULL') || '|' "
            "|| COALESCE(projected_score_low::text,'NULL') || '|' "
            "|| COALESCE(projected_score_high::text,'NULL') || '|' "
            "|| COALESCE(range_width::text,'NULL') || '|' "
            "|| blend_denominator::text || '|' || fl_count_used::text "
            "FROM public.compute_section_projection("
            "{sid}, {section}, TIMESTAMPTZ '2026-06-13T00:00:00Z');".format(
                fid=_lit(fid), sid=_lit(sid), section=_lit(section)
            )
        )

    print("\n".join(out))
    return 0


def cmd_check(psql_out: str) -> int:
    if selfcheck() != 0:
        return 1
    rows: dict[str, dict] = {}
    with open(psql_out, encoding="utf8") as fh:
        for line in fh:
            line = line.strip()
            if not line.startswith("PARITY|"):
                continue
            parts = line.split("|")
            # PARITY | fid | section | mid | low | high | width | denom | fl_count
            _, fid, section, mid, low, high, width, denom, flc = parts
            rows[fid] = {
                "section": section,
                "mid": mid, "low": low, "high": high, "width": width,
                "denom": int(denom), "flc": int(flc),
            }

    # Fail-closed (no false-green): a parser that silently matched zero rows would "pass" with no
    # comparisons. Require every fixture to have produced a PL/pgSQL row before any equality check.
    if len(rows) != len(FIXTURES):
        missing = sorted(set(FIXTURES) - set(rows))
        print(f"PROJECTION PARITY: FAIL — parsed {len(rows)}/{len(FIXTURES)} PARITY rows from PL/pgSQL "
              f"output (missing {missing}); refusing to pass without all comparisons", file=sys.stderr)
        return 1

    ok = True
    for fid, fx in FIXTURES.items():
        if fid not in rows:
            print(f"  FAIL {fid}: no PL/pgSQL output row", file=sys.stderr)
            ok = False
            continue
        ref = compute_state_a(fx["section"], fx["masteries"], fx["relevant_qcount"])
        pg = rows[fid]
        exp = fx["expected"]
        # three-way: PL/pgSQL == Python reference == §6 expected
        checks = [
            ("mid", int(pg["mid"]), ref["mid"], exp["mid"]),
            ("low", int(pg["low"]), ref["low"], exp["low"]),
            ("high", int(pg["high"]), ref["high"], exp["high"]),
        ]
        for name, pgv, refv, expv in checks:
            if not (pgv == refv == expv):
                print(f"  FAIL {fid}.{name}: pg={pgv} ref={refv} expected={expv}", file=sys.stderr)
                ok = False
        # width + State-A blend invariants
        if int(pg["width"]) != ref["range_width"]:
            print(f"  FAIL {fid}.width: pg={pg['width']} ref={ref['range_width']}", file=sys.stderr)
            ok = False
        if pg["denom"] != 1 or pg["flc"] != 0:
            print(f"  FAIL {fid}: State A expects denom=1 fl_count=0, got denom={pg['denom']} flc={pg['flc']}", file=sys.stderr)
            ok = False
        if ok:
            print(f"  OK {fid} ({fx['section']}): {pg['mid']} ({pg['low']}-{pg['high']}) "
                  f"== ref {ref['mid']} ({ref['low']}-{ref['high']}) == §6 {exp['mid']} ({exp['low']}-{exp['high']})")

    if not ok:
        print("PROJECTION PARITY: FAIL", file=sys.stderr)
        return 1
    print(f"PROJECTION PARITY: PASS (three-way bit-exact over {len(FIXTURES)} State-A fixtures incl. Example 2 Math 480 (380-580))")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("gen")
    sub.add_parser("selfcheck")
    c = sub.add_parser("check")
    c.add_argument("--psql-out", required=True)
    args = ap.parse_args()
    if args.cmd == "gen":
        return cmd_gen()
    if args.cmd == "selfcheck":
        return selfcheck()
    if args.cmd == "check":
        return cmd_check(args.psql_out)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
