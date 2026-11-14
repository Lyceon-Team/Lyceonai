/**
 * Voices raw lines in one Chirp 3 HD voice: the brand-name pronunciation test clips, and every
 * spoken line of the given worked examples, for timing and for a local re-render.
 *
 * @spec [Karl's voice change 2026-11-11: production voice A (Chirp 3 HD Orus) from the blind
 *       bake-off; "Lyceon" = "lye-see-on", IPA /ˈlaɪsiɑn/; test the engine's IPA control, then the
 *       respellings "Lie-see-on" and "Lye-see-ahn", and send Karl one clip of "Lyceon SAT Prep."
 *       per variant before rolling out] | @implemented [2026-11-11]
 *
 * plain English: one run on a pull request (the bake-off pattern: Workload Identity Federation as
 * lyceon-ci-eval, no stored key). `--clips` writes clips/<variant>.wav for "Lyceon SAT Prep."
 * three ways: the IPA custom pronunciation (google-tts.ts brandPronunciations), and the two
 * respellings with no custom pronunciation. Each `--example` folder (an example.json) is voiced
 * line by line in spoken order, the kit's call to action last, into <out>/<question_id>/<key>.wav
 * with lines.json. Nothing is normalised, checked, cached or committed here: the raw audio is
 * downloaded from the run's artifact, and the worked examples' own normalise / transcribe / check
 * step (voice.ts transcribeAndCheck) runs on it locally before anything is rendered.
 * report.json records the characters billed (Chirp 3 HD: first 1M characters a month free).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workedExampleContentSchema } from "../../packages/shared/src/worked-example-schema";
import { scriptLines } from "./composition";
import {
  accessToken,
  billedChars,
  chirpRequest,
  synthesize,
  type FetchLike,
  type SynthesizeRequest,
} from "./google-tts";
import { loadKit } from "./kit";

/** The brand-name test line and its three pronunciation variants. */
export const PRONUNCIATION_CLIPS: readonly {
  variant: string;
  text: string;
}[] = [
  { variant: "ipa", text: "Lyceon SAT Prep." },
  { variant: "lie-see-on", text: "Lie-see-on SAT Prep." },
  { variant: "lye-see-ahn", text: "Lye-see-ahn SAT Prep." },
];

/** The requests for the clips: the IPA custom pronunciation rides only on the plain spelling. */
export function clipRequests(
  voice: string,
): { variant: string; req: SynthesizeRequest }[] {
  return PRONUNCIATION_CLIPS.map((c) => ({
    variant: c.variant,
    req: chirpRequest(voice, c.text),
  }));
}

function arg(name: string): string | undefined {
  const k = process.argv.indexOf(name);
  return k >= 0 ? process.argv[k + 1] : undefined;
}

async function main(): Promise<void> {
  const voice = arg("--voice");
  const out = arg("--out");
  if (!voice || !out)
    throw new Error(
      "usage: chirp-lines.ts --voice <Chirp name> --out <dir> [--rate n] [--clips] [--example <dir>]...",
    );
  const rate = Number(arg("--rate") ?? "1");
  const examples = process.argv.flatMap((a, k) =>
    a === "--example" && process.argv[k + 1] ? [process.argv[k + 1] ?? ""] : [],
  );
  const kit = loadKit();
  const token = await accessToken();
  const fetchImpl: FetchLike = (url, init) => fetch(url, init);
  let chars = 0;
  const say = async (req: SynthesizeRequest, file: string): Promise<void> => {
    chars += billedChars(req);
    writeFileSync(file, await synthesize(req, token, "v1", fetchImpl));
  };
  if (process.argv.includes("--clips")) {
    mkdirSync(join(out, "clips"), { recursive: true });
    for (const c of clipRequests(voice))
      await say(c.req, join(out, "clips", `${c.variant}.wav`));
  }
  for (const dir of examples) {
    const example = workedExampleContentSchema.parse(
      JSON.parse(readFileSync(join(dir, "example.json"), "utf8")),
    );
    const lines = scriptLines(example, kit.voice.outro_text);
    const target = join(out, example.question_id);
    mkdirSync(target, { recursive: true });
    for (const line of lines)
      await say(
        chirpRequest(voice, line.text, rate),
        join(target, `${line.key}.wav`),
      );
    writeFileSync(
      join(target, "lines.json"),
      `${JSON.stringify(lines, null, 2)}\n`,
    );
  }
  writeFileSync(
    join(out, "report.json"),
    `${JSON.stringify({ voice, rate, examples: examples.length, chars }, null, 2)}\n`,
  );
  process.stdout.write(
    `chirp-lines: ${voice}, ${examples.length} example(s), ${chars} characters\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(
    `chirp-lines: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
