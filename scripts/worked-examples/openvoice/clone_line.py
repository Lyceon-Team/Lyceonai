"""Speak one line in the cloned voice: MeloTTS base speaker, then OpenVoice V2 tone-colour conversion.

@spec [OpenVoice addendum (Karl, 2026-10-27): engine OpenVoice V2 (MIT); reference voice read from a
      private local path, never committed; generated at batch-writing time; CI never installs
      OpenVoice or Python] | @implemented [2026-10-27]

plain English: called by scripts/worked-examples/voice.ts (never by CI) with the Python of a local
environment built from scripts/worked-examples/openvoice/requirements.txt. It
  1. speaks the text with the MeloTTS base speaker (e.g. EN-US) into a temporary file;
  2. converts its tone colour from that base speaker's embedding (shipped in the V2 checkpoints)
     to the reference speaker's, which is extracted once from the private reference recording and
     cached outside the repository, keyed by the recording's sha256;
  3. peak-normalises to --peak-dbfs (default -3 dBFS, the level of the /brag voice lines; the
     converter's raw output is about 10 dB quieter, which fails the voice-over-music margin) and
     writes 16-bit PCM mono at 24 kHz (the format of the /brag voice lines) to --out.
OpenVoice's own audio watermark is left on (its default). Prints one JSON line: {"ok": true, ...}.
Exit code 2 on bad arguments, 1 on any other failure (the caller then uses the fallback voice).
"""
import argparse
import hashlib
import json
import os
import sys
import tempfile

TARGET_RATE = 24000


def reference_embedding(converter, reference, cache_dir):
    import librosa
    import numpy
    import soundfile
    import torch

    digest = hashlib.sha256(open(reference, "rb").read()).hexdigest()
    cached = os.path.join(cache_dir, f"{digest}.se.pth")
    if os.path.isfile(cached):
        return torch.load(cached, map_location=converter.device)
    # The recording, with silences removed, in ~10 s pieces (OpenVoice's own extractor does the
    # same with a VAD that needs faster-whisper; this needs only librosa).
    rate = converter.hps.data.sampling_rate
    audio, _ = librosa.load(reference, sr=rate, mono=True)
    voiced = [audio[a:b] for a, b in librosa.effects.split(audio, top_db=35)]
    speech = numpy.concatenate(voiced) if voiced else audio[:0]
    if len(speech) < rate * 10:
        raise ValueError("the reference has less than 10 s of speech")
    work = tempfile.mkdtemp(prefix="we-ref-")
    pieces = []
    step = rate * 10
    for k in range(0, len(speech) - step // 2, step):
        path = os.path.join(work, f"seg{k // step}.wav")
        soundfile.write(path, speech[k : k + step], rate)
        pieces.append(path)
    os.makedirs(cache_dir, exist_ok=True)
    return converter.extract_se(pieces, se_save_path=cached)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--text", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--reference", required=True)
    p.add_argument("--checkpoints", required=True)
    p.add_argument("--cache", required=True)
    p.add_argument("--language", default="EN")
    p.add_argument("--speaker", default="EN-US")
    p.add_argument("--tau", type=float, default=0.3)
    p.add_argument("--speed", type=float, default=1.0)
    p.add_argument("--peak-dbfs", type=float, default=-3.0)
    a = p.parse_args()
    for path in (a.reference, os.path.join(a.checkpoints, "converter", "checkpoint.pth")):
        if not os.path.isfile(path):
            print(json.dumps({"ok": False, "error": f"missing {path}"}))
            sys.exit(2)

    import librosa
    import soundfile
    import torch
    from melo.api import TTS
    from openvoice.api import ToneColorConverter

    device = "cpu"
    converter = ToneColorConverter(os.path.join(a.checkpoints, "converter", "config.json"), device=device)
    converter.load_ckpt(os.path.join(a.checkpoints, "converter", "checkpoint.pth"))
    target_se = reference_embedding(converter, a.reference, a.cache)

    base = TTS(language=a.language, device=device)
    speaker_id = base.hps.data.spk2id[a.speaker]
    source_se = torch.load(
        os.path.join(a.checkpoints, "base_speakers", "ses", f"{a.speaker.lower().replace('_', '-')}.pth"),
        map_location=device,
    )
    work = tempfile.mkdtemp(prefix="we-clone-")
    spoken = os.path.join(work, "base.wav")
    converted = os.path.join(work, "clone.wav")
    base.tts_to_file(a.text, speaker_id, spoken, speed=a.speed, quiet=True)
    converter.convert(audio_src_path=spoken, src_se=source_se, tgt_se=target_se, output_path=converted, tau=a.tau)

    audio, _ = librosa.load(converted, sr=TARGET_RATE, mono=True)
    peak = float(abs(audio).max()) if len(audio) else 0.0
    if peak > 0:
        audio = audio * (10 ** (a.peak_dbfs / 20) / peak)
    soundfile.write(a.out, audio, TARGET_RATE, subtype="PCM_16")
    print(json.dumps({"ok": True, "seconds": round(len(audio) / TARGET_RATE, 3)}))


if __name__ == "__main__":
    try:
        main()
    except Exception as err:  # reported to the caller, which falls back to the /brag voice
        print(json.dumps({"ok": False, "error": f"{type(err).__name__}: {err}"}))
        sys.exit(1)
