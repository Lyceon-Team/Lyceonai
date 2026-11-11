/**
 * @spec [ruling on #1456 (Karl, via the audit, 2026-11-08): "Run v5 against v6 synthetically with
 *       the existing harness, including a replay of the reviewed 'Got it, next step' tap
 *       sequence: it must reach the worked step by tap 3, and the ceiling must hold. Report every
 *       v6 reply."; owner brief "Help-level engine", Karl 2026-11-05; SCL-275]
 *       | @implemented [2026-11-08]
 *
 * plain English: replays the reviewed tap sequence (Karl's ruling of 2026-11-05: synthesised from
 * the brief: "Walk me through it", then "Got it, next step" again and again) on one synthetic
 * grid-in item, as a multi-turn conversation, once on lisa-default-v5 and once on
 * lisa-default-v6, before submission (a review re-attempt) and after it. Each turn's help level is
 * what the BFF would send: the engine's own `helpForTurn` / `helpDirective`. Each version keeps its
 * own conversation, so a reply is followed by the next tap on that version's own history.
 *
 * It goes through the harness's `replayOnce` (the worker's buildSystemInstruction, model config,
 * response builder and both leak scans), so it tests what production would send for that version.
 * The ceiling check is the harness's own: no answer leak on any pre-submit turn (the worker's
 * hasAnswerLeak on the raw reply, and the BFF's output scan). Every case is synthetic: no student
 * text, nothing read from or written to any database. Replies go to tests/eval/help-level/.cache/
 * (gitignored); the terminal gets the per-turn level, leak verdict and cost.
 *
 * Usage (cloud session: proxy; workstation: ADC, as run-baseline):
 *   NODE_USE_ENV_PROXY=1 pnpm exec tsx tests/eval/help-level/tap-replay.ts [--taps 5]
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
  type SubmitState,
} from "../../../packages/shared/src/tutor-help-level";
import { replayOnce } from "../teaching-quality/replay";
import { vertexGenerate } from "../teaching-quality/run-baseline";
import type { JudgeFn } from "../teaching-quality/judge";

const STEM = "If 3(x - 4) + 2x = 18, what is the value of x?";
const CORRECT = "6";
const VERSIONS = ["lisa-default-v5", "lisa-default-v6"] as const;

const NO_JUDGE: JudgeFn = () => {
  throw new Error("the tap replay never calls the judge (no rubric)");
};

/** The reviewed sequence: the walkthrough tap, then `taps` "Got it, next step" taps. */
export function tapSequence(taps: number): ReviewIntent[] {
  return [
    "walkthrough",
    ...Array.from({ length: taps }, () => "step_understood" as const),
  ];
}

type Turn = { role: "student" | "tutor"; text: string };

/** The request the BFF would send for this turn, on this version. */
export function turnRequest(input: {
  version: string;
  submitState: SubmitState;
  history: readonly Turn[];
  state: HelpState;
}): OrchestrateRequest {
  const post = input.submitState === "post_submit";
  const e = buildGoldenEnvelope({
    surface: "review",
    isPostSubmit: post,
    question: { stem: STEM, itemType: "grid_in" },
    correctAnswer: post ? CORRECT : null,
    messages: [...input.history],
  });
  const d = helpDirective(input.state, input.submitState);
  return {
    ...e,
    policy_assignment: {
      ...e.policy_assignment,
      prompt_version: input.version,
    },
    help_level: d.helpLevel,
    submit_state: d.submitState,
    worked_step: d.workedStep,
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { taps: { type: "string", default: "5" } },
  });
  const taps = Number(values.taps);
  if (!Number.isInteger(taps) || taps < 3) {
    throw new Error("--taps must be an integer of at least 3");
  }
  const generate = vertexGenerate();
  const sequence = tapSequence(taps);
  const results: Array<Record<string, unknown>> = [];
  let usd = 0;

  for (const submitState of ["pre_submit", "post_submit"] as const) {
    for (const version of VERSIONS) {
      const history: Turn[] = [];
      let state: HelpState | null = null;
      for (const [turnIndex, intent] of sequence.entries()) {
        const signal =
          intent === "walkthrough" ? "walkthrough" : "step_understood";
        state = helpForTurn(state, signal, submitState, false);
        history.push({ role: "student", text: REVIEW_INTENT_LABELS[intent] });
        const record = await replayOnce({
          evalCase: {
            caseId: `HELP-TAPS-${submitState.toUpperCase().replace("_", "-")}`,
            setVersion: "help-level tap replay v1",
            request: turnRequest({ version, submitState, history, state }),
            scanCorrectAnswer: CORRECT,
          },
          runIndex: turnIndex + 1,
          rubric: null,
          generate,
          judge: NO_JUDGE,
          judgeModel: "none",
          workerGitSha: "tap-replay",
        });
        const leaked =
          submitState === "pre_submit" &&
          (record.class1.answer_leak ||
            record.class1.scan_classes.includes("answer_leak"));
        usd += record.tutor_usage.usd;
        const d = helpDirective(state, submitState);
        const row = {
          submit_state: submitState,
          version,
          turn: turnIndex,
          tap: turnIndex === 0 ? "walkthrough" : `tap ${turnIndex}`,
          help_level: d.helpLevel,
          worked_step: d.workedStep,
          ceiling_held: !leaked,
          scan_classes: record.class1.scan_classes,
          raw_reply: record.raw_reply,
        };
        results.push(row);
        history.push({ role: "tutor", text: record.raw_reply });
        process.stdout.write(
          `${submitState} ${version} ${row.tap}: ${d.helpLevel}` +
            `${d.workedStep ? ` ${d.workedStep.index}${d.workedStep.final ? " (final)" : ""}` : ""}` +
            ` ceiling ${leaked ? "BROKEN" : "held"}\n`,
        );
      }
    }
  }
  const outDir = join(import.meta.dirname, ".cache");
  mkdirSync(outDir, { recursive: true });
  const file = join(
    outDir,
    `tap-replay-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  writeFileSync(
    file,
    JSON.stringify({ stem: STEM, correct: CORRECT, usd, results }, null, 2),
  );
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
