// @vitest-environment jsdom
/**
 * @spec [Doc_05F_Study_Calendar, §7.8 idempotency (INV-08-09), §12.1 regeneration,
 *        §12.2/§12.4 move and day edit, §12.6 do-it-now, §12.7 acknowledgement,
 *        §8.1 profile; lyceon-coding-standards §4.2 (idempotency is required)]
 * @implemented [2026-09-22]
 *
 * plain English: one hook test per calendar mutation, proving the three properties the whole
 * optimistic design rests on — the cache moves BEFORE the request settles, a failed write is
 * rolled back to the exact snapshot, and a retry reuses the SAME `idempotency_key`.
 *
 * The network is intercepted at `@/lib/csrf`, the same seam `useGuardianStudents.test.ts`
 * uses, so everything between the hook and the socket is the real code: `apiRequest`, the
 * `HttpApiError` construction in `api-error.ts`, and the shared-schema parse in `client.ts`.
 * Mocking `postMoveBlock` and friends directly would assert that the hooks call functions,
 * which is not the guarantee anyone needs.
 *
 * WHY THE RETRY ASSERTION IS THE IMPORTANT ONE. §7.8 wants one key per user INTENT, reused
 * across retries of that intent. `mutations.ts` gets that by putting the key in the mutation
 * VARIABLES, because TanStack re-invokes `mutationFn` with the same variables object. Nothing
 * about that is enforced by a type: if a future edit mints the key inside `mutationFn`, every
 * retry becomes a second write and a dropped connection silently duplicates a day edit. These
 * tests read the key off the WIRE on both attempts, so that change fails here.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CalendarDay,
  CalendarResponse,
  DayBlock,
  PlanBlock,
} from "@lyceon/shared";
import type { HttpApiError } from "@/lib/api-error";
import { calendarKeys } from "./keys";
import {
  newIntent,
  useAcknowledge,
  useDoItNow,
  useEditDay,
  useMoveBlock,
  useRegenerateDay,
  useRegeneratePlan,
  useResetDay,
  useStudyProfileMutation,
} from "./mutations";
import { resetProvisionalIds } from "./optimistic";

const csrfFetchMock = vi.fn();

vi.mock("@/lib/csrf", () => ({
  csrfFetch: (...args: unknown[]) => csrfFetchMock(...args),
}));

// ── Fixture ─────────────────────────────────────────────────────────────────

const FROM = "2026-09-21";
const TO = "2026-09-22";
const TZ = "America/Los_Angeles";
const YESTERDAY = FROM;
const TODAY = TO;

const BLOCK_PAST = "00000000-0000-4000-8000-000000000001";
const BLOCK_TODAY = "00000000-0000-4000-8000-000000000003";

const RANGE_KEY = calendarKeys.range(FROM, TO, TZ);

function practiceBlock(
  blockId: string,
  date: string,
  target: number,
): PlanBlock {
  return {
    block_id: blockId,
    scheduled_date: date,
    block_type: "practice",
    section: "M",
    scope: {
      level: "domain",
      mix: [{ domain: "Algebra", count: target, explanation_key: "weak" }],
    },
    target_count: target,
    source: "auto",
    derived_from_block_id: null,
    explanation_key: "weighted",
    display_ordinal: 1,
    membership_type: "created",
  };
}

function entry(block: PlanBlock, actual: number): DayBlock {
  return {
    block,
    actual,
    progress: actual / block.target_count,
    status: actual === 0 ? "scheduled" : "partial",
  };
}

function day(
  localDate: string,
  blocks: readonly DayBlock[],
  status: CalendarDay["status"],
): CalendarDay {
  return {
    local_date: localDate,
    timezone: TZ,
    is_user_override: false,
    is_study_day: true,
    version_no: 7,
    status,
    blocks: [...blocks],
    extra_work: [],
    planned_count: blocks.reduce(
      (sum, item) => sum + item.block.target_count,
      0,
    ),
    actual_count: blocks.reduce((sum, item) => sum + item.actual, 0),
    extra_count: 0,
  };
}

const READY: CalendarResponse = {
  status: "ready",
  profile: {
    timezone: TZ,
    target_exam_date: "2026-11-07",
    target_score: 1400,
    study_days_mask: 62,
    daily_minutes: 45,
    full_length_weekday: 6,
    planner_mode: "auto",
    setup_completed_at: "2026-09-01T18:00:00Z",
  },
  estimates: { practice_seconds_per_unit: 90, review_seconds_per_unit: 120 },
  days: [
    day(
      YESTERDAY,
      [entry(practiceBlock(BLOCK_PAST, YESTERDAY, 20), 12)],
      "partial",
    ),
    day(TODAY, [entry(practiceBlock(BLOCK_TODAY, TODAY, 15), 0)], "today"),
  ],
  facts: {
    blocks_total: 2,
    blocks_completed: 0,
    blocks_partial: 1,
    blocks_missed: 0,
    blocks_in_progress: 0,
    blocks_scheduled: 1,
    questions_completed: 12,
    full_lengths_completed: 0,
    extra_questions: 0,
  },
  streak: { current: 4, longest: null, history_complete: false },
  latest_unacknowledged_nonstudent_change: {
    version_no: 7,
    trigger: "weekly",
    created_at: "2026-09-15T09:00:00Z",
  },
  diagnostic_state: "baseline_ready",
};

/** The snapshot every rollback test compares against, captured before anything runs. */
const ORIGINAL = structuredClone(READY);

