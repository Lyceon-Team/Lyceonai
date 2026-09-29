# The calendar rules: which branches anything actually pins

**Brief 18, Steps 1, 2 and 4.** Owner question: *"a rule with two branches had fixtures for
one. Report whether any other calendar rule has a branch with no fixture."*

Measured 2026-09-29 against `docs/Spec/calendar_formula_reference.py` at `c1161211`
(md5 `d78fd393…`), `docs/Spec/calendar_formula_fixtures.json` (md5 `bb24a36c…`), and the
migration pipeline applied to a local PostgreSQL 17.11 — `calendar_place_full_lengths`
live at `7497 / e8056c8f64b4c5e94d061603c3946b6e`, the body `scripts/ci/calendar-schema-gates.sql`
B-02 records. `docs/Spec/` was read, never written; every mutant is a scratchpad copy.

---

## Step 1 — the post-exam anchor IS ported. There is no gap, so there is no Step 3.

The brief's inference — *"`prosrc` contains no reference to `last_exam_date` at all"* — is a
false negative. The SQL does not use that name. Reading the live body — `pg_proc.prosrc`, the
catalog rather than the ledger, with CRs stripped; the line numbers are the body's own:

```
 11:  x_last         date;
 38:  x_last := (p_input #>> '{exams,last_completed_local_date}')::date;
109:  IF x_last IS NOT NULL THEN
110:    v_first := x_last + (p_iv * 7);
111:  ELSE
112:    v_first := p_setup + 1;
113:  END IF;
```

against the oracle (`calendar_formula_reference.py:79-82`):

```python
if P["last_exam_date"]:
    first = P["last_exam_date"] + timedelta(days=iv * 7)
else:
    first = P["setup_date"] + timedelta(days=1)
```

The snapshot key is `exams.last_completed_local_date` — the name
`scripts/ci/reference/calendar_parity_emit.py:89` gives `P["last_exam_date"]` when it builds the
Doc 05F §10.1 PlanInput. Same branch, different vocabulary.

Confirmed behaviourally, not by reading: a 336-case differential sweep (4 intervals × 3 weekdays
× 7 sitting ages × 4 setup ages; 212 of them placing at least one sitting) found **0 mismatches**
between the live SQL and the oracle.

## Step 1, second half — the premise about the fixtures is imprecise too, and the conclusion
survives it

Two of the 13 fixtures do set `last_exam_date`:

| fixture | `last_exam_date` | placements in horizon |
|---|---|---|
| `exam_in_10d_daily_90m_postexam_ALG_SEC` | 2026-09-19 | 0 |
| `fallback_MonWedSat_60m_FLSat_after_exam` | 2026-09-19 | 1, on 2026-10-03 |

The second looks like coverage and is not. Its `setup_date` is 2026-09-14, so
`setup + 1` snapped forward to Saturday lands on **2026-09-19 — exactly `last_exam_date`** — and
both anchors then yield 2026-10-03. The fixture agrees with either rule.

The decisive test is not "does a fixture set this field" but "does deleting the branch change any
stored expectation". Deleting the post-exam arm from a scratchpad copy of the oracle changes
**0 of 13** fixtures. The brief's conclusion stands; its stated reason does not.

## Step 2 — the fixture that does discriminate

`docs/Spec/` is read-only to Claude Code and hook-blocked, so this is handed over rather than
committed: **`docs/plans/calendar_spec_fixtures.patch`**, which `git apply`s cleanly onto
`docs/Spec/calendar_formula_fixtures.json`. (It supersedes the original
`calendar_fixture_post_sitting_interval.patch`, which carried only this fixture; the combined
patch also fixes the two drifts recorded below.)

Name: `exam_post_sitting_interval_MonFri_FLSat_fortnightly`. Derived from
`fallback_MonWedSat_60m_FLSat_after_exam` by changing four fields and nothing else:

| field | parent | here | why |
|---|---|---|---|
| `setup_date` | 2026-09-14 | **2026-09-08** | so the two anchors give different series |
| `study_days_mask` | 74 | **62** (Mon–Fri) | the Saturday sitting is not a study day |
| `last_exam_reviewed` | false | **true** | no exam-review block competing for the plan |
| `days_since_exam` | null | **2** | what the builder emits (see the note below) |

It discriminates, measured both ways:

```
anchor inputs      : setup_date=2026-09-08  last_exam_date=2026-09-19  iv=2  wd=6  mask=62
real oracle placed : ['2026-10-03']          (last sitting + 14, already a Saturday)
branch-deleted     : ['2026-09-26']          (setup+1 -> 09-12 Sat, +14)
DISCRIMINATES      : YES
```

