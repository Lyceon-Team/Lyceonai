"""Doc 05F plan generator — deterministic_v1 + fallback_v1 (parity oracle, integer-only).
Mastery levels are 0..4 per public.mastery_levels (L0 Foundations weakest .. L4 Strong); NULL = unmeasured.
Same input → same output. No table reads: everything comes from the snapshot P and constants C.
"""
import json, random
from datetime import date, timedelta
from collections import Counter

DOMAINS = ["Algebra", "Advanced Math", "Problem Solving and Data Analysis", "Geometry and Trigonometry",
           "Information and Ideas", "Craft and Structure", "Expression of Ideas", "Standard English Conventions"]
# The canonical eight, in full, exactly as production stores them (student_domain_mastery.domain,
# practice_session_items.question_domain, calendar_runtime_config.canonical_domain_order).
# No codes, no aliases, no mapping layer: the oracle, the fixtures and the RPCs speak one vocabulary.
SEC = {d: ("M" if i < 4 else "RW") for i, d in enumerate(DOMAINS)}

C = dict(   # calendar_runtime_config (launch defaults) — integers only; ratios in basis points
    horizon_days=14,
    review_share_max_bp=5000, review_block_max=30,
    exam_review_default_count=20,
    weight_by_level={0:5, 1:4, 2:3, 3:2, 4:1}, null_level_weight=3,   # mastery_levels: L0 Foundations (weakest) .. L4 Strong; NULL unmeasured
    post_exam_emphasis_days=7, post_exam_multiplier=2,
    min_domain_questions=5, max_domains_per_block=4, granularity=5,
    full_length_every_n_occurrences=2, full_length_min_gap_days=7, final_exam_lead_days=7, max_full_length_per_horizon=2,
    taper_days=3, taper_ratio_bp=5000,
)
ENG = dict(practice_seconds_per_unit=90, review_seconds_per_unit=120)   # snapshotted from practice config / SCL-08-F

# ---------------------------------------------------------------- steps
def dow(D):
    """Postgres DOW: Sunday = 0 … Saturday = 6. The mask and full_length_weekday use this convention everywhere."""
    return (D.weekday() + 1) % 7

def weights(P):
    """Step 3 — need weights. None means cold start (all NULL)."""
    lv = P["levels"]
    if all(lv[d] is None for d in DOMAINS): return None
    w, why = {}, {}
    for d in DOMAINS:
        L = lv[d]
        w[d] = C["null_level_weight"] if L is None else C["weight_by_level"][L]
        why[d] = "exploring" if L is None else ("weak" if L <= 1 else ("strength" if L >= 3 else "balanced"))
        if P["days_since_exam"] is not None and P["days_since_exam"] <= C["post_exam_emphasis_days"] and d in P["exam_weak_domains"]:
            w[d] *= C["post_exam_multiplier"]; why[d] = "post_exam"
    return w, why

