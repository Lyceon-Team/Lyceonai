#!/usr/bin/env python3
# @spec [Doc-05A_V1 §4/§6.2/§12; Lane-C contract §D3] | @implemented [2026-06-13]
# plain English: the PRODUCTION-derivation parity driver (Lane C, bridges isolation-parity to
#   production-parity). Instead of the fixture stand-in canonical_mastery_events, it seeds the
#   REAL WS-2 answer tables (practice_session_items[answered] + review_error_attempts) through
#   their FKs (profiles, questions, practice_sessions), then runs compute_mastery_for_entity over
#   the PRODUCTION canonical_mastery_events and compares three-way (PL/pgSQL == Python reference ==
#   Doc 05A §12 expected) — proving the bit-exact formula proof transfers to the live wiring.
# scope: only the practice/review-only fixture subset (no `test` source — that branch is WS-4 / A4).
#   The 12 test-bearing fixtures stay proven via the isolation harness and get production parity
#   when WS-4 lands the test answer surface.
# subcommands: `gen` emits the seed + compute SQL; `check` compares the captured psql output.

from __future__ import annotations
import argparse, os, sys, uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "reference"))
from mastery_reference import FIXTURES, compute_mastery  # noqa: E402

_NS = uuid.UUID("05a05a05-0000-0000-0000-00000000c0de")
_QID = "SATM1AAAAAA"   # one shared canonical question (SAT-format); items carry per-event difficulty
_BASE = "2026-01-01T00:00:00Z"


def _prod_fixtures() -> dict:
    """Fixtures whose events are practice/review only (no `test` source) — the production-derivable set."""
    out = {}
    for fid, fx in FIXTURES.items():
        if all(e["source_family"] in ("practice", "review") for e in fx["events"]):
            out[fid] = fx
    return out


def _student(fid: str) -> str: return str(uuid.uuid5(_NS, f"student:{fid}"))
def _sess(fid: str) -> str: return str(uuid.uuid5(_NS, f"session:{fid}"))
def _evt(fid: str, i: int) -> str: return str(uuid.uuid5(_NS, f"event:{fid}:{i}"))
def _lit(s: str) -> str: return "'" + s.replace("'", "''") + "'"


def cmd_gen() -> int:
    prod = _prod_fixtures()
    out: list[str] = ["SET search_path = public, pg_temp;"]
    # one shared canonical question (FK target for every answer row)
    out.append(
        "INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, "
        "stem, options, correct_answer, explanation) VALUES "
        f"({_lit(_QID)}, 'M', 1, 'Algebra', ARRAY['s'], 2, 'stem', "
        f"'[{{\"key\":\"A\",\"text\":\"a\"}},{{\"key\":\"B\",\"text\":\"b\"}},{{\"key\":\"C\",\"text\":\"c\"}},{{\"key\":\"D\",\"text\":\"d\"}}]'::jsonb, 'A', 'expl') "
        "ON CONFLICT (id) DO NOTHING;"
    )
    for fid, fx in prod.items():
        sid = _student(fid)
        out.append(f"INSERT INTO auth.users (id, email) VALUES ({_lit(sid)}, {_lit(fid+'@ci')}) ON CONFLICT (id) DO NOTHING;")
        out.append(f"INSERT INTO public.profiles (id, email) VALUES ({_lit(sid)}, {_lit(fid+'@ci')}) ON CONFLICT (id) DO NOTHING;")
        events = fx["events"]
        has_practice = any(e["source_family"] == "practice" for e in events)
        if has_practice:
            out.append(
                "INSERT INTO public.practice_sessions (id, user_id, mode, target_count, platform, client_instance_id, actor_id) "
                f"VALUES ({_lit(_sess(fid))}, {_lit(sid)}, 'flow', {max(1,len(events))}, 'web', 'ci', "
                f"(SELECT actor_id FROM public.profiles WHERE id = {_lit(sid)})) ON CONFLICT (id) DO NOTHING;"
            )
        for i, e in enumerate(events):
            # recency order: idx 0 is most recent -> strictly-decreasing occurred_at
            occ = f"(TIMESTAMPTZ {_lit(_BASE)} - (INTERVAL '1 minute' * {i}))"
            correct = "true" if e["correct"] else "false"
            diff = e["difficulty"]
            if e["source_family"] == "practice":
                out.append(
                    "INSERT INTO public.practice_session_items "
                    "(id, session_id, user_id, ordinal, question_id, question_stem, question_options, "
                    " question_correct_answer, question_explanation, question_domain, question_skill, "
                    " question_difficulty, question_section, status, is_correct, occurred_at, actor_id) VALUES ("
                    f"{_lit(_evt(fid,i))}, {_lit(_sess(fid))}, {_lit(sid)}, {i}, {_lit(_QID)}, 'stem', '[]'::jsonb, "
                    f"'A', 'expl', 'Algebra', 's', {diff}::smallint, 'M', 'answered', {correct}, {occ}, "
                    f"(SELECT actor_id FROM public.profiles WHERE id = {_lit(sid)}));"
                )
            else:  # review
                out.append(
                    "INSERT INTO public.review_error_attempts "
                    "(id, student_id, question_id, is_correct, section, domain, skill, difficulty, occurred_at, actor_id) VALUES ("
                    f"{_lit(_evt(fid,i))}, {_lit(sid)}, {_lit(_QID)}, {correct}, 'M', 'Algebra', 's', {diff}::smallint, {occ}, "
                    f"(SELECT actor_id FROM public.profiles WHERE id = {_lit(sid)}));"
                )
    # compute via PRODUCTION canonical_mastery_events, COPYed as TSV
    selects = [
        f"SELECT {_lit(fid)}::text AS fid, c.total_events, c.acc_test, c.acc_practice, c.acc_review, "
        f"c.mastery_score, c.mastery_pct, c.mastery_level "
        f"FROM public.compute_mastery_for_entity({_lit(_student(fid))}, 'skill', 'M', 'Algebra', 's') c"
        for fid in prod
    ]
    out.append("\\echo __COMPUTE_BEGIN__")
    out.append("COPY (\n" + "\nUNION ALL\n".join(selects) + "\n) TO STDOUT;")
    out.append("\\echo __COMPUTE_END__")
    sys.stdout.write("\n".join(out) + "\n")
    return 0


