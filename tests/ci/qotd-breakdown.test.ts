/**
 * The QOTD breakdown pilot: the stored order and letter, the authored script and its approval, the
 * anti-leak day, the fallback rule, the captions, the pilot window and the workflows.
 *
 * @spec [owner brief "QOTD breakdown pilot, 2 weeks" (Karl, 2026-11-02, Part C): "Add a test that
 *       fails if the letter or order differs from the stored row"; "Add a test that today's QOTD
 *       is refused"; the fallback rule (a)-(d) with stable codes; SCL-258, SCL-262, SCL-266. Karl's
 *       rulings on #1398, 2026-11-02: authored scripts approved by his merge; at render the
 *       script's option_order and correct_display_letter must equal the stored row the archive
 *       serves (order_mismatch); no approved script = no_approved_script; the worked examples'
 *       rules H1-H6, S1, S2 and the trap opener, reused; am_michael; the pilot 2026-11-09 to
 *       2026-11-22. Karl's rulings 2026-11-02/03: this repository is public, so nothing
 *       breakdown-specific that names an answer lives here; the scripts move to the private repo;
 *       the tests run on a SYNTHETIC fixture] | @implemented [2026-11-02, authored scripts
 *       2026-11-02, synthetic fixture 2026-11-03]
 *
 * plain English: every breakdown day here is SYNTHETIC (tests/fixtures/qotd-breakdowns-synthetic:
 * made-up questions in the SYNTH id namespace, never scheduled and never in the bank), in the
 * exact shape qotd_archive() returns, and it reaches the breakdown through the real projection
 * (toArchiveResponse) in the archive API's { data } envelope and through the generator's own
 * reader (loadYesterday), the path the nightly job takes. The fixture can disprove the hard rule:
 * on every synthetic multiple-choice day the stored order is a shuffle and the stored letter
 * differs from the canonical key, so a script or a breakdown that used the authored order or the
 * canonical letter fails here. The script is the synthetic tree's, voiced in am_michael by
 * scripts/qotd-social/voice-breakdown.ts, the same files the pull-request dry run renders. The
 * shared QOTD fixture (tests/fixtures/qotd/rows.json, real qotd_archive() output) is used once,
 * at the end, to show real rows reach the breakdown through the same projection.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { execFileSync, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  QOTD_BREAKDOWN_SKIP_CODES,
  qotdBreakdownManifestSchema,
  qotdBreakdownPilotSchema,
  qotdBreakdownScheduleSchema,
  qotdBreakdownScriptSchema,
  type QotdBreakdownSchedule,
  type QotdBreakdownScript,
} from "../../packages/shared/src/qotd-breakdown-schema";
import type { QotdArchiveResponse } from "../../packages/shared/src/qotd-schema";
import {
  QOTD_BREAKDOWN_CONTENT_BRANCH,
  QOTD_BREAKDOWN_CONTENT_REPO,
  QOTD_BREAKDOWN_PILOT,
  QOTD_BREAKDOWN_PILOT_RULED,
  QOTD_BREAKDOWN_SKIP_REASON,
  QOTD_BREAKDOWN_VOICE_PROFILE,
  breakdownCopy,
  breakdownQuestion,
  breakdownScriptDir,
  breakdownSkipCode,
  breakdownSkipLine,
  pilotWindow,
  scheduledDay,
  scriptOrderProblem,
  type BreakdownQuestion,
} from "../../shared/qotd/breakdown";
import {
  socialFacebookCaption,
  socialInstagramCaption,
  socialTiktokCaption,
  copyBlockProblems,
  nextSatTest,
  qotdHeadline,
} from "../../shared/social/posts";
import { scriptProblems } from "../../shared/worked-examples/rules";
import {
  seedQuestionSchema,
  type SeedQuestion,
} from "../../shared/worked-examples/seed-question";
import {
  breakdownDay,
  breakdownPlan,
  buildBreakdown,
  finishVideo,
  fixtureArchiveFetch,
  scriptApproval,
  type ScriptSource,
} from "../../scripts/qotd-social/breakdown";
import { measureMix } from "../../scripts/worked-examples/final-mix";
import {
  breakdownVoice,
  checkBreakdownScripts,
  loadBreakdownScripts,
  readScheduleExport,
  type SeedLookup,
} from "../../scripts/qotd-social/check-breakdown-scripts";
import { loadYesterday } from "../../scripts/qotd-social/generate";
import { SYNTHETIC_QUESTION_ID } from "../../scripts/ci/breakdown-content-gate";
import { buildScriptComposition } from "../../scripts/worked-examples/composition";
import { loadVoice } from "../../scripts/worked-examples/content";
import { loadKit } from "../../scripts/worked-examples/kit";
import {
  voiceLineSchema,
  workedExampleContentSchema,
} from "../../packages/shared/src/worked-example-schema";
import { QOTD_ARCHIVE_ROWS } from "../lib/qotd-fixture";
import { qotdRowSchema, type QotdRow } from "../../shared/qotd/projection";
import { z } from "zod";

const ROOT = resolve(import.meta.dirname, "../..");
/** The synthetic fixture (Karl, 2026-11-03): made-up questions, the archive's exact row shape. */
const SYNTHETIC = resolve(ROOT, "tests/fixtures/qotd-breakdowns-synthetic");
const ROWS_JSON: unknown = JSON.parse(
  readFileSync(join(SYNTHETIC, "rows.json"), "utf8"),
);
const SYNTHETIC_ROWS = z
  .object({
    generated_on: z.string(),
    archive: z.array(qotdRowSchema),
    today: z.array(qotdRowSchema).length(1),
  })
  .parse(ROWS_JSON);
const SYNTHETIC_TODAY = SYNTHETIC_ROWS.generated_on;
function syntheticRow(date: string): QotdRow {
  const row = SYNTHETIC_ROWS.archive.find((r) => r.qotd_date === date);
  if (!row) throw new Error(`no synthetic archive row for ${date}`);
  return { ...row };
}
const BASE = "https://lyceon.ai";
/** The synthetic private-repo tree: the 2026-01-14 script and its am_michael voice. */
const CONTENT = join(SYNTHETIC, "content");
const SCRIPT_DATE = "2026-01-14";
const SCRIPT_DIR = breakdownScriptDir(SCRIPT_DATE);
/** The synthetic question the scripted day asks (made up; never in the bank). */
const SCRIPT_QUESTION_ID = "SATM1SYNTH1";
/** A shuffled day with no script. */
const OTHER_DATE = "2026-01-15";
/** A Reading and Writing day, and a grid-in day (no scripts). */
const RW_DATE = "2026-01-12";
const GRID_IN_DATE = "2026-01-13";

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The day as the nightly job reads it: the archive API's payload via loadYesterday. */
async function archiveDay(date: string): Promise<QotdArchiveResponse> {
  const { day } = await loadYesterday(
    BASE,
    nextDay(date),
    fixtureArchiveFetch(ROWS_JSON),
  );
  if (day === null) throw new Error(`${date} is not in the fixture archive`);
  return day;
}

