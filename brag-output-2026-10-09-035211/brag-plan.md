# Brag Plan: Lyceon — homepage walkthrough (landscape)

**Run:** 2026-10-09 · `/brag --voice --tone polished --duration 60 --format landscape`
**Output dir:** `brag-output-2026-10-09-035211/` (a `brag-output/` already exists, so this run is timestamped)
**Sister run:** `brag-output-2026-10-09-041834/` — the same plan at `--format vertical`.

> **Owner overrides of the skill defaults (Karl, 2026-10-09):** the script below is approved and
> narrated **verbatim** (the skill's "do not read visible text" narration guidance gives way to
> it); `--duration 60` overrides the 15–25 s creative law; every on-screen product frame comes from
> the real app on test accounts and test data (`tests/e2e/student-harness`, walkthrough mode).

## What is this app?
Lyceon is SAT prep for students 13–18: a free diagnostic, free daily practice with a worked
explanation after every question, review of missed questions, and on Pro a study calendar, LISA
(an AI tutor), full-length practice tests and a read-only progress view for parents.

## The angle
A quiet, confident product walk: one feature per scene, the real screen doing its job, one
narrated line each. No claims beyond the approved script; the product carries it.

## Hook (first 2-3 seconds)
The homepage hero ("SAT prep that adapts to you.") with a slow push-in, voiced on the same line.

## Key moments (the middle)
- The worked explanation appearing under a practice question (the push lands on it).
- LISA answering step by step in the "Slope from standard form" conversation.
- The full-length test, then its report's domain bars filling the frame.

## Outro / punchline
Logo on cream, "Study Smarter, Score Higher.", "lyceon.ai". Music resolves under the last line.

## User flow worth showing
Diagnostic → practice with explanation → review the misses → (Pro) LISA, calendar, full-length
test and report → the parent's read-only view.

## Tone
- Preset: polished
- Creative direction: quiet premium product walkthrough for families
- Interpretation: slow 0.7 s crossfades, gentle push-ins, generous holds; motion never competes
  with the screen or the voice.

## Format: landscape — 1920x1080
## Duration: 60 seconds

## Visual identity (from the project)
- Background: `#FFFAEF` (`--color-cream`, client/src/index.css)
- Panels: `#F9F3E7` (`--color-cream-alt`)
- Text / accent: `#0F2E48` (`--color-navy`)
- Display font: Poppins (client/public/fonts) · Body font: Inter
- Strongest visual element: the real product screens on cream, in a soft rounded window

## Share copy (draft)
Introducing Lyceon: SAT prep that adapts to you. Start free at lyceon.ai.

## Voiceover script (verbatim, Karl-approved)
Kokoro via Hyperframes, voice `af_heart`, one file per line, placed at the scene times below.
Line 9 is fed to the voice as "Ly-see-on … ly-see-on dot A.I." so the brand and URL are spoken
correctly (checked by transcription); its words and captions are unchanged.

| # | Line | Starts | Length |
|---|---|---|---|
| 1 | SAT prep that adapts to you. | 0.8 s | 1.8 s |
| 2 | Start with a free diagnostic. See where you stand across every SAT section. | 5.6 s | 4.9 s |
| 3 | Practice every day for free, with a worked explanation after every question. | 12.6 s | 4.5 s |
| 4 | Review the ones you missed, so they stick. | 19.6 s | 2.0 s |
| 5 | Stuck? Ask LISA, your AI tutor, for step-by-step help. | 25.6 s | 3.6 s |
| 6 | A study plan that adapts and focuses on your weak areas. | 32.6 s | 3.3 s |
| 7 | Take full-length practice tests with a score report after each one. | 39.6 s | 3.9 s |
| 8 | Parents can follow along with a read-only progress view. | 47.1 s | 3.1 s |
| 9 | Lyceon. Study Smarter, Score Higher. Start free at lyceon.ai. | 53.6 s | 4.8 s |

