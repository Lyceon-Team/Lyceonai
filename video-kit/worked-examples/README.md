# Worked-example asset kit

Every worked-example video is rendered from this folder plus the approved content file. Nothing is
hand-edited (owner brief "Worked examples: production system", Karl, 2026-10-27).

| File | What it is |
|---|---|
| `templates/kit.css` | Blank paper (one flat colour: no lines, no margin), Caveat handwriting, safe-area column; no captions (SCL-267) |
| `templates/frame.html` | The composition document |
| `templates/hook-card.html`, `question-card.html`, `step-reveal.html`, `answer-reveal.html`, `trap-callout.html`, `end-card.html` | The six templates |
| `brand.json` | Lyceon colours; fonts (Caveat here, Poppins and Inter shared with the site from `client/public/fonts`) |
| `fonts/caveat-latin.woff2`, `fonts/OFL-Caveat.md` | Caveat 2.000 (Google Fonts), SIL OFL 1.1 |
| `voice.json` | Voice profiles (`am_michael`, the default and fallback since SCL-267; the /brag voice `af_heart`, kept for the W45 batch; the `clone`), each with its `speaking_rate` (1.0 natural), the loudness target (-14 LUFS, -1 dBTP), the finished mix's true-peak ceiling (`final_mix`, -1 dBTP, SCL-270), the speech quality limits, the transcriber's hearings of "Lyceon", line gap, the end card's call to action, music gain, the 15 dB voice-over-music margin, 30-60 s |
| `voice/outro.wav`, `voice/outro.json` | The end card's spoken line, voiced once |
| `voice/OPENVOICE-LICENCE.md` | Licence record for the cloned voice (OpenVoice V2 and MeloTTS, both MIT, pinned commits). The clone is a profile in `voice.json`, not the default, until Karl picks it; its reference recording is never in this folder or any checkout |
| `music/tracks.json`, `music/*.mp3`, `music/*.LICENSE.md` | The track, its measured peak and its licence record |
| `vendor/gsap.min.js`, `lyceon-logo.png` | Copied from the /brag composition |

Generate a project: `pnpm exec tsx scripts/worked-examples/generate.ts --content <social checkout>
--dir content/worked-examples/<week>/<QUESTION_ID> --out <folder>`. Runbook:
`docs/runbooks/worked-examples.md`.
