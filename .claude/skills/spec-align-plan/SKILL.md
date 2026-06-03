---
name: spec-align-plan
description: Plan parallel spec-alignment so multiple swings run at once while staying coherent — one unified codebase, not several divergent ones. Invoke with /spec-align-plan. Reads the drift backlog, lands shared primitives first, identifies surfaces multiple units will touch so they consume one canonical version instead of forking, orders the waves, and emits the git-worktree launch commands. Run this before launching parallel /spec-align passes.
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git worktree:*)
---

# /spec-align-plan — coherent parallel wave plan

Goal: run several `/spec-align` passes concurrently, each with its own full context, while producing **one coherent codebase**. Make no code edits here — this stage only plans. Output a plan the user reviews (in plan mode) and launches.

## The real risk: divergence, not collision

Two parallel passes rarely edit the same line. The actual failure is **divergence** — each agent/session reinventing the same helper, schema, or pattern slightly differently, leaving the repo internally inconsistent. So the plan's job is to make shared things **single-source-of-truth and built first**, so every parallel pass consumes the canonical version rather than forking its own. Overlap on a shared primitive is fine — *forking* it is the defect.

## Procedure

### 1. Gather units
From the drift backlog (`/spec-drift` first if needed), list candidate alignment units (one invariant domain or module each).

### 2. Identify shared surfaces
For each unit, list the files/primitives it will create or modify. Then find the surfaces **more than one unit touches** — typically `packages/shared` schemas/types, the logger, DB utilities, identity helpers, the route registry, CI. These are the divergence hotspots.

### 3. Assign canonical ownership of shared surfaces → Wave 0
Every shared surface gets **one owner** and is built/landed **first, serially**, in Wave 0 (alongside the CI baseline reset). Parallel domain passes then import these canonical primitives. If a domain pass discovers it needs a new shared primitive mid-flight, it adds it to the canonical location (and flags it), rather than defining a local copy.

### 4. Order into waves
- **Wave 0 (serial, first):** shared foundations everything depends on — `packages/shared` schemas/types, env, shared utils/logger, and the **CI baseline reset (Pass 0)**. Not parallelized; merged before domain work.
- **Wave 1…N (parallel):** domain units. Group units that touch *different* domain surfaces into the same wave so reviews stay clean. If two units would both need to modify the *same non-foundation* file, prefer putting them in different waves (sequential) over a fragile split — but this is a coherence/reviewability call, not a hard invariant.
- Order waves by invariant risk (anti-leak / auth before frontend).

### 5. Emit the plan
A table plus launch commands:

```
WAVE 0 (serial): packages/shared schemas · logger/utils · CI baseline reset
WAVE 1 (parallel): anti-leak | auth-entitlements
WAVE 2 (parallel): determinism-idempotency | stripe-billing
WAVE 3 (parallel): mastery-kpi | frontend
```

| Unit | Files it owns | Shared surfaces it consumes (canonical owner) | Wave |
|---|---|---|---|

For each parallel unit, the worktree + session commands (separate working trees keep parallel sessions clean):

```bash
git worktree add ../lyceon-anti-leak         -b claude/align-anti-leak
git worktree add ../lyceon-auth-entitlements -b claude/align-auth-entitlements
```
Open each worktree as its own Claude Code desktop session; run `/spec-align <unit>` in it (in plan mode first). Each runs the full six-stage gated pipeline and opens its own PR.

### 6. Maximize subagents (per Anthropic guidance)
- Use **subagents** for the read-only investigation in Stage 1–2 and for the independent audit in Stage 4 — isolated context windows keep the main thread focused and let exploration run in parallel without bloating context.
- The orchestrating thread plans and integrates; subagents do the bounded, parallelizable work (investigate, draft, review).
- Don't exceed what a human can review: **2–3 parallel domain units per wave**.

### 7. Merge & coherence review
- Each parallel unit → its own PR.
- Merge **Wave 0 first** (domains import its primitives).
- On each merge, do a quick **coherence review**: did this pass reuse the canonical primitives and follow established patterns, or introduce a divergent/duplicate one? A divergence is a finding — fix it before merge, even if tests pass.
- Remove finished worktrees: `git worktree remove ../lyceon-<unit>`.

## Output

A single plan: the unit→files→shared-surfaces→wave table, which surfaces are canonical-owned in Wave 0, the wave ordering, the subagent fan-out, and the copy-paste worktree/launch commands. No edits made.

## Guardrails

- Wave 0 (shared primitives + CI) is never parallelized and never skipped — it's what keeps parallel work coherent.
- Cap concurrency to what you can review (2–3 per wave).
- When in doubt between a clever parallel split and serializing, **serialize** — coherence on load-bearing invariants beats parallel speed.
