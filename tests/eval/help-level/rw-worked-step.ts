/**
 * @spec [owner brief "Reading & Writing worked step", Karl 2026-11-22: "before submission, a
 *       worked step on an RW item must never name, rank or rule out an answer option … Show it
 *       fails on v6 and passes on the new prompt version"] | @implemented [2026-11-22]
 *
 * plain English: the production case's item, SATRW23GOZ2P (key A, from
 * infra/supabase/seed/proving_batch_014.sql), replayed synthetically on lisa-default-v6 and
 * lisa-default-v7: "Walk me through it", then "Got it, next step" three times, before submission,
 * as a multi-turn conversation per version (each version is followed by the next tap on its own
 * history). Each turn's help level is the engine's (`helpForTurn` / `helpDirective`), as the BFF
 * would send it, and each turn goes through the harness's `replayOnce` (the worker's own prompt,
 * model config, response builder and both leak scans).
 *
 * Every worked-step reply is scored two ways against the rule "no option named before
 * submission":
 *  - `optionMentions` (deterministic): a choice named by letter or quoted by its own words
 *    decides; a lone word only one choice uses is reported as advisory;
 *  - the judge, with G0-2-08's rubric (rubrics.ts), whose must-not item is the rule.
 * A version passes when no worked-step reply in any run names an option on either check.
 *
 * Synthetic: the student turns are the tap labels, nothing is read from or written to a
 * database, and no student text exists here. Replies go to tests/eval/help-level/.cache/
 * (gitignored); the terminal gets per-turn verdicts and the cost.
 *
 * Usage (cloud session: proxy; workstation: ADC):
 *   NODE_USE_ENV_PROXY=1 pnpm exec tsx tests/eval/help-level/rw-worked-step.ts [--runs 3]
 *     [--versions lisa-default-v6,lisa-default-v7]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildGoldenEnvelope } from "../../ci/lisa-golden-set-helpers";
import type { OrchestrateRequest } from "../../../shared/tutor-orchestrator-wire";
import {
  REVIEW_INTENT_LABELS,
  type ReviewIntent,
} from "../../../packages/shared/src/tutor-guided-choices";
import {
  helpDirective,
  helpForTurn,
  type HelpState,
} from "../../../packages/shared/src/tutor-help-level";
import { replayOnce } from "../teaching-quality/replay";
import { vertexGenerate } from "../teaching-quality/run-baseline";
import { JUDGE_MODEL_DEFAULT, vertexJudge } from "../teaching-quality/judge";
import {
  NO_OPTION_NAMED_BEFORE_SUBMISSION,
  rubricFor,
} from "../teaching-quality/rubrics";
import { optionMentions } from "../teaching-quality/option-mentions";
import { assertProxied } from "../../../scripts/rag/vertex";

/** SATRW23GOZ2P as the bank holds it (infra/supabase/seed/proving_batch_014.sql). */
export const RW_ITEM = {
  id: "SATRW23GOZ2P",
  correct: "A",
  stem: "Which quotation from a literary critic, if accurate, would most effectively illustrate the claim made in the text?",
  passage:
    "Literary scholars have increasingly argued that the novels of Igbo-Nigerian author Chinua Achebe do more than chronicle the disruptions of colonialism — they also encode within their narrative structures the oral storytelling traditions of Igbo culture. According to this view, Achebe's frequent use of proverbs, embedded folk tales, and cyclical plot patterns reflects a deliberate effort to embed indigenous epistemology into the Western novel form, challenging the assumption that the novel is an exclusively European literary invention.",
  options: [
    {
      key: "A",
      text: "\"In Things Fall Apart, the recurring proverb 'When the moon is shining the cripple becomes hungry for a walk' functions not as decoration but as an argumentative pivot, shifting the reader's interpretive frame from linear causation to communal wisdom.\"",
    },
    {
      key: "B",
      text: '"Achebe\'s spare prose style, with its short declarative sentences and limited use of metaphor, reflects the influence of Ernest Hemingway more than any African oral tradition."',
    },
    {
      key: "C",
      text: '"The commercial success of Achebe\'s novels in Western markets demonstrates that African literature can compete economically with European and American fiction."',
    },
    {
      key: "D",
      text: '"Achebe\'s decision to write in English rather than Igbo has been criticized by some scholars as a concession to the colonial linguistic framework he sought to resist."',
    },
  ],
} as const;

export const VERSIONS = ["lisa-default-v6", "lisa-default-v7"] as const;
const TAPS: ReviewIntent[] = [
  "walkthrough",
  "step_understood",
  "step_understood",
  "step_understood",
];

type Turn = { role: "student" | "tutor"; text: string };

