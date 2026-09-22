/**
 * @spec [Doc_05F_Study_Calendar, §7.8 idempotency (INV-08-09), §12 mutations, §17.7]
 * @implemented [2026-09-23]
 *
 * plain English: every calendar write, as a TanStack mutation with an optimistic apply, a
 * snapshot rollback on failure, and an invalidate on settle. Expected outcome: the UI moves
 * the instant the student acts, and the server's answer always wins in the end.
 *
 * THE IDEMPOTENCY KEY LIVES IN THE VARIABLES, and that is the whole mechanism. §7.8 wants
 * one key per user INTENT, reused across retries of that intent. TanStack re-invokes
 * `mutationFn` with the SAME variables object when it retries, so a key minted once into
 * the variables is reused by construction — there is no second place it could be minted and
 * no way for a retry to mint a fresh one. `newIntent()` is the only minter, so a caller
 * cannot accidentally reuse one intent's key for a different intent either.
 *
 * trade-offs: `retry: 1` is set here although the app default is `retry: false`. Retrying a
 * mutation is normally dangerous; it is safe on exactly these routes because every one of
 * them is idempotent by key, which is what the keys are for. A dropped connection on a day
 * edit should not silently lose the edit.
 *
 * edge cases: every mutation invalidates `calendarKeys.ranges()` — the whole prefix, not one
 * range. A move touches two dates that may sit in two different cached ranges, and a plan
 * regenerate touches all of them.
 */
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type {
  AcknowledgeBody,
  CalendarResponse,
  DayBlock,
  DayEditBody,
  DayEditResponse,
  DoItNowResponse,
  LaunchBody,
  LaunchResponse,
  PlanMember,
  ProfileUpsertResponse,
  VersionResponse,
} from "@lyceon/shared";
import { calendarKeys } from "./keys";
import {
  postAcknowledge,
  postDoItNow,
  postLaunch,
  postMoveBlock,
  postRegenerateDay,
  postRegeneratePlan,
  postResetDay,
  putDay,
  putStudyProfile,
} from "./client";
import {
  applyAcknowledge,
  applyBlockEdit,
  applyDoItNow,
  applyMove,
  applyRemoveBlock,
} from "./optimistic";

/**
 * Stamps a fresh idempotency key onto one user intent. Call it at the call site — once per
 * press, per drop, per save — and pass the result straight to `mutate`.
 */
export function newIntent<V extends object>(
  variables: V,
): V & { idempotency_key: string } {
  return { ...variables, idempotency_key: crypto.randomUUID() };
}

export type Intent<V extends object> = V & { idempotency_key: string };

/** What `onMutate` hands to `onError` so a failed write can be undone exactly. */
type Snapshot = { previous: [readonly unknown[], CalendarResponse][] };

/**
 * The shared optimistic/rollback/settle wiring. Written once because five mutations need
 * byte-identical cache discipline, and five copies of it is five chances to forget the
 * `cancelQueries` that stops an in-flight read from overwriting the optimistic paint.
 */
function useOptimisticCalendarMutation<V extends object, R>(
  mutationFn: (variables: V) => Promise<R>,
  optimistic: (response: CalendarResponse, variables: V) => CalendarResponse,
): UseMutationResult<R, Error, V, Snapshot> {
  const queryClient = useQueryClient();
  return useMutation<R, Error, V, Snapshot>({
    mutationFn,
    retry: 1,
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: calendarKeys.ranges() });
      const previous = queryClient.getQueriesData<CalendarResponse>({
        queryKey: calendarKeys.ranges(),
      }) as [readonly unknown[], CalendarResponse][];
      queryClient.setQueriesData<CalendarResponse>(
        { queryKey: calendarKeys.ranges() },
        (current) =>
          current === undefined ? current : optimistic(current, variables),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      // Restore EVERY range we touched, not just the visible one: the optimistic apply ran
      // across the whole prefix, so a partial rollback would leave a stale month behind the
      // corrected week.
      for (const [key, snapshot] of context?.previous ?? []) {
        queryClient.setQueryData(key, snapshot);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: calendarKeys.ranges() });
    },
  });
}

// ── Profile (setup and settings) ────────────────────────────────────────────

/**
 * §8.1 PUT /api/calendar/profile. No optimistic apply: a profile change can trigger a
 * `profile_change` regeneration that rewrites the whole horizon, and predicting a generated
 * plan on the client would be the one thing this system never does (§4, the formula lives
 * only in PL/pgSQL).
 */
export function useStudyProfileMutation(): UseMutationResult<
  ProfileUpsertResponse,
  Error,
  Record<string, unknown>
> {
  const queryClient = useQueryClient();
  return useMutation<ProfileUpsertResponse, Error, Record<string, unknown>>({
    mutationFn: putStudyProfile,
    retry: 1,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: calendarKeys.ranges() });
    },
  });
}

// ── Day edits ───────────────────────────────────────────────────────────────

export type EditDayVariables = Intent<{
  date: string;
  members: readonly PlanMember[];
  /**
   * How the day should look while the write is in flight. The member list is the wire
   * shape and cannot be rendered — it names created blocks by scope, not by id — so the
   * caller, which already holds the rendered day, supplies the prediction.
   */
  optimisticBlocks?:
    | { blockId: string; edited: DayBlock["block"] }
    | { removeBlockId: string };
}>;

export function useEditDay(): UseMutationResult<
  DayEditResponse,
  Error,
  EditDayVariables
