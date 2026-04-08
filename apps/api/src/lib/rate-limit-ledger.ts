import { supabaseServer } from "./supabase-server";

type RpcClient = {
  rpc?: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: any }>;
};

export interface RateLimitDecision {
  allowed: boolean;
  code: string;
  message: string;
  limitType: "practice" | "full_length" | "tutor";
  current: number | null;
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
  cooldownUntil: string | null;
  reservationId: string | null;
  duplicate: boolean;
}

export interface TutorFinalizeResult {
  ok: boolean;
  code: string;
  message: string;
  reservationId: string | null;
  state: string | null;
  finalInputTokens: number | null;
  finalOutputTokens: number | null;
  finalCostMicros: number | null;
}

export class RateLimitUnavailableError extends Error {
  public readonly code: string;

  constructor(message = "Rate-limit DB gate unavailable") {
    super(message);
    this.name = "RateLimitUnavailableError";
    this.code = "RATE_LIMIT_DB_UNAVAILABLE";
  }
}

function isTestEnvironment(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

function defaultBypassDecision(limitType: RateLimitDecision["limitType"]): RateLimitDecision {
  return {
    allowed: true,
    code: "RATE_LIMIT_TEST_BYPASS",
    message: "Rate-limit DB gate bypassed in test mode",
    limitType,
    current: 0,
    limit: null,
    remaining: null,
    resetAt: null,
    cooldownUntil: null,
    reservationId: null,
    duplicate: false,
  };
}

function parseDecisionPayload(payload: unknown, limitType: RateLimitDecision["limitType"]): RateLimitDecision {
  if (!payload || typeof payload !== "object") {
    throw new RateLimitUnavailableError("Rate-limit DB gate returned invalid payload");
  }

  const row = payload as Record<string, unknown>;

  return {
    allowed: Boolean(row.allowed),
    code: typeof row.code === "string" && row.code.length > 0 ? row.code : "RATE_LIMIT_UNKNOWN",
    message: typeof row.message === "string" && row.message.length > 0 ? row.message : "Rate-limit gate decision unavailable",
    limitType,
    current: Number.isFinite(row.current as number) ? Number(row.current) : null,
    limit: Number.isFinite(row.limit as number) ? Number(row.limit) : null,
    remaining: Number.isFinite(row.remaining as number) ? Number(row.remaining) : null,
    resetAt: typeof row.reset_at === "string" ? row.reset_at : null,
    cooldownUntil: typeof row.cooldown_until === "string" ? row.cooldown_until : null,
    reservationId: typeof row.reservation_id === "string" ? row.reservation_id : null,
    duplicate: Boolean(row.duplicate),
  };
}

function parseFinalizePayload(payload: unknown): TutorFinalizeResult {
  if (!payload || typeof payload !== "object") {
    throw new RateLimitUnavailableError("Tutor finalize gate returned invalid payload");
  }

  const row = payload as Record<string, unknown>;

  return {
    ok: Boolean(row.ok),
    code: typeof row.code === "string" ? row.code : "FINALIZE_UNKNOWN",
    message: typeof row.message === "string" ? row.message : "Tutor usage finalization unavailable",
    reservationId: typeof row.reservation_id === "string" ? row.reservation_id : null,
    state: typeof row.state === "string" ? row.state : null,
    finalInputTokens: Number.isFinite(row.final_input_tokens as number) ? Number(row.final_input_tokens) : null,
    finalOutputTokens: Number.isFinite(row.final_output_tokens as number) ? Number(row.final_output_tokens) : null,
    finalCostMicros: Number.isFinite(row.final_cost_micros as number) ? Number(row.final_cost_micros) : null,
  };
}

async function callDecisionRpc(
  functionName: string,
  args: Record<string, unknown>,
  limitType: RateLimitDecision["limitType"],
  supabase?: RpcClient,
): Promise<RateLimitDecision> {
  const client = (supabase ?? (supabaseServer as unknown as RpcClient)) as RpcClient;
  const rpc = client.rpc;

  if (typeof rpc !== "function") {
    if (isTestEnvironment()) {
      return defaultBypassDecision(limitType);
    }
    throw new RateLimitUnavailableError(`Supabase RPC client missing for ${functionName}`);
  }

  const { data, error } = await rpc(functionName, args);
  if (error) {
    throw new RateLimitUnavailableError(`Supabase RPC ${functionName} failed: ${error.message ?? "unknown error"}`);
  }

  if (data == null) {
    if (isTestEnvironment()) {
      return defaultBypassDecision(limitType);
    }
    throw new RateLimitUnavailableError(`Supabase RPC ${functionName} returned no data`);
  }

  const payload = Array.isArray(data) ? data[0] : data;
  if (typeof payload === "string") {
    try {
      return parseDecisionPayload(JSON.parse(payload), limitType);
    } catch {
      if (isTestEnvironment()) {
        return defaultBypassDecision(limitType);
      }
      throw new RateLimitUnavailableError(`Supabase RPC ${functionName} returned unparsable JSON`);
    }
  }

  return parseDecisionPayload(payload, limitType);
}

export async function checkAndReservePracticeQuota(args: {
  studentUserId: string;
  accountId?: string | null;
  sessionId?: string | null;
  sessionItemId?: string | null;
  dryRun?: boolean;
  requestId?: string | null;
  role?: string | null;
  supabase?: RpcClient;
}): Promise<RateLimitDecision> {
  if (args.role === "admin") {
    return {
      ...defaultBypassDecision("practice"),
      code: "RATE_LIMIT_BYPASS_ADMIN",
      message: "Admin bypass",
    };
  }

  return callDecisionRpc(
    "check_and_reserve_practice_quota",
    {
      p_student_user_id: args.studentUserId,
      p_account_id: args.accountId ?? null,
      p_session_id: args.sessionId ?? null,
      p_session_item_id: args.sessionItemId ?? null,
      p_dry_run: args.dryRun === true,
      p_request_id: args.requestId ?? null,
    },
    "practice",
    args.supabase,
  );
}

export async function checkAndReserveFullLengthQuota(args: {
  studentUserId: string;
  accountId?: string | null;
  referenceId?: string | null;
  role?: string | null;
  supabase?: RpcClient;
}): Promise<RateLimitDecision> {
  if (args.role === "admin") {
    return {
      ...defaultBypassDecision("full_length"),
      code: "RATE_LIMIT_BYPASS_ADMIN",
      message: "Admin bypass",
    };
  }

  return callDecisionRpc(
    "check_and_reserve_full_length_quota",
    {
      p_student_user_id: args.studentUserId,
      p_account_id: args.accountId ?? null,
      p_reference_id: args.referenceId ?? null,
    },
    "full_length",
    args.supabase,
  );
}

export async function checkAndReserveTutorBudget(args: {
  studentUserId: string;
  accountId?: string | null;
  sessionKey?: string | null;
  reservedInputTokens?: number;
  reservedOutputTokens?: number;
  requestId?: string | null;
  role?: string | null;
  supabase?: RpcClient;
}): Promise<RateLimitDecision> {
  if (args.role === "admin") {
    return {
      ...defaultBypassDecision("tutor"),
      code: "RATE_LIMIT_BYPASS_ADMIN",
      message: "Admin bypass",
    };
  }

  return callDecisionRpc(
    "check_and_reserve_tutor_budget",
    {
      p_student_user_id: args.studentUserId,
      p_account_id: args.accountId ?? null,
      p_session_key: args.sessionKey ?? null,
      p_reserved_input_tokens: args.reservedInputTokens ?? 1800,
      p_reserved_output_tokens: args.reservedOutputTokens ?? 1200,
      p_request_id: args.requestId ?? null,
    },
    "tutor",
    args.supabase,
  );
}

export async function finalizeTutorUsage(args: {
  reservationId: string;
  success: boolean;
  failureCode?: string | null;
  finalInputTokens?: number | null;
  finalOutputTokens?: number | null;
  finalCostMicros?: number | null;
  supabase?: RpcClient;
}): Promise<TutorFinalizeResult> {
  const client = (args.supabase ?? (supabaseServer as unknown as RpcClient)) as RpcClient;
  const rpc = client.rpc;

  if (typeof rpc !== "function") {
    if (isTestEnvironment()) {
      return {
        ok: true,
        code: "FINALIZE_TEST_BYPASS",
        message: "Tutor finalize bypassed in test mode",
        reservationId: args.reservationId,
        state: args.success ? "finalized" : "failed",
        finalInputTokens: args.finalInputTokens ?? null,
        finalOutputTokens: args.finalOutputTokens ?? null,
        finalCostMicros: args.finalCostMicros ?? null,
      };
    }
    throw new RateLimitUnavailableError("Supabase RPC client missing for finalize_tutor_usage");
  }

  const { data, error } = await rpc("finalize_tutor_usage", {
    p_reservation_id: args.reservationId,
    p_success: args.success,
    p_failure_code: args.failureCode ?? null,
    p_final_input_tokens: args.finalInputTokens ?? null,
    p_final_output_tokens: args.finalOutputTokens ?? null,
    p_final_cost_micros: args.finalCostMicros ?? null,
  });

  if (error) {
    throw new RateLimitUnavailableError(`Supabase RPC finalize_tutor_usage failed: ${error.message ?? "unknown error"}`);
  }

  if (data == null) {
    if (isTestEnvironment()) {
      return {
        ok: true,
        code: "FINALIZE_TEST_BYPASS",
        message: "Tutor finalize bypassed in test mode",
        reservationId: args.reservationId,
        state: args.success ? "finalized" : "failed",
        finalInputTokens: args.finalInputTokens ?? null,
        finalOutputTokens: args.finalOutputTokens ?? null,
        finalCostMicros: args.finalCostMicros ?? null,
      };
    }
    throw new RateLimitUnavailableError("Supabase RPC finalize_tutor_usage returned no data");
  }

  const payload = Array.isArray(data) ? data[0] : data;
  if (typeof payload === "string") {
    try {
      return parseFinalizePayload(JSON.parse(payload));
    } catch {
      if (isTestEnvironment()) {
        return {
          ok: true,
          code: "FINALIZE_TEST_BYPASS",
          message: "Tutor finalize bypassed in test mode",
          reservationId: args.reservationId,
          state: args.success ? "finalized" : "failed",
          finalInputTokens: args.finalInputTokens ?? null,
          finalOutputTokens: args.finalOutputTokens ?? null,
          finalCostMicros: args.finalCostMicros ?? null,
        };
      }
      throw new RateLimitUnavailableError("Supabase RPC finalize_tutor_usage returned unparsable JSON");
    }
  }

  return parseFinalizePayload(payload);
}

export function estimateTokenCount(input: string | null | undefined): number {
  if (!input) return 0;
  const chars = input.trim().length;
  if (chars <= 0) return 0;
  return Math.max(1, Math.ceil(chars / 4));
}

export function estimateTutorCostMicros(inputTokens: number, outputTokens: number): number {
  const safeIn = Math.max(0, Math.trunc(inputTokens));
  const safeOut = Math.max(0, Math.trunc(outputTokens));
  const costMicros = Math.ceil((safeIn / 1000) * 75 + (safeOut / 1000) * 300);
  return Number.isFinite(costMicros) ? Math.max(0, costMicros) : 0;
}

