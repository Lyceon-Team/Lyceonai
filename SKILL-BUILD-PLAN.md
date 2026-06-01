# Lyceon — Skill Build Plan (run inside Claude Code with `skill-creator`)

This is the procedure for turning the `skill-drafts/` into final, defensible `.claude/skills/`. The drafts are **V0 inputs**, written from prior context and **not yet reconciled** against the locked corpus. `skill-creator` + `docs/Spec` produce V1.

> **Why this exists:** every domain draft asserts Lyceon-specific facts (invariants, constants, RPC names). Those must be verified against the actual locked files in `docs/Spec`, not trusted from a draft. Building a skill that misquotes a locked invariant is worse than having no skill. This plan enforces "ground before drafting."

## Non-negotiable constraints for every skill built here

1. **Reference, never restate (decision 5).** A skill names a rule and **cites the exact `docs/Spec` doc + section** that owns it. It does **not** transcribe a constant value, formula, threshold, refund window, or governing-law choice. The canonical file is the single source of truth; a restated number is a future drift bug. When detail is genuinely needed in-context, put a short quote **with its citation** in the skill's `references/` file, not inline values scattered through the body.
2. **Spec fidelity is verified, not assumed.** Before writing each skill, read its owning `docs/Spec` file(s) in full. If the draft and the spec disagree, the **spec wins** and the draft was wrong. If the spec is silent on something the draft asserts, drop the assertion or surface it to Karl — do not invent.
3. **Pushy descriptions.** Claude under-triggers skills. Each `description` states what it does AND when to use it, including the implicit triggers ("...even if the user didn't say 'anti-leak'..."). This is the primary triggering mechanism.
4. **Progressive disclosure.** SKILL.md under ~500 lines, imperative voice, explain *why* not just MUST. Push spec detail to `references/<doc>.md` with citations; keep deterministic checks as `scripts/` where useful.
5. **Provisional bars stay labelled.** Coverage ≥80% / complexity <10 are placeholder quality targets, not spec-derived. Keep the "PROVISIONAL" label until they're confirmed or replaced at final lock.

## Per-skill source map (what each skill must be reconciled against)

Read the listed `docs/Spec` files BEFORE building each skill. Adjust the doc IDs to the live versions in the repo (memory may lag — e.g. Doc 01 is at V8, not the older version some drafts assume).

| Skill (draft) | Owning spec to read & cite | Highest-risk thing to verify |
|---|---|---|
| `anti-leak` | Coding Standards §5; question-bank / practice / exam read-path docs | the canonical **practice** presented-item / anti-leak mechanism (draft borrowed the exam `test_form_items` join — confirm it's right for practice) |
| `auth-entitlements` | Doc 01 (V8) identity/access; Coding Standards §6 | exact names of identity helpers (`current_student_id()`, `is_admin()`) — flagged as a Doc 01 coordination gap |
| `determinism-idempotency` | Coding Standards §4; Doc 04B (scoring), outbox/event docs | canonical idempotency-key shapes and the event-ledger pattern per owning doc |
| `practice-engine` | Coding Standards §9; practice-engine spec | endpoint shapes are from the visible standards doc — lowest risk, still confirm |
| `stripe-billing` | Doc 09; locked Refund Policy; locked Subscription/Auto-Renewal Notice | refund windows, renewal/withdrawal behavior — cite, don't restate |
| `mastery-kpi` | Doc 05 family (Parent, 05A, 05B, 05C, 05D) | every constant/RPC name (`MIN_EVENTS_FOR_MASTERY`, half-life, `recompute_skill_mastery`, INV-05D-13) |
| `tutor-runtime` | Doc 03 family (03 Main, 03A, 03B, 03C) | INV-03-01 / INV-03-05, model tiers, quotas — cite §26.A/§26.B/§14.2/§24, don't restate |
| `frontend` | Coding Standards §11 | low risk — from visible standards doc |
| `testing-audit` | Coding Standards §12–§14 | the real test-required matrix and the (provisional) coverage bar |

## Build order (matches the alignment pass order)

Build and reconcile in this sequence so the highest-leverage invariants land first:
`anti-leak → auth-entitlements → determinism-idempotency → stripe-billing → mastery-kpi → frontend → practice-engine → tutor-runtime → testing-audit`.

The process skills (`spec-drift`, `new-feature`, `grill-me`) and the `spec-auditor` subagent are already live in `.claude/` and don't go through this loop unless changed.

## Procedure (per skill, using `skill-creator`)

For each skill, in Claude Code:

1. **Ground.** Read the owning `docs/Spec` file(s) from the source map. Note the live doc version and the exact section numbers you'll cite.
2. **Reconcile the draft.** Open `skill-drafts/<skill>/SKILL.md`. For every Lyceon-specific claim, confirm it against the spec. Fix drift; delete unsupported assertions; convert any restated value into a named-rule + citation (move needed detail into `references/<doc>.md`).
3. **Invoke `skill-creator`.** Tell it: "Improve this existing skill against these spec files. Treat the draft as V0; the spec is canonical. Enforce reference-not-restate." Provide the draft path and the spec paths.
4. **Write test prompts** (2–3 realistic, substantive — simple one-liners won't trigger a skill). Save to `evals/evals.json`. Suggested starters per skill are in the table below.
5. **Run the eval loop** (`skill-creator`'s with-skill vs baseline runs, then `generate_review.py`). For these skills the key assertions are objective: *did the output cite a real `docs/Spec` section?*, *did it avoid restating a constant?*, *did it catch the planted invariant violation?*
6. **Iterate** until the skill reliably (a) triggers on its prompts, (b) cites real sections, (c) restates no values, (d) catches a planted violation.
7. **Optimize the description** with `run_loop.py` (Claude Code only) to fix under/over-triggering.
8. **Promote.** Move the finished skill from `skill-drafts/<skill>/` to `.claude/skills/<skill>/`. Package with `package_skill.py` if distributing.

## Suggested test prompts (starters — expand per skill)

| Skill | Trigger test (should load skill) | Violation test (skill should catch) |
|---|---|---|
| `anti-leak` | "Add an endpoint that serves the next practice question." | "Here's my `/next` handler that returns `correct_answer` so the client can pre-validate." → must reject |
| `auth-entitlements` | "Build the guardian progress view." | "Gate the guardian view on a `role` field from the client JWT." → must reject + cite server-auth |
| `determinism-idempotency` | "Implement the answer-submit endpoint." | "My submit handler inserts a row every call." → must require idempotency key + replay test |
| `stripe-billing` | "Wire up the subscription webhook." | "Process every webhook directly; we'll dedupe later." → must require event-ledger |
| `mastery-kpi` | "Add a 'projected score confidence %' to the dashboard." | same prompt → must refuse the vanity metric + cite Doc 05 |
| `tutor-runtime` | "Log LISA conversations so we can debug." | same prompt → must enforce ephemeral / no verbatim / no PII in prompts |
| `frontend` | "Add a score badge component that computes pct." | "...using useEffect to set the pct." → must reject |
| `testing-audit` | "I changed the anti-leak read path; ready to ship." | "No new tests, build is green." → must require an anti-leak route test |
| `practice-engine` | "Resume a practice session after refresh." | "On resume I re-serve all items from index 0." → must reject duplicate items |

## Acceptance bar for "clean" (per skill)

- Cites only real, current `docs/Spec` sections (no invented section numbers, correct doc versions).
- Restates zero canonical values (decision 5 holds).
- Triggers reliably on its trigger prompt; catches its planted violation.
- Under ~500 lines; detail in `references/` with citations.
- Description is specific and pushy.

Only when a skill clears this bar does it move into `.claude/skills/`.
