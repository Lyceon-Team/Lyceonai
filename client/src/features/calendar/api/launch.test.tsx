// @vitest-environment jsdom
/**
 * @spec [Doc_05F_Study_Calendar, §15.1 launch (INV-08-18), §17.5 states, §17.7 interaction
 *        rules; Doc_05F_formula_sheet §8 item 12 — `enabled_block_types` is ["practice"]]
 * @implemented [2026-09-22]
 *
 * plain English: pressing Start must land the student on a practice page that is ALREADY
 * loaded. That promise is kept by one string — the prefetch key — and broken silently if it
 * ever stops matching the key `resume-practice.tsx` reads with.
 *
 * WHY THESE TESTS EXIST RATHER THAN A COMMENT. A prefetch into the wrong cache slot still
 * "works": the request is made, the promise resolves, the navigation happens, and the only
 * symptom is a spinner nobody wrote a test for. So this file pins the key from BOTH ends —
 * the literal in the page's source, and the cache the practice query actually reads — and
 * asserts the query is not loading on its FIRST render after a launch. A key change on
 * either side fails here instead of degrading in production.
 */
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getQueryFn } from "@/lib/queryClient";
import { useLaunchBlock } from "./launch";
import { isLaunchableBlockType } from "../lib/blocks";

/** What `launch` resolves to, read off the hook rather than imported as a named type. */
type LaunchOutcome = Awaited<
  ReturnType<ReturnType<typeof useLaunchBlock>["launch"]>
>;

const csrfFetchMock = vi.fn();

vi.mock("@/lib/csrf", () => ({
  csrfFetch: (...args: unknown[]) => csrfFetchMock(...args),
}));

const BLOCK_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "6f1d2f5a-9f8a-4a1e-8f4c-0b2f1d3e4a5b";
const CID = "c1d0e0f0-1111-4111-8111-222222222222";
const NEXT = `/practice/session/${SESSION_ID}`;

const LAUNCH_BODY = {
  engine: "practice",
  session_id: SESSION_ID,
  next: NEXT,
  resumed: false,
};

/**
 * The two state keys, spelled out as literals — the strings `resume-practice.tsx` and
 * `resume-review.tsx` read with. Literals, not the module's builder: the assertion is that
 * the cache slot a launch warms is EXACTLY this string, and a builder shared by both sides
 * would agree with itself whatever it spelled.
 */
const PRACTICE_STATE_KEY = `/api/practice/sessions/${SESSION_ID}/state?client_instance_id=${CID}`;
const REVIEW_STATE_KEY = `/api/review/sessions/${SESSION_ID}/state?client_instance_id=${CID}`;

/** What `GET /api/practice/sessions/:id/state` answers — the payload the page renders from. */
const SESSION_STATE = {
  sessionId: SESSION_ID,
  section: "M",
  mode: "practice",
  state: "in_progress",
  currentOrdinal: 1,
  answeredCount: 0,
  targetQuestionCount: 20,
  readOnly: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, code: string): Response {
  return jsonResponse({ error: { message: `failed: ${code}`, code } }, status);
}

/**
 * The launch POST and the prefetch GET share one intercept, routed by URL, so the test never
 * has to assume an order — and the prefetch's real URL is asserted by the routing itself.
 */
function routeByUrl(launchResponse: () => Response): void {
  csrfFetchMock.mockImplementation((url: unknown) => {
    const path = String(url);
    if (path.includes("/launch")) return Promise.resolve(launchResponse());
    if (
      path.startsWith("/api/practice/sessions/") ||
      path.startsWith("/api/review/sessions/")
    ) {
      return Promise.resolve(jsonResponse(SESSION_STATE));
    }
    return Promise.resolve(jsonResponse({}));
  });
}