## Audio direction
- Role: warm bed under a narrator
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (ende.app, CC BY 4.0), the
  skill's `polished` pick
- Music treatment: fade in over 1.5 s, held low (0.12, set on the volume lane) under the voice for the whole film, fade
  out over the last 3 s
- Music cue guidance: preset `assets/music/cues/…vol-12….music-cues.json`, 109.96 BPM. Strong-cue
  locks: 13.11 s (cursor click on the practice answer) and 42.00 s (the report's domain bars
  arrive). Everything else keeps natural timing for readability.
- Audio-reactive treatment: none — the product screens must stay still to be read; restraint is
  the polished choice (documented, not a missing helper).
- SFX posture: sparse, low HF risk (Kenney CC0): one click on the practice answer, one soft
  reveal on the report, one bong on the logo.
- Restraint rule: nothing louder than the voice; no SFX under a spoken word.

## Storyboard

### Scene 1 — Hero — 0.0–5.0 s
The homepage hero in a soft window, slow push-in toward the headline.
Sequential/interaction: none · Audio intent: bed fades in, voice lands the hook
Transition mood: soft crossfade → Scene 2

### Scene 2 — Free diagnostic — 5.0–12.0 s
The diagnostic's first question, push toward the question. The question counter and progress
dots are painted out of the frame (the diagnostic's length is not public).
Sequential/interaction: none · Audio intent: voice
Transition mood: soft crossfade → Scene 3

### Scene 3 — Practice + explanation — 12.0–19.0 s
A practice question answered correctly; a cursor taps the correct choice (13.11 s, beat-locked),
then the frame pushes onto the worked explanation.
Sequential/interaction: yes — simulated tap · Audio-coupled idea: one soft click on the tap
Transition mood: soft crossfade → Scene 4

### Scene 4 — Review — 19.0–25.0 s
The Review page (the count and "Start reviewing"), cropped to the main column (no mastery
panel), with its two lines on how the review list is ordered and refilled painted out (they
describe a mechanism); then a missed question with its explanation in the review runner.
Transition mood: soft crossfade → Scene 5

### Scene 5 — LISA (Pro) — 25.0–32.0 s
The "Slope from standard form" conversation (the only session in the list); push onto LISA's
step-by-step replies. "Pro" tag on screen.

### Scene 6 — Study calendar (Pro) — 32.0–39.0 s
The week view, cropped to the grid and rail: the target and projected score panel is never in
frame (owner decision 4); the test-day card's "Good luck. You're ready." is painted out (it reads
as a readiness claim). "Pro" tag.

### Scene 7 — Full-length test + report (Pro) — 39.0–46.5 s
The timed module (Reading and Writing, question 1), then the report's "Knowledge and skills"
domain bars only (no total, no section scores, no scoring note — owner decision 4), arriving at
42.00 s (beat-locked) with one soft reveal. "Pro" tag.

### Scene 8 — Parent view (Pro) — 46.5–53.0 s
The guardian dashboard's read-only progress view: the same screen as the homepage's approved
product screenshot (claim inventory, open item 5, approved by Karl 2026-10-05), on example data,
score figures hidden. "Pro" tag.

### Scene 9 — Outro — 53.0–60.0 s
Logo on cream, "Study Smarter, Score Higher.", "lyceon.ai". One bong as the logo settles.

**Music mood for this video:** steady, clean, low
**Audio summary:** a warm bed rises under a calm narrator, stays out of the way for a minute,
and resolves with the logo.

## Captions
16:9 (this run): no burned-in text; the WebVTT track `walkthrough.en.vtt` carries the nine lines
at the voice times above (owner decision 5).

## Real-data rules (owner brief)
Test accounts only ("Alex Moreno" free, "Sam Rivera" Pro, fixture guardian), questions written for
this video (`tests/e2e/student-harness/walkthrough-content.ts`), the fixture LISA conversation, no
real student, name or score, nothing that shows how anything works.
