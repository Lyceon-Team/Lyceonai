/**
 * Breakdown content gate: nothing breakdown-specific that names an answer may exist in this
 * (public) repository.
 *
 * @spec [Karl's ruling 2026-11-02 (third rulings, 2): "Nothing breakdown-specific that names an
 *       answer may exist in the public repo: no scripts, audio, fixtures with real answers, logs or
 *       artifacts. Add a CI check in the public repo that fails if a breakdown script file appears
 *       there."; Karl's ruling 2026-11-03 (1): the private-repo plan approved as proposed, "Use the
 *       synthetic fixture and the breakdown-content-gate with its own plants, exactly as
 *       described"; SCL-266] | @implemented [2026-11-03]
 *
 * plain English: reads every TRACKED file (git ls-files) and fails on any of three findings:
 *   BD-PATH   a path with a `qotd-breakdowns/` segment (the private repo's layout: a script, its
 *             voice/*.wav, its manifest), anywhere but the synthetic fixture root;
 *   BD-EXPORT a file named qotd-breakdown-schedule*.json (Karl's weekly export: future answers),
 *             anywhere, the synthetic root included;
 *   BD-SCRIPT a .json file holding a breakdown script (it parses as qotdBreakdownScriptSchema with
 *             any extra keys allowed, or it carries correct_display_letter beside a script field:
 *             hook, steps, trap or answer), at the top level or as an element of a top-level
 *             array, under any name and in any folder, unless it is under the synthetic root AND
 *             its question_id is in the synthetic namespace (SAT<M|RW><1|2>SYNTH<one character>,
 *             used by no real question).
 * A tripwire refuses a run that saw fewer than MIN_FILES files, so a gate pointed at nothing
 * cannot pass. Findings print as `<rule> <path>: <detail>`; the detail never quotes the file.
 * The plants that prove each rule goes red are in breakdown-content-gate.mutations.sh.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { qotdBreakdownScriptSchema } from "../../packages/shared/src/qotd-breakdown-schema";

/** The one place a breakdown-shaped file may live: the made-up fixture the tests run on. */
export const SYNTHETIC_ROOT = "tests/fixtures/qotd-breakdowns-synthetic/";

/** The synthetic question ids: no real question has SYNTH after its section and module. */
export const SYNTHETIC_QUESTION_ID = /^SAT(M|RW)[12]SYNTH[A-Z0-9]$/;

/** Fewer tracked files than this means the gate is looking at the wrong tree. */
export const MIN_FILES = 500;

export type GateRule = "BD-PATH" | "BD-EXPORT" | "BD-SCRIPT";
export type GateFinding = { rule: GateRule; path: string; detail: string };
export type GateFile = { path: string; read: () => string };

const BREAKDOWN_SEGMENT = /(^|\/)qotd-breakdowns\//;
const EXPORT_NAME = /^qotd-breakdown-schedule.*\.json$/i;
const SCRIPT_FIELDS = ["hook", "steps", "trap", "answer"] as const;
const looseScriptSchema = qotdBreakdownScriptSchema.passthrough();

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A breakdown script, strictly or loosely shaped (a renamed or trimmed copy still counts). */
export function looksLikeScript(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (looseScriptSchema.safeParse(v).success) return true;
  return (
    "correct_display_letter" in v && SCRIPT_FIELDS.some((field) => field in v)
  );
}

/** The candidate objects in a parsed JSON document: itself, or each element of an array. */
function candidates(doc: unknown): unknown[] {
  return Array.isArray(doc) ? doc : [doc];
}

function parseJson(text: string): { ok: true; doc: unknown } | { ok: false } {
  try {
    const doc: unknown = JSON.parse(text);
    return { ok: true, doc };
  } catch (e: unknown) {
    // Not JSON (a template, JSONC): it cannot be a script the pipeline would read.
    if (e instanceof SyntaxError) return { ok: false };
    throw e;
  }
}

/** Every finding for these files. Pure apart from the reads it is handed. */
export function breakdownContentFindings(
  files: readonly GateFile[],
): GateFinding[] {
  const findings: GateFinding[] = [];
  for (const f of files) {
    const synthetic = f.path.startsWith(SYNTHETIC_ROOT);
    if (BREAKDOWN_SEGMENT.test(f.path) && !synthetic)
      findings.push({
        rule: "BD-PATH",
        path: f.path,
        detail:
          "breakdown content lives in Lyceon-Team/lyceon-content-private, never here",
      });
    if (EXPORT_NAME.test(basename(f.path)))
      findings.push({
        rule: "BD-EXPORT",
        path: f.path,
        detail:
          "the schedule export holds future answers and is never committed",
      });
    if (!f.path.endsWith(".json")) continue;
    const parsed = parseJson(f.read());
    if (!parsed.ok) continue;
    candidates(parsed.doc).forEach((c, i) => {
      if (!looksLikeScript(c)) return;
      const where = Array.isArray(parsed.doc) ? ` (element ${i})` : "";
      if (!synthetic) {
        findings.push({
          rule: "BD-SCRIPT",
          path: f.path,
          detail: `a breakdown script${where} outside ${SYNTHETIC_ROOT}`,
        });
        return;
      }
      const id = isRecord(c) ? c.question_id : undefined;
      if (typeof id !== "string" || !SYNTHETIC_QUESTION_ID.test(id))
        findings.push({
          rule: "BD-SCRIPT",
          path: f.path,
          detail: `a breakdown script${where} whose question_id is not synthetic (SAT<M|RW><1|2>SYNTH<x>)`,
        });
    });
  }
  return findings;
}

/** The tracked files of the checkout at `root`. */
export function trackedFiles(root: string): GateFile[] {
  return execFileSync("git", ["-C", root, "ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((p) => p !== "")
    .map((p) => ({ path: p, read: () => readFileSync(join(root, p), "utf8") }));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(process.argv[2] ?? ".");
  const files = trackedFiles(root);
  if (files.length < MIN_FILES) {
    process.stderr.write(
      `breakdown-content-gate: ZERO-FILE tripwire: saw ${files.length} tracked files (at least ${MIN_FILES} expected)\n`,
    );
    process.exit(1);
  }
  const findings = breakdownContentFindings(files);
  for (const f of findings)
    process.stderr.write(`${f.rule} ${f.path}: ${f.detail}\n`);
  if (findings.length > 0) {
    process.stderr.write(
      `breakdown-content-gate: FAIL (${findings.length} finding(s))\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `breakdown-content-gate: OK (${files.length} tracked files; no breakdown content outside ${SYNTHETIC_ROOT})\n`,
  );
}