function harness(): {
  queryClient: QueryClient;
  wrapper: (props: { children: React.ReactNode }) => React.ReactElement;
} {
  const queryClient = new QueryClient({
    defaultOptions: {
      // The app's real default queryFn: it joins the key and fetches it (`queryClient.ts`).
      // Using it rather than a stub is what makes the URL-as-key convention load-bearing here.
      queries: { queryFn: getQueryFn({ on401: "throw" }), retry: false },
      mutations: { retry: false, retryDelay: 0 },
    },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem("lyceon_client_instance_id", CID);
});

// ── The key itself ──────────────────────────────────────────────────────────

/** Every query key the launch left in the cache — the slots it warmed, and nothing else. */
function warmedKeys(queryClient: QueryClient): unknown[] {
  return queryClient
    .getQueryCache()
    .getAll()
    .map((query) => query.queryKey);
}

/** Launches one block of `blockType` through the real hook, against `routeByUrl`. */
async function launchOne(
  blockType: "practice" | "review" | "full_length",
): Promise<{ queryClient: QueryClient; navigate: ReturnType<typeof vi.fn> }> {
  routeByUrl(() =>
    jsonResponse({
      ...LAUNCH_BODY,
      engine: blockType,
      next: `/${blockType}/session/${SESSION_ID}`,
    }),
  );
  const { queryClient, wrapper } = harness();
  const navigate = vi.fn();
  const { result } = renderHook(() => useLaunchBlock(navigate), { wrapper });
  await act(async () => {
    await result.current.launch(BLOCK_ID, blockType);
  });
  return { queryClient, navigate };
}

describe("the practice state key — the one string that stops the prefetch rotting", () => {
  it("a practice launch warms EXACTLY `/api/practice/sessions/:id/state?client_instance_id=:cid`", async () => {
    const { queryClient } = await launchOne("practice");
    expect(warmedKeys(queryClient)).toEqual([[PRACTICE_STATE_KEY]]);
    expect(queryClient.getQueryData([PRACTICE_STATE_KEY])).toEqual(
      SESSION_STATE,
    );
  });

  it("matches the literal `resume-practice.tsx` builds its query key from — the page is the other end of the contract", async () => {
    // Read as TEXT, not imported: the assertion is about the key the PAGE spells, and an
    // import would only prove this file can load that module. If the page's key is edited
    // and the launch's is not, the prefetch lands in a slot nothing reads and the spinner
    // comes back silently. That is the rot this test exists to catch.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pageSource = readFileSync(
      path.resolve(here, "../../../pages/resume-practice.tsx"),
      "utf8",
    );

    const pageLiteral =
      "`/api/practice/sessions/${sessionId}/state?client_instance_id=${clientInstanceId}`";
    expect(pageSource).toContain(pageLiteral);

    const substituted = pageLiteral
      .slice(1, -1)
      .replace("${sessionId}", SESSION_ID)
      .replace("${clientInstanceId}", CID);
    const { queryClient } = await launchOne("practice");
    expect(warmedKeys(queryClient)).toEqual([[substituted]]);
  });
});

// ── isLaunchableBlockType (formula sheet §8 item 12) ────────────────────────

describe("isLaunchableBlockType", () => {
  it("is true for the engines that are REAL — practice, review (2026-09-22) and full-length (E9b)", () => {
    expect(isLaunchableBlockType("practice")).toBe(true);
    expect(isLaunchableBlockType("review")).toBe(true);
    // E9b: the exam vertical shipped and its adapter replaced the fail-open stub, so this
    // line moved from false to true exactly as it said it would.
    expect(isLaunchableBlockType("full_length")).toBe(true);
  });
});

describe("the prefetch key is the one the landing page actually reads", () => {
  it("routes each engine to its own state key, and full_length to none", async () => {
    expect(warmedKeys((await launchOne("practice")).queryClient)).toEqual([
      [PRACTICE_STATE_KEY],
    ]);
    // resume-review.tsx:65, character for character.
    expect(warmedKeys((await launchOne("review")).queryClient)).toEqual([
      [REVIEW_STATE_KEY],
    ]);
    // Nothing warmed means "navigate without prefetching", never "prefetch the wrong key" —
    // a key nothing reads warms a slot nobody looks in and the spinner comes back silently.
    const fullLength = await launchOne("full_length");
    expect(warmedKeys(fullLength.queryClient)).toEqual([]);
    expect(fullLength.navigate).toHaveBeenCalledWith(
      `/full_length/session/${SESSION_ID}`,
    );
  });

  it("never warms the practice key for a review launch", async () => {
    // The one mistake that would look like it worked.
    const { queryClient } = await launchOne("review");
    expect(queryClient.getQueryData([REVIEW_STATE_KEY])).toEqual(SESSION_STATE);
    expect(queryClient.getQueryData([PRACTICE_STATE_KEY])).toBeUndefined();
  });
});

// ── The integration assertion ───────────────────────────────────────────────

