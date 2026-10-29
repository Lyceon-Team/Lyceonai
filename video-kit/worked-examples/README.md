# Worked-example asset kit

Every worked-example video is rendered from this folder plus the approved content file. Nothing is
hand-edited (owner brief "Worked examples: production system", Karl, 2026-10-27).

| File | What it is |
|---|---|
| `templates/kit.css` | Blank paper (one flat colour: no lines, no margin), Caveat handwriting, captions, safe-area column |
| `templates/frame.html` | The composition document |
| `templates/hook-card.html`, `question-card.html`, `step-reveal.html`, `answer-reveal.html`, `trap-callout.html`, `end-card.html` | The six templates |
| `brand.json` | Lyceon colours; fonts (Caveat here, Poppins and Inter shared with the site from `client/public/fonts`) |
| `fonts/caveat-latin.woff2`, `fonts/OFL-Caveat.md` | Caveat 2.000 (Google Fonts), SIL OFL 1.1 |
| `voice.json` | The /brag voice (Kokoro `af_heart` via `hyperframes tts`), line gap, end-card line, music gain, the 15 dB voice-over-music margin, 30-60 s |
| `voice/outro.wav`, `voice/outro.json` | The end card's spoken line, voiced once |
| `music/tracks.json`, `music/*.mp3`, `music/*.LICENSE.md` | The track, its measured peak and its licence record |
| `vendor/gsap.min.js`, `lyceon-logo.png` | Copied from the /brag composition |

Generate a project: `pnpm exec tsx scripts/worked-examples/generate.ts --content <social checkout>
--dir content/worked-examples/<week>/<QUESTION_ID> --out <folder>`. Runbook:
`docs/runbooks/worked-examples.md`.
