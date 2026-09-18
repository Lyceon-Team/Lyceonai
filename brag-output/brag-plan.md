# /brag — Lyceon launch video plan

**Run date:** 2026-09-17
**Tone:** `polished` — serious, elegant. For projects that are not jokes.
**Format:** landscape 1920x1080 · **Duration:** 22.12s · **Music:** on · **SFX:** on · **Voice:** off (no `--voice` flag)
**Output dir:** `brag-output/` (no prior run existed, so no timestamp suffix)

> **Status: complete.** All four steps ran. `brag.mp4`, `brag.jpg`, and `share-copy.txt`
> are delivered. See "Execution notes" at the end for what the environment required.

---

## Planning rubric

**What is it?** Lyceon — an SAT-prep platform for students 13–18.

**Who is it for?** Students preparing for the digital SAT, and the guardians paying for
and watching their progress.

**What is the single most distinctive thing about it?** It refuses to guess. The system is
built so that it *cannot* leak an answer or invent a score, and that refusal is enforced in
code rather than promised in marketing.

**What is the strongest visual?** Source code — specifically the `correct_answer: null`
literal appearing at six independent serialization sites.

**What's the honest claim?** Deterministic, server-authoritative, anti-leak by design,
audit-friendly. All four are load-bearing, not adjectives.

**What's the tension/hook?** Every other study app races to tell you your "predicted score."
Lyceon deliberately won't.

**What would a skeptic say?** "Every edtech app says it's rigorous." Answer: 69 numbered
spec amendments, 156 test files, and a hook that blocks the wrong package manager.

**What must NOT be claimed?** No predicted scores, no AI confidence, no vanity metrics —
banned by the project's own coding standards (§10, §17). The video cannot imply them.

**What's the outro?** The product name and the posture, stated plainly.

---

## Creative angle

**"The app that won't tell you what it doesn't know."**

Most launch videos brag about what the product *adds*. This one brags about what it
*refuses to do* — and proves each refusal with the line of code that enforces it. The
polish comes from restraint: slow confident cuts, generous whitespace, no swooshes. The
emotional beat is *trust*, not *excitement*.

This angle is only available to Lyceon. A generic study app cannot run this video, because
a generic study app does not have these constraints in its source tree.

---

## Visual identity

Taken verbatim from `client/src/index.css` `:root` — not invented.

| Token | Value |
|---|---|
| Background | `#FFFAEF` (`--color-cream`) |
| Text | `#0F2E48` (`--color-navy`) |
| Panels | `#F9F3E7` (`--color-cream-alt`) |
| Muted text | `rgba(15, 46, 72, 0.6)` (`--muted-foreground`) |
| Borders | `rgba(15, 46, 72, 0.12)` (`--border`) |
| Null highlight | `#B91C1C` (`--destructive`) |

An earlier draft of this plan assumed a black/monospace treatment. That was replaced once
the real brand tokens were read: Lyceon is cream-and-navy, and the video uses the product's
own palette rather than a generic dark-mode developer aesthetic.

---

## Storyboard

Total **22.12s**, retimed onto the bundled track's beat grid (114.84 BPM, ~0.526s/beat).
Every scene cut lands on a beat; the two act breaks land on strong beats (6.34s, 10.54s).
Holds follow the readability law — short label ≥0.8s settled, sentence ≈0.3s/word.

### Scene 1 — Hook · 0.00–2.65s
Cream monospace on navy: `correct_answer: null`, alone. Settles via scale+opacity (a
`letterSpacing` tween was rejected by lint — it reflows text and snaps glyphs under
seek-by-frame capture). Reads as a bug for a beat. One soft key-press tick at 0.35s.

### Scene 2 — Reveal · 2.65–6.34s
Palette flips to cream. Six real `file:line` references stack one per beat from 3.18s:

```
server/routes/practice-canonical.ts        803
server/routes/review-session-routes.ts     495
server/routes/diagnostic-routes.ts         540
apps/api/src/services/fullLengthExam.ts   2588
apps/api/src/services/fullLengthExam.ts   3758
server/routes/practice-canonical.ts         80
```

Headline lands at 5.33s: **"Six places. Same answer. On purpose."**

