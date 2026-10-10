# Hyperframes Composition Brief: Lyceon homepage walkthrough

## Objective
A 60-second, narrated, faceless product walkthrough for the social (9:16) channels, with burned-in captions.

## Output
- Composition directory: `brag-output-2026-10-09-041834/composition/`
- Rendered video: `brag-output-2026-10-09-041834/brag.mp4`
- Format: vertical — 1080x1920
- Duration: 60 seconds (owner override of the 15–25 s default)

## Source Material
- Project root: `/home/user/Lyceonai`
- Primary files read: `client/src/index.css` (tokens), `client/public/fonts/`, `client/public/lyceon-logo.png`, `client/src/pages/home.tsx` ("See how it works"), `docs/compliance/claim-inventory.md`, the student harness (`tests/e2e/student-harness/`)
- Product name: Lyceon
- Tagline / strongest claim: "Study Smarter, Score Higher." (approved)
- Key UI moments: the worked explanation under a practice question; LISA's step-by-step replies; the report's domain bars
- Copy that must appear verbatim: the nine voiceover lines in `brag-plan.md` (spoken, burned in as captions, and in the VTT track); on the end card, "Study Smarter, Score Higher." and "lyceon.ai"

## Creative Direction
- Tone preset: polished
- Creative direction: quiet premium product walkthrough for families
- Interpretation: slow crossfades (0.7 s), gentle push-ins, long holds; motion never competes with the screen or the voice
- Angle: the real product, one feature per scene, one narrated line each
- Hook: the homepage hero with the headline spoken
- Outro / punchline: logo, tagline, URL
- Avoid: generic SaaS language; abstract filler; any frame showing a score, a target, a projection, settings or an internal label

## Visual Identity
- Background: `#FFFAEF` · Text: `#0F2E48` · Panels: `#F9F3E7`
- Display font: Poppins (shipped woff2 in `assets/fonts/`) · Body font: Inter (shipped woff2)
- Visual references: navy-on-cream palette, soft rounded windows, a small navy "Pro" pill

## Storyboard
Use the storyboard in `brag-plan.md` as the creative contract. Footage is `assets/footage/*.jpg`,
pre-cropped (calendar without its goals panel, review without its mastery panel, report domain
bars only) so excluded content is not in the composition at all.

## Audio
- Audio role: warm bed under a narrator
- Music: `assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` at 0.12 on its volume lane (the lane sets the level; `data-volume` stays 1), faded in 0–1.5 s and out 57–60 s
- Music cue guidance: preset JSON in the skill (`assets/music/cues/`); locks at 13.11 s and 42.00 s
- Voiceover: `assets/voiceover.wav`, Kokoro `af_heart`, lines placed at the plan's times, loudness-normalised to -16 LUFS
- Audio-reactive treatment: none (documented in the plan)
- SFX: `ui/click2.ogg` at 13.11 s, `impact/impactSoft_medium_001.ogg` at 42.00 s, `interface/bong_001.ogg` at 53.6 s, all 0.55
- Exact SFX choice made after the motion existed; files copied into `composition/assets/sfx/`

## Hyperframes Instructions
Composition-building skills loaded: hyperframes-core, -animation, -creative, -keyframes, -cli.
GSAP is vendored (`vendor/gsap.min.js`): the render must not depend on a CDN. `hyperframes check`
is the gate before render.