const VERSION_BODY = { version_no: 8 };
const DAY_EDIT_BODY = {
  version_no: 8,
  day: day(TODAY, [entry(practiceBlock(BLOCK_TODAY, TODAY, 15), 0)], "today"),
};
const DO_IT_NOW_BODY = {
  version_no: 8,
  block: practiceBlock("00000000-0000-4000-8000-0000000000aa", TODAY, 20),
};
const PROFILE_BODY = { profile: READY.status === "ready" ? READY.profile : {} };

// ── Harness ─────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A real server error envelope, so the hook sees the `HttpApiError` `api-error.ts` builds. */
function errorResponse(status: number, code: string): Response {
  return jsonResponse({ error: { message: `failed: ${code}`, code } }, status);
}

/** A request that never comes back — the window in which the optimistic paint must exist. */
function neverSettles(): Promise<Response> {
  return new Promise<Response>(() => {});
}

type Harness = {
  queryClient: QueryClient;
  wrapper: (props: { children: React.ReactNode }) => React.ReactElement;
  invalidateSpy: ReturnType<typeof vi.spyOn>;
};

function harness(): Harness {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      // The hooks set `retry: 1` themselves; only the DELAY is a test concern.
      mutations: { retry: false, retryDelay: 0 },
    },
  });
  queryClient.setQueryData(RANGE_KEY, structuredClone(READY));
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper, invalidateSpy };
}

function cached(queryClient: QueryClient): CalendarResponse {
  const value = queryClient.getQueryData<CalendarResponse>(RANGE_KEY);
  if (value === undefined) throw new Error("the range key holds nothing");
  return value;
}

function readyDays(response: CalendarResponse): readonly CalendarDay[] {
  if (response.status !== "ready") throw new Error("expected a ready response");
  return response.days;
}

function blockIdsOn(queryClient: QueryClient, date: string): string[] {
  const found = readyDays(cached(queryClient)).find(
    (item) => item.local_date === date,
  );
  if (found === undefined) throw new Error(`no day ${date}`);
  return found.blocks.map((item) => item.block.block_id);
}

/** The JSON body of the nth intercepted request — what actually went on the wire. */
function sentBody(index: number): Record<string, unknown> {
  const call: unknown[] = csrfFetchMock.mock.calls[index] ?? [];
  const init = call[1] as RequestInit | undefined;
  if (typeof init?.body !== "string") {
    throw new Error(`call ${index} carried no JSON body`);
  }
  return JSON.parse(init.body) as Record<string, unknown>;
}

