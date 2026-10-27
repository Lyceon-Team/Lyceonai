#!/usr/bin/env pnpm exec tsx
/**
 * G0-2 baseline: replay every teaching-quality case n times on lisa-default-v3 at thinking
 * budget 1024, and write each run to `tutor_eval_runs`.
 *
 * @spec [Doc-03D_V1.2 §3.2.1, §5.1, §5.3, §8.1;
 *       docs/eval/lisa/G0-2_Teaching_Quality_Set_Design.md §5; Karl's rulings 2026-10-27:
 *       D3 (Gemini Pro judge), D4 (5 runs per case)] | @implemented [2026-10-27]
 *
 * plain English: owner-run. Reads the cases from `tutor_eval_cases` over DATABASE_URL (a
 * service-role or owner connection; the tables have no client access), replays each through
 * `replay.ts`, inserts one `tutor_eval_runs` row per run, then prints per-case counts, the
 * measured cost, and judge-vs-Karl agreement over every graded run in the set.
 *
 * Nothing it prints is conversation text: case ids, verdicts, flags, token counts and USD
 * only. Replies and judge quotes stay in the table (Karl, 2026-10-27; the students are
 * minors).
 *
 * Idempotent per batch: (batch_id, case_id, run_index) is unique, so re-running with the same
 * `--batch` skips the runs already written and only fills the gaps.
 *
 * Usage:
 *   NODE_USE_ENV_PROXY=1 DATABASE_URL=... pnpm exec tsx tests/eval/teaching-quality/run-baseline.ts \
 *     [--runs 5] [--batch <uuid>] [--case G0-2-03] [--judge-model gemini-3.1-pro-preview]
 *     [--prompt-version lisa-default-v3 | lisa-default-v4]
 *
 * Vertex credentials are attached by the egress proxy or ADC; nothing is read from the
 * environment for them.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import pg from "pg";
import { GoogleGenAI, type Content } from "@google/genai";
import { OAuth2Client } from "google-auth-library";
import { orchestrateRequestSchema } from "../../../shared/tutor-orchestrator-wire";
import {
  TEACHING_QUALITY_SET_VERSION,
  tutorEvalAgreement,
  tutorEvalOwnerGradeSchema,
  tutorEvalVerdictSchema,
} from "../../../packages/shared/src/tutor-eval-schema";
import { PROJECT, assertProxied } from "../../../scripts/rag/vertex";
import { JUDGE_MODEL_DEFAULT, vertexJudge } from "./judge";
import { replayOnce, type GenerateFn, type ReplayCase } from "./replay";
import { rubricFor } from "./rubrics";

const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "5" },
    batch: { type: "string" },
    case: { type: "string" },
    "judge-model": { type: "string", default: JUDGE_MODEL_DEFAULT },
    // The prompt artifact every case is replayed on, by exact version (v4 is not the latest
    // for any variant, so it is only reachable this way).
    "prompt-version": { type: "string", default: "lisa-default-v3" },
  },
});
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1) {
  throw new Error("--runs must be a positive integer");
}
const batchId = values.batch ?? randomUUID();
const judgeModel = values["judge-model"];
const promptVersion = values["prompt-version"];
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
assertProxied();

/** The commit the harness imported the worker from; "-dirty" if the worker has local edits. */
function workerGitSha(): string {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const dirty = execFileSync(
    "git",
    [
      "status",
      "--porcelain",
      "--",
      "apps/workers/tutor-orchestrator/src",
      "shared",
    ],
    { encoding: "utf8" },
  ).trim();
  return dirty === "" ? sha : `${sha}-dirty`;
}

/** Vertex via @google/genai; the proxy (or ADC) supplies the credential. */
function vertexGenerate(): GenerateFn {
  const auth = new OAuth2Client();
  auth.setCredentials({
    access_token: "proxy-injected",
    expiry_date: Date.now() + 3_600_000,
  });
  const ai = new GoogleGenAI({
    vertexai: true,
    project: PROJECT,
    location: "global",
    googleAuthOptions: { authClient: auth },
  });
  return async ({ model, messages, config }) => {
    const contents: Content[] = messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    }));
    const response = await ai.models.generateContent({
      model,
      contents,
      config,
    });
    const usage = response.usageMetadata;
    return {
      text: response.text ?? "",
      finishReason: response.candidates?.[0]?.finishReason ?? null,
      usage: {
        prompt: usage?.promptTokenCount ?? 0,
        cached: usage?.cachedContentTokenCount ?? 0,
        candidates: usage?.candidatesTokenCount ?? 0,
        thoughts: usage?.thoughtsTokenCount ?? 0,
      },
    };
  };
}

