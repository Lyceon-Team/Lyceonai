/**
 * Review landing data: the pool summary and the open-session list.
 *
 * @spec [Doc-02B_V4 §16; ruled plan §2, ruling 17; brief R4 §2.3/§2.5]
 * @implemented [2026-09-22]
 *
 * plain English: two reads the review landing page needs — how many questions are
 * waiting and how they break down (`GET /api/review/pool`), and which review sessions
 * are still open (`GET /api/review/sessions/open`). Expected outcome: the landing
 * renders counts and "Continue" rows from the server's own numbers, and never invents
 * one.
 *
 * WHY THE RESPONSES ARE PARSED AND NOT CAST. `useActiveSessions.ts` declares a
 * hand-written `ActiveSession` type and trusts it, which is how `started_at` came to be
 * read from a payload that sends `created_at` (`practice-canonical.ts:2209`) and how
 * every practice open-session row came to render "Invalid DateTime". R3 publishes real
 * Zod schemas for both of these responses, so the hooks parse with them: a field
 * renamed on the server becomes a caught, logged failure here instead of `undefined`
 * rendered to a student.
 *
 * ANTI-LEAK: neither response carries question content. The pool summary carries counts
 * and source-session facts; the open list carries session rows. Nothing here can reveal
 * an answer or an explanation, pre- or post-submit.
 *
 * trade-offs: parsing costs a little CPU per fetch and makes a server change fail loudly
 * rather than silently. That is the trade we want on a surface whose whole job is to
 * report numbers accurately.
 *
 * edge cases:
 *   - the browser's IANA zone is sent as `?tz=`; R3 falls back to UTC and says so via
 *     `timezoneFallback`, which the caller can surface rather than silently mis-grouping
 *     a student's days.
 *   - the open list is filtered to `created`/`active` CLIENT-side as well as on the
 *     server (`review-canonical.ts:1443`). Ruling 17 says abandoned sessions never
 *     appear; one server predicate is a single point of failure for that, and this
 *     surface is cheap to make independently correct. THE FILTER RUNS BEFORE THE PARSE,
 *     deliberately: R3's schema pins `status` to `created | active`
 *     (`review-schema.ts:274`), so parsing first would turn one closed row into a
 *     thrown error that hides the whole list. Dropping the closed row and then parsing
 *     the rest keeps both properties — abandoned never appears, and a genuinely
 *     drifted shape still fails loudly.
 */

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { csrfFetch } from "@/lib/csrf";
import { getClientInstanceId } from "@/lib/client-instance";
import {
  type ReviewOpenSessionsResponse,
  type ReviewPoolSummaryResponse,
  reviewOpenSessionsResponseSchema,
  reviewPoolSummaryResponseSchema,
} from "@lyceon/shared/review-schema";

export const REVIEW_POOL_QUERY_KEY = "/api/review/pool";
export const REVIEW_OPEN_SESSIONS_QUERY_KEY = "/api/review/sessions/open";

/** Statuses a session may have and still be offered as "Continue" (ruling 17). */
const OPEN_STATUSES: ReadonlySet<string> = new Set(["created", "active"]);

/**
 * The caller's IANA zone, or `null` when the browser will not say. Never throws:
 * `resolvedOptions()` is absent in some embedded webviews and a missing timezone must
 * degrade to the server's UTC fallback, not to a blank page.
 */
export function browserTimeZone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === "string" && tz.length > 0 ? tz : null;
  } catch {
    // An environment without a resolvable zone is an EXPECTED condition here, not a
    // programming error: the server's `timezoneFallback` path exists for exactly this.
    return null;
  }
}

export function reviewPoolPath(tz: string | null): string {
  return tz === null
    ? REVIEW_POOL_QUERY_KEY
    : `${REVIEW_POOL_QUERY_KEY}?tz=${encodeURIComponent(tz)}`;
}

/** `GET /api/review/pool?tz=…` — every count the landing page shows. */
export function useReviewPool(): {
  pool: ReviewPoolSummaryResponse | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
} {
  const { user, authLoading } = useSupabaseAuth();
  const tz = useMemo(() => browserTimeZone(), []);
  const path = useMemo(() => reviewPoolPath(tz), [tz]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [path],
    enabled: !!user && !authLoading,
    select: (raw: unknown): ReviewPoolSummaryResponse =>
      reviewPoolSummaryResponseSchema.parse(raw),
  });

  return {
    pool: data ?? null,
    isLoading,
    isError,
    error,
    refetch: () => {
      void refetch();
    },
  };
}

export type ReviewOpenSession = ReviewOpenSessionsResponse["sessions"][number];

/**
 * Ruling 17, enforced on the wire payload before it is parsed: a session that is not
 * `created` or `active` is removed, not rendered and not thrown over. Everything else
 * passes through untouched so the schema still judges it.
 */
export function dropClosedSessions(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const bag = raw as Record<string, unknown>;
  if (!Array.isArray(bag.sessions)) return raw;
  return {
    ...bag,
    sessions: bag.sessions.filter((row) => {
      if (row === null || typeof row !== "object") return true;
      const status = (row as Record<string, unknown>).status;
      return typeof status !== "string" || OPEN_STATUSES.has(status);
    }),
  };
}

