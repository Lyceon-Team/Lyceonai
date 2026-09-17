# /brag — Lyceon launch video plan

**Run date:** 2026-09-17
**Tone:** `polished` — serious, elegant. For projects that are not jokes.
**Format:** landscape (default) · **Duration:** 22s · **Music:** on · **SFX:** on · **Voice:** off (no `--voice` flag)
**Output dir:** `brag-output/` (no prior run existed, so no timestamp suffix)

> **Status: Steps 1–2 only.** Steps 3–4 (Hyperframes composition + render) are blocked —
> see "Blockers" at the end. This file is the Step 2 deliverable.

---

## Planning rubric

The skill's 9-question rubric lives in `references/step-1-inspect.md`, which was not
provided. Answered below against the standard inspection dimensions; re-check once
the real rubric is available.

**What is it?** Lyceon — an SAT-prep platform for students 13–18.

**Who is it for?** Students preparing for the digital SAT, and the guardians paying for
and watching their progress.

**What is the single most distinctive thing about it?** It refuses to guess. The whole
system is built so that it *cannot* leak an answer or invent a score, and that refusal is
enforced in code rather than promised in marketing.

**What is the strongest visual?** Source code. Specifically the `correct_answer: null`
literal appearing at six independent serialization sites.

**What's the honest claim?** Deterministic, server-authoritative, anti-leak by design,
audit-friendly. All four are load-bearing, not adjectives.

**What's the tension/hook?** Every other study app is racing to tell you your "predicted
score." Lyceon deliberately won't.

**What would a skeptic say?** "Every edtech app says it's rigorous." Answer: 69 numbered
spec amendments, 156 test files, and a hook that blocks the wrong package manager.

**What must NOT be claimed?** No predicted scores, no AI confidence, no vanity metrics —
these are banned by the project's own coding standards (§10, §17). The video cannot imply them.

**What's the outro?** The product name and the posture, stated plainly.

---

## Creative angle

**"The app that won't tell you what it doesn't know."**

Most launch videos brag about what the product *adds*. This one brags about what it
*refuses to do* — and proves each refusal with the line of code that enforces it. The
polish comes from restraint: slow, confident cuts; monospace against generous whitespace;
no swooshes. The emotional beat is *trust*, not *excitement*.

This angle is only available to Lyceon. A generic study app cannot run this video, because
a generic study app does not have these constraints in its source tree.

---

## Storyboard

Total: **22.0s**. Timings follow the readability law — short label ≥0.8s settled,
sentence ≈0.3s/word. Fast-in, then hold.

### Scene 1 — Hook (0.0–2.6s) · 2.6s
- **Visual:** Black. A single centered line of monospace fades up, letter-spacing settling.
- **Text:** `correct_answer: null`
- **Hold:** 1.8s settled — long enough to read and be puzzled by.
- **Transition:** Hard cut.
- **SFX:** One soft low key-press tick on the text landing.
- **Why it hooks:** It looks like a bug. It is the opposite of a bug. The viewer needs the
  next scene to resolve it.

### Scene 2 — Reveal (2.6–6.2s) · 3.6s
- **Visual:** The line stays anchored; six file paths stack beneath it in sequence,
  0.28s apart, each with its line number right-aligned in a dimmer weight.
- **Text (stacking):**
  `server/routes/practice-canonical.ts:803`
  `server/routes/review-session-routes.ts:495`
  `server/routes/diagnostic-routes.ts:540`
  `apps/api/src/services/fullLengthExam.ts:2588`
  `apps/api/src/services/fullLengthExam.ts:3758`
  `server/routes/practice-canonical.ts:80`
- **Then:** Headline wipes in below — **"Six places. Same answer. On purpose."**
- **Hold:** 1.0s on the completed stack.
- **Transition:** Vertical wipe upward.
- **SFX:** Six ascending ticks, one per path, quantized to the music grid.

### Scene 3 — Highlight 1 (6.2–10.4s) · 4.2s
- **Visual:** Split frame. Left: a practice question card rendered from the product's own
  UI. Right: the payload it ships, with `correct_answer` and `explanation` both struck to
  `null`. A caret blinks once.
- **Text:** **"The server never sends the answer before you submit."**
- **Sub:** `Pre-submit payloads return null. Not hidden. Absent.`
- **Hold:** 2.2s — 8-word headline needs ≈2.4s; sub reads during the tail.
- **Transition:** Cross-dissolve.