type CaseRow = {
  case_id: string;
  set_version: string;
  request: unknown;
  scan_correct_answer: string | null;
};

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const cases = await client.query<CaseRow>(
      `SELECT case_id, set_version, request, scan_correct_answer
         FROM public.tutor_eval_cases
        WHERE set_version = $1 AND ($2::text IS NULL OR case_id = $2)
        ORDER BY case_id`,
      [TEACHING_QUALITY_SET_VERSION, values.case ?? null],
    );
    if (cases.rowCount === 0) {
      throw new Error("no cases to replay (has the import run?)");
    }
    const sha = workerGitSha();
    const generate = vertexGenerate();
    const judge = vertexJudge(judgeModel);
    let totalUsd = 0;
    process.stdout.write(
      `batch ${batchId}: ${cases.rowCount} case(s) x ${runs} run(s); worker ${sha}; prompt ${promptVersion}; judge ${judgeModel}\n`,
    );

    for (const row of cases.rows) {
      const parsed = orchestrateRequestSchema.safeParse(row.request);
      if (!parsed.success) {
        throw new Error(`${row.case_id}: stored request fails the wire schema`);
      }
      const evalCase: ReplayCase = {
        caseId: row.case_id,
        setVersion: row.set_version,
        request: {
          ...parsed.data,
          policy_assignment: {
            ...parsed.data.policy_assignment,
            prompt_version: promptVersion,
          },
        },
        scanCorrectAnswer: row.scan_correct_answer,
      };
      const done = await client.query<{ run_index: number }>(
        `SELECT run_index FROM public.tutor_eval_runs WHERE batch_id = $1 AND case_id = $2`,
        [batchId, row.case_id],
      );
      const have = new Set(
        done.rows.map((r: { run_index: number }) => r.run_index),
      );
      const verdicts: Record<string, number> = {};
      let leaks = 0;
      let toolFlags = 0;
      let caseUsd = 0;
      for (let runIndex = 1; runIndex <= runs; runIndex += 1) {
        if (have.has(runIndex)) continue;
        const record = await replayOnce({
          evalCase,
          runIndex,
          rubric: rubricFor(row.case_id),
          generate,
          judge,
          judgeModel,
          workerGitSha: sha,
        });
        await client.query(
          `INSERT INTO public.tutor_eval_runs (case_id, batch_id, run_index, record, verdict)
           VALUES ($1, $2, $3, $4::jsonb, $5)
           ON CONFLICT (batch_id, case_id, run_index) DO NOTHING`,
          [
            row.case_id,
            batchId,
            runIndex,
            JSON.stringify(record),
            record.verdict,
          ],
        );
        verdicts[record.verdict] = (verdicts[record.verdict] ?? 0) + 1;
        if (record.class1.answer_leak) leaks += 1;
        if (record.class1.tool_request_unanswered) toolFlags += 1;
        caseUsd += record.tutor_usage.usd + (record.judge?.usage.usd ?? 0);
      }
      totalUsd += caseUsd;
      process.stdout.write(
        `${row.case_id}: ${JSON.stringify(verdicts)}; leak ${leaks}; tool-request flag ${toolFlags}; $${caseUsd.toFixed(4)}\n`,
      );
    }

    const graded = await client.query<{
      verdict: string;
      owner_grade: string | null;
    }>(
      `SELECT r.verdict, r.owner_grade
         FROM public.tutor_eval_runs r JOIN public.tutor_eval_cases c USING (case_id)
        WHERE c.set_version = $1`,
      [TEACHING_QUALITY_SET_VERSION],
    );
    const agreement = tutorEvalAgreement(
      graded.rows.map((r: { verdict: string; owner_grade: string | null }) => ({
        verdict: tutorEvalVerdictSchema.parse(r.verdict),
        owner_grade:
          r.owner_grade === null
            ? null
            : tutorEvalOwnerGradeSchema.parse(r.owner_grade),
      })),
    );
    process.stdout.write(
      `agreement (judge vs Karl): ${agreement.agreed}/${agreement.graded} graded runs ${JSON.stringify(agreement.pairs)}\n` +
        `measured cost this batch: $${totalUsd.toFixed(4)} (third-party list prices, scripts/rag/vertex.ts)\n`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  // The message names the step and status only; no model output or conversation text.
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