/** `GET /api/review/sessions/open` plus the terminate mutation the rows need. */
export function useActiveReviewSessions(): {
  sessions: ReviewOpenSession[];
  maxConcurrentSessions: number | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  terminateSession: (sessionId: string) => void;
  isTerminating: boolean;
} {
  const { user, authLoading } = useSupabaseAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [REVIEW_OPEN_SESSIONS_QUERY_KEY],
    enabled: !!user && !authLoading,
    select: (raw: unknown): ReviewOpenSessionsResponse =>
      reviewOpenSessionsResponseSchema.parse(dropClosedSessions(raw)),
  });

  const terminateMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await csrfFetch(
        `/api/review/sessions/${encodeURIComponent(sessionId)}/terminate`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to terminate review session");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [REVIEW_OPEN_SESSIONS_QUERY_KEY],
      });
      queryClient.invalidateQueries({ queryKey: [REVIEW_POOL_QUERY_KEY] });
    },
  });

  return {
    sessions: data?.sessions ?? [],
    maxConcurrentSessions: data?.maxConcurrentSessions ?? null,
    isLoading,
    isError,
    error,
    refetch: () => {
      void refetch();
    },
    terminateSession: terminateMutation.mutate,
    isTerminating: terminateMutation.isPending,
  };
}

/**
 * The three ways into a review session, as the create body R3 takes
 * (`review-schema.ts:93-99`). The landing builds one of these and hands it here.
 */
export type ReviewStartSpec =
  | { mode: "queue" }
  | {
      mode: "session";
      filters: { source_engine: string; source_session_id: string };
    }
  | {
      mode: "filter";
      filters: {
        sections?: string[];
        domains?: string[];
        skills?: string[];
        difficulties?: string[];
      };
    };

/**
 * Why a create fails in a way the student should see. `pool_empty` is NOT an error —
 * brief R4 §2.3 calls it a decision — so the landing renders it as the same friendly
 * empty state an empty queue gets, with no error styling.
 */
export type ReviewStartFailure =
  | { kind: "pool_empty"; message: string }
  | { kind: "session_limit"; message: string }
  | { kind: "other"; message: string };

export type ReviewStartResult =
  | { ok: true; sessionId: string }
  | { ok: false; failure: ReviewStartFailure };

/**
 * `POST /api/review/sessions`, then the caller navigates to `/review/session/:id`
 * (brief R4 §2.2 — refresh, back and new tab all resume, which only holds if the id is
 * in the URL rather than in component state).
 *
 * A Result rather than a throw: an empty pool and a session-limit hit are EXPECTED
 * outcomes with their own copy (Coding Standards §3.6), not exceptions.
 */
export function useCreateReviewSession(): {
  startSession: (spec: ReviewStartSpec) => Promise<ReviewStartResult>;
  isStarting: boolean;
} {
  const queryClient = useQueryClient();

  const mutation = useMutation<ReviewStartResult, Error, ReviewStartSpec>({
    mutationFn: async (spec: ReviewStartSpec): Promise<ReviewStartResult> => {
      const res = await csrfFetch("/api/review/sessions", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          mode: spec.mode,
          ...(spec.mode === "queue" ? {} : { filters: spec.filters }),
          client_instance_id: getClientInstanceId(),
          idempotency_key: crypto.randomUUID(),
        }),
      });

      const body: unknown = await res.json().catch(() => null);
      const parsed =
        body !== null && typeof body === "object"
          ? (body as Record<string, unknown>)
          : {};
      const message =
        typeof parsed.message === "string" ? parsed.message : null;

      if (res.status === 422 && parsed.code === "REVIEW_POOL_EMPTY") {
        return {
          ok: false,
          failure: {
            kind: "pool_empty",
            message: message ?? "You have nothing to review in this selection.",
          },
        };
      }
      if (res.status === 403 && parsed.code === "SESSION_LIMIT_EXCEEDED") {
        return {
          ok: false,
          failure: {
            kind: "session_limit",
            message:
              message ?? "You already have too many open review sessions.",
          },
        };
      }
      if (!res.ok) {
        return {
          ok: false,
          failure: {
            kind: "other",
            message:
              message ?? `Failed to start review session (${res.status})`,
          },
        };
      }

      const sessionId = parsed.sessionId ?? parsed.id;
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        return {
          ok: false,
          failure: {
            kind: "other",
            message: "Server did not return a sessionId",
          },
        };
      }
      return { ok: true, sessionId };
    },
    onSuccess: (result) => {
      if (!result.ok) return;
      queryClient.invalidateQueries({
        queryKey: [REVIEW_OPEN_SESSIONS_QUERY_KEY],
      });
      queryClient.invalidateQueries({ queryKey: [REVIEW_POOL_QUERY_KEY] });
    },
  });

  return {
    startSession: (spec: ReviewStartSpec) => mutation.mutateAsync(spec),
    isStarting: mutation.isPending,
  };
}