function accepted(day: QotdArchiveResponse): BreakdownQuestion {
  const q = breakdownQuestion(day);
  if (!q.ok) throw new Error(`refused: ${q.code}`);
  return q.question;
}

function fixtureScript(): QotdBreakdownScript {
  return qotdBreakdownScriptSchema.parse(
    JSON.parse(readFileSync(join(CONTENT, SCRIPT_DIR, "script.json"), "utf8")),
  );
}

/** The question as its "seed" holds it: the synthetic row (canonical order and key). */
const seedFromRows: SeedLookup = (id) => {
  const row = SYNTHETIC_ROWS.archive.find((r) => r.question_id === id);
  if (!row) return { ok: false, problem: `${id} is in no fixture row` };
  return {
    ok: true,
    question: seedQuestionSchema.parse({
      id: row.question_id,
      section: row.section,
      domain: row.domain,
      skill_codes: row.skill_codes,
      difficulty: row.difficulty,
      item_type: row.item_type,
      stem: row.stem,
      passage: row.passage,
      options: row.options,
      correct_answer: row.correct_answer,
    }),
  };
};

/** Karl's export for the fixture day, from the synthetic stored row (the SQL's five keys). */
function exportFor(date: string): QotdBreakdownSchedule {
  const row = syntheticRow(date);
  return qotdBreakdownScheduleSchema.parse([
    {
      qotd_date: row.qotd_date,
      question_id: row.question_id,
      option_order: row.option_order,
      correct_display_letter: row.correct_display_letter,
      section: row.section,
    },
  ]);
}

/** A copy of the fixture tree with the 2026-01-14 script changed. */
function treeWith(
  change: (s: QotdBreakdownScript) => QotdBreakdownScript,
): string {
  const root = mkdtempSync(join(tmpdir(), "qotd-breakdown-"));
  cpSync(CONTENT, root, { recursive: true });
  writeFileSync(
    join(root, SCRIPT_DIR, "script.json"),
    `${JSON.stringify(change(fixtureScript()), null, 2)}\n`,
  );
  return root;
}

const APPROVED: ScriptSource["approve"] = async () => ({
  ok: true,
  approval: {
    pr: 7,
    mergedBy: "karl",
    mergeSha: "a".repeat(40),
    mergedAt: "2026-10-01T12:00:00Z",
  },
});

/** The build up to the first machine step: every case here stops before voicing or rendering. */
async function buildUntilRefused(
  date: string,
  contentRoot: string,
  approve: ScriptSource["approve"] = APPROVED,
): Promise<{ code: string; details: string[] }> {
  const out = mkdtempSync(join(tmpdir(), "qotd-breakdown-out-"));
  const o = await buildBreakdown(
    await archiveDay(date),
    date,
    nextDay(date),
    out,
    { contentRoot, approve },
  );
  if (o.manifest.status !== "skipped")
    throw new Error(`expected a skip, got ${o.manifest.status}`);
  return { code: o.manifest.code, details: o.details };
}

const SHUFFLED_DAYS = [RW_DATE, SCRIPT_DATE, OTHER_DATE] as const;

describe("the hard rule: the stored option_order and correct_display_letter", () => {
  it("the fixture can disprove it: stored order shuffled and the stored letter is not the canonical key", () => {
    for (const date of SHUFFLED_DAYS) {
      const row = syntheticRow(date);
      expect(row.option_order.length).toBe(4);
      expect(row.option_order.join("")).not.toBe("ABCD");
      expect(row.correct_display_letter).not.toBeNull();
      expect(row.correct_display_letter).not.toBe(row.correct_answer);
    }
  });

  it("letters the choices by the stored order and keys the answer on the stored letter, for every shuffled day", async () => {
    for (const date of SHUFFLED_DAYS) {
      const row = syntheticRow(date);
      const q = accepted(await archiveDay(date));
      const canonicalText = new Map(
        (row.options as { key: string; text: string }[]).map((o) => [
          o.key,
          o.text,
        ]),
      );
      expect(q.options.map((o) => o.key)).toEqual(["A", "B", "C", "D"]);
      expect(q.options.map((o) => o.text)).toEqual(
        row.option_order.map((k) => canonicalText.get(k)),
      );
      expect(q.option_order).toEqual(row.option_order);
      expect(q.correct_answer).toBe(row.correct_display_letter);
      expect(
        q.options.find((o) => o.key === row.correct_display_letter)?.text,
      ).toBe(canonicalText.get(row.correct_answer ?? ""));
    }
  });

  it("the approved script names the stored row; its canonical order, the canonical letter or another day's row is refused", async () => {
    const day = await archiveDay(SCRIPT_DATE);
    const row = syntheticRow(SCRIPT_DATE);
    const q = accepted(day);
    const script = fixtureScript();
    // Presence first: the script carries the stored row, which is a real shuffle.
    expect(script.option_order).toEqual(row.option_order);
    expect(script.correct_display_letter).toBe(row.correct_display_letter);
    expect(scriptOrderProblem(script, day, q)).toBeNull();
    // The question's original order and its canonical letter.
    expect(
      scriptOrderProblem(
        { ...script, option_order: ["A", "B", "C", "D"] },
        day,
        q,
      ),
    ).toBe("the script's option_order differs from the stored row");
    expect(
      scriptOrderProblem(
        {
          ...script,
          correct_display_letter:
            qotdBreakdownScriptSchema.shape.correct_display_letter.parse(
              row.correct_answer,
            ),
        },
        day,
        q,
      ),
    ).toBe("the script's correct_display_letter differs from the stored row");
    // Another shuffled day's row.
    const other = await archiveDay(OTHER_DATE);
    expect(scriptOrderProblem(script, other, accepted(other))).toBe(
      "the script is for another day",
    );
  });

  it("at render, a script whose order or letter differs from the stored row is order_mismatch, before anything is voiced", async () => {
    const order = treeWith((s) => ({
      ...s,
      option_order: ["A", "B", "C", "D"],
    }));
    expect((await buildUntilRefused(SCRIPT_DATE, order)).code).toBe(
      "order_mismatch",
    );
    const letter = treeWith((s) => ({ ...s, correct_display_letter: "B" }));
    expect((await buildUntilRefused(SCRIPT_DATE, letter)).code).toBe(
      "order_mismatch",
    );
  });

  it("the card on screen shows the stored order under A-D, from the committed voice", async () => {
    const day = await archiveDay(SCRIPT_DATE);
    const row = syntheticRow(SCRIPT_DATE);
    const q = accepted(day);
    const kit = loadKit();
    const manifest = loadVoice(CONTENT, SCRIPT_DIR);
    expect(manifest.voice).toBe("am_michael");
    const comp = buildScriptComposition({
      script: fixtureScript(),
      question: q,
      title: `QOTD breakdown: ${SCRIPT_DATE}`,
      voice: manifest.lines,
      outro: voiceLineSchema.parse(
        JSON.parse(
          readFileSync(
            resolve(ROOT, "video-kit/worked-examples/voice/outro.json"),
            "utf8",
          ),
        ),
      ),
      kit,
    });
    const shown = [
      ...comp.html.matchAll(/<li><b>([A-D])\)<\/b> ([^<]*)<\/li>/g),
    ];
    const canonicalText = new Map(
      (row.options as { key: string; text: string }[]).map((o) => [
        o.key,
        o.text,
      ]),
    );
    expect(shown.map((m) => m[1])).toEqual(["A", "B", "C", "D"]);
    expect(shown.map((m) => m[2])).toEqual(
      row.option_order.map((k) => canonicalText.get(k)),
    );
    // Karl's spoken order: hook, setup, steps, trap, answer, call to action; 30-60 s.
    expect(comp.scenes.map((s) => s.key)).toEqual([
      "open",
      "work",
      "trap",
      "answer",
      "endcard",
    ]);
    expect(comp.duration).toBeGreaterThanOrEqual(30);
    expect(comp.duration).toBeLessThanOrEqual(60);
  });

  it("refuses a day whose stored letter is not where the correct choice is shown (no canonical fallback)", async () => {
    const day = await archiveDay(SCRIPT_DATE);
    const moved: QotdArchiveResponse = {
      ...day,
      question: { ...day.question, correct_letter: "B" },
    };
    expect(breakdownQuestion(moved)).toEqual({
      ok: false,
      code: "order_mismatch",
    });
    const missing: QotdArchiveResponse = {
      ...day,
      question: { ...day.question, correct_letter: null },
    };
    expect(breakdownQuestion(missing)).toEqual({
      ok: false,
      code: "order_mismatch",
    });
  });
});

