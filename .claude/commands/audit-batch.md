---
description: Independently audit an assembled SAT question batch by dispatching the registered question-auditor. Fails closed if the auditor is not registered.
argument-hint: "<path-to-assembled-sql>"
---

You dispatch the registered `question-auditor` subagent to independently audit an assembled batch. This command is usable standalone (outside `author-batch`) to re-audit any batch.

## Step 0 — Parse arguments

`$ARGUMENTS` must contain a path to an assembled SQL file (e.g. `infra/supabase/seed/proving_batch_003.sql`). If missing, prompt for it.

## Step 1 — Verify auditor registration (fail-closed)

Confirm `question-auditor` is registered and invocable: spawn an Agent with `subagent_type: "question-auditor"` whose prompt is `"Echo OK"`. If it fails with an agent-type-not-found error:

**HARD STOP.** Emit:

```
AUDITOR_NOT_REGISTERED — audit aborted.
Register the question-auditor (.claude/agents/question-auditor.md) and rerun in a fresh session.
Do NOT substitute a general-purpose agent. Do NOT continue.
```

## Step 2 — Dispatch the auditor

Dispatch the `question-auditor` subagent **by registered name** (`subagent_type: "question-auditor"`). Prompt:

> Audit the assembled batch at `<path>` for content correctness.
>
> Reference files:
> - `content/canonical/taxonomy.json`
> - `docs/questions_governance.md`
>
> Perform cold re-derivation of every question's answer key per your contract.

Pass only the file path and reference pointers — **never** the authors' reasoning.

## Step 3 — Verify auditor identity

When the auditor returns, verify its verdict JSON contains the `auditor` identity header:

```json
"auditor": { "agent": "question-auditor", "contractHash": "<8-char SHA-256 prefix>" }
```

Independently compute `sha256sum .claude/skills/question-audit/SKILL.md | cut -c1-8` and compare. If the header is absent or the hash mismatches:

**The audit is VOID.** Emit:

```
AUDIT_IDENTITY_FAILED — the auditor identity header is missing or the contract hash mismatches.
This batch was not audited by the registered question-auditor. Re-run the audit.
```

## Step 4 — Report

Surface the auditor verdict (with identity verification status). That's it — no apply, no merge.
