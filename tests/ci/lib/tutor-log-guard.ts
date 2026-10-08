/**
 * @spec [Coding Standards §12.1 ("never log … tutor prompts or responses"); CLAUDE.md Privacy
 *        invariant; Public Disclosure Doctrine rule 2 (LISA's prompts are never published);
 *        owner decision 2026-10-07 on the CI audit, item 1]
 * @implemented 2026-10-07
 *
 * plain English: keeps LISA's prompts and tutor exchanges out of test output. CI logs on this
 * repository are public, so anything a test prints is published. A proof test printed LISA's
 * full system instruction into every CI run from 2026-08-28 to 2026-10-07; this module is the
 * two guards that stop that class, not just that file.
 *
 *   1. The chokepoint (runtime). `makeTutorConsoleGuard` is wired into vitest's `onConsoleLog`
 *      (vitest.config.ts, vitest.integration.config.ts). Every line any test sends to the
 *      console passes through it; a line carrying a fragment of LISA's prompt text is dropped
 *      before it is printed, the drop is reported by test file only (never the text), and the
 *      run exits non-zero. The fingerprints are read from the prompt sources themselves
 *      (`PROMPT_SOURCE_DIR`), so a prompt edit moves the fingerprints with it.
 *   2. The static rule. `findTutorConsoleWrites` flags a test file that imports a tutor module
 *      and writes to the console or to stdout/stderr at all. Tutor answers in tests are
 *      fixtures with no stable fingerprint, so the only reliable rule for them is "a test that
 *      handles tutor content does not print". `tests/ci/test-logs-no-tutor-content.guard.test.ts`
 *      applies it to every test file in the repository.
 *
 * trade-offs:
 *  - Fingerprints are the string-literal fragments of the prompt sources at least
 *    `MIN_FRAGMENT` characters long. Interpolated values (the student's question, mastery
 *    bands) are not fingerprinted; the static rule covers a tutor test printing those.
 *  - `onConsoleLog` only sees console calls. A raw `process.stdout.write` bypasses it, which
 *    is why the static rule names stdout/stderr writes too.
 *  - Exiting non-zero from the config hook (rather than failing the one test) is deliberate:
 *    the hook runs in the main process and cannot fail a test, and the line must be dropped
 *    either way. The test file is named so the failure is findable.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./strip-comments";

/** Where LISA's prompt text lives: the artifacts and the state blocks they render. */
export const PROMPT_SOURCE_DIR = "apps/workers/tutor-orchestrator/src/prompts";
/** Shortest literal fragment treated as prompt text; shorter ones are too generic to match on. */
export const MIN_FRAGMENT = 40;

/** An import specifier naming tutor code: the worker, the BFF tutor services, LISA, prompts. */
export const TUTOR_IMPORT_RE = /(tutor|lisa|orchestrat|prompt)/i;

const LITERAL_RE = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const IMPORT_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bvi\.mock\(\s*|\brequire\(\s*)(["'])([^"'\n]+)\1/g;
const CONSOLE_WRITE_RE =
  /\b(console\.(?:log|info|warn|error|debug|trace|dir|table)|process\.(?:stdout|stderr)\.write)\s*\(/g;

/** The prose fragments of every string literal in `source`, split at template interpolations. */
export function promptFragments(source: string): string[] {
  const fragments: string[] = [];
  for (const m of stripComments(source).matchAll(LITERAL_RE)) {
    const body = m[0].slice(1, -1);
    for (const piece of body.split(/\$\{[^}]*\}/)) {
      const text = piece.replace(/\\n/g, "\n").trim();
      if (text.length >= MIN_FRAGMENT && /\s/.test(text)) fragments.push(text);
    }
  }
  return fragments;
}

/** Fingerprints of LISA's prompt text, read from the prompt sources under `root`. */
export function loadTutorPromptFingerprints(root: string): string[] {
  const dir = join(root, PROMPT_SOURCE_DIR);
  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );
  const all = new Set<string>();
  for (const f of files)
    for (const frag of promptFragments(readFileSync(join(dir, f), "utf8")))
      all.add(frag);
  return [...all];
}

/** The first fingerprint `text` contains, or null. */
export function containsTutorPrompt(
  text: string,
  fingerprints: readonly string[],
): string | null {
  for (const fp of fingerprints) if (text.includes(fp)) return fp;
  return null;
}

type ConsoleEntity =
  | { moduleId?: string; module?: { moduleId?: string } }
  | undefined;

export type TutorConsoleGuard = {
  /** vitest `onConsoleLog`: false drops the line. */
  onConsoleLog: (
    log: string,
    type: "stdout" | "stderr",
    entity?: ConsoleEntity,
  ) => boolean | void;
  /** Test files whose console output was dropped. */
  blocked: () => readonly string[];
};

/**
 * The runtime chokepoint. `report` receives one line per drop naming the test file, never the
 * dropped text; `fail` is called once, on the first drop, to make the run exit non-zero.
 */
export function makeTutorConsoleGuard(
  fingerprints: readonly string[],
  report: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
  fail: () => void = () => {
    process.exitCode = 1;
    process.once("exit", () => {
      process.exitCode = 1;
    });
  },
): TutorConsoleGuard {
  const blocked: string[] = [];
  return {
    onConsoleLog(log, _type, entity) {
      if (containsTutorPrompt(log, fingerprints) === null) return undefined;
      const where =
        entity?.moduleId ?? entity?.module?.moduleId ?? "unknown test file";
      if (blocked.length === 0) fail();
      blocked.push(where);
      report(
        `TUTOR LOG GUARD: dropped console output carrying LISA prompt text from ${where} (Coding Standards §12.1). Remove the print.`,
      );
      return false;
    },
    blocked: () => blocked,
  };
}

/** Module specifiers `source` imports, mocks or requires. */
export function importedSpecifiers(source: string): string[] {
  return [...stripComments(source).matchAll(IMPORT_RE)].map((m) => m[2] ?? "");
}

/**
 * The static rule: a file that imports tutor code must not write to the console or to
 * stdout/stderr. Returns one finding per write, as "line N: <call>". Calls written inside a
 * string literal are text, not writes, and are not counted.
 */
export function findTutorConsoleWrites(source: string): string[] {
  if (!importedSpecifiers(source).some((s) => TUTOR_IMPORT_RE.test(s)))
    return [];
  // Comments removed and string-literal contents blanked (newlines kept, so line numbers
  // stay true): a call written inside a string is text, not a write.
  const code = stripComments(source, { keepLines: true }).replace(
    LITERAL_RE,
    (lit) =>
      lit[0] + lit.slice(1, -1).replace(/[^\n]/g, " ") + lit[lit.length - 1],
  );
  const findings: string[] = [];
  for (const m of code.matchAll(CONSOLE_WRITE_RE)) {
    const line = code.slice(0, m.index).split("\n").length;
    findings.push(`line ${line}: ${m[1]}(`);
  }
  return findings;
}