describe("the authored script: approved by merge, under the worked examples' rules", () => {
  it("no script for the day is no_approved_script", async () => {
    const r = await buildUntilRefused(OTHER_DATE, CONTENT);
    expect(r.code).toBe("no_approved_script");
    expect(r.details[0]).toBe(
      `no script for ${OTHER_DATE} under qotd-breakdowns/2026-W03/${OTHER_DATE} in the private repo`,
    );
  });

  it("a script Karl did not merge is no_approved_script (the worked examples' approval), checked before anything else about it", async () => {
    // The script also carries a wrong letter: the approval is asked first, so it is never read
    // further (and a build that skipped the approval stops at order_mismatch, not a render).
    const root = treeWith((s) => ({ ...s, correct_display_letter: "B" }));
    const r = await buildUntilRefused(SCRIPT_DATE, root, async () => ({
      ok: false,
      reason: "pull request #9 was merged by someone, not the approver",
    }));
    expect(r.code).toBe("no_approved_script");
    expect(r.details).toEqual([
      `${SCRIPT_DIR}: pull request #9 was merged by someone, not the approver`,
    ]);
  });

  it("the fixture script passes every rule on the day as served: H1-H6, S1, S2, the trap opener", async () => {
    const q = accepted(await archiveDay(SCRIPT_DATE));
    expect(scriptProblems(fixtureScript(), q)).toEqual([]);
  });

  it("a setup that reads the question aloud is content_rules (S1), before anything is voiced", async () => {
    const root = treeWith((s) => ({
      ...s,
      question_voice: "If 4x - 7 = 21, what is the value of x?",
    }));
    const r = await buildUntilRefused(SCRIPT_DATE, root);
    expect(r.code).toBe("content_rules");
    expect(r.details.join("\n")).toMatch(
      /^S1 reads the screen: spoken question/m,
    );
  });

  it("a script edited after it was voiced is voice_check_failed (the committed voice no longer matches)", async () => {
    const root = treeWith((s) => ({
      ...s,
      answer: { ...s.answer, voice: `${s.answer.voice} Nice.` },
    }));
    const r = await buildUntilRefused(SCRIPT_DATE, root);
    expect(r.code).toBe("voice_check_failed");
    expect(r.details.join("\n")).toContain(
      "voice/answer.wav was voiced from different text than answer now has",
    );
  });

  it("a script voiced in another voice than am_michael is voice_check_failed", async () => {
    expect(QOTD_BREAKDOWN_VOICE_PROFILE).toBe("am_michael");
    expect(loadKit().voice.profiles[QOTD_BREAKDOWN_VOICE_PROFILE]?.engine).toBe(
      "kokoro",
    );
    const root = treeWith((s) => s);
    const file = join(root, SCRIPT_DIR, "voice", "manifest.json");
    const manifest: unknown = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(
      file,
      JSON.stringify({ ...(manifest as object), voice: "af_heart" }),
    );
    const r = await buildUntilRefused(SCRIPT_DATE, root);
    expect(r.code).toBe("voice_check_failed");
    expect(r.details[0]).toBe("voiced in af_heart, not am_michael");
  });

  it("the script's spoken fields are the worked examples' own schemas (picked, not re-declared)", () => {
    const we = workedExampleContentSchema.shape;
    const bd = qotdBreakdownScriptSchema.shape;
    expect(bd.steps).toBe(we.steps);
    expect(bd.question_voice).toBe(we.question_voice);
    // A notepad line over the worked examples' 32 characters is refused here too.
    const s = fixtureScript();
    expect(
      qotdBreakdownScriptSchema.safeParse({
        ...s,
        answer: { ...s.answer, notepad: "x".repeat(33) },
      }).success,
    ).toBe(false);
    // The order is four distinct canonical keys.
    expect(
      qotdBreakdownScriptSchema.safeParse({
        ...s,
        option_order: ["A", "A", "C", "D"],
      }).success,
    ).toBe(false);
  });
});

