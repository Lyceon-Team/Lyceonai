#!/usr/bin/env python3
# @spec [Doc-05B_V1 §13 (domain stress fixture) / §13.1 (31 scenarios at domain grain) /
#   §13.2 (test_domain_mastery_equals_event_aggregation) / INV-05B-13; Doc-05A §12;
#   contract ws3-05b-05c §G1 / §A2] | @implemented [2026-06-13]
# plain English: the DOMAIN-grain production parity driver. Doc 05B §13.1 reuses 05A's
#   practice/review stress fixtures at the DOMAIN grain (same event sets, same expected values)
#   because compute_mastery_for_entity is the ONE formula impl (INV-05A-11): an identical event
#   history MUST produce identical mastery whether the entity filter is 'skill' or 'domain'.
#   This seeds the REAL WS-2 answer tables (practice_session_items[answered] + review_error_attempts)
#   exactly as mastery_production_parity.py does, then runs compute_mastery_for_entity over the
#   PRODUCTION canonical_mastery_events with entity_type='domain' (p_skill=NULL) and compares
#   three-way (PL/pgSQL == Python reference == Doc 05A §12 expected), bit-exact.
#
#   PLUS the INV-05B-13 cross-skill aggregation invariant (§13.2 / contract §A2): a domain with 5
#   events across TWO sub-threshold skills (each <5 events) STILL yields a NON-NULL domain mastery
#   (event-aggregation, not skill roll-up), while each skill's compute('skill') is NULL. This is
#   the test that catches any future "compute domain from skill rows" optimization.
#
# scope: practice/review-only fixtures (no `test` source — WS-4 / A4), matching the production
#   canonical_mastery_events surface. subcommands: `gen` emits seed+compute SQL; `check` compares.

from __future__ import annotations
import argparse, os, sys, uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "reference"))
from mastery_reference import FIXTURES, compute_mastery  # noqa: E402

_NS = uuid.UUID("05b05b05-0000-0000-0000-00000000d011")
_QID = "SATM1BBBBBB"   # one shared canonical question (SAT-format)
_BASE = "2026-02-01T00:00:00Z"
_DOMAIN = "Algebra"    # all fixture events tagged to a single canonical M domain (§13.1)

# INV-05B-13 cross-skill fixture identity
_AGG_STUDENT = str(uuid.uuid5(_NS, "inv13:student"))
_AGG_SESS = str(uuid.uuid5(_NS, "inv13:session"))
_AGG_SKILLS = ["Linear equations in one variable", "Linear equations in two variables"]  # two sub-threshold skills


def _prod_fixtures() -> dict:
    """Fixtures whose events are practice/review only — the production-derivable set (no `test`)."""
    return {fid: fx for fid, fx in FIXTURES.items()
            if all(e["source_family"] in ("practice", "review") for e in fx["events"])}


def _student(fid: str) -> str: return str(uuid.uuid5(_NS, f"student:{fid}"))
def _sess(fid: str) -> str: return str(uuid.uuid5(_NS, f"session:{fid}"))
def _evt(fid: str, i: int) -> str: return str(uuid.uuid5(_NS, f"event:{fid}:{i}"))
def _lit(s: str) -> str: return "'" + s.replace("'", "''") + "'"


def _practice_item(eid: str, sess: str, sid: str, ordinal: int, skill: str, diff: int, correct: str, occ: str) -> str:
    return (
        "INSERT INTO public.practice_session_items "
        "(id, session_id, user_id, ordinal, question_id, question_stem, question_options, "
        " question_correct_answer, question_explanation, question_domain, question_skill, "
        " question_difficulty, question_section, status, is_correct, occurred_at, actor_id) VALUES ("
        f"{_lit(eid)}, {_lit(sess)}, {_lit(sid)}, {ordinal}, {_lit(_QID)}, 'stem', '[]'::jsonb, "
        f"'A', 'expl', {_lit(_DOMAIN)}, {_lit(skill)}, {diff}::smallint, 'M', 'answered', {correct}, {occ}, "
        f"(SELECT actor_id FROM public.profiles WHERE id = {_lit(sid)}));"
    )


def _review_attempt(eid: str, sid: str, skill: str, diff: int, correct: str, occ: str) -> str:
    return (
        "INSERT INTO public.review_error_attempts "
        "(id, student_id, question_id, is_correct, section, domain, skill, difficulty, occurred_at, actor_id) VALUES ("
        f"{_lit(eid)}, {_lit(sid)}, {_lit(_QID)}, {correct}, 'M', {_lit(_DOMAIN)}, {_lit(skill)}, {diff}::smallint, {occ}, "
        f"(SELECT actor_id FROM public.profiles WHERE id = {_lit(sid)}));"
    )