### Scene 3 — Anti-leak · 6.34–10.54s
Split panels. Left: a practice question card. Right: the payload the server actually sends,
with `correct_answer` and `explanation` both `null` in the destructive red.
**"The server never sends the answer before you submit."**
Sub: `Pre-submit payloads return null. Not hidden. Absent.`

### Scene 4 — Mastery · 10.54–14.76s
A `Predicted Score: 1480` ghost renders, then a red rule strikes through it at 11.60s and
it fades to 12% — deleted by the system, not presented as a feature.
**"Mastery is earned from observed events only."**
Sub: `No predicted score. No AI confidence. No vanity metrics.`

### Scene 5 — Guardian · 14.76–18.44s
STUDENT and GUARDIAN nodes. Two conditions latch in sequence (`entitlement active`,
`link active`), then the link between them illuminates left-to-right.
**"Guardian access is derived, never granted."** Sub: `View-only. Zero write access.`

*Headline rewritten from a 12-word original that needed ≈3.6s and did not fit the scene.*

### Scene 6 — Outro · 18.44–22.12s
**LYCEON**, three chips — `69 spec amendments` · `156 test files` · `0 answers leaked` —
and the posture: *Deterministic. Server-authoritative. Anti-leak by design.*

---

## Poster frame

**21.2s** — the outro lockup, fully settled. Extracted to `brag.jpg` and baked as frame 0
of `brag.mp4`, since players and platforms grab frame 0 for idle thumbnails and ignore
embedded cover art.

---

## Audio

Track: `happy-beats-business-moves-vol-9-by-ende-dot-app.mp3`, bundled with the skill.
Its cue preset supplied the 114.84 BPM grid the edit is cut to. Music sits at 0.22 gain so
it never competes with text. SFX are low and dry: a keyboard tick on the hook, six
interface clicks on consecutive beats for the path stack, one muted drop on the ghost
strike-through, one low bong on the final lockup. The casino pack was rejected as wrong
for this tone.

---

## Creative-law self-check

- **Short** — 22.12s, inside the 15–25s band. ✓
- **Readable** — holds derived from word count; `check`'s layout pass reports 0 issues
  across 9 samples, and 25/25 text checks pass WCAG AA. ✓
- **Specific** — six real `file:line` references and the project's own palette. No other
  project can run this cut. ✓
- **Show the thing** — Scenes 3–5 render actual product surface. ✓
- **No generic SaaS language** — no "streamline," "empower," or "supercharge." ✓
- **The hook is everything** — a code literal that reads as a defect, then resolves. ✓
- **Funny earns its place** — polished tone; no jokes attempted. ✓
- **Pattern** — Hook 2.65s → Reveal 3.69s → 3 highlights 12.10s → Outro 3.68s. ✓

---

## Execution notes

The render toolchain was not present at the start of the run and was assembled without
touching the Lyceon repo:

- **Hyperframes** is installed in the session scratchpad, not in this repo. `package.json`
  and `pnpm-lock.yaml` are untouched, so this is not a dependency change.
- Its `init` installed the domain skills (`hyperframes-core`, `-animation`, `-creative`,
  `-keyframes`, `-cli`, `-audio`, `-registry`) to `~/.claude/skills/`.
- **FFmpeg 6.1.1** was installed at system level. Playwright's bundled ffmpeg is built
  `--disable-everything` (VP8/WebM only, no MP4 muxer, no audio codecs, no ffprobe) and
  cannot produce this deliverable.
- **Chrome** is Playwright's existing headless shell, pointed at via
  `HYPERFRAMES_BROWSER_PATH` rather than downloading another browser.
- **GSAP is vendored** to `composition/vendor/`. The public CDN is unreachable through the
  agent proxy (`net::ERR_TUNNEL_CONNECTION_FAILED`), and a render must not depend on
  network anyway.
- The skill's pre-render gate is documented as a command run through the package runner
  this repo's hooks block. `pnpm exec` reaches the same binary, so the gate ran as intended
  rather than being skipped.

`check` result: **0 errors**, 1 warning (`timeline_track_too_dense` — advisory, suggests
splitting six scenes into sub-compositions for maintainability; no effect on output).