describe("the authoring check (check-breakdown-scripts.ts)", () => {
  const kit = loadKit();

  it("a malformed script for one day is that day's problem, not every day's", () => {
    const root = mkdtempSync(join(tmpdir(), "qotd-breakdown-bad-"));
    cpSync(CONTENT, root, { recursive: true });
    const badDir = join(root, SCRIPT_DIR, "..", OTHER_DATE);
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, "script.json"), "{ not json");
    const loaded = loadBreakdownScripts(root);
    // Presence first: the good day still loads.
    expect(loaded.scripts.map((e) => e.script.qotd_date)).toEqual([
      SCRIPT_DATE,
    ]);
    expect(loaded.problems).toHaveLength(1);
    expect(loaded.problems[0]).toMatch(
      new RegExp(`${OTHER_DATE}/script\\.json: not valid JSON`),
    );
  });

  it("the fixture tree passes, without and with Karl's export", () => {
    expect(loadBreakdownScripts(CONTENT).scripts.length).toBe(1);
    expect(checkBreakdownScripts(CONTENT, null, seedFromRows, kit)).toEqual([]);
    expect(
      checkBreakdownScripts(CONTENT, exportFor(SCRIPT_DATE), seedFromRows, kit),
    ).toEqual([]);
  });

  it("a script that differs from the export is named by field only (the export holds future answers)", () => {
    const row = syntheticRow(SCRIPT_DATE);
    const moved = qotdBreakdownScheduleSchema.parse([
      {
        qotd_date: SCRIPT_DATE,
        question_id: "SATM1SYNTH9",
        option_order: ["D", "C", "B", "A"],
        correct_display_letter: "D",
        section: "RW",
      },
    ]);
    const problems = checkBreakdownScripts(CONTENT, moved, seedFromRows, kit);
    expect(problems).toEqual([
      `${SCRIPT_DIR}: question_id differs from the schedule export`,
      `${SCRIPT_DIR}: option_order differs from the schedule export`,
      `${SCRIPT_DIR}: correct_display_letter differs from the schedule export`,
      `${SCRIPT_DIR}: the schedule export's section is not the question's`,
    ]);
    // No value of the export in any message.
    for (const p of problems) {
      expect(p).not.toMatch(/SATM1SYNTH9|DCBA|D,C,B,A/);
      expect(p.replace(SCRIPT_DIR, "")).not.toMatch(/\b[A-D]\b/);
    }
    expect(row.option_order.join(",")).not.toBe("D,C,B,A");
    expect(
      checkBreakdownScripts(CONTENT, exportFor(OTHER_DATE), seedFromRows, kit),
    ).toEqual([
      `${SCRIPT_DIR}: the schedule export has no row for ${SCRIPT_DATE}`,
    ]);
  });

  it("without the export, a letter that is not where the question's key lands under the order is refused", () => {
    const root = treeWith((s) => ({ ...s, correct_display_letter: "B" }));
    expect(checkBreakdownScripts(root, null, seedFromRows, kit)).toEqual([
      `${SCRIPT_DIR}: the option_order and correct_display_letter do not fit the question (not a permutation of its choices, or the letter is not where its key lands)`,
    ]);
  });

  it("the committed voice: am_michael, and every line voiced from the text it has now", () => {
    const entry = loadBreakdownScripts(CONTENT).scripts[0];
    if (!entry) throw new Error("no fixture script");
    const ok = breakdownVoice(CONTENT, entry, kit);
    expect(ok.lines.map((l) => l.key)).toEqual([
      "hook",
      "question",
      "step-1",
      "step-2",
      "step-3",
      "step-4",
      "trap",
      "answer",
    ]);
    expect(ok.problems).toEqual([]);
    const edited = breakdownVoice(
      CONTENT,
      {
        ...entry,
        script: {
          ...entry.script,
          trap: {
            ...entry.script.trap,
            voice: `${entry.script.trap.voice} Yes.`,
          },
        },
      },
      kit,
    );
    expect(edited.problems).toContain(
      "voice/trap.wav was voiced from different text than trap now has: re-voice it",
    );
    const root = treeWith((s) => s);
    const file = join(root, SCRIPT_DIR, "voice", "manifest.json");
    const manifest: unknown = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(
      file,
      JSON.stringify({ ...(manifest as object), voice: "af_heart" }),
    );
    expect(breakdownVoice(root, entry, kit).problems).toEqual([
      "voiced in af_heart, not am_michael",
    ]);
  });

  it("runs the worked examples' S1 and voice checks", () => {
    const root = treeWith((s) => ({
      ...s,
      question_voice: "If 4x - 7 = 21, what is the value of x?",
    }));
    const problems = checkBreakdownScripts(root, null, seedFromRows, kit);
    expect(problems.some((p) => p.includes("S1 reads the screen"))).toBe(true);
    expect(
      problems.some((p) =>
        p.includes("voice/question.wav was voiced from different text"),
      ),
    ).toBe(true);
  });

  it("a script whose question is not Hard is refused (Karl, 2026-11-05: breakdowns use Hard questions only)", () => {
    const root = treeWith((s) => s);
    // Presence first: the synthetic scripted day is Hard and passes.
    const asked = seedFromRows(SCRIPT_QUESTION_ID);
    if (!asked.ok) throw new Error(asked.problem);
    expect(asked.question.difficulty).toBe(3);
    expect(checkBreakdownScripts(root, null, seedFromRows, kit)).toEqual([]);
    const medium: SeedLookup = (id) => {
      const r = seedFromRows(id);
      return r.ok
        ? { ok: true, question: { ...r.question, difficulty: 2 } }
        : r;
    };
    expect(checkBreakdownScripts(root, null, medium, kit).join("\n")).toContain(
      `${SCRIPT_QUESTION_ID} is difficulty 2, not Hard (3)`,
    );
  });

  it("anything but script.json and voice/ in a day's folder is refused (an export dropped there, say)", () => {
    const root = treeWith((s) => s);
    writeFileSync(join(root, SCRIPT_DIR, "schedule.json"), "[]");
    expect(checkBreakdownScripts(root, null, seedFromRows, kit)).toEqual([
      `${SCRIPT_DIR}/schedule.json: only script.json and voice/ belong here`,
    ]);
  });

  it("refuses to read the export from inside a checkout", () => {
    const inside = join(SYNTHETIC, "rows.json");
    expect(() => readScheduleExport(inside, CONTENT)).toThrow(
      /keep it outside every checkout \(it holds future answers\)/,
    );
    const outside = join(mkdtempSync(join(tmpdir(), "qotd-export-")), "x.json");
    writeFileSync(outside, JSON.stringify(exportFor(SCRIPT_DATE)));
    expect(readScheduleExport(outside, CONTENT)).toEqual(
      exportFor(SCRIPT_DATE),
    );
  });

  it("the export's shape: a grid-in day has no order and no letter; one row a day, in order", () => {
    expect(
      qotdBreakdownScheduleSchema.safeParse([
        {
          qotd_date: "2026-11-09",
          question_id: "SATM2SYNTH1",
          option_order: [],
          correct_display_letter: null,
          section: "M",
        },
      ]).success,
    ).toBe(true);
    const row = exportFor(SCRIPT_DATE)[0];
    expect(qotdBreakdownScheduleSchema.safeParse([row, row]).success).toBe(
      false,
    );
    expect(
      qotdBreakdownScheduleSchema.safeParse([
        { ...row, correct_display_letter: null },
      ]).success,
    ).toBe(false);
  });

  it("scheduledDay letters the seed question exactly as the archive serves the day", async () => {
    const seed = seedFromRows("SATM1SYNTH1");
    if (!seed.ok) throw new Error(seed.problem);
    const row = syntheticRow(SCRIPT_DATE);
    const built = scheduledDay(
      seed.question satisfies SeedQuestion,
      SCRIPT_DATE,
      row.option_order,
      row.correct_display_letter ?? "",
    );
    if (!built.ok) throw new Error(built.problem);
    expect(accepted(built.day)).toEqual(
      accepted(await archiveDay(SCRIPT_DATE)),
    );
  });
});