and it passes, against the live PG 17 pipeline, every check
`scripts/ci/calendar-parity.ts` makes:

```
(2) stored == reference for both generators              : True
(3) deterministic_v1   RPC == oracle                     : True
(3) fallback_v1        RPC == oracle                     : True
(4) explanations       RPC == oracle                     : True  (0 keyed blocks)
(5) deterministic_v1   calendar_validate_plan            : accepted
(5) fallback_v1        calendar_validate_plan            : accepted
    presence check     full_length placed on 2026-10-03, 14 days planned
```

The presence line is there because an exam-placement fixture that places no exam proves nothing.

**Two things to fix while the file is open.** First: `fallback_MonWedSat_60m_FLSat_after_exam` carries
`last_exam_date: "2026-09-19"` with `days_since_exam: null`. The plan-input builder
(`supabase/migrations/20261011000000_exam_placement_frequency.sql:1094`, the last migration
defining `calendar_build_plan_input`) emits
`CASE WHEN v_exam_date IS NULL THEN NULL ELSE v_today - v_exam_date END` — so that pairing is a
shape production cannot produce. It changes no expectation today only because that fixture is
cold-start, where `weights()` returns before reading the field. It is the hand-written-fixture
hazard in CLAUDE.md, sitting in the file. The new fixture carries `2`; the old one is the
owner's to correct, being spec.

Second: the file's top-level `constants` block has drifted from the oracle's `C`. It is missing
`default_full_length_weekday`, which Brief 17 added to `C` today — every other key and every
value still matches:

```
in oracle, missing from fixtures constants: ['default_full_length_weekday']
in fixtures constants, not in oracle      : []
differing values                          : {}
```

Nothing compares the two, which is why it is silent: `calendar_parity_emit.py:41` asserts only
that `ref.DOMAINS == FIXTURES["canonical_domain_order"]`, and `checkConstants` in
`scripts/ci/calendar-parity.ts` compares the oracle's `C` to `calendar_runtime_config` — never to
this block. `generator_versions` (`"frequency-2026-09-27"`) is likewise read by nothing; adding a
fixture does not change a generator, so it needs no bump for this change, but it will not catch
one either.

A third gate would close both: assert `FIXTURES["constants"] == constants_for_db()` minus the
keys the bridge synthesises, in the same place the `DOMAINS` assertion already sits. Offered, not
done — it touches the parity emitter, which is outside what Brief 18 asked for.

---

## Step 4 — the census

Method, for each branch: neutralise exactly that branch in a scratchpad copy of the oracle, then
count how many of the 13 committed fixtures and how many of the 3000 seeded suite cases CI
regenerates (`--suite-n 3000 --suite-seed 1`) change the triple parity compares —
`serialize(deterministic_v1)`, `serialize(fallback_v1)`, `explanations(deterministic_v1)`.

The two columns answer different questions. **`fix`** is what pins the *oracle*: fixtures are the
only stored expectations, so a branch at 0 can be rewritten in the spec and CI stays green.
**`suite`** is what pins the *SQL against the oracle*: suite cases carry no stored value, they are
regenerated and compared to the RPC, so a branch at 0 there is one where the two can diverge
unobserved. A branch at 0 in both is pinned by parity in neither direction.

```
id      fix  suite  rule
E-01      0    494  final rehearsal: placed at all
E-02      0    217  post-exam anchor: last_exam_date + iv*7   (Brief 18's branch)
E-03      0     62  first sitting is STRICTLY after setup (setup+1, not setup)
E-04      4    609  snap FORWARD to the preferred weekday
E-05      1    458  series dates before the horizon start are skipped
E-06      0      0  max_full_length_per_horizon cap
E-07      2    133  override shift is +7 (same weekday), never 1..6 days
E-08      0      0  a shifted date past the horizon is NOT a suppression
E-09      0      0  suppression is recorded rather than dropped silently
E-10      1    708  final-exam lead window bars a cadence sitting
E-11      0      0  the series advances on the INTENDED date, not the shifted one
E-12      0      0  the weekday/interval pair guard
G-01      1   1272  budget zeroed on and after the target date
G-02      1   1217  taper window halves the budget
G-03      0    538  exam review is pending only when the sitting is UNREVIEWED
G-04      0    505  exam review is capped by the day's budget
G-05      2   2406  ordinary review is capped by the review SHARE of the budget
G-06      0    177  ordinary review is capped by review_block_max
G-07      4   1160  an exam day queues the placeholder review for the next study day
G-08      6    539  cold-start branch (all mastery NULL)
G-09      1   1367  product rule: both sections appear when the day allows it
G-10      0      0  max_domains_per_block closes the pool
G-11      0    530  a section under min_domain_questions gets no block
G-12      1    187  post-exam emphasis doubles a weak domain's weight
G-13      7   2105  weak/strength/balanced explanation keys (weak_level_max = 1)
G-14      1   1043  null_level_weight for an unmeasured domain
F-01      2    494  fallback: exam review pending on an unreviewed sitting
F-02      2    292  fallback: missed_count or the default count
F-03     13   2389  fallback: M/RW alternation by study-day index
F-04      1   1217  fallback: taper window
F-05      1   1272  fallback: budget zeroed on and after the target date
```