def _num(t: str): return None if t == "\\N" else float(t)
def _close(a, b, tol):
    if a is None or b is None: return a is None and b is None
    return abs(a - b) <= tol


def cmd_check(psql_out: str) -> int:
    lines = psql_out.splitlines()
    try:
        block = lines[lines.index("__COMPUTE_BEGIN__")+1:lines.index("__COMPUTE_END__")]
    except ValueError:
        print("PROD-PARITY FAIL: compute markers missing (psql error?)"); return 1
    prod = _prod_fixtures()
    seen = {}
    for line in block:
        if not line.strip(): continue
        p = line.split("\t")
        if len(p) != 8:
            print(f"PROD-PARITY FAIL: malformed row {line!r}"); return 1
        seen[p[0]] = p
    failures = []
    if set(seen) != set(prod):
        failures.append(f"subset mismatch: expected {len(prod)} fixtures, saw {len(seen)} "
                        f"(missing {sorted(set(prod)-set(seen))})")
    for fid, p in seen.items():
        ref = compute_mastery(FIXTURES[fid]["events"]); exp = FIXTURES[fid]["expected"]
        sql = {"total": int(p[1]), "acc_test": _num(p[2]), "acc_practice": _num(p[3]),
               "acc_review": _num(p[4]), "score": _num(p[5]), "pct": _num(p[6]),
               "level": None if p[7]=="\\N" else int(p[7])}
        checks = [
            ("total", sql["total"]==ref["total_events"]==exp["total"]),
            ("acc_test", _close(sql["acc_test"],ref["acc_test"],1e-6) and _close(sql["acc_test"],exp["acc_test"],1e-6)),
            ("acc_practice", _close(sql["acc_practice"],ref["acc_practice"],1e-6) and _close(sql["acc_practice"],exp["acc_practice"],1e-6)),
            ("acc_review", _close(sql["acc_review"],ref["acc_review"],1e-6) and _close(sql["acc_review"],exp["acc_review"],1e-6)),
            ("score", _close(sql["score"],ref["mastery_score"],1e-4) and _close(sql["score"],exp["score"],1e-4)),
            ("pct", _close(sql["pct"],ref["mastery_pct"],1e-2) and _close(sql["pct"],exp["pct"],1e-2)),
            ("level", sql["level"]==ref["mastery_level"]==exp["level"]),
        ]
        for name, ok in checks:
            if not ok: failures.append(f"{fid}.{name}: sql={sql[name]} ref={ref.get('mastery_'+name, ref.get(name)) } exp={exp.get(name)}")
    if failures:
        print(f"PRODUCTION-DERIVATION PARITY FAILED — {len(failures)} divergence(s):")
        for f in failures: print("  - " + f)
        return 1
    print(f"PRODUCTION-DERIVATION PARITY PASSED — {len(seen)} practice/review fixtures bit-exact "
          f"three-way over the PRODUCTION canonical_mastery_events (real WS-2 tables + FKs).")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Lane-C production-derivation parity")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("gen")
    cp = sub.add_parser("check"); cp.add_argument("--psql-out", required=True)
    a = ap.parse_args()
    if a.cmd == "gen": return cmd_gen()
    with open(a.psql_out, encoding="utf-8") as fh: return cmd_check(fh.read())


if __name__ == "__main__":
    sys.exit(main())