describe("anti-leak: only a day whose answer is public", () => {
  it("today's QOTD is refused; tonight's run breaks down yesterday", () => {
    // 04:05 UTC on 2026-10-04: the QOTD day is 2026-10-04 (04:00 UTC to 04:00 UTC).
    const now = new Date("2026-10-04T04:05:00Z");
    const today = breakdownDay("2026-10-04", now);
    expect(today.ok).toBe(false);
    if (!today.ok) expect(today.problem).toContain("has not passed yet");
    expect(breakdownDay("2026-10-05", now).ok).toBe(false);
    expect(breakdownDay(null, now)).toEqual({
      ok: true,
      date: "2026-10-03",
      postedOn: "2026-10-04",
    });
    // At 03:59 UTC the 2026-10-03 QOTD is still today: refused.
    expect(
      breakdownDay("2026-10-03", new Date("2026-10-04T03:59:00Z")).ok,
    ).toBe(false);
  });

  it("the archive serves no answer for today: the fixture's today is a 404 there (withheld)", async () => {
    const { day } = await loadYesterday(
      BASE,
      nextDay(SYNTHETIC_TODAY),
      fixtureArchiveFetch(ROWS_JSON),
    );
    expect(day).toBeNull();
  });

  it("a manifest is always of the day before it posts", () => {
    expect(
      qotdBreakdownManifestSchema.safeParse({
        status: "skipped",
        qotd_date: "2026-10-04",
        posted_on: "2026-10-04",
        code: "withheld",
      }).success,
    ).toBe(false);
  });
});

describe("the fallback rule", () => {
  it("a grid-in, a long passage, a paired passage", async () => {
    expect(breakdownSkipCode(await archiveDay(GRID_IN_DATE))).toBe("grid_in");
    const day = await archiveDay(RW_DATE);
    expect(breakdownSkipCode(day)).toBeNull();
    const q = day.question;
    expect(
      breakdownSkipCode({
        ...day,
        question: { ...q, passage: "word ".repeat(80) },
      }),
    ).toBe("too_long_to_read");
    expect(
      breakdownSkipCode({
        ...day,
        question: {
          ...q,
          passage: "Text 1 says one thing. Text 2 says another.",
        },
      }),
    ).toBe("paired_passage");
  });

  it("the templated script's codes are gone; no_approved_script is new", () => {
    expect(QOTD_BREAKDOWN_SKIP_CODES).toContain("no_approved_script");
    for (const gone of ["letter_named", "no_explanation", "too_many_steps"])
      expect(QOTD_BREAKDOWN_SKIP_CODES as readonly string[]).not.toContain(
        gone,
      );
  });

  it("every code has a fixed reason, and the notice reads 'Breakdown skipped: <reason> (<code>)'", () => {
    for (const code of QOTD_BREAKDOWN_SKIP_CODES) {
      expect(QOTD_BREAKDOWN_SKIP_REASON[code].length).toBeGreaterThan(0);
      expect(breakdownSkipLine(code)).toBe(
        `Breakdown skipped: ${QOTD_BREAKDOWN_SKIP_REASON[code]} (${code})`,
      );
    }
    expect(breakdownSkipLine("no_approved_script")).toBe(
      "Breakdown skipped: no approved script for the day (no_approved_script)",
    );
  });
});

describe("captions and keywords: SCL-262 through the canonical builders, music credited", () => {
  it("each caption is the canonical builder's output, with no music credit (it is on the end card)", async () => {
    const kit = loadKit();
    const day = await archiveDay(RW_DATE);
    const copy = breakdownCopy(day, nextDay(RW_DATE));
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    const test = nextSatTest(nextDay(RW_DATE));
    const headline = qotdHeadline(test, "Reading and Writing");
    expect(copy.copy.headline).toBe(headline);
    expect(copy.copy.caption).toBe(
      socialTiktokCaption(headline, test, "Reading and Writing"),
    );
    expect(copy.copy.instagram_caption).toBe(
      socialInstagramCaption(headline, test, "Reading and Writing"),
    );
    expect(copy.copy.facebook_caption).toBe(
      socialFacebookCaption(headline, test, "Reading and Writing"),
    );
    // Karl, 2026-11-04: nothing but what Karl pastes in any block (the credit is on the end card).
    expect(kit.track.on_screen_credit).not.toBeNull();
    for (const c of [
      copy.copy.caption,
      copy.copy.instagram_caption,
      copy.copy.facebook_caption,
      copy.copy.keywords.join("\n"),
    ]) {
      expect(c.length).toBeGreaterThan(0);
      expect(copyBlockProblems(c)).toEqual([]);
      expect(c).not.toMatch(/Music:|CC BY/);
    }
    expect(copy.copy.keywords).toContain("SAT grammar");
  });

  it("no caption names the answer", async () => {
    for (const date of SHUFFLED_DAYS) {
      const day = await archiveDay(date);
      const copy = breakdownCopy(day, nextDay(date));
      if (!copy.ok) throw new Error(copy.problems.join("; "));
      const correct = day.question.options.find(
        (o) => o.id === day.question.correct_option_id,
      );
      for (const c of [
        copy.copy.caption,
        copy.copy.instagram_caption,
        copy.copy.facebook_caption,
      ]) {
        expect(c.length).toBeGreaterThan(0);
        expect(c).not.toMatch(
          /\b(?:answer|choice|option)\s+(?:is\s+)?[A-D]\b/i,
        );
        expect(c.toLowerCase()).not.toContain(
          ` ${correct?.text.toLowerCase()} `,
        );
      }
    }
  });
});

