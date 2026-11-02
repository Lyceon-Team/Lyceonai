# OpenVoice V2 and MeloTTS: licence record

The cloned voice (profile `clone` in `../voice.json`) is made with OpenVoice V2 converting the tone
colour of a MeloTTS base speaker (OpenVoice addendum, Karl, 2026-10-27). Neither is installed in CI or
shipped with the site; both run on the batch writer's machine
(`scripts/worked-examples/openvoice/`). Checked 2026-10-27 against the exact releases pinned here.

## OpenVoice V2

- Code: https://github.com/myshell-ai/OpenVoice at commit `74a1d147b17a8c3092dd5430504bd83ef6c7eb23`
  (no releases or tags are published; this is `main` as of 2026-10-27).
- `LICENSE`: the MIT License, "Copyright 2024 MyShell.ai".
- README, "License": "OpenVoice V1 and V2 are MIT Licensed. Free for both commercial and research use."
- README, "OpenVoice V2": "Free Commercial Use. Starting from April 2024, both V2 and V1 are released
  under MIT License. Free for commercial use."
- Checkpoints: https://huggingface.co/myshell-ai/OpenVoiceV2 at revision
  `f36e7edfe1684461a8343844af60babc2efbb727` (`converter/`, `base_speakers/ses/`), model card licence
  "mit". `converter/checkpoint.pth` sha256 `9652c27e92b6b2a91632590ac9962ef7ae2b712e5c5b7f4c34ec55ee2b37ab9e`.
  (The S3 zip `checkpoints_v2_0417.zip` linked from the README returned HTTP 403 on 2026-10-27.)

## MeloTTS (the base TTS)

- Code: https://github.com/myshell-ai/MeloTTS at commit `209145371cff8fc3bd60d7be902ea69cbdb7965a`.
- `LICENSE`: the MIT License, "Copyright (c) 2024 MyShell.ai".
- Model: https://huggingface.co/myshell-ai/MeloTTS-English, model card licence "mit": "This library
  is under MIT License, which means it is free for both commercial and non-commercial use."

## The reference voice

The clone's reference recording is a clean recording of Karl, or of a person who has given written
consent; Karl keeps the consent record outside the repository. The recording is never committed: it
is read from the private path in `WE_VOICE_REFERENCE`, which the tooling refuses if it lies inside
any repository checkout, and `.gitignore` ignores `*.reference.*` and `voice-reference/`.
OpenVoice's own inaudible audio watermark is left on (its default).
