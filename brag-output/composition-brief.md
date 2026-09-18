# Hyperframes Composition Brief: Lyceon

## Objective
Create a short launch-style brag video for Lyceon.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 22.12 seconds

## Source Material
- Project root: `/home/user/Lyceonai`
- Primary files read: `client/src/index.css` (brand tokens), `tailwind.config.ts`, `server/routes/practice-canonical.ts`, `server/routes/review-session-routes.ts`, `server/routes/diagnostic-routes.ts`, `apps/api/src/services/fullLengthExam.ts`, `CLAUDE.md`, `docs/Spec/lyceon-coding-standards.md`
- Product name: Lyceon
- Tagline / strongest claim: Deterministic, server-authoritative, anti-leak by design.
- Key UI or visual moment to recreate: the pre-submit question payload with `correct_answer` and `explanation` both `null`
- Copy that must appear verbatim:
  - `correct_answer: null`
  - `Mastery is earned from observed events only.`
  - `Deterministic. Server-authoritative. Anti-leak by design.`

## Creative Direction
- Tone preset: `polished`
- Creative direction: restraint as the flex — the product's credibility is the story
- Interpretation: slow confident cuts, generous whitespace, no swooshes or bounce eases. Motion is settle-and-hold, never bounce-and-go. Every claim is followed by its proof.
- Angle: Most launch videos brag about what a product adds. This one brags about what Lyceon refuses to do — and proves each refusal with the line of code that enforces it. The emotional beat is trust, not excitement. This angle is only available to Lyceon, because a generic study app does not have these constraints in its source tree.
- Hook: `correct_answer: null` alone on navy. It reads as a bug for a beat, then resolves into the thesis.
- Outro / punchline: LYCEON + three earned numbers + the three-word posture.
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign

## Visual Identity
Taken verbatim from `client/src/index.css` `:root` — not invented.

- Background: `#FFFAEF` (`--color-cream`)
- Text: `#0F2E48` (`--color-navy`)
- Accent: `#F9F3E7` (`--color-cream-alt`), `#F0EAE0` (`--muted`)
- Muted text: `rgba(15, 46, 72, 0.6)` (`--muted-foreground`)
- Border: `rgba(15, 46, 72, 0.12)` (`--border`)
- Display font: generic `ui-sans-serif, system-ui, sans-serif` stack. The app names Inter/Poppins, but a named family without a shipped `@font-face` trips `font_family_without_font_face` in lint, and no font files ship with this project.
- Body font: same stack. Code uses `ui-monospace, monospace`.
- Visual references from the project: navy-on-cream palette, thin navy hairline borders, generous whitespace, no shadows.

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene timings are retimed onto the bundled track's beat grid (114.84 BPM, ~0.526s per beat). Every scene cut lands on a beat, and the two act breaks land on strong beats (6.34s, 10.54s).

Scene summary:
1. Hook — 0.00–2.65s — `correct_answer: null` alone, cream on navy. Must be readable and feel like a defect.
2. Reveal — 2.65–6.34s — palette flips to cream. Six real `file:line` paths stack, then "Six places. Same answer. On purpose."
3. Anti-leak — 6.34–10.54s — question card beside its payload, both reveal fields struck to `null`.
4. Mastery — 10.54–14.76s — a "Predicted Score" ghost renders, then is deleted. "Mastery is earned from observed events only."
5. Guardian — 14.76–18.44s — two nodes, two locks latch, link illuminates. "Guardian access is derived, never granted."
6. Outro — 18.44–22.12s — LYCEON, three stat chips, the three-word posture.

## Audio
- Audio role: sparse professional accents
- Audio arc: near-silent under the hook, enters on the palette flip at 2.65s, holds a steady bed through the highlights, decays across the outro
- Music: `happy-beats-business-moves-vol-9-by-ende-dot-app.mp3`
- Music treatment: low bed, fade in at the 2.65s flip, fade under the final logo from ~19.5s to silence at 22.12s. Never competes with the text.
- Music cue guidance: bundled preset at `assets/music/cues/happy-beats-business-moves-vol-9-by-ende-dot-app.music-cues.{json,md}`. 114.84 BPM. Strong cues in window: 3.70, 4.23, 5.28, 6.34, 7.92, 8.44, 10.54, 11.60, 12.65, 23.17. Scene cuts are already snapped to this grid; cue metadata is timing guidance only, and readability wins where they conflict.
- Audio-reactive treatment: none. The polished tone does not want reactive visuals.
- Audio-coupled moments:
  - Scene 1 text landing — single soft key-press tick
  - Scene 2 path stack — six ticks, one per path, on consecutive beats
  - Scene 4 ghost deletion — one muted impact on the strike-through
  - Scene 6 lockup — one low resolving tone
- SFX selection guidance: prefer low, dry, short sounds. `keyboard/` for the hook tick, `interface/` or `ui/` for the path stack, `impact/impactGeneric_light` for the deletion. Nothing bright or metallic — the casino pack is wrong for this tone.
- SFX analysis guidance: `skill-drafts/skills/brag/assets/sfx/sfx-analysis.md` — prefer lower high-frequency-risk sounds, since the path stack repeats a sound six times in under two seconds.
- Exact SFX choice: Hyperframes chooses filenames, timestamps, density, and volume after the visual animation exists.
- Audio files: chosen music and SFX are copied into `brag-output/composition/assets/`.

## Hyperframes Instructions
Domain skills read directly (`hyperframes-core` first) rather than entering the `/hyperframes` intent interview — `/brag` is its own workflow and must not route into the generic promo / launch-video workflow.

Requirements:
- Show at least one real UI, copy, or visual element from the source project. Satisfied by Scenes 2–4: six real `file:line` references and the actual pre-submit payload shape.
- Keep all text readable. Holds are derived from word count (short label ≥0.8s settled; sentence ≈0.3s/word).
- Keep the video within 15–25 seconds. 22.12s.
- Include the planned music/SFX layer.
- Treat these audio notes as guidance, not a fixed cue sheet.