describe("useLaunchBlock (§15.1)", () => {
  it("the practice query's FIRST render after a launch has isLoading === false — the prefetch landed in the slot the page reads", async () => {
    routeByUrl(() => jsonResponse(LAUNCH_BODY));
    const { wrapper } = harness();
    const navigate = vi.fn();

    const { result } = renderHook(() => useLaunchBlock(navigate), { wrapper });

    let outcome: LaunchOutcome | undefined;
    await act(async () => {
      outcome = await result.current.launch(BLOCK_ID, "practice");
    });

    expect(outcome?.kind).toBe("navigated");
    expect(navigate).toHaveBeenCalledWith(NEXT);

    // The same QueryClient the launch warmed. This is the page's query, spelled the way
    // `resume-practice.tsx` spells it.
    const page = renderHook(
      () =>
        useQuery<typeof SESSION_STATE>({
          queryKey: [PRACTICE_STATE_KEY],
        }),
      { wrapper },
    );

    // FIRST render, no waitFor: a spinner here is the regression.
    expect(page.result.current.isLoading).toBe(false);
    expect(page.result.current.data).toEqual(SESSION_STATE);
  });

  it("prefetches with the CLIENT INSTANCE id the launch body carried, so the two keys cannot diverge", async () => {
    routeByUrl(() => jsonResponse(LAUNCH_BODY));
    const { queryClient, wrapper } = harness();

    const { result } = renderHook(() => useLaunchBlock(vi.fn()), { wrapper });
    await act(async () => {
      await result.current.launch(BLOCK_ID, "practice");
    });

    const launchCall = csrfFetchMock.mock.calls.find(([url]) =>
      String(url).includes("/launch"),
    );
    const sent = JSON.parse(
      String((launchCall?.[1] as RequestInit | undefined)?.body),
    ) as Record<string, unknown>;
    expect(sent.client_instance_id).toBe(CID);

    expect(queryClient.getQueryData([PRACTICE_STATE_KEY])).toEqual(
      SESSION_STATE,
    );
  });

  it("awaits the prefetch BEFORE navigating — a fire-and-forget would race the route change", async () => {
    routeByUrl(() => jsonResponse(LAUNCH_BODY));
    const { queryClient, wrapper } = harness();
    let cacheAtNavigate: unknown;
    const navigate = vi.fn(() => {
      cacheAtNavigate = queryClient.getQueryData([PRACTICE_STATE_KEY]);
    });

    const { result } = renderHook(() => useLaunchBlock(navigate), { wrapper });
    await act(async () => {
      await result.current.launch(BLOCK_ID, "practice");
    });

    expect(cacheAtNavigate).toEqual(SESSION_STATE);
  });

  it("a 409 CALENDAR_ALREADY_COMPLETE returns `already_complete` and does NOT navigate (§17.5 has no 'you already did that' state)", async () => {
    routeByUrl(() => errorResponse(409, "CALENDAR_ALREADY_COMPLETE"));
    const { wrapper } = harness();
    const navigate = vi.fn();

    const { result } = renderHook(() => useLaunchBlock(navigate), { wrapper });

    let outcome: LaunchOutcome | undefined;
    await act(async () => {
      outcome = await result.current.launch(BLOCK_ID, "practice");
    });

    expect(outcome).toEqual({ kind: "already_complete" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("any OTHER error returns `failed` and does not navigate", async () => {
    routeByUrl(() => errorResponse(500, "INTERNAL"));
    const { wrapper } = harness();
    const navigate = vi.fn();

    const { result } = renderHook(() => useLaunchBlock(navigate), { wrapper });

    let outcome: LaunchOutcome | undefined;
    await act(async () => {
      outcome = await result.current.launch(BLOCK_ID, "practice");
    });

    expect(outcome?.kind).toBe("failed");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("a 409 with a DIFFERENT code is a failure, not an already-complete — the code is the discriminator", async () => {
    routeByUrl(() => errorResponse(409, "CALENDAR_MOVE_REFUSED"));
    const { wrapper } = harness();
    const navigate = vi.fn();

    const { result } = renderHook(() => useLaunchBlock(navigate), { wrapper });

    let outcome: LaunchOutcome | undefined;
    await act(async () => {
      outcome = await result.current.launch(BLOCK_ID, "practice");
    });

    expect(outcome?.kind).toBe("failed");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("nothing is prefetched when the launch fails — no cache slot is warmed for a session that does not exist", async () => {
    routeByUrl(() => errorResponse(500, "INTERNAL"));
    const { queryClient, wrapper } = harness();

    const { result } = renderHook(() => useLaunchBlock(vi.fn()), { wrapper });
    await act(async () => {
      await result.current.launch(BLOCK_ID, "practice");
    });

    await waitFor(() =>
      expect(queryClient.getQueryData([PRACTICE_STATE_KEY])).toBeUndefined(),
    );
  });
});