> {
  return useOptimisticCalendarMutation<EditDayVariables, DayEditResponse>(
    (variables) =>
      putDay(variables.date, {
        members: variables.members as DayEditBody["members"],
        idempotency_key: variables.idempotency_key,
      }),
    (response, variables) => {
      const hint = variables.optimisticBlocks;
      if (hint === undefined) return response;
      if ("removeBlockId" in hint) {
        return applyRemoveBlock(response, variables.date, hint.removeBlockId);
      }
      return applyBlockEdit(
        response,
        variables.date,
        hint.blockId,
        hint.edited,
      );
    },
  );
}

// ── Move ────────────────────────────────────────────────────────────────────

export type MoveBlockVariables = Intent<{ blockId: string; toDate: string }>;

/**
 * §12.2/§12.4. The optimistic apply is exact here — unlike an edit, a move creates no new
 * scope, so the block that lands on the target day is the same block the student dragged.
 */
export function useMoveBlock(): UseMutationResult<
  VersionResponse,
  Error,
  MoveBlockVariables
> {
  return useOptimisticCalendarMutation<MoveBlockVariables, VersionResponse>(
    (variables) =>
      postMoveBlock(variables.blockId, {
        to_date: variables.toDate,
        idempotency_key: variables.idempotency_key,
      }),
    (response, variables) =>
      applyMove(response, variables.blockId, variables.toDate),
  );
}

// ── Regeneration ────────────────────────────────────────────────────────────

export type RegenerateVariables = Intent<Record<string, never>>;
export type DayScopedVariables = Intent<{ date: string }>;

/** §12.1 `student_refresh` — the student's own `Refresh plan`. */
export function useRegeneratePlan(): UseMutationResult<
  VersionResponse,
  Error,
  RegenerateVariables
> {
  const queryClient = useQueryClient();
  return useMutation<VersionResponse, Error, RegenerateVariables>({
    mutationFn: (variables) => postRegeneratePlan(variables.idempotency_key),
    retry: 1,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: calendarKeys.ranges() });
    },
  });
}

/** §12.1 `day_regenerate`. No optimistic apply — the generator decides what the day becomes. */
export function useRegenerateDay(): UseMutationResult<
  VersionResponse,
  Error,
  DayScopedVariables
> {
  const queryClient = useQueryClient();
  return useMutation<VersionResponse, Error, DayScopedVariables>({
    mutationFn: (variables) =>
      postRegenerateDay(variables.date, variables.idempotency_key),
    retry: 1,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: calendarKeys.ranges() });
    },
  });
}

/** §12.1 `day_reset` — back to auto, the override cleared. */
export function useResetDay(): UseMutationResult<
  VersionResponse,
  Error,
  DayScopedVariables
> {
  const queryClient = useQueryClient();
  return useMutation<VersionResponse, Error, DayScopedVariables>({
    mutationFn: (variables) =>
      postResetDay(variables.date, variables.idempotency_key),
    retry: 1,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: calendarKeys.ranges() });
    },
  });
}

// ── Do it now ───────────────────────────────────────────────────────────────

export type DoItNowVariables = Intent<{ blockId: string; today: string }>;

export function useDoItNow(): UseMutationResult<
  DoItNowResponse,
  Error,
  DoItNowVariables
> {
  return useOptimisticCalendarMutation<DoItNowVariables, DoItNowResponse>(
    (variables) => postDoItNow(variables.blockId, variables.idempotency_key),
    (response, variables) =>
      applyDoItNow(response, variables.blockId, variables.today),
  );
}

// ── Acknowledge ─────────────────────────────────────────────────────────────

/** §12.7, monotonic — §15 gives this route no idempotency key, so `newIntent` is not used. */
export function useAcknowledge(): UseMutationResult<
  { ok: true },
  Error,
  AcknowledgeBody
> {
  const queryClient = useQueryClient();
  return useMutation<{ ok: true }, Error, AcknowledgeBody, Snapshot>({
    mutationFn: postAcknowledge,
    retry: 1,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: calendarKeys.ranges() });
      const previous = queryClient.getQueriesData<CalendarResponse>({
        queryKey: calendarKeys.ranges(),
      }) as [readonly unknown[], CalendarResponse][];
      queryClient.setQueriesData<CalendarResponse>(
        { queryKey: calendarKeys.ranges() },
        (current) =>
          current === undefined ? current : applyAcknowledge(current),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      for (const [key, snapshot] of context?.previous ?? []) {
        queryClient.setQueryData(key, snapshot);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: calendarKeys.ranges() });
    },
  });
}

// ── Launch ──────────────────────────────────────────────────────────────────

export type LaunchVariables = { blockId: string } & LaunchBody;

/**
 * §15.1. No optimistic apply and no idempotency key in the body: the service owns the engine
 * key (INV-08-18), and what happens on success is a NAVIGATION, not a cache edit. The
 * prefetch that makes that navigation feel instant lives in `useLaunchBlock` in `launch.ts`,
 * which wraps this.
 */
export function useLaunchMutation(): UseMutationResult<
  LaunchResponse,
  Error,
  LaunchVariables
> {
  const queryClient = useQueryClient();
  return useMutation<LaunchResponse, Error, LaunchVariables>({
    mutationFn: ({ blockId, ...body }) => postLaunch(blockId, body),
    retry: 1,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: calendarKeys.ranges() });
    },
  });
}