describe("the pilot window: 2026-11-09 to 2026-11-22 (Karl, 2026-11-02), held (Karl, 2026-11-03)", () => {
  it("held: the live window is off, so nothing builds or posts on any of the ruled days", () => {
    expect(QOTD_BREAKDOWN_PILOT).toEqual({ start: null, end: null });
    for (const day of ["2026-11-08", "2026-11-09", "2026-11-15", "2026-11-22"])
      expect(pilotWindow(QOTD_BREAKDOWN_PILOT, day, false)).toBe("off");
    // An inactive manifest posts nothing (no "no approved script" notice).
    expect(
      breakdownPlan(
        qotdBreakdownManifestSchema.parse({
          status: "inactive",
          qotd_date: "2026-11-08",
          posted_on: "2026-11-09",
          window: "off",
        }),
        () => true,
      ).kind,
    ).toBe("nothing");
  });

  it("is set to Karl's dates, posting days, 14 inclusive", () => {
    const QOTD_BREAKDOWN_PILOT = QOTD_BREAKDOWN_PILOT_RULED;
    expect(QOTD_BREAKDOWN_PILOT).toEqual({
      start: "2026-11-09",
      end: "2026-11-22",
    });
    expect(pilotWindow(QOTD_BREAKDOWN_PILOT, "2026-11-08", false)).toBe(
      "not_started",
    );
    expect(pilotWindow(QOTD_BREAKDOWN_PILOT, "2026-11-09", false)).toBe(
      "active",
    );
    expect(pilotWindow(QOTD_BREAKDOWN_PILOT, "2026-11-22", false)).toBe(
      "active",
    );
    expect(pilotWindow(QOTD_BREAKDOWN_PILOT, "2026-11-23", false)).toBe(
      "ended",
    );
    expect(pilotWindow(QOTD_BREAKDOWN_PILOT, "2026-11-15", true)).toBe(
      "paused",
    );
  });

  it("off with no dates; refuses one date alone, an end before the start, or more than 14 days", () => {
    const off = qotdBreakdownPilotSchema.parse({ start: null, end: null });
    expect(pilotWindow(off, "2026-11-10", false)).toBe("off");
    for (const bad of [
      { start: "2026-11-05", end: null },
      { start: "2026-11-05", end: "2026-11-04" },
      { start: "2026-11-05", end: "2026-11-19" },
    ])
      expect(
        qotdBreakdownPilotSchema.safeParse(bad).success,
        JSON.stringify(bad),
      ).toBe(false);
  });
});

describe("the post: the video, or the answer slide and the notice; nothing outside the window", () => {
  const built = qotdBreakdownManifestSchema.parse({
    status: "built",
    qotd_date: "2026-01-14",
    posted_on: "2026-01-15",
    section: "M",
    video: "qotd-2026-01-14-breakdown.mp4",
    label: "QOTD breakdown · 2026-01-14 · Math",
    headline: "H",
    caption: "H\n\nx",
    instagram_caption: "H\n\ny",
    facebook_caption: "H\n\nz",
    keywords: ["SAT"],
    warnings: [],
    option_order: ["C", "A", "B", "D"],
    display_letter: "C",
    question_id: "SATM1SYNTH1",
    duration_seconds: 46,
    approval: {
      pr: 7,
      mergedBy: "karl",
      mergeSha: "a".repeat(40),
      mergedAt: "2026-10-01T12:00:00Z",
    },
  });

  it("built: the video first, then the SCL-262 copy blocks; outside them only the platform headers", () => {
    const plan = breakdownPlan(built, () => false);
    expect(plan.kind).toBe("video");
    if (plan.kind !== "video") return;
    expect(plan.steps.map((s) => s.kind)).toEqual([
      "video",
      "message",
      "message",
      "message",
    ]);
    const first = plan.steps[0];
    expect(first?.kind === "video" && first.comment).toBe("*TikTok*");
    for (const step of plan.steps.slice(1))
      if (step.kind === "message")
        expect(step.text.replace(/```[\s\S]*?```/g, "").trim()).toMatch(
          /^(\*Instagram\*|\*Facebook\*|)$/,
        );
  });

  it("skipped: yesterday's answer slide with 'Breakdown skipped: <reason>', or the notice alone", () => {
    const skipped = qotdBreakdownManifestSchema.parse({
      status: "skipped",
      qotd_date: "2026-10-03",
      posted_on: "2026-10-04",
      code: "no_approved_script",
    });
    const withSlide = breakdownPlan(
      skipped,
      (f) => f === "qotd-2026-10-03-tiktok-3.png",
    );
    expect(withSlide.kind === "fallback" && withSlide.slide).toBe(
      "qotd-2026-10-03-tiktok-3.png",
    );
    expect(withSlide.kind === "fallback" && withSlide.text).toContain(
      breakdownSkipLine("no_approved_script"),
    );
    const without = breakdownPlan(skipped, () => false);
    expect(without.kind === "fallback" && without.slide).toBeNull();
    const crashed = breakdownPlan(null, () => true);
    expect(crashed.kind === "fallback" && crashed.text).toContain(
      "(build_failed)",
    );
  });

  it("inactive: nothing is posted", () => {
    const inactive = qotdBreakdownManifestSchema.parse({
      status: "inactive",
      qotd_date: "2026-11-22",
      posted_on: "2026-11-23",
      window: "ended",
    });
    expect(breakdownPlan(inactive, () => true)).toEqual({
      kind: "nothing",
      note: "pilot ended",
    });
  });
});

type Step = {
  name: string;
  if?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
  with?: Record<string, string | number>;
  "continue-on-error"?: boolean;
};
type Job = {
  needs?: string;
  if?: string;
  environment?: string;
  permissions?: Record<string, string>;
  steps: Step[];
  outputs?: Record<string, string>;
};