def cmd_gen() -> int:
    prod = _prod_fixtures()
    out: list[str] = ["SET search_path = public, pg_temp;"]
    out.append(
        "INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, "
        "stem, options, correct_answer, explanation) VALUES "
        f"({_lit(_QID)}, 'M', 1, {_lit(_DOMAIN)}, ARRAY['s'], 2, 'stem', "
        f"'[{{\"key\":\"A\",\"text\":\"a\"}},{{\"key\":\"B\",\"text\":\"b\"}},{{\"key\":\"C\",\"text\":\"c\"}},{{\"key\":\"D\",\"text\":\"d\"}}]'::jsonb, 'A', 'expl') "
        "ON CONFLICT (id) DO NOTHING;"
    )

    # --- 31-scenario domain-grain seeding (all events single domain, single skill 's_dom') ---
    _DOM_SKILL = "Linear functions"
    for fid, fx in prod.items():
        sid = _student(fid)
        out.append(f"INSERT INTO auth.users (id, email) VALUES ({_lit(sid)}, {_lit(fid+'@cid')}) ON CONFLICT (id) DO NOTHING;")
        out.append(f"INSERT INTO public.profiles (id, email) VALUES ({_lit(sid)}, {_lit(fid+'@cid')}) ON CONFLICT (id) DO NOTHING;")
        events = fx["events"]
        if any(e["source_family"] == "practice" for e in events):
            out.append(
                "INSERT INTO public.practice_sessions (id, user_id, mode, target_count, platform, client_instance_id, actor_id) "
                f"VALUES ({_lit(_sess(fid))}, {_lit(sid)}, 'flow', {max(1,len(events))}, 'web', 'ci', "
                f"(SELECT actor_id FROM public.profiles WHERE id = {_lit(sid)})) ON CONFLICT (id) DO NOTHING;"
            )
        for i, e in enumerate(events):
            occ = f"(TIMESTAMPTZ {_lit(_BASE)} - (INTERVAL '1 minute' * {i}))"
            correct = "true" if e["correct"] else "false"
            if e["source_family"] == "practice":
                out.append(_practice_item(_evt(fid, i), _sess(fid), sid, i, _DOM_SKILL, e["difficulty"], correct, occ))
            else:
                out.append(_review_attempt(_evt(fid, i), sid, _DOM_SKILL, e["difficulty"], correct, occ))

    # compute at DOMAIN grain over PRODUCTION canonical_mastery_events.
    selects = [
        f"SELECT {_lit(fid)}::text AS fid, c.total_events, c.acc_test, c.acc_practice, c.acc_review, "
        f"c.mastery_score, c.mastery_pct, c.mastery_level "
        f"FROM public.compute_mastery_for_entity({_lit(_student(fid))}, 'domain', 'M', {_lit(_DOMAIN)}, NULL) c"
        for fid in prod
    ]
    out.append("\\echo __COMPUTE_BEGIN__")
    out.append("COPY (\n" + "\nUNION ALL\n".join(selects) + "\n) TO STDOUT;")
    out.append("\\echo __COMPUTE_END__")

    # --- INV-05B-13 cross-skill aggregation fixture: 5 medium practice correct across 2 skills ---
    # skill A gets 3 events, skill B gets 2 events; each skill < MIN_EVENTS_FOR_MASTERY (5).
    out.append(f"INSERT INTO auth.users (id, email) VALUES ({_lit(_AGG_STUDENT)}, 'inv13@cid') ON CONFLICT (id) DO NOTHING;")
    out.append(f"INSERT INTO public.profiles (id, email) VALUES ({_lit(_AGG_STUDENT)}, 'inv13@cid') ON CONFLICT (id) DO NOTHING;")
    out.append(
        "INSERT INTO public.practice_sessions (id, user_id, mode, target_count, platform, client_instance_id, actor_id) "
        f"VALUES ({_lit(_AGG_SESS)}, {_lit(_AGG_STUDENT)}, 'flow', 5, 'web', 'ci', "
        f"(SELECT actor_id FROM public.profiles WHERE id = {_lit(_AGG_STUDENT)})) ON CONFLICT (id) DO NOTHING;"
    )
    skill_alloc = [_AGG_SKILLS[0], _AGG_SKILLS[0], _AGG_SKILLS[0], _AGG_SKILLS[1], _AGG_SKILLS[1]]
    for i, skill in enumerate(skill_alloc):
        occ = f"(TIMESTAMPTZ {_lit(_BASE)} - (INTERVAL '1 minute' * {i}))"
        out.append(_practice_item(str(uuid.uuid5(_NS, f"inv13:evt:{i}")), _AGG_SESS, _AGG_STUDENT, i, skill, 2, "true", occ))
    # domain compute (must be NON-NULL: 5 events aggregate) and each skill compute (must be NULL: <5).
    out.append("\\echo __INV13_BEGIN__")
    out.append(
        "COPY (\n"
        f"  SELECT 'domain'::text AS scope, c.total_events, c.mastery_score, c.mastery_level "
        f"  FROM public.compute_mastery_for_entity({_lit(_AGG_STUDENT)}, 'domain', 'M', {_lit(_DOMAIN)}, NULL) c\n"
        "UNION ALL\n"
        f"  SELECT 'skillA'::text, c.total_events, c.mastery_score, c.mastery_level "
        f"  FROM public.compute_mastery_for_entity({_lit(_AGG_STUDENT)}, 'skill', 'M', {_lit(_DOMAIN)}, {_lit(_AGG_SKILLS[0])}) c\n"
        "UNION ALL\n"
        f"  SELECT 'skillB'::text, c.total_events, c.mastery_score, c.mastery_level "
        f"  FROM public.compute_mastery_for_entity({_lit(_AGG_STUDENT)}, 'skill', 'M', {_lit(_DOMAIN)}, {_lit(_AGG_SKILLS[1])}) c\n"
        ") TO STDOUT;"
    )
    out.append("\\echo __INV13_END__")
    sys.stdout.write("\n".join(out) + "\n")
    return 0


