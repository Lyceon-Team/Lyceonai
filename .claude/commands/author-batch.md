---
description: Author a batch of SAT questions end-to-end — decompose by the canonical tree, dispatch author workers in waves, run the deterministic gate, then the auditor.
argument-hint: "[section=M|RW] [domain=\"...\"] [skill=\"...\"] [difficulty=1|2|3] [count=N]"
---

You are the batch-authoring orchestrator. Run this procedure exactly — do not improvise the loop, and do not author questions yourself.

## Arguments

Parse `$ARGUMENTS` as optional filters: `section`, `domain`, `skill`, `difficulty`, `count` (per skill×difficulty leaf; default 1).
- **No filter** → full batch: all 29 skills × difficulties {1,2,3} = 87, plus 3 extra hard questions on the three highest-frequency skills = 90.
- Any filter narrows the target leaf set accordingly (e.g. `difficulty=3` → 29 hard, one per skill; `domain="Algebra"` → Algebra's 5 skills × 3; `skill="Circles" difficulty=2 count=5` → 5).

## Step 1 — Resolve the target leaf set

Read `content/canonical/taxonomy.json`. Expand the filter into a concrete list of `(section, domain, skill, difficulty, count)` leaves. This is the tree in action: section → domain → skill → difficulty.

## Step 2 — Allocate disjoint assignments

Group target leaves by `domain`. **Split any domain whose total question count exceeds 12** into two assignments by disjoint skill subsets (at full batch: Algebra 15 → 2, Problem Solving and Data Analysis 21 → 2). Every leaf is owned by exactly one assignment — no overlap. Assign each a unique part-file path: `infra/supabase/seed/parts/batch_<NNN>/<domain-slug>[_a|_b].ndjson`.

## Step 3 — Dispatch workers in waves

Dispatch the `question-author` subagent once per assignment, **3–4 concurrent at a time** (do not fan out all at once). Each worker's prompt is self-contained: its `(section, domain, leaves, count, output_path)` plus a pointer to the contract. Wait for each wave before starting the next.

## Step 4 — Verify part-files on disk (never trust the worker's claim)

After each worker returns, run `wc -l` on its part-file. The file must exist and its record count must equal the assignment's count. If missing or short, re-dispatch that one worker **once**; if it fails again, **hard-stop** and report — do not proceed to the gate with an incomplete batch.

## Step 5 — Run the deterministic gate

Once all part-files are present and counts match:

```
pnpm assemble-batch --in infra/supabase/seed/parts/batch_<NNN> --out infra/supabase/seed/proving_batch_<NNN>.sql --report /tmp/batch_<NNN>_report.json
```

If the gate exits non-zero: **stop.** Surface the report's violations. Do **not** run the auditor on a batch that failed structural validation. Structure must be clean before content is judged.

## Step 6 — Trigger the auditor

On a clean gate pass, dispatch the `question-auditor` subagent on the assembled `proving_batch_<NNN>.sql`. Pass it only the file path, `taxonomy.json`, and the governance doc — **never** the authors' reasoning.

## Step 7 — Report

Surface: the assembled SQL path, the gate report, and the auditor verdict. Stop there. Applying to prod and merging are Karl's actions — never apply or merge.
