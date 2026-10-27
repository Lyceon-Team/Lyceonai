/**
 * @spec [Doc-03D_V1.2 §5.1, §3.2.1, §8.1; docs/eval/lisa/G0-2_Teaching_Quality_Set_Design.md
 *       §4.1, §5.1, §5.2, §6; Karl's rulings 2026-10-27: D3 (judge), D4 (5 runs per case)]
 *       | @implemented [2026-10-27]
 *
 * plain English: replays one case once, the way production would answer it today, and builds
 * the run record.
 *  1. Prompt: the worker's own `buildSystemInstruction` (lisa-default-v3 + state blocks) and
 *     `buildConversationMessages`, from the case's stored envelope.
 *  2. Model: the worker's `resolveModelAlias` → `resolveProviderModel`; config from the worker's
 *     `buildTutorGenerationConfig` (temperature, topP, topK, thinking budget 1024, safety
 *     settings). Nothing is hand-copied.
 *  3. The visible reply: the worker's `buildOrchestrateResponse` (marker strip, worker
 *     anti-leak), then the BFF's `scanTutorOutput` (the serializer's own scan, no IO).
 *  4. Class 1: `hasAnswerLeak` on the raw reply (pre-submit) and `toolRequestUnanswered`.
 *  5. The judge, only when the case's rubric is complete and nothing leaked.
 *  6. `decideTutorEvalVerdict`.
 *
 * trade-offs:
 *  - The model call is injected (`GenerateFn`), so the unit tests run the whole path with
 *    planted replies and no network.
 *  - The pro_class budget circuit breaker is read as not tripped: it is an ops override, and a
 *    baseline must not depend on a production toggle.
 *  - No retry and no pro→flash fallback: a failed call fails the run loudly rather than
 *    silently replaying on a different model.
 *  - The context hash is provisional (sha256 of system instruction + messages) until the
 *    canonical one lands (design §6).
 */
import { createHash } from "node:crypto";
import type { GenerateContentConfig } from "@google/genai";
import {
  buildConversationMessages,
  buildOrchestrateResponse,
  buildSystemInstruction,
  resolveModelAlias,
} from "../../../apps/workers/tutor-orchestrator/src/routes/orchestrate";
import { resolvePromptArtifact } from "../../../apps/workers/tutor-orchestrator/src/prompts/prompt-registry";
import {
  THINKING_BUDGET,
  buildTutorGenerationConfig,
  resolveProviderModel,
  type VertexMessage,
} from "../../../apps/workers/tutor-orchestrator/src/lib/vertex-client";
import { scanTutorOutput } from "../../../server/services/tutor-output-serializer";
import { hasAnswerLeak } from "../../../shared/tutor-safety-constants";
import type { OrchestrateRequest } from "../../../shared/tutor-orchestrator-wire";
import {
  completeRubric,
  decideTutorEvalVerdict,
  tutorEvalRunRecordSchema,
  type TutorEvalRubric,
  type TutorEvalRunRecord,
} from "../../../packages/shared/src/tutor-eval-schema";
import { priceOf, type Usage } from "../../../scripts/rag/vertex";
import type { JudgeFn } from "./judge";

export type GenerateResult = {
  text: string;
  finishReason: string | null;
  usage: {
    prompt: number;
    cached: number;
    candidates: number;
    thoughts: number;
  };
};

export type GenerateFn = (args: {
  model: string;
  messages: VertexMessage[];
  config: GenerateContentConfig;
}) => Promise<GenerateResult>;

/** A case as loaded from `tutor_eval_cases`, request already parsed. */
export type ReplayCase = {
  caseId: string;
  setVersion: string;
  request: OrchestrateRequest;
  scanCorrectAnswer: string | null;
};

const TOOL_MENTION = /\b(desmos|calculator|graph(?:ing|s|ed)?)\b/i;

/**
 * Design §4.1 heuristic: the reply names no tool (Desmos / calculator / graph) and ends in a
 * question. REVIEW_NEEDED material, not a failure: a good reply could defer the tool.
 */
export function toolRequestUnanswered(reply: string): boolean {
  return !TOOL_MENTION.test(reply) && /\?\s*$/.test(reply.trim());
}

/** Design §6: provisional context hash until the canonical one exists. */
export function provisionalContextHash(
  systemInstruction: string,
  messages: readonly VertexMessage[],
): string {
  return createHash("sha256")
    .update(JSON.stringify({ systemInstruction, messages }))
    .digest("hex");
}

