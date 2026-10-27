/**
 * Reads the worked-example content tree and runs every content rule over it.
 *
 * @spec [owner brief "Worked examples: production system" (Karl, 2026-10-27); Step 0 rulings 4
 *       (render from the merged content file + seed SQL), 5 (voice audio committed at batch time),
 *       6 (a per-skill style table)] | @implemented [2026-10-27]
 *
 * plain English: the tree, on `social`:
 *   content/worked-examples/STYLE.json                       the per-skill style table
 *   content/worked-examples/<YYYY-MM>-plan/plan.json         a month's slots
 *   content/worked-examples/<YYYY-Www>/<QUESTION_ID>/example.json
 *   content/worked-examples/<YYYY-Www>/<QUESTION_ID>/voice/manifest.json + <line>.wav
 *   content/worked-examples/posted.json                      the daily job's ledger
 * exampleProblems runs the shape, question, hook, style, plan and voice rules on one example; the
 * pull-request check and the daily job both call it, so nothing that fails here is ever posted.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  voiceManifestSchema,
  workedExampleContentSchema,
  workedExamplePlanSchema,
  workedExamplePostedLedgerSchema,
  workedExampleStyleSchema,
  type VoiceManifest,
  type WorkedExampleContent,
  type WorkedExamplePlan,
  type WorkedExamplePostedLedger,
  type WorkedExampleStyle,
} from "../../packages/shared/src/worked-example-schema";
import {
  contentProblems,
  planSlotProblem,
} from "../../shared/worked-examples/rules";
import {
  parseQuestionInsert,
  seedQuestionFromValues,
  type SeedQuestion,
} from "../../shared/worked-examples/seed-question";
import type { ExampleOnBranch } from "./approval";
import { mixProblem, readWav } from "./audio";
import { scriptLines } from "./composition";
import { ROOT, type Kit } from "./kit";

export const CONTENT_DIR = "content/worked-examples";
const WEEK = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Every example under `contentRoot` (a checkout of `social`), in folder order. */
export function loadExamples(contentRoot: string): ExampleOnBranch[] {
  const base = join(contentRoot, CONTENT_DIR);
  if (!existsSync(base)) return [];
  const out: ExampleOnBranch[] = [];
  for (const cycle of readdirSync(base).sort()) {
    if (!WEEK.test(cycle)) continue;
    for (const qid of readdirSync(join(base, cycle)).sort()) {
      const dir = `${CONTENT_DIR}/${cycle}/${qid}`;
      const file = join(contentRoot, dir, "example.json");
      const parsed = workedExampleContentSchema.safeParse(readJson(file));
      if (!parsed.success)
        throw new Error(
          `${dir}/example.json: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
        );
      if (parsed.data.question_id !== qid)
        throw new Error(
          `${dir}/example.json names ${parsed.data.question_id}, not its folder ${qid}`,
        );
      out.push({ dir, cycle, content: parsed.data });
    }
  }
  return out;
}

export function loadStyle(contentRoot: string): WorkedExampleStyle {
  const file = join(contentRoot, CONTENT_DIR, "STYLE.json");
  return existsSync(file) ? workedExampleStyleSchema.parse(readJson(file)) : {};
}

export function loadPlan(
  contentRoot: string,
  month: string,
): WorkedExamplePlan | null {
  const file = join(contentRoot, CONTENT_DIR, `${month}-plan`, "plan.json");
  if (!existsSync(file)) return null;
  const plan = workedExamplePlanSchema.parse(readJson(file));
  if (plan.month !== month)
    throw new Error(`${month}-plan/plan.json says month ${plan.month}`);
  return plan;
}

export const POSTED_PATH = `${CONTENT_DIR}/posted.json`;

export function loadPosted(contentRoot: string): WorkedExamplePostedLedger {
  const file = join(contentRoot, POSTED_PATH);
  return existsSync(file)
    ? workedExamplePostedLedgerSchema.parse(readJson(file))
    : {};
}

export function loadVoice(contentRoot: string, dir: string): VoiceManifest {
  return voiceManifestSchema.parse(
    readJson(join(contentRoot, dir, "voice", "manifest.json")),
  );
}

/** The seed patch files: a question they name is refused (its seed text is not what is served). */
const SEED_DIR = "infra/supabase/seed";

function seedFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      const p = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".sql")) out.push(p);
    }
  };
  walk(SEED_DIR);
  return out.sort();
}

/**
 * The question as its seed SQL inserts it. Every INSERT of the id must agree; a seed patch that
 * names the id refuses it.
 */
export function seedQuestion(
  id: string,
): { ok: true; question: SeedQuestion } | { ok: false; problem: string } {
  const found: SeedQuestion[] = [];
  for (const rel of seedFiles()) {
    const sql = readFileSync(join(ROOT, rel), "utf8");
    if (!sql.includes(`'${id}'`)) continue;
    if (rel.startsWith(`${SEED_DIR}/migrations/`))
      return {
        ok: false,
        problem: `${id} is changed by the seed patch ${rel}; choose another question`,
      };
    const values = parseQuestionInsert(sql, id);
    if (!values) continue;
    const q = seedQuestionFromValues(values);
    if (!q.ok) return q;
    found.push(q.question);
  }
  if (found.length === 0)
    return { ok: false, problem: `${id} is in no seed SQL under ${SEED_DIR}` };
  const first = JSON.stringify(found[0]);
  if (found.some((q) => JSON.stringify(q) !== first))
    return {
      ok: false,
      problem: `${id} is inserted differently by two seed files`,
    };
  const q = found[0];
  return q
    ? { ok: true, question: q }
    : { ok: false, problem: `${id} not found` };
}

/** The committed voice against the script and the kit: same lines, same text, same voice, loud enough. */
export function voiceProblems(
  example: WorkedExampleContent,
  manifest: VoiceManifest,
  kit: Kit,
  wav: (file: string) => Uint8Array,
): string[] {
  const out: string[] = [];
  if (manifest.voice !== kit.voice.voice)
    out.push(`voice is ${manifest.voice}, the kit's is ${kit.voice.voice}`);
  const script = scriptLines(example, kit.voice.outro_text).filter(
    (s) => s.key !== "outro",
  );
  const keys = manifest.lines.map((l) => l.key).join(",");
  if (keys !== script.map((s) => s.key).join(","))
    return [
      ...out,
      `voice lines ${keys} do not match the script ${script.map((s) => s.key).join(",")}`,
    ];
  const peaks: number[] = [];
  script.forEach((s, k) => {
    const line = manifest.lines[k];
    if (!line) return;
    if (line.text_sha256 !== sha256(s.text))
      out.push(
        `voice/${line.file} was voiced from different text than ${s.key} now has: re-voice it`,
      );
    const info = readWav(wav(line.file));
    if (Math.abs(info.durationSeconds - line.duration) > 0.05)
      out.push(
        `voice/${line.file} lasts ${info.durationSeconds.toFixed(2)} s, the manifest says ${line.duration}`,
      );
    peaks.push(info.peakDbfs);
  });
  const mix = mixProblem(
    peaks,
    kit.track.peak_dbfs,
    kit.voice.music_gain,
    kit.voice.min_voice_over_music_db,
  );
  if (mix) out.push(mix);
  return out;
}

/** Every rule for one example on a branch. Empty means it may be rendered. */
export function exampleProblems(
  contentRoot: string,
  e: ExampleOnBranch,
  kit: Kit,
): { problems: string[]; question: SeedQuestion | null } {
  const q = seedQuestion(e.content.question_id);
  if (!q.ok) return { problems: [q.problem], question: null };
  const problems = contentProblems(
    e.content,
    q.question,
    e.cycle,
    loadStyle(contentRoot),
  );
  const slot = planSlotProblem(
    e.content,
    loadPlan(contentRoot, e.content.post_on.slice(0, 7)),
  );
  if (slot) problems.push(slot);
  try {
    const manifest = loadVoice(contentRoot, e.dir);
    problems.push(
      ...voiceProblems(e.content, manifest, kit, (file) =>
        readFileSync(join(contentRoot, e.dir, "voice", file)),
      ),
    );
  } catch (err: unknown) {
    if (!(err instanceof Error)) throw err;
    problems.push(`voice: ${err.message}`);
  }
  return {
    problems: problems.map((p) => `${e.dir}: ${p}`),
    question: q.question,
  };
}
