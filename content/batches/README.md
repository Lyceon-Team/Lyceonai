# Content batches (Doc 10B §8)

One folder per cycle:

- **Weekly batch** (`2026-W43`, the ISO week the posts publish in): `REVIEW.md`. The posts
  themselves live in `shared/content/posts/<slug>.ts`, with `batch: "2026-W43"`.
- **Monthly plan** (`2026-11-plan`): `PLAN.md` (the calendar) and `REVIEW.md`.

| File | Written by | What it is |
| --- | --- | --- |
| `REVIEW.template.md` | — | The review record template: four sections, in order (§8.7) |
| `RUBRIC.md` | — | What Codex audits against (approved by Karl, 2026-10-11) |
| `<cycle>/REVIEW.md` | Claude (sections 1 and 3), Codex (section 2) | The one file Karl reads |
| `approvals.json` | **Only** the `Content batch approval` workflow, from Karl's merge | A cycle is approved exactly when it has a stamp here |

How it runs, the trigger prompts and the one-time setup: `docs/runbooks/content-ops.md`.