function expectInvalidatesRanges(
  invalidateSpy: Harness["invalidateSpy"],
): void {
  expect(invalidateSpy).toHaveBeenCalledWith({
    queryKey: calendarKeys.ranges(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetProvisionalIds();
});

// ── newIntent ───────────────────────────────────────────────────────────────

describe("newIntent (§7.8 / INV-08-09)", () => {
  it("mints a FRESH key per call, so one intent's key can never be reused by another", () => {
    const first = newIntent({ date: TODAY });
    const second = newIntent({ date: TODAY });

    expect(first.idempotency_key).not.toBe(second.idempotency_key);
    expect(first.date).toBe(TODAY);
  });

  it("leaves the caller's variables intact alongside the key", () => {
    const intent = newIntent({ blockId: BLOCK_PAST, toDate: TODAY });
    expect(intent.blockId).toBe(BLOCK_PAST);
    expect(intent.toDate).toBe(TODAY);
    expect(typeof intent.idempotency_key).toBe("string");
  });
});

// ── useEditDay ──────────────────────────────────────────────────────────────

describe("useEditDay (§12.4)", () => {
  it("applies the optimistic removal BEFORE the request settles", async () => {
    const { queryClient, wrapper } = harness();
    csrfFetchMock.mockImplementation(neverSettles);

    const { result } = renderHook(() => useEditDay(), { wrapper });
    act(() => {
      result.current.mutate(
        newIntent({
          date: YESTERDAY,
          members: [],
          optimisticBlocks: { removeBlockId: BLOCK_PAST },
        }),
      );
    });

    await waitFor(() => expect(blockIdsOn(queryClient, YESTERDAY)).toEqual([]));
    // The paint happened while the write is still in flight — that is the point.
    expect(result.current.isPending).toBe(true);
  });

  it("applies the optimistic EDIT as a provisional block, because the server creates a new row", async () => {
    const { queryClient, wrapper } = harness();
    csrfFetchMock.mockImplementation(neverSettles);

    const { result } = renderHook(() => useEditDay(), { wrapper });
    act(() => {
      result.current.mutate(
        newIntent({
          date: TODAY,
          members: [],
          optimisticBlocks: {
            blockId: BLOCK_TODAY,
            edited: practiceBlock(BLOCK_TODAY, TODAY, 25),
          },
        }),
      );
    });

    await waitFor(() =>
      expect(blockIdsOn(queryClient, TODAY)).toEqual(["provisional:1"]),
    );
  });

  it("ROLLS BACK to the exact snapshot on a 409", async () => {
    const { queryClient, wrapper } = harness();
    csrfFetchMock.mockResolvedValue(errorResponse(409, "CALENDAR_CONFLICT"));

    const { result } = renderHook(() => useEditDay(), { wrapper });
    act(() => {
      result.current.mutate(
        newIntent({
          date: YESTERDAY,
          members: [],
          optimisticBlocks: { removeBlockId: BLOCK_PAST },
        }),
      );
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as HttpApiError).status).toBe(409);
    expect(cached(queryClient)).toEqual(ORIGINAL);
  });

  it("ROLLS BACK to the exact snapshot on a 500", async () => {
    const { queryClient, wrapper } = harness();
    csrfFetchMock.mockResolvedValue(errorResponse(500, "INTERNAL"));

    const { result } = renderHook(() => useEditDay(), { wrapper });
    act(() => {
      result.current.mutate(
        newIntent({
          date: YESTERDAY,
          members: [],
          optimisticBlocks: { removeBlockId: BLOCK_PAST },
        }),
      );
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as HttpApiError).status).toBe(500);
    expect(cached(queryClient)).toEqual(ORIGINAL);
  });

  it("a RETRY re-sends the SAME idempotency_key — the guarantee §7.8 rests on", async () => {
    const { wrapper } = harness();
    csrfFetchMock
      .mockResolvedValueOnce(errorResponse(500, "INTERNAL"))
      .mockResolvedValueOnce(jsonResponse(DAY_EDIT_BODY));

    const { result } = renderHook(() => useEditDay(), { wrapper });
    act(() => {
      result.current.mutate(newIntent({ date: TODAY, members: [] }));
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(csrfFetchMock).toHaveBeenCalledTimes(2);
    // Two attempts, ONE intent: the server dedupes the second write by this key. A key
    // minted inside `mutationFn` would differ here and the retry would write twice.
    expect(sentBody(0).idempotency_key).toBe(sentBody(1).idempotency_key);
  });

  it("invalidates the whole `calendar/range` prefix on settle", async () => {
    const { wrapper, invalidateSpy } = harness();
    csrfFetchMock.mockResolvedValue(jsonResponse(DAY_EDIT_BODY));

    const { result } = renderHook(() => useEditDay(), { wrapper });
    act(() => {
      result.current.mutate(newIntent({ date: TODAY, members: [] }));
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expectInvalidatesRanges(invalidateSpy);
  });
});

// ── useMoveBlock ────────────────────────────────────────────────────────────

describe("useMoveBlock (§12.2/§12.4)", () => {
  it("moves the block in the cache BEFORE the request settles", async () => {
    const { queryClient, wrapper } = harness();
    csrfFetchMock.mockImplementation(neverSettles);

    const { result } = renderHook(() => useMoveBlock(), { wrapper });
    act(() => {
      result.current.mutate(newIntent({ blockId: BLOCK_PAST, toDate: TODAY }));
    });

    await waitFor(() =>
      expect(blockIdsOn(queryClient, TODAY)).toEqual([BLOCK_TODAY, BLOCK_PAST]),
    );
    expect(blockIdsOn(queryClient, YESTERDAY)).toEqual([]);
    expect(result.current.isPending).toBe(true);
  });

  it("ROLLS BACK the drop on a 409 — a refused move must not leave the block on the target", async () => {
    const { queryClient, wrapper } = harness();
    csrfFetchMock.mockResolvedValue(
      errorResponse(409, "CALENDAR_MOVE_REFUSED"),
    );

    const { result } = renderHook(() => useMoveBlock(), { wrapper });
    act(() => {
      result.current.mutate(newIntent({ blockId: BLOCK_PAST, toDate: TODAY }));
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as HttpApiError).status).toBe(409);
    expect(cached(queryClient)).toEqual(ORIGINAL);
  });

  it("ROLLS BACK the drop on a 500", async () => {
    const { queryClient, wrapper } = harness();
    csrfFetchMock.mockResolvedValue(errorResponse(500, "INTERNAL"));

    const { result } = renderHook(() => useMoveBlock(), { wrapper });
    act(() => {
      result.current.mutate(newIntent({ blockId: BLOCK_PAST, toDate: TODAY }));
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(cached(queryClient)).toEqual(ORIGINAL);
  });

  it("a RETRY re-sends the SAME idempotency_key, so the move is written once", async () => {
    const { wrapper } = harness();
    csrfFetchMock
      .mockResolvedValueOnce(errorResponse(500, "INTERNAL"))
      .mockResolvedValueOnce(jsonResponse(VERSION_BODY));

    const { result } = renderHook(() => useMoveBlock(), { wrapper });
    act(() => {
      result.current.mutate(newIntent({ blockId: BLOCK_PAST, toDate: TODAY }));
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(csrfFetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(0).idempotency_key).toBe(sentBody(1).idempotency_key);
    expect(sentBody(1).to_date).toBe(TODAY);
  });

  it("invalidates the whole `calendar/range` prefix on settle — a move touches two dates", async () => {
    const { wrapper, invalidateSpy } = harness();
    csrfFetchMock.mockResolvedValue(jsonResponse(VERSION_BODY));

    const { result } = renderHook(() => useMoveBlock(), { wrapper });
    act(() => {
      result.current.mutate(newIntent({ blockId: BLOCK_PAST, toDate: TODAY }));
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expectInvalidatesRanges(invalidateSpy);
  });
});

// ── useDoItNow ──────────────────────────────────────────────────────────────

describe("useDoItNow (§12.6)", () => {
  it("appends the copy to today BEFORE the request settles, leaving the source day alone", async () => {
    const { queryClient, wrapper } = harness();
    csrfFetchMock.mockImplementation(neverSettles);

    const { result } = renderHook(() => useDoItNow(), { wrapper });
    act(() => {
      result.current.mutate(newIntent({ blockId: BLOCK_PAST, today: TODAY }));
    });

    await waitFor(() =>
      expect(blockIdsOn(queryClient, TODAY)).toEqual([
        BLOCK_TODAY,
        "provisional:1",
      ]),
    );
    expect(blockIdsOn(queryClient, YESTERDAY)).toEqual([BLOCK_PAST]);
  });

  it("ROLLS BACK the copy on a 409", async () => {
    const { queryClient, wrapper } = harness();
    csrfFetchMock.mockResolvedValue(errorResponse(409, "CALENDAR_CONFLICT"));

    const { result } = renderHook(() => useDoItNow(), { wrapper });
    act(() => {
      result.current.mutate(newIntent({ blockId: BLOCK_PAST, today: TODAY }));
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as HttpApiError).status).toBe(409);
    expect(cached(queryClient)).toEqual(ORIGINAL);
  });

  it("ROLLS BACK the copy on a 500", async () => {
    const { queryClient, wrapper } = harness();
    csrfFetchMock.mockResolvedValue(errorResponse(500, "INTERNAL"));

    const { result } = renderHook(() => useDoItNow(), { wrapper });
    act(() => {
      result.current.mutate(newIntent({ blockId: BLOCK_PAST, today: TODAY }));
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(cached(queryClient)).toEqual(ORIGINAL);
  });

  it("a RETRY re-sends the SAME idempotency_key, so one press never produces two copies", async () => {
    const { wrapper } = harness();
    csrfFetchMock
      .mockResolvedValueOnce(errorResponse(500, "INTERNAL"))
      .mockResolvedValueOnce(jsonResponse(DO_IT_NOW_BODY));

    const { result } = renderHook(() => useDoItNow(), { wrapper });
    act(() => {
      result.current.mutate(newIntent({ blockId: BLOCK_PAST, today: TODAY }));
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(csrfFetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(0).idempotency_key).toBe(sentBody(1).idempotency_key);
  });

  it("invalidates the whole `calendar/range` prefix on settle", async () => {
    const { wrapper, invalidateSpy } = harness();
    csrfFetchMock.mockResolvedValue(jsonResponse(DO_IT_NOW_BODY));

    const { result } = renderHook(() => useDoItNow(), { wrapper });
    act(() => {
      result.current.mutate(newIntent({ blockId: BLOCK_PAST, today: TODAY }));
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expectInvalidatesRanges(invalidateSpy);
  });
});

// ── useAcknowledge ──────────────────────────────────────────────────────────

describe("useAcknowledge (§12.7)", () => {
  it("clears the banner BEFORE the request settles", async () => {
    const { queryClient, wrapper } = harness();
    csrfFetchMock.mockImplementation(neverSettles);

    const { result } = renderHook(() => useAcknowledge(), { wrapper });
    act(() => {
      result.current.mutate({ version_no: 7 });
    });

    await waitFor(() => {
      const value = cached(queryClient);
      expect(
        value.status === "ready"
          ? value.latest_unacknowledged_nonstudent_change
          : undefined,
      ).toBeNull();
    });
    expect(result.current.isPending).toBe(true);
  });

  it("ROLLS BACK the banner on a 409 — a failed acknowledgement must bring the banner back", async () => {
    const { queryClient, wrapper } = harness();
    csrfFetchMock.mockResolvedValue(errorResponse(409, "CALENDAR_CONFLICT"));

    const { result } = renderHook(() => useAcknowledge(), { wrapper });
    act(() => {
      result.current.mutate({ version_no: 7 });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as HttpApiError).status).toBe(409);
    expect(cached(queryClient)).toEqual(ORIGINAL);
  });

  it("ROLLS BACK the banner on a 500", async () => {
    const { queryClient, wrapper } = harness();
    csrfFetchMock.mockResolvedValue(errorResponse(500, "INTERNAL"));

    const { result } = renderHook(() => useAcknowledge(), { wrapper });
    act(() => {
      result.current.mutate({ version_no: 7 });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(cached(queryClient)).toEqual(ORIGINAL);
  });

  it("a RETRY re-sends the SAME body — §15 gives this route no key BECAUSE it is monotonic", async () => {
    const { wrapper } = harness();
    csrfFetchMock
      .mockResolvedValueOnce(errorResponse(500, "INTERNAL"))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const { result } = renderHook(() => useAcknowledge(), { wrapper });
    act(() => {
      result.current.mutate({ version_no: 7 });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(csrfFetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(0)).toEqual({ version_no: 7 });
    expect(sentBody(1)).toEqual({ version_no: 7 });
    // No key on the wire: acknowledging twice raises the same watermark to the same place.
    expect(sentBody(0).idempotency_key).toBeUndefined();
  });

  it("invalidates the whole `calendar/range` prefix on settle", async () => {
    const { wrapper, invalidateSpy } = harness();
    csrfFetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    const { result } = renderHook(() => useAcknowledge(), { wrapper });
    act(() => {
      result.current.mutate({ version_no: 7 });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expectInvalidatesRanges(invalidateSpy);
  });
});

// ── The non-optimistic mutations (§12.1, §8.1) ──────────────────────────────

describe("useRegeneratePlan (§12.1 student_refresh)", () => {
  it("does NOT paint a predicted plan — the formula lives only in PL/pgSQL", async () => {
    const { queryClient, wrapper } = harness();
    csrfFetchMock.mockImplementation(neverSettles);

    const { result } = renderHook(() => useRegeneratePlan(), { wrapper });
    act(() => {
      result.current.mutate(newIntent({}));
    });

    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(cached(queryClient)).toEqual(ORIGINAL);
  });

  it("a RETRY re-sends the SAME idempotency_key, so one Refresh is one version", async () => {
    const { wrapper, invalidateSpy } = harness();
    csrfFetchMock
      .mockResolvedValueOnce(errorResponse(500, "INTERNAL"))
      .mockResolvedValueOnce(jsonResponse(VERSION_BODY));

    const { result } = renderHook(() => useRegeneratePlan(), { wrapper });
    act(() => {
      result.current.mutate(newIntent({}));
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(csrfFetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(0).idempotency_key).toBe(sentBody(1).idempotency_key);
    expectInvalidatesRanges(invalidateSpy);
  });
});

describe("useRegenerateDay (§12.1 day_regenerate)", () => {
  it("posts to the day's own route and reuses the key across a retry", async () => {
    const { wrapper, invalidateSpy } = harness();
    csrfFetchMock
      .mockResolvedValueOnce(errorResponse(500, "INTERNAL"))
      .mockResolvedValueOnce(jsonResponse(VERSION_BODY));

    const { result } = renderHook(() => useRegenerateDay(), { wrapper });
    act(() => {
      result.current.mutate(newIntent({ date: TODAY }));
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(String(csrfFetchMock.mock.calls[0]?.[0])).toBe(
      `/api/calendar/days/${TODAY}/regenerate`,
    );
    expect(sentBody(0).idempotency_key).toBe(sentBody(1).idempotency_key);
    expectInvalidatesRanges(invalidateSpy);
  });
});

describe("useResetDay (§12.1 day_reset)", () => {
  it("posts to the reset route and reuses the key across a retry", async () => {
    const { wrapper, invalidateSpy } = harness();
    csrfFetchMock
      .mockResolvedValueOnce(errorResponse(500, "INTERNAL"))
      .mockResolvedValueOnce(jsonResponse(VERSION_BODY));

    const { result } = renderHook(() => useResetDay(), { wrapper });
    act(() => {
      result.current.mutate(newIntent({ date: TODAY }));
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(String(csrfFetchMock.mock.calls[0]?.[0])).toBe(
      `/api/calendar/days/${TODAY}/reset`,
    );
    expect(sentBody(0).idempotency_key).toBe(sentBody(1).idempotency_key);
    expectInvalidatesRanges(invalidateSpy);
  });
});

describe("useStudyProfileMutation (§8.1)", () => {
  it("PUTs the profile, paints nothing optimistically, and invalidates on settle", async () => {
    const { queryClient, wrapper, invalidateSpy } = harness();
    csrfFetchMock.mockResolvedValue(jsonResponse(PROFILE_BODY));

    const { result } = renderHook(() => useStudyProfileMutation(), { wrapper });
    act(() => {
      result.current.mutate({ daily_minutes: 60 });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const init = csrfFetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(String(csrfFetchMock.mock.calls[0]?.[0])).toBe(
      "/api/calendar/profile",
    );
    expect(init?.method).toBe("PUT");
    // A profile change can regenerate the whole horizon; the client never predicts it.
    expect(cached(queryClient)).toEqual(ORIGINAL);
    expectInvalidatesRanges(invalidateSpy);
  });

  it("surfaces a 500 as an error and leaves the cache untouched", async () => {
    const { queryClient, wrapper } = harness();
    csrfFetchMock.mockResolvedValue(errorResponse(500, "INTERNAL"));

    const { result } = renderHook(() => useStudyProfileMutation(), { wrapper });
    act(() => {
      result.current.mutate({ daily_minutes: 60 });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(cached(queryClient)).toEqual(ORIGINAL);
  });
});