def exam_dates(P, horizon):
    """Step 2 — full-length placement. Precedence: rehearsal → lead window → min gap → cadence → cap."""
    wd = P["full_length_weekday"]
    if wd is None: return {}
    exam = P["target_exam_date"]; placed = {}
    if exam:
        d = exam - timedelta(days=C["final_exam_lead_days"])
        while dow(d) != wd: d -= timedelta(days=1)
        if horizon[0] <= d <= horizon[-1]: placed[d] = "final_rehearsal"
    anchor = P["setup_date"]
    while dow(anchor) != wd: anchor += timedelta(days=1)
    for D in horizon:
        if len(placed) >= C["max_full_length_per_horizon"]: break
        if dow(D) != wd or D in placed or D < anchor: continue
        if ((D - anchor).days // 7) % C["full_length_every_n_occurrences"] != 0: continue
        if exam and (D >= exam or (exam - D).days < C["final_exam_lead_days"]): continue
        others = list(placed) + ([P["last_exam_date"]] if P["last_exam_date"] else [])
        if all(abs((D - e).days) >= C["full_length_min_gap_days"] for e in others): placed[D] = "exam_cadence"
    return placed

def split_mix(Q, picks, w):
    """Step 5b — largest-remainder split of Q across picked domains, multiples of `granularity`, each ≥ min."""
    g, m = C["granularity"], C["min_domain_questions"]
    units = Q // g
    # a domain fits today only if its proportional share rounds to ≥ one granule; otherwise its deficit carries to a later day
    keep = list(picks)
    while len(keep) > 1:
        tot = sum(w[d] for d in keep)
        weakest = min(keep, key=lambda d: (w[d], -DOMAINS.index(d)))
        if (units * w[weakest] * 2 + tot) // (2 * tot) >= m // g: break
        keep.remove(weakest)
    tot = sum(w[d] for d in keep)
    base = {d: max(m // g, (units * w[d]) // tot) for d in keep}
    while sum(base.values()) > units and len(base) > 1:
        drop = min(base, key=lambda d: (w[d], -DOMAINS.index(d))); del base[drop]
        tot = sum(w[d] for d in base); base = {d: max(m // g, (units * w[d]) // tot) for d in base}
    rem = units - sum(base.values())
    order = sorted(base, key=lambda d: (-((units * w[d]) % tot), DOMAINS.index(d)))
    for i in range(rem): base[order[i % len(order)]] += 1
    return {d: v * g for d, v in base.items()}

def generate(P):
    start = P["today"]; horizon = [start + timedelta(days=i) for i in range(C["horizon_days"])]
    study = {D for D in horizon if (P["study_days_mask"] >> dow(D)) & 1}
    exams = exam_dates(P, horizon)
    W = weights(P)
    allocated = Counter(P.get("recent_planned_by_domain", {}))   # deficit state seeded from the last 28 days of plan rows (snapshot input)
    planned_total = sum(allocated.values())
    due = 0
    exam_review_pending = None     # (size, key) to place on the next study day
    if P["last_exam_date"] and P["last_exam_missed_count"] is not None and not P["last_exam_reviewed"]:
        exam_review_pending = (P["last_exam_missed_count"], "exam_review")
    plan = {}; study_index = 0
    target = P["target_exam_date"]
    for D in horizon:
        due += P["review_due_by_date"].get(D, 0)
        if D in exams:
            plan[D] = [("full_length", None, 1, exams[D])]
            exam_review_pending = (C["exam_review_default_count"], "exam_review_placeholder")
            continue
        if D not in study: plan[D] = []; continue
        # Step 1 — budget
        B = P["daily_minutes"] * 60; tapered = False
        if target:
            dd = (target - D).days
            if dd <= 0: B = 0
            elif dd <= C["taper_days"]: B = B * C["taper_ratio_bp"] // 10000; tapered = True
        blocks = []
        # Step 4 — review: exam review takes the whole budget if needed; otherwise ordinary review ≤ share cap
        if exam_review_pending:
            size = min(exam_review_pending[0], B // ENG["review_seconds_per_unit"])
            if size >= 1:
                blocks.append(("review", None, size, exam_review_pending[1])); B -= size * ENG["review_seconds_per_unit"]
                exam_review_pending = None
        else:
            R = min(due, C["review_block_max"], (C["review_share_max_bp"] * B // 10000) // ENG["review_seconds_per_unit"])
            if R >= 1:
                blocks.append(("review", None, R, "review_due")); due -= R; B -= R * ENG["review_seconds_per_unit"]
        # Step 5 — practice: split Q by section weight share, then per section pick domains by deficit and split by weight
        Q = (B // ENG["practice_seconds_per_unit"]) // C["granularity"] * C["granularity"]
        if Q >= C["min_domain_questions"]:
            g = C["granularity"]
            if W is None:
                half = (Q // g // 2) * g
                lead = "M" if study_index % 2 == 0 else "RW"; other = "RW" if lead == "M" else "M"
                parts = {lead: Q - half, other: half} if half else {lead: Q}
                for s_, q in parts.items(): blocks.append(("practice", {s_: q}, q, "taper" if tapered else "cold_start"))
            else:
                w, why = W; tot = sum(w.values()); g = C["granularity"]
                sec_w = {"M": sum(w[d] for d in DOMAINS if SEC[d] == "M"), "RW": sum(w[d] for d in DOMAINS if SEC[d] == "RW")}
                sec_tot = sec_w["M"] + sec_w["RW"]
                planned_sec = {s_: sum(allocated[d] for d in DOMAINS if SEC[d] == s_) for s_ in ("M", "RW")}
                units = Q // g
                # level 1 — each granule goes to the section furthest behind its share (deficit = share × cumulative − had), ties → M
                sec_units = {"M": 0, "RW": 0}
                for _ in range(units):
                    cum = planned_total + (sec_units["M"] + sec_units["RW"] + 1) * g
                    deficit = {s_: cum * sec_w[s_] - (planned_sec[s_] + sec_units[s_] * g) * sec_tot for s_ in ("M", "RW")}
                    s_ = max(("M", "RW"), key=lambda x: (deficit[x], x == "M")); sec_units[s_] += 1
                if units >= 2:                                                   # product rule: both sections appear when the day allows it
                    for s_ in ("M", "RW"):
                        if sec_units[s_] == 0:
                            o = "RW" if s_ == "M" else "M"; sec_units[s_] += 1; sec_units[o] -= 1
                # level 2 — within each section, each granule goes to the domain furthest behind its share; at most max_domains_per_block distinct
                for s_ in ("M", "RW"):
                    q = sec_units[s_] * g
                    if q < C["min_domain_questions"]: continue
                    doms = [d for d in DOMAINS if SEC[d] == s_]; mix = Counter()
                    for _ in range(q // g):
                        cum = planned_total + Q                                  # target share of everything planned incl. today
                        deficit = {d: cum * w[d] - (allocated[d] + mix[d]) * tot for d in doms}
                        pool = [d for d in doms if d in mix] if len(mix) >= C["max_domains_per_block"] else doms
                        d = max(pool, key=lambda x: (deficit[x], -DOMAINS.index(x))); mix[d] += g
                    for d, c in mix.items(): allocated[d] += c
                    blocks.append(("practice", dict(mix), q, "taper" if tapered else "weighted", {d: why[d] for d in mix}))
                planned_total += Q
        plan[D] = blocks; study_index += 1
    return plan

# ---------------------------------------------------------------- property suite
def rand_snapshot(rng):
    T = date(2026, 9, 21) + timedelta(days=rng.randint(0, 6))
    mode = rng.choice(["cold", "mixed", "mixed", "mixed", "lopsided"])
    levels = {d: None for d in DOMAINS} if mode == "cold" else ({d: rng.choice([0, 0, 4, 4]) for d in DOMAINS} if mode == "lopsided" else {d: rng.choice([0, 1, 2, 3, 4, None]) for d in DOMAINS})
    exam_in = rng.choice([None, 1, 2, 3, 5, 8, 10, 14, 20, 30, 45, 60, 90, 180])
    last = T - timedelta(days=rng.randint(1, 30)) if rng.random() < 0.4 else None
    return dict(today=T, setup_date=T - timedelta(days=rng.randint(0, 60)), study_days_mask=rng.randint(1, 127),
                daily_minutes=rng.choice([15, 30, 45, 60, 90, 120, 180]), levels=levels,
                target_exam_date=(T + timedelta(days=exam_in)) if exam_in else None, full_length_weekday=rng.choice([None, 0, 1, 2, 3, 4, 5, 6]),
                last_exam_date=last, days_since_exam=(T - last).days if last else None, exam_weak_domains=rng.sample(DOMAINS, 2) if last else [],
                last_exam_missed_count=rng.choice([0, 8, 25, 60]) if last else None, last_exam_reviewed=rng.random() < 0.5,
                review_due_by_date={T + timedelta(days=i): rng.choice([0, 0, 3, 10, 25]) for i in range(14)},
                recent_planned_by_domain={d: rng.choice([0, 0, 20, 60]) for d in DOMAINS})

def suite(N=3000, seed=1):
    rng = random.Random(seed); viol = Counter(); tvd = []; util = []
    for _ in range(N):
        P = rand_snapshot(rng); p1 = generate(P); p2 = generate(P)
        if p1 != p2: viol["determinism"] += 1
        exam = P["target_exam_date"]; exdates = []; u = Counter()
        for D, bs in p1.items():
            isstudy = (P["study_days_mask"] >> dow(D)) & 1
            budget = P["daily_minutes"] * 60
            if exam and (exam - D).days <= 0:
                if bs and bs[0][0] != "full_length": viol["study_after_target"] += 1
                continue
            if exam and 0 < (exam - D).days <= C["taper_days"]: budget = budget * C["taper_ratio_bp"] // 10000
            secs = sum(b[2] * (ENG["practice_seconds_per_unit"] if b[0] == "practice" else ENG["review_seconds_per_unit"]) for b in bs if b[0] != "full_length")
            if secs > budget: viol["over_budget"] += 1
            if isstudy and not bs and D not in exdates and budget >= 900: viol["empty_study_day"] += 1
            if isstudy and bs and bs[0][0] != "full_length": util.append(secs / budget if budget else 1)
            for b in bs:
                if b[0] == "full_length": exdates.append(D)
                if b[0] == "practice":
                    for d, c in b[1].items(): u[d] += c
                    if len(b[1]) > C["max_domains_per_block"]: viol["too_many_domains"] += 1
                    if len({SEC.get(d, d) for d in b[1]}) != 1: viol["block_spans_sections"] += 1
                    if any(c < C["min_domain_questions"] or c % C["granularity"] for c in b[1].values()): viol["bad_granularity"] += 1
            if sum(1 for b in bs if b[0] == "practice") > 2: viol["more_than_two_practice_blocks"] += 1
            if any(b[0] == "full_length" for b in bs) and len(bs) > 1: viol["exam_day_not_alone"] += 1
        for a in exdates:
            if exam and (a >= exam or (exam - a).days < C["final_exam_lead_days"]): viol["exam_in_lead_window"] += 1
            for b in exdates:
                if a < b and (b - a).days < C["full_length_min_gap_days"]: viol["exam_gap"] += 1
            nxt = [D for D in p1 if D > a and (P["study_days_mask"] >> dow(D)) & 1 and D not in exdates]
            if nxt and not any(b[0] == "review" and b[3].startswith("exam_review") for b in p1[nxt[0]]) and not (exam and (exam - nxt[0]).days <= 0): viol["exam_review_missing"] += 1
        W = weights(P)
        if W and sum(u.values()) >= 80:
            w, _ = W; tot = sum(w.values())
            cum = Counter(P["recent_planned_by_domain"]) + u; U = sum(cum.values())   # fidelity over history + horizon
            tvd.append(sum(abs(cum[d] / U - w[d] / tot) for d in DOMAINS) / 2)
            d = rng.choice(DOMAINS); L = P["levels"][d]
            if L is not None and L > 0 and U >= 160:
                P2 = dict(P); P2["levels"] = dict(P["levels"]); P2["levels"][d] = L - 1
                u2 = sum(c for bs in generate(P2).values() for b in bs if b[0] == "practice" for dd, c in b[1].items() if dd == d)
                if u2 < u[d]: viol["monotonicity_16plus"] += 1
    return dict(N=N, violations=dict(viol), mean_TVD=round(sum(tvd) / len(tvd), 3), max_TVD=round(max(tvd), 3), mean_budget_utilization=round(sum(util) / len(util), 3))

if __name__ == "__main__":
    print(json.dumps(suite(), indent=1))

# ---------------------------------------------------------------- fallback_v1 (profile-only inputs; fail-open generator)
def generate_fallback(P):
    """Needs only: profile (mask, minutes, target date, full-length weekday, setup date), optional last-exam facts, optional total review due.
    No mastery, no per-date review queue, no plan history. Same output shape and validator as deterministic_v1."""
    start = P["today"]; horizon = [start + timedelta(days=i) for i in range(C["horizon_days"])]
    study = {D for D in horizon if (P["study_days_mask"] >> dow(D)) & 1}
    exams = exam_dates(P, horizon)                                            # Step 2 needs only the profile
    due = sum(P.get("review_due_by_date", {}).values())                       # a single total is enough here
    exam_review_pending = None
    if P.get("last_exam_date") and not P.get("last_exam_reviewed", True):
        exam_review_pending = (P.get("last_exam_missed_count") or C["exam_review_default_count"], "exam_review")
    plan = {}; target = P["target_exam_date"]; study_index = 0
    for D in horizon:
        if D in exams:
            plan[D] = [("full_length", None, 1, exams[D])]; exam_review_pending = (C["exam_review_default_count"], "exam_review_placeholder"); continue
        if D not in study: plan[D] = []; continue
        B = P["daily_minutes"] * 60; tapered = False
        if target:
            dd = (target - D).days
            if dd <= 0: B = 0
            elif dd <= C["taper_days"]: B = B * C["taper_ratio_bp"] // 10000; tapered = True
        blocks = []
        if exam_review_pending:                                               # exam-review day: whole budget if needed
            size = min(exam_review_pending[0], B // ENG["review_seconds_per_unit"])
            if size >= 1: blocks.append(("review", None, size, exam_review_pending[1])); B -= size * ENG["review_seconds_per_unit"]; exam_review_pending = None
        else:
            R = min(due, C["review_block_max"], (C["review_share_max_bp"] * B // 10000) // ENG["review_seconds_per_unit"])
            if R >= 1: blocks.append(("review", None, R, "review_due")); due -= R; B -= R * ENG["review_seconds_per_unit"]
        Q = (B // ENG["practice_seconds_per_unit"]) // C["granularity"] * C["granularity"]
        if Q >= C["min_domain_questions"]:
            g = C["granularity"]; half = (Q // g // 2) * g
            first = "M" if study_index % 2 == 0 else "RW"; other = "RW" if first == "M" else "M"   # alternation from the study-day index: no stored state
            parts = {first: Q - half, other: half} if half else {first: Q}
            for s_, q in parts.items(): blocks.append(("practice", {s_: q}, q, "taper" if tapered else "fallback"))
        plan[D] = blocks; study_index += 1
    return plan

def suite_fallback(N=3000, seed=1):
    rng = random.Random(seed); viol = Counter(); util = []
    for _ in range(N):
        P = rand_snapshot(rng); p1 = generate_fallback(P)
        if p1 != generate_fallback(P): viol["determinism"] += 1
        exam = P["target_exam_date"]; exdates = []
        for D, bs in p1.items():
            isstudy = (P["study_days_mask"] >> dow(D)) & 1; budget = P["daily_minutes"] * 60
            if exam and (exam - D).days <= 0:
                if bs and bs[0][0] != "full_length": viol["study_after_target"] += 1
                continue
            if exam and 0 < (exam - D).days <= C["taper_days"]: budget = budget * C["taper_ratio_bp"] // 10000
            secs = sum(b[2] * (ENG["practice_seconds_per_unit"] if b[0] == "practice" else ENG["review_seconds_per_unit"]) for b in bs if b[0] != "full_length")
            if secs > budget: viol["over_budget"] += 1
            if isstudy and not bs and budget >= 900 and not any(b[0]=="full_length" for b in bs): viol["empty_study_day"] += 1
            if isstudy and bs and bs[0][0] != "full_length": util.append(secs / budget if budget else 1)
            for b in bs:
                if b[0] == "full_length": exdates.append(D)
                if b[0] == "practice" and any(c < C["min_domain_questions"] or c % C["granularity"] for c in b[1].values()): viol["bad_granularity"] += 1
            if any(b[0] == "full_length" for b in bs) and len(bs) > 1: viol["exam_day_not_alone"] += 1
        for a in exdates:
            if exam and (a >= exam or (exam - a).days < C["final_exam_lead_days"]): viol["exam_in_lead_window"] += 1
            for b in exdates:
                if a < b and (b - a).days < C["full_length_min_gap_days"]: viol["exam_gap"] += 1
            nxt = [D for D in p1 if D > a and (P["study_days_mask"] >> dow(D)) & 1 and D not in exdates]
            if nxt and not any(b[0] == "review" and b[3].startswith("exam_review") for b in p1[nxt[0]]) and not (exam and (exam - nxt[0]).days <= 0): viol["exam_review_missing"] += 1
    return dict(N=N, violations=dict(viol), mean_budget_utilization=round(sum(util) / len(util), 3))