function costUsd(model: string, u: GenerateResult["usage"]): Usage {
  const price = priceOf(model);
  const output = u.candidates + u.thoughts;
  return {
    calls: 1,
    prompt: u.prompt,
    cached: u.cached,
    output,
    thoughts: u.thoughts,
    usd:
      (Math.max(0, u.prompt - u.cached) * price.input +
        u.cached * price.cached +
        output * price.output) /
      1_000_000,
  };
}

function recordUsage(u: Usage): TutorEvalRunRecord["tutor_usage"] {
  return {
    prompt: u.prompt,
    cached: u.cached,
    output: u.output,
    thoughts: u.thoughts,
    usd: u.usd,
  };
}

export async function replayOnce(args: {
  evalCase: ReplayCase;
  runIndex: number;
  rubric: TutorEvalRubric | null;
  generate: GenerateFn;
  judge: JudgeFn;
  judgeModel: string;
  workerGitSha: string;
}): Promise<TutorEvalRunRecord> {
  const { evalCase, runIndex, generate, judge } = args;
  const request = evalCase.request;

  const modelAlias = resolveModelAlias({
    sourceSurface: request.source_surface,
    entryMode: request.entry_mode,
    policyVariant: request.policy_assignment.policy_variant,
    proBudgetCircuitBreakerTripped: false,
  });
  const providerModel = resolveProviderModel(modelAlias);
  const promptVersion = resolvePromptArtifact(
    request.policy_assignment.policy_variant,
    request.policy_assignment.prompt_version,
  ).version;
  const messages = buildConversationMessages(request);
  const systemInstruction = buildSystemInstruction(request);
  const config = buildTutorGenerationConfig(
    systemInstruction,
    request.runtime_limits.max_output_tokens,
  );

  const started = performance.now();
  const generated = await generate({ model: providerModel, messages, config });
  const latencyMs = Math.round(performance.now() - started);

  const workerResponse = buildOrchestrateResponse(
    {
      text: generated.text,
      modelAliasUsed: modelAlias,
      providerModel,
      fallbackApplied: false,
      finishReason: generated.finishReason,
    },
    request,
    promptVersion,
  );

  const studentMessages = request.recent_messages
    .filter((m) => m.role === "student")
    .map((m) => m.message);
  const isPreSubmit = !request.is_post_submit;
  const scan = scanTutorOutput(workerResponse.response.content, {
    conversationId: request.conversation_id,
    studentId: request.student_id,
    isPreSubmit,
    correctAnswer: evalCase.scanCorrectAnswer,
    correctAnswerResolutionFailed: false,
    questionCanonicalId: null,
    studentMessages,
    allowedVideoIds: [],
  });
  const visibleReply = scan.content;

  const class1 = {
    answer_leak:
      isPreSubmit &&
      evalCase.scanCorrectAnswer !== null &&
      hasAnswerLeak(
        generated.text,
        evalCase.scanCorrectAnswer,
        studentMessages,
      ),
    scan_blocked: scan.blocked,
    scan_classes: scan.detectedClasses,
    tool_request_unanswered: toolRequestUnanswered(visibleReply),
  };

  const rubric = args.rubric === null ? null : completeRubric(args.rubric);
  const leaked =
    class1.answer_leak || scan.detectedClasses.includes("answer_leak");
  const judged =
    rubric === null || leaked
      ? null
      : await judge({ request, rubric, visibleReply });

  const verdict = decideTutorEvalVerdict({
    class1,
    judge: judged?.response ?? null,
    rubric,
    visibleReply,
  });

  const tutorUsage = costUsd(providerModel, generated.usage);
  return tutorEvalRunRecordSchema.parse({
    set_version: evalCase.setVersion,
    case_id: evalCase.caseId,
    run_index: runIndex,
    prompt_version: promptVersion,
    context_hash: {
      kind: "provisional",
      sha256: provisionalContextHash(systemInstruction, messages),
    },
    model_alias: modelAlias,
    provider_model: providerModel,
    thinking_budget: config.thinkingConfig?.thinkingBudget ?? THINKING_BUDGET,
    temperature: config.temperature,
    top_p: config.topP,
    top_k: config.topK,
    max_output_tokens: config.maxOutputTokens,
    worker_git_sha: args.workerGitSha,
    finish_reason: generated.finishReason,
    latency_ms: latencyMs,
    raw_reply: generated.text,
    visible_reply: visibleReply,
    suggested_action: workerResponse.response.suggested_action.type,
    class1,
    judge:
      judged === null
        ? null
        : {
            model: args.judgeModel,
            response: judged.response,
            usage: recordUsage(judged.usage),
          },
    judge_skipped: judged !== null ? null : leaked ? "leak" : "no_rubric",
    verdict,
    tutor_usage: recordUsage(tutorUsage),
  });
}