describe("the workflow: after the QOTD, never blocking it; the approved script, no voicing", () => {
  const wf = readFileSync(
    resolve(ROOT, ".github/workflows/qotd-social.yml"),
    "utf8",
  );
  const doc = parseYaml(wf) as { jobs: { assets: Job; breakdown: Job } };
  const job = doc.jobs.breakdown;
  const names = job.steps.map((s) => s.name);

  it("runs after the QOTD job, whatever its result, as its own job", () => {
    expect(job.needs).toBe("assets");
    expect(job.if).toBe("always()");
    expect(doc.jobs.assets.outputs?.date).toBe("${{ steps.day.outputs.date }}");
    // Nothing of the breakdown is in the QOTD job.
    expect(JSON.stringify(doc.jobs.assets)).not.toContain("breakdown");
  });

  it("secrets: the Slack token only in the post, which posts only inside the window; the private repo's token only in its checkout and the build", () => {
    const post = job.steps.find((s) => s.name === "Breakdown Slack post");
    expect(post?.if).toBe(
      "always() && github.event_name != 'pull_request' && steps.window.outputs.window == 'active'",
    );
    expect(post?.env).toEqual({
      SLACK_BOT_TOKEN: "${{ secrets.SLACK_BOT_TOKEN }}",
      SLACK_CHANNEL_ID:
        "${{ inputs.slack_channel || vars.SOCIAL_SLACK_CHANNEL_ID }}",
    });
    const checkout = job.steps.find(
      (s) =>
        s.name ===
        "Checkout the private repo (yesterday's folder only, read-only token)",
    );
    const build = job.steps.find((s) => s.name === "Build the breakdown");
    // Presence first: each of the three steps is there.
    expect([post, checkout, build].every((s) => s !== undefined)).toBe(true);
    for (const step of job.steps) {
      const text = JSON.stringify(step);
      expect(text.includes("secrets.SLACK_BOT_TOKEN"), step.name).toBe(
        step === post,
      );
      expect(text.includes("secrets.CONTENT_PRIVATE_TOKEN"), step.name).toBe(
        step === checkout || step === build,
      );
      expect(
        text.replace(/secrets\.(SLACK_BOT_TOKEN|CONTENT_PRIVATE_TOKEN)/g, ""),
        step.name,
      ).not.toContain("secrets.");
    }
  });

  it("the private repo's token lives in the qotd-breakdown environment, which pull requests never enter", () => {
    expect(job.environment).toBe(
      "${{ github.event_name != 'pull_request' && 'qotd-breakdown' || '' }}",
    );
    // This job's own token only reads this repository; the approval is read with the private one.
    expect(job.permissions).toEqual({ contents: "read" });
    expect(JSON.stringify(job)).not.toContain("github.token");
  });

  it("checks out yesterday's folder only from the private repo: sparse, no other day's file content, no credentials kept", () => {
    const target = job.steps.find(
      (s) => s.name === "Yesterday's script folder",
    );
    expect(target?.if).toBe(
      "github.event_name != 'pull_request' && steps.window.outputs.window == 'active'",
    );
    expect(target?.run).toContain("breakdown.ts target");
    const checkout = job.steps.find(
      (s) =>
        s.name ===
        "Checkout the private repo (yesterday's folder only, read-only token)",
    );
    expect(checkout?.if).toBe(target?.if);
    expect(checkout?.uses).toBe("actions/checkout@v4");
    expect(checkout?.with).toEqual({
      repository: "Lyceon-Team/lyceon-content-private",
      ref: "main",
      token: "${{ secrets.CONTENT_PRIVATE_TOKEN }}",
      path: "content-private",
      "fetch-depth": 0,
      filter: "blob:none",
      "sparse-checkout": "${{ steps.target.outputs.dir }}",
      "sparse-checkout-cone-mode": false,
      "persist-credentials": false,
    });
    expect(names.indexOf("Yesterday's script folder")).toBeLessThan(
      names.indexOf(
        "Checkout the private repo (yesterday's folder only, read-only token)",
      ),
    );
    expect(wf).not.toContain("ref: social");
    const build = job.steps.find((s) => s.name === "Build the breakdown");
    expect(build?.run).toContain(
      "breakdown.ts build --content content-private --out",
    );
    expect(build?.env?.CONTENT_PRIVATE_TOKEN).toBe(
      "${{ secrets.CONTENT_PRIVATE_TOKEN }}",
    );
    expect(build?.env?.CONTENT_APPROVER_LOGIN).toBe(
      "${{ vars.CONTENT_APPROVER_LOGIN }}",
    );
  });

  it("the target is yesterday's folder: the day the build breaks down, in its ISO week", () => {
    const now = new Date("2026-11-10T04:05:00Z");
    const day = breakdownDay(null, now);
    expect(day).toEqual({
      ok: true,
      date: "2026-11-09",
      postedOn: "2026-11-10",
    });
    expect(breakdownScriptDir("2026-11-09")).toBe(
      "qotd-breakdowns/2026-W46/2026-11-09",
    );
    expect(QOTD_BREAKDOWN_CONTENT_REPO).toBe(
      "Lyceon-Team/lyceon-content-private",
    );
    expect(QOTD_BREAKDOWN_CONTENT_BRANCH).toBe("main");
  });

  it("pull requests: a dry run on the synthetic rows and the synthetic script tree, the MP4 uploaded, nothing sent", () => {
    const build = job.steps.find((s) => s.name === "Build the breakdown");
    expect(build?.run).toMatch(
      /--content tests\/fixtures\/qotd-breakdowns-synthetic\/content \\\s+--fixture tests\/fixtures\/qotd-breakdowns-synthetic\/rows\.json \\\s+--date 2026-01-14 --now 2026-01-15T04:05:00Z --dry-run/,
    );
    const dry = job.steps.find(
      (s) => s.name === "Breakdown Slack post (dry run)",
    );
    expect(dry?.if).toBe("always() && github.event_name == 'pull_request'");
    expect(dry?.run).toContain("--dry-run");
    expect(dry?.env).toBeUndefined();
    const upload = job.steps.find(
      (s) => s.name === "Upload the breakdown video",
    );
    expect(upload?.uses).toBe("actions/upload-artifact@v4");
    expect(String(upload?.with?.path)).toContain("*.mp4");
    expect(names.indexOf("Upload the breakdown video")).toBeLessThan(
      names.indexOf("Breakdown Slack post"),
    );
  });

  it("no voicing at render: no Python, no pip, no voice models, no clone", () => {
    for (const step of job.steps) {
      expect(step.uses ?? "", step.name).not.toContain("setup-python");
      expect(step.run ?? "", step.name).not.toMatch(/\bpip3? install|\btts\b/);
    }
    expect(wf).not.toMatch(
      /openvoice|clone_line|WE_VOICE_REFERENCE|HYPERFRAMES_PYTHON/i,
    );
  });

  it("no workflow here reads breakdown scripts from social (they live in the private repo)", () => {
    expect(
      existsSync(resolve(ROOT, ".github/workflows/qotd-breakdown-checks.yml")),
    ).toBe(false);
    expect(wf).not.toContain("content/qotd-breakdowns");
  });
});

describe("the fixture is the archive's shape, through the real projection", () => {
  it("every synthetic row reaches the breakdown through the real projection", async () => {
    expect(SYNTHETIC_ROWS.archive.length).toBeGreaterThanOrEqual(4);
    for (const row of SYNTHETIC_ROWS.archive) {
      const day = await archiveDay(row.qotd_date);
      expect(day.qotd_date).toBe(row.qotd_date);
      if (row.item_type === "mcq")
        expect(day.question.correct_letter).toBe(row.correct_display_letter);
    }
  });

  it("real qotd_archive() rows (the shared QOTD fixture) reach it through the same path", async () => {
    const realRows: unknown = JSON.parse(
      readFileSync(resolve(ROOT, "tests/fixtures/qotd/rows.json"), "utf8"),
    );
    expect(QOTD_ARCHIVE_ROWS.length).toBeGreaterThanOrEqual(3);
    for (const row of QOTD_ARCHIVE_ROWS) {
      const { day } = await loadYesterday(
        BASE,
        nextDay(row.qotd_date),
        fixtureArchiveFetch(realRows),
      );
      expect(day?.qotd_date).toBe(row.qotd_date);
      if (row.item_type === "mcq") {
        if (!day) throw new Error(`${row.qotd_date} not served`);
        expect(accepted(day).correct_answer).toBe(row.correct_display_letter);
      }
    }
  });

  it("every synthetic question id is in the SYNTH namespace the content gate allows", () => {
    for (const row of [...SYNTHETIC_ROWS.archive, ...SYNTHETIC_ROWS.today])
      expect(row.question_id).toMatch(SYNTHETIC_QUESTION_ID);
    expect(fixtureScript().question_id).toMatch(SYNTHETIC_QUESTION_ID);
  });
});