### The direct answer: thirteen branches have no fixture, and six of those have nothing at all

**No fixture, but the seeded suite reaches them** — E-01, E-02, E-03, G-03, G-04, G-06, G-11.
These can drift in the *spec* without CI noticing; they cannot drift between the spec and the SQL.
Three of the seven are in the full-length placement rule, and two of those three landed this
week: E-02 is Brief 18's, and **E-03 — "strictly after the setup date" — is the rule Brief 17 landed
today in `8fb191f5` (#968), and it has no fixture either.**

**No fixture and no suite case.** Six, and they are not one kind of thing:

| id | status | evidence |
|---|---|---|
| E-06 | **unreachable** | with the cap removed, the maximum placements over **3,561,600** cases (setup × last-exam × interval × weekday × target × every override subset of the horizon of size 0, 1 or 2) is **2** — the cap's own value. Weekly is the densest cadence, a 14-day horizon holds two occurrences of a weekday, and the rehearsal lands on that same weekday so it collides rather than adds. The cap cannot bite. |
| E-11 | **unreachable** | the mutant that advances the series from the shifted date instead of the intended one differs from the real rule in **0** of those 3,561,600 cases, for the same arithmetic reason: after a +7 shift the next intended date is already past the horizon. |
| G-10 | **unreachable, by construction** | `SEC` puts 4 domains in each section and `max_domains_per_block` is 4, so when `len(mix) >= 4` the mix already holds all four and `pool = [d for d in doms if d in mix]` **is** `doms`. The guard can never change the pick. |
| E-12 | unreachable through the database | the `full_length_pair` CHECK and the Zod refinement both refuse half a pair, and `rand_snapshot` emits both or neither. |
| E-09 | **was: reachable, parity structurally blind. NOW GATED TWICE** | `generate` does `exams, _suppressed = exam_dates(...)` and discards the second value, so no plan could witness a suppression. **Closed 2026-09-29**: `calendar-parity.ts` now compares each case's `exam_placement` against `calendar_place_full_lengths`' own return, on every fixture and every suite case, and `scripts/ci/calendar-parity-placement.mutations.sh` P3 proves it bites. **Z-58** still holds the SQL side. |
| E-08 | **was: reachable, gated by nothing, anywhere. NOW GATED** | see below. **Closed 2026-09-29** by **Z-70** in `scripts/ci/calendar-writer-gates.sql`, planted by `scripts/ci/calendar-placement-gate.mutations.sh` M1/M2. |

### E-08 is the same defect as the post-exam anchor, one arm over

When a cadence date is overridden, the rule shifts it +7. If that shifted date falls past the end
of the horizon, the sitting **is not a suppression** — it simply belongs to the next horizon:

```python
if nxt > horizon[-1]:
    continue     # not a suppression: it simply belongs to a later horizon
```

and the same comment sits in the SQL at
`supabase/migrations/20261013000000_first_sitting_rule.sql:188`. Making that arm record a
suppression instead is reachable in **162,848 of the 3,561,600 cases swept** — 4.6%, with a
witness as ordinary as *set up a fortnight ago, weekly, Sunday sittings, the last day of the
horizon blocked*.

Nothing asserts it. Not a fixture (parity cannot see `suppressed` at all). Not the suite, for the
same reason. Not a writer gate: **Z-57** pins the clean shift and explicitly requires horizon room
for it, **Z-58** pins both-occurrences-blocked, **Z-59** pins the rehearsal. The third arm has no
gate. The student-visible consequence is the wrong one: `full_length_suppressions` reaches the client
(`packages/shared/src/calendar/api.ts:284` and `:606`, rendered by
`FullLengthSuppressionNotice` in `client/src/features/calendar/components/Chrome.tsx`), so a
regression here tells a student their practice test was cancelled when it was only scheduled for
next fortnight.

The shape is exactly what Brief 18 found: **a rule with three arms, gates on two.**

### A correction to the brief's premise

> "the override shift and the suppression each have exactly one [fixture]"

Half right. The override shift (E-07) is pinned by **two** fixtures. The suppression (E-09) is
pinned by **no fixture at all** — Z-58 holds it, on the SQL side, and nothing else does. `exam_both_occurrences_overridden_suppressed` exists and carries a
`"suppressed": [...]` block — but **nothing in the repository reads any fixture's `exam_placement`
key**; a repo-wide search for `exam_placement` across `*.ts`, `*.tsx`, `*.py`, `*.sql` and
`*.sh` returns exactly one hit outside `docs/Spec/`, and it is a migration *filename* inside a
comment (`20261013000000_first_sitting_rule.sql:269`). The only thing that fixture's `deterministic_v1` can witness is the *absence* of a
full-length block on that date, which passes identically if the rule places nothing for any other
reason — the wrong anchor, the wrong weekday, the cap. It is an absence assertion standing where a
presence assertion is needed, which is the third bullet of CLAUDE.md's test-layer rule.

### The generic lesson, stated as a rule

A fixture pins a branch only if **deleting the branch changes that fixture's stored expectation**.
"A fixture sets the field" is not the same claim, and `fallback_MonWedSat_60m_FLSat_after_exam`
is the proof: it sets `last_exam_date`, places a sitting, and agrees with both anchors. The
mutation is cheap — the whole census above is one scratchpad copy of the oracle per branch — and
it is the only form of the question that cannot be answered wrongly by inspection.

The second half: **a rule whose output the comparison discards cannot be pinned by that
comparison, however many fixtures exercise it.** `suppressed` is returned by `exam_dates`,
dropped by `generate`, and therefore invisible to every one of the 3013 cases parity runs. That
is why E-08 and E-09 sit at 0/0 while the arms either side of them are covered hundreds of times
over, and why Z-58 — a writer gate, reading the RPC's own return value — is the only thing
holding one of them.

### Closed, 2026-09-29 (owner brief following this report)

Both gaps this report named are now held, and both are planted:

- **Z-70** in `scripts/ci/calendar-writer-gates.sql` blocks the LAST cadence date in the
  horizon and asserts the plan places nothing there, keeps the earlier sitting, reports no
  suppression, and places nothing past the window. `scripts/ci/calendar-placement-gate.mutations.sh`
  reds it two ways: M1 makes the arm record a suppression, M2 deletes the arm outright.
  Z-70's first draft hardcoded a 14-day horizon and passed against the wrong arm — Z-51 sets
  `horizon_days` to 28 and the gate file is one transaction, so the gate now READS the value
  and derives its interval from it.
- **`exam_placement` is read.** `calendar_parity_emit.py` emits Step 2's second return value,
  and `calendar-parity.ts` compares it against `calendar_place_full_lengths`' own jsonb on
  every case — with its own counter, so a comparison that stops running fails the gate.
  `scripts/ci/calendar-parity-placement.mutations.sh` plants all three ways it can fail.

Still offered, still not done: an assertion in `calendar_parity_emit.py` that the fixtures'
`constants` block equals the oracle's `C` (minus the keys the bridge synthesises). It is what
would have caught drift (3) below rather than leaving it to be noticed.

---

## Reproducing this

Everything above is a scratchpad copy of the oracle plus the two files CI already reads; nothing
writes to `docs/Spec/`. The scripts are not committed — the method is the artefact, and it is
three steps:

1. `src = open("docs/Spec/calendar_formula_reference.py").read()`, then
   `exec(compile(src.replace(OLD, NEW), ...))` into a fresh module — one mutant per branch,
   asserting first that `OLD` occurs exactly once so a stale anchor cannot pass as a clean run.
2. For each of the 13 fixtures and each of `rand_snapshot`'s 3000 seed-1 snapshots, compare
   `[serialize(generate(P)), serialize(generate_fallback(P)), explanations(generate(P)))]`
   against the unmutated module's. `rand_snapshot` is untouched by every mutation, so both sides
   see identical snapshots.
3. Guard each evaluation with `signal.setitimer` — a mutation that removes a loop's advance does
   not fail, it hangs, and a hung mutant is indistinguishable from a slow one. One of the
   thirty-one did this (E-11's first form left `cursor` at `None` forever). The watchdog is what
   made it visible; the fix was to rewrite that mutation so the cursor still advances, from the
   shifted date rather than the intended one, which is the branch actually under test.