### Scene 4 — Highlight 2 (10.4–14.6s) · 4.2s
- **Visual:** A mastery drill-down panel. A "Predicted Score: 1480" ghost element renders
  for 0.4s and is then *deleted* — struck through and dissolved, not animated away
  decoratively.
- **Text:** **"Mastery is earned from observed events only."**
- **Sub:** `No predicted score. No AI confidence. No vanity metrics.`
- **Hold:** 2.0s.
- **Transition:** Hard cut on the beat.
- **Note:** The ghost element must read as *removed by the system*, not as a feature. If
  it reads as a feature, the scene is a lie and must be recut.

### Scene 5 — Highlight 3 (14.6–18.4s) · 3.8s
- **Visual:** Two nodes — STUDENT and GUARDIAN — joined by a link that illuminates only
  when both conditions latch. Two small locks click closed in sequence, then the link lights.
- **Text:** **"Guardian access is derived, never granted."**
- **Sub:** `Visible only while the link and the entitlement are both live. View-only.`
- **Hold:** 2.4s.
- **Transition:** Fade to near-black.
- **Note:** The headline was rewritten during the self-check below — the original
  12-word line needed ≈3.6s and did not fit the scene. The 6-word line above is authoritative.

### Scene 6 — Outro (18.4–22.0s) · 3.6s
- **Visual:** Wordmark centered on near-black. Three stat chips fade in beneath, 0.2s apart.
- **Text:** **LYCEON**
- **Chips:** `69 spec amendments` · `156 test files` · `0 answers leaked`
- **Tag:** *Deterministic. Server-authoritative. Anti-leak by design.*
- **Hold:** 1.6s on the full lockup.
- **SFX:** Single low resolving tone; music tail decays past the final frame.

---

## Poster frame candidate

**Scene 6 at 21.2s** — full lockup, all three chips settled, tagline visible. Fallback:
Scene 2 at 5.9s (completed file-path stack), which is more distinctive but less legible
at thumbnail scale.

---

## Music cue guidance

`assets/music/cues/` was not provided, so no bundled track preset could be read. Cues to be
detected at composition time. Intended shape: sparse and tonal, no percussion until the
Scene 2 wipe, a single low swell entering under Scene 4, and full decay across Scene 6.
The six ticks in Scene 2 should quantize to the detected grid. Cue metadata is timing
guidance only — readability and product clarity stay primary.

---

## Creative-law self-check

- **Short** — 22.0s, inside the 15–25s band. ✓
- **Readable** — every line's hold is derived from its word count; Scene 5 was rewritten
  when its headline failed the check. ✓
- **Specific** — six real file:line references from this repo. No other project can use
  this cut. ✓
- **Show the thing** — Scenes 3, 4, 5 all render actual product surface. ✓
- **No generic SaaS language** — no "streamline," no "empower," no "supercharge." ✓
- **The hook is everything** — Scene 1 is a two-word code literal that reads as a defect
  and resolves into the thesis. ✓
- **Funny earns its place** — polished tone; no jokes attempted. ✓
- **Pattern** — Hook 2.6s → Reveal 3.6s → 3 highlights 12.2s → Outro 3.6s. ✓

---

## Blockers — Steps 3 and 4 cannot proceed

1. **Hyperframes is absent.** Step 3 requires `hyperframes-core`, `hyperframes-animation`,
   `hyperframes-creative`, `hyperframes-keyframes`, `hyperframes-cli`. None are installed.
   Hyperframes owns composition structure, animation mechanics, runtime, lint rules, and
   the render workflow — the skill explicitly assigns those away from /brag.
2. **The Step 3 gate is a blocked command.** The `hyperframes check` gate runs through the
   prohibited package runner, which this repo's pre-tool hook rejects; CLAUDE.md permits
   `pnpm` only. Hyperframes is in neither `package.json` nor `pnpm-lock.yaml`, so adding it
   is also a dependency change requiring Karl's approval.
3. **Reference files never arrived** — `step-1-inspect.md`, `step-2-plan.md`,
   `step-3-compose.md`, `step-4-deliver.md`, `audio.md`, `tones.md`, plus `assets/music/cues/`.
   The rubric and storyboard format above are reconstructed from the SKILL.md's own
   creative laws, which are self-contained; the tone and audio detail are not.