describe("the approval: Karl's merge into the private repo's main, read with its own token", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A real git repo with one commit touching the script folder: what the sparse checkout holds. */
  function privateCheckout(): { root: string; sha: string } {
    const root = mkdtempSync(join(tmpdir(), "content-private-"));
    const git = (...args: string[]): string =>
      execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "test");
    cpSync(join(CONTENT, SCRIPT_DIR), join(root, SCRIPT_DIR), {
      recursive: true,
    });
    git("add", "-A");
    git("commit", "-q", "-m", "W03 scripts");
    return { root, sha: git("rev-parse", "HEAD") };
  }

  /** GitHub's record: the commit is the merge of #12, merged into `base` by `login`. */
  function stubGitHub(sha: string, base: string, login: string): string[] {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      async (url: string, init?: { headers?: Record<string, string> }) => {
        urls.push(`${url} ${init?.headers?.authorization ?? ""}`);
        const body = url.endsWith(`commits/${sha}/pulls`)
          ? [{ number: 12, merge_commit_sha: sha }]
          : {
              number: 12,
              merged_at: "2026-11-07T12:00:00Z",
              merge_commit_sha: sha,
              merged_by: { login },
              base: { ref: base },
            };
        return new Response(JSON.stringify(body), { status: 200 });
      },
    );
    return urls;
  }

  it("approved when the record shows the approver merged it into the private repo's main", async () => {
    const { root, sha } = privateCheckout();
    const urls = stubGitHub(sha, "main", "karl");
    const approve = scriptApproval(root, false, {
      CONTENT_PRIVATE_TOKEN: "t0ken",
      CONTENT_APPROVER_LOGIN: "karl",
    });
    expect(await approve(SCRIPT_DIR)).toEqual({
      ok: true,
      approval: {
        pr: 12,
        mergedBy: "karl",
        mergeSha: sha,
        mergedAt: "2026-11-07T12:00:00Z",
      },
    });
    // The record is the PRIVATE repo's, read with its own token, never this repo's.
    expect(urls).toEqual([
      `https://api.github.com/repos/Lyceon-Team/lyceon-content-private/commits/${sha}/pulls Bearer t0ken`,
      "https://api.github.com/repos/Lyceon-Team/lyceon-content-private/pulls/12 Bearer t0ken",
    ]);
  });

  it("refused when merged into another branch, by someone else, or with no private token", async () => {
    const { root, sha } = privateCheckout();
    stubGitHub(sha, "social", "karl");
    const env = {
      CONTENT_PRIVATE_TOKEN: "t0ken",
      CONTENT_APPROVER_LOGIN: "karl",
    };
    expect(await scriptApproval(root, false, env)(SCRIPT_DIR)).toEqual({
      ok: false,
      reason: "pull request #12 was merged into social, not main",
    });
    stubGitHub(sha, "main", "someone");
    expect(await scriptApproval(root, false, env)(SCRIPT_DIR)).toEqual({
      ok: false,
      reason: "pull request #12 was merged by someone, not the approver",
    });
    // This repository's token is not a substitute for the private one.
    expect(
      await scriptApproval(root, false, {
        GITHUB_TOKEN: "repo-token",
        GITHUB_REPOSITORY: "Lyceon-Team/Lyceonai",
        CONTENT_APPROVER_LOGIN: "karl",
      })(SCRIPT_DIR),
    ).toEqual({ ok: false, reason: "CONTENT_PRIVATE_TOKEN is not set" });
  });
});

describe("the finished mix: limited to at most -1 dBTP before the MP4 check (SCL-270)", () => {
  // A real round trip through ffmpeg, as the worked examples' limiter test does. Needs ffmpeg (the
  // breakdown job, the qotd pull-request job and the mutation harness have it; the fast lane may
  // not), so it is skipped only where ffmpeg is absent.
  const HAVE_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;

  /** An MP4 the kit's checks accept in every way but its mix: a hot tone with intersample peaks. */
  function hotRender(): { dir: string; rendered: string } {
    const dir = mkdtempSync(join(tmpdir(), "qotd-breakdown-mix-"));
    const duration = 31;
    writeFileSync(join(dir, "meta.json"), JSON.stringify({ duration }));
    const rendered = join(dir, "render.mp4");
    const tone = "0.99*sin(2*PI*12000*t+PI/4)";
    const make = spawnSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=white:s=1080x1920:r=1:d=${duration}`,
        "-f",
        "lavfi",
        "-i",
        `aevalsrc=${tone}|${tone}:s=48000:d=${duration}`,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        rendered,
      ],
      { encoding: "utf8" },
    );
    if (make.status !== 0) throw new Error(make.stderr);
    return { dir, rendered };
  }

  it.skipIf(!HAVE_FFMPEG)(
    "the video is the limited mix: at most -1 dBTP, and the MP4 check passes",
    () => {
      const kit = loadKit();
      const { dir, rendered } = hotRender();
      // Presence first: as rendered, the mix is over the ceiling.
      expect(measureMix(rendered, kit)?.truePeakDbtp).toBeGreaterThan(-1);
      const video = join(dir, "video.mp4");
      const done = finishVideo(rendered, video, dir, kit);
      expect(done.ok ? [] : done.problems).toEqual([]);
      expect(measureMix(video, kit)?.truePeakDbtp).toBeLessThanOrEqual(-1);
    },
    120_000,
  );

  it.skipIf(!HAVE_FFMPEG)(
    "a mix the limiter did not bring down is refused by the finished-mix check",
    () => {
      const kit = loadKit();
      const { dir, rendered } = hotRender();
      const video = join(dir, "video.mp4");
      const done = finishVideo(rendered, video, dir, kit, (input, output) =>
        cpSync(input, output),
      );
      expect(done.ok).toBe(false);
      if (!done.ok)
        expect(done.problems.join("\n")).toMatch(
          /the finished mix peaks at -?\d+\.\d\d dBTP; at most -1 dBTP/,
        );
    },
    120_000,
  );
});
