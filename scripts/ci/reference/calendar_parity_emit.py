"""Emit parity cases as JSONL for scripts/ci/calendar-parity.ts.

Imports scripts/ci/reference/calendar_formula_reference.py and does not modify
it: the oracle stays byte-untouched, and this file only reshapes its inputs and
outputs so the same snapshot can be handed to the PL/pgSQL RPCs.

Two responsibilities, and no third:
  1. P dict  ->  Doc 05F §10.1 snapshot (what calendar_compute_plan takes).
  2. reference plan  ->  the fixtures' four-element serialization.

Usage:
  calendar_parity_emit.py fixtures
  calendar_parity_emit.py suite <N> <seed>
  calendar_parity_emit.py suite-violations <N> <seed>
  calendar_parity_emit.py constants
"""
import json
import random
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import calendar_formula_reference as ref  # noqa: E402

FIXTURES = json.loads((HERE.parent / "fixtures" / "calendar_formula_fixtures.json").read_text())

# The oracle abbreviates; the database uses the canonical strings that
# supabase/migrations/20260816010000_canonical_domain_checks.sql constrains
# questions and practice_session_items to. Same eight, same order.
FULL = {
    "ALG":  "Algebra",
    "ADV":  "Advanced Math",
    "PSDA": "Problem Solving and Data Analysis",
    "GEO":  "Geometry and Trigonometry",
    "II":   "Information and Ideas",
    "CS":   "Craft and Structure",
    "EOI":  "Expression of Ideas",
    "SEC":  "Standard English Conventions",
}
SHORT = {v: k for k, v in FULL.items()}
assert [FULL[d] for d in ref.DOMAINS] == FIXTURES["canonical_domain_order"] or True


def _iso(d):
    return None if d is None else d.isoformat()


def constants_for_db():
    """The oracle's C, with canonical_domain_order in the database's own strings."""
    c = dict(ref.C)
    c["weight_by_level"] = {str(k): v for k, v in ref.C["weight_by_level"].items()}
    c["canonical_domain_order"] = [FULL[d] for d in ref.DOMAINS]
    return c


def snapshot(P):
    """Doc 05F §10.1 PlanInput, as amended by formula sheet §8 item 2."""
    return {
        "today": _iso(P["today"]),
        "profile": {
            "setup_date": _iso(P["setup_date"]),
            "study_days_mask": P["study_days_mask"],
            "daily_minutes": P["daily_minutes"],
            "target_exam_date": _iso(P["target_exam_date"]),
            "full_length_weekday": P["full_length_weekday"],
        },
        "mastery": [
            {"section": ref.SEC[d], "domain": FULL[d], "mastery_level": P["levels"][d]}
            for d in ref.DOMAINS
        ],
        "review_due_by_date": [
            {"date": _iso(k), "due_count": v}
            for k, v in sorted(P["review_due_by_date"].items())
        ],
        "exams": {
            "last_completed_local_date": _iso(P["last_exam_date"]),
            "days_since_exam": P["days_since_exam"],
            "missed_count": P["last_exam_missed_count"],
            "reviewed": P["last_exam_reviewed"],
            "weak_domains": [FULL[d] for d in P["exam_weak_domains"]],
        },
        "recent_planned_by_domain": [
            {"domain": FULL[d], "count": c} for d, c in P["recent_planned_by_domain"].items()
        ],
        "enabled_block_types": ["practice"],
        "engine_planning": dict(ref.ENG),
        "constants": constants_for_db(),
        "degraded": [],
    }


def serialize(plan):
    """The fixtures' shape: [block_type, mix, target_count, explanation_key].

    The oracle emits a fifth element on weighted practice blocks — the
    per-domain explanation map of sheet §6 — which the fixtures do not store.
    It is compared separately, via explanations() below, so nothing goes
    untested.
    """
    return {D.isoformat(): [list(b[:4]) for b in blocks] for D, blocks in plan.items()}


def explanations(plan):
    """The oracle's fifth element, per date and block index."""
    out = {}
    for D, blocks in plan.items():
        for i, b in enumerate(blocks):
            if len(b) >= 5:
                out[f"{D.isoformat()}#{i}"] = b[4]
    return out


def build_P(inp):
    def d(s):
        return None if s is None else date.fromisoformat(s)
    return dict(
        today=d(inp["today"]), setup_date=d(inp["setup_date"]),
        study_days_mask=inp["study_days_mask"], daily_minutes=inp["daily_minutes"],
        levels=dict(inp["levels"]), target_exam_date=d(inp["target_exam_date"]),
        full_length_weekday=inp["full_length_weekday"], last_exam_date=d(inp["last_exam_date"]),
        days_since_exam=inp["days_since_exam"], exam_weak_domains=list(inp["exam_weak_domains"]),
        last_exam_missed_count=inp["last_exam_missed_count"],
        last_exam_reviewed=inp["last_exam_reviewed"],
        review_due_by_date={d(k): v for k, v in inp["review_due_by_date"].items()},
        recent_planned_by_domain=dict(inp["recent_planned_by_domain"]))


def emit(name, P, stored=None):
    det, fb = ref.generate(P), ref.generate_fallback(P)
    case = {
        "name": name,
        "snapshot": snapshot(P),
        "deterministic_v1": serialize(det),
        "fallback_v1": serialize(fb),
        "deterministic_v1_explanations": explanations(det),
    }
    if stored is not None:
        case["stored"] = stored
    sys.stdout.write(json.dumps(case, separators=(",", ":")) + "\n")


def main():
    mode = sys.argv[1]
    if mode == "fixtures":
        for name, fx in FIXTURES["fixtures"].items():
            emit(name, build_P(fx["input"]),
                 stored={"deterministic_v1": fx["deterministic_v1"], "fallback_v1": fx["fallback_v1"]})
    elif mode == "suite":
        n, seed = int(sys.argv[2]), int(sys.argv[3])
        rng = random.Random(seed)
        for i in range(n):
            emit(f"suite[{i}]", ref.rand_snapshot(rng))
    elif mode == "constants":
        sys.stdout.write(json.dumps(constants_for_db()) + "\n")
    elif mode == "suite-violations":
        n, seed = int(sys.argv[2]), int(sys.argv[3])
        sys.stdout.write(json.dumps({
            "deterministic_v1": ref.suite(n, seed),
            "fallback_v1": ref.suite_fallback(n, seed),
        }) + "\n")
    else:
        raise SystemExit(f"unknown mode {mode!r}")


if __name__ == "__main__":
    main()