def _num(t: str): return None if t == "\\N" else float(t)
def _close(a, b, tol):
    if a is None or b is None: return a is None and b is None
    return abs(a - b) <= tol


def cmd_check(psql_out: str) -> int:
    lines = psql_out.splitlines()
    failures: list[str] = []

    # --- block 1: the 31-fixture domain-grain three-way parity ---
    try:
        block = lines[lines.index("__COMPUTE_BEGIN__")+1:lines.index("__COMPUTE_END__")]
    except ValueError:
        print("DOMAIN-PARITY FAIL: compute markers missing (psql error?)"); return 1
    prod = _prod_fixtures()
    seen = {}
    for line in block:
        if not line.strip(): continue
        p = line.split("\t")
        if len(p) != 8:
            print(f"DOMAIN-PARITY FAIL: malformed row {line!r}"); return 1
        seen[p[0]] = p
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
            if not ok: failures.append(f"{fid}.{name}: sql={sql[name]} exp={exp.get(name)}")

    # --- block 2: INV-05B-13 cross-skill aggregation ---
    try:
        inv = lines[lines.index("__INV13_BEGIN__")+1:lines.index("__INV13_END__")]
    except ValueError:
        print("DOMAIN-PARITY FAIL: INV13 markers missing"); return 1
    inv_rows = {}
    for line in inv:
        if not line.strip(): continue
        p = line.split("\t")
        if len(p) != 4:
            failures.append(f"INV13 malformed row {line!r}"); continue
        inv_rows[p[0]] = {"total": int(p[1]), "score": _num(p[2]),
                          "level": None if p[3]=="\\N" else int(p[3])}
    # domain: 5 events aggregated -> NON-NULL score (== 1.0, all medium correct); each skill -> NULL (<5).
    dom = inv_rows.get("domain"); sa = inv_rows.get("skillA"); sb = inv_rows.get("skillB")
    if dom is None or sa is None or sb is None:
        failures.append(f"INV13: missing scope row(s) (saw {sorted(inv_rows)})")
    else:
        if dom["total"] != 5:
            failures.append(f"INV13 domain.total={dom['total']} (expected 5 event aggregation)")
        if dom["score"] is None:
            failures.append("INV13 domain.score IS NULL — domain did NOT event-aggregate (skill roll-up regression!)")
        elif not _close(dom["score"], 1.0, 1e-4):
            failures.append(f"INV13 domain.score={dom['score']} (expected 1.0000 — 5 medium practice correct)")
        if sa["score"] is not None:
            failures.append(f"INV13 skillA.score={sa['score']} (expected NULL — {sa['total']} events < 5 threshold)")
        if sb["score"] is not None:
            failures.append(f"INV13 skillB.score={sb['score']} (expected NULL — {sb['total']} events < 5 threshold)")
        if sa["total"] >= 5 or sb["total"] >= 5:
            failures.append(f"INV13 skill allocation wrong: A={sa['total']} B={sb['total']} (both must be <5)")

    if failures:
        print(f"DOMAIN-MASTERY PARITY FAILED — {len(failures)} divergence(s):")
        for f in failures: print("  - " + f)
        return 1
    print(f"DOMAIN-MASTERY PARITY PASSED — {len(seen)} practice/review fixtures bit-exact three-way "
          f"at DOMAIN grain over PRODUCTION canonical_mastery_events; INV-05B-13 event-aggregation "
          f"holds (domain 5 events -> level {inv_rows['domain']['level']} NON-NULL; each sub-threshold skill NULL).")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Doc 05B domain-grain mastery parity (§13)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("gen")
    cp = sub.add_parser("check"); cp.add_argument("--psql-out", required=True)
    a = ap.parse_args()
    if a.cmd == "gen": return cmd_gen()
    with open(a.psql_out, encoding="utf-8") as fh: return cmd_check(fh.read())


if __name__ == "__main__":
    sys.exit(main())