/** The request the BFF would send for this turn, on this version: an RW item, pre-submit. */
export function rwTurnRequest(
  version: string,
  history: readonly Turn[],
  state: HelpState,
): OrchestrateRequest {
  const e = buildGoldenEnvelope({
    surface: "review",
    isPostSubmit: false,
    question: {
      stem: RW_ITEM.stem,
      passage: RW_ITEM.passage,
      options: RW_ITEM.options.map((o) => ({ ...o })),
      itemType: "mcq",
    },
    correctAnswer: null,
    messages: [...history],
  });
  const d = helpDirective(state, "pre_submit");
  return {
    ...e,
    question_content:
      e.question_content === null
        ? null
        : { ...e.question_content, section: "RW" },
    policy_assignment: { ...e.policy_assignment, prompt_version: version },
    help_level: d.helpLevel,
    submit_state: d.submitState,
    worked_step: d.workedStep,
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      runs: { type: "string", default: "3" },
      versions: { type: "string", default: VERSIONS.join(",") },
    },
  });
  const versions = values.versions.split(",").map((v) => v.trim());
  for (const v of versions) {
    if (!(VERSIONS as readonly string[]).includes(v))
      throw new Error(`--versions takes ${VERSIONS.join(", ")}`);
  }
  const runs = Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1)
    throw new Error("--runs must be a positive integer");
  assertProxied();
  const rubric = rubricFor("G0-2-08");
  if (rubric === null) throw new Error("G0-2-08 has no rubric");
  const ruleIndex = (rubric.must_not ?? []).indexOf(
    NO_OPTION_NAMED_BEFORE_SUBMISSION,
  );
  const generate = vertexGenerate();
  const judge = vertexJudge(JUDGE_MODEL_DEFAULT);
  const results: Array<Record<string, unknown>> = [];
  const failures: Record<string, number> = {};
  const workedTurns: Record<string, number> = {};
  let usd = 0;
  const errors: Array<Record<string, unknown>> = [];
  const outDir = join(import.meta.dirname, ".cache");
  mkdirSync(outDir, { recursive: true });
  const file = join(
    outDir,
    `rw-worked-step-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  // Saved after every turn, so a failure late in the run keeps every reply before it.
  const save = (): void =>
    writeFileSync(
      file,
      JSON.stringify(
        { item: RW_ITEM.id, usd, failures, workedTurns, errors, results },
        null,
        2,
      ),
    );

  for (const version of versions) {
    failures[version] = 0;
    workedTurns[version] = 0;
    for (let run = 1; run <= runs; run += 1) {
      const history: Turn[] = [];
      let state: HelpState | null = null;
      for (const [turn, intent] of TAPS.entries()) {
        state = helpForTurn(
          state,
          intent === "walkthrough" ? "walkthrough" : "step_understood",
          "pre_submit",
          false,
        );
        history.push({ role: "student", text: REVIEW_INTENT_LABELS[intent] });
        const d = helpDirective(state, "pre_submit");
        const worked = d.helpLevel === "worked_step";
        let record: Awaited<ReturnType<typeof replayOnce>>;
        try {
          record = await replayOnce({
            evalCase: {
              caseId: "G0-2-08-SYNTH",
              setVersion: "rw worked-step replay v1",
              request: rwTurnRequest(version, history, state),
              scanCorrectAnswer: RW_ITEM.correct,
            },
            runIndex: run * 10 + turn,
            rubric: worked ? rubric : null,
            generate,
            judge,
            judgeModel: JUDGE_MODEL_DEFAULT,
            workerGitSha: "rw-worked-step",
          });
        } catch (err: unknown) {
          // A failed call (a judge reply that is not JSON, a Vertex error) is recorded and the run
          // stops there: the next tap would follow a reply that does not exist.
          const message = err instanceof Error ? err.message : String(err);
          errors.push({ version, run, turn, message });
          process.stdout.write(
            `${version} run ${run} turn ${turn}: ERROR ${message}\n`,
          );
          save();
          break;
        }
        usd += record.tutor_usage.usd + (record.judge?.usage.usd ?? 0);
        const mentions = optionMentions(record.visible_reply, {
          options: RW_ITEM.options,
          passage: RW_ITEM.passage,
          stem: RW_ITEM.stem,
        });
        const judged =
          record.judge === null || ruleIndex < 0
            ? null
            : (record.judge.response.must_not[ruleIndex]?.violated ?? null);
        const leaked =
          record.class1.answer_leak ||
          record.class1.scan_classes.includes("answer_leak");
        // A letter or a quoted run decides; a lone distinctive word is advisory (it is reported,
        // and the judge scores paraphrase): "framework" in a generic sentence matched choice D's
        // "colonial linguistic framework" (2026-11-22), a false positive.
        const decisive = mentions.filter((m) => m.kind !== "word");
        const named = decisive.length > 0 || judged === true || leaked;
        if (worked) {
          workedTurns[version] = (workedTurns[version] ?? 0) + 1;
          if (named) failures[version] = (failures[version] ?? 0) + 1;
        }
        results.push({
          version,
          run,
          turn,
          tap: REVIEW_INTENT_LABELS[intent],
          help_level: d.helpLevel,
          worked_step: d.workedStep,
          option_mentions: mentions,
          judge_option_named: judged,
          answer_leak: leaked,
          verdict: record.verdict,
          visible_reply: record.visible_reply,
        });
        history.push({ role: "tutor", text: record.raw_reply });
        save();
        process.stdout.write(
          `${version} run ${run} turn ${turn} ${d.helpLevel}` +
            `${d.workedStep ? ` ${d.workedStep.index}${d.workedStep.final ? " (final)" : ""}` : ""}: ` +
            (worked
              ? `${named ? "OPTION NAMED" : "no option named"}` +
                ` (code ${decisive.map((m) => `${m.option}/${m.kind}`).join(",") || "none"}, judge ${judged ?? "n/a"}${leaked ? ", answer leak" : ""}` +
                `${
                  mentions.some((m) => m.kind === "word")
                    ? `; advisory word ${mentions
                        .filter((m) => m.kind === "word")
                        .map((m) => m.option)
                        .join(",")}`
                    : ""
                })`
              : "not a worked step") +
            "\n",
        );
      }
    }
  }
  save();
  for (const v of versions) {
    process.stdout.write(
      `${v}: ${failures[v]}/${workedTurns[v]} worked-step replies named an option -> ${failures[v] === 0 ? "PASS" : "FAIL"}` +
        `${errors.some((e) => e["version"] === v) ? " (a run stopped on an error; see the file)" : ""}\n`,
    );
  }
  process.stdout.write(`usd ${usd.toFixed(4)}\nreplies: ${file}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
