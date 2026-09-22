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
import {
  isLaunchable,
  stateKeyForEngine,
  practiceStateKey,
  useLaunchBlock,
  type LaunchOutcome,
} from "./launch";
import { isLaunchableBlockType } from "../lib/blocks";

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
    if (path.startsWith("/api/practice/sessions/")) {
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

describe("practiceStateKey — the one string that stops the prefetch rotting", () => {
  it("returns EXACTLY `/api/practice/sessions/:id/state?client_instance_id=:cid`", () => {
    expect(practiceStateKey(SESSION_ID, CID)).toBe(
      `/api/practice/sessions/${SESSION_ID}/state?client_instance_id=${CID}`,
    );
  });

  it("matches the literal `resume-practice.tsx` builds its query key from — the page is the other end of the contract", () => {
    // Read as TEXT, not imported: the assertion is about the key the PAGE spells, and an
    // import would only prove this file can load that module. If the page's key is edited
    // and `practiceStateKey` is not, the prefetch lands in a slot nothing reads and the
    // spinner comes back silently. That is the rot this test exists to catch.
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
    expect(practiceStateKey(SESSION_ID, CID)).toBe(substituted);
  });
});

// ── isLaunchable (formula sheet §8 item 12) ─────────────────────────────────

describe("isLaunchable", () => {
  it("is true for the engines that are REAL — practice and, since 2026-09-22, review", () => {
    expect(isLaunchable({ block_type: "practice" })).toBe(true);
    expect(isLaunchable({ block_type: "review" })).toBe(true);
    // Full-length is still the fail-open stub, so its control reads "Coming soon" and
    // never calls launch. When the exam vertical ships, this line moves and the sheet's
    // branch goes with it.
    expect(isLaunchable({ block_type: "full_length" })).toBe(false);
  });

  it("is the SAME rule the view model uses — one definition, not two that agree by luck", () => {
    // Until this change the rule existed twice: here, and as a hand-written
    // `block.block_type === "practice"` in view-model.ts. They agreed by coincidence, and
    // the moment review shipped the launch path accepted it while the card still drew
    // "Coming soon". Both now call `isLaunchableBlockType`.
    for (const blockType of ["practice", "review", "full_length"] as const) {
      expect(isLaunchable({ block_type: blockType })).toBe(
        isLaunchableBlockType(blockType),
      );
    }
  });
});

describe("the prefetch key is the one the landing page actually reads", () => {
  it("routes each engine to its own state key, and full_length to none", () => {
    expect(stateKeyForEngine("practice", "s1", "ci")).toBe(
      "/api/practice/sessions/s1/state?client_instance_id=ci",
    );
    // resume-review.tsx:65, character for character.
    expect(stateKeyForEngine("review", "s1", "ci")).toBe(
      "/api/review/sessions/s1/state?client_instance_id=ci",
    );
    // Null means "navigate without prefetching", never "prefetch the wrong key" — a key
    // nothing reads warms a slot nobody looks in and the spinner comes back silently.
    expect(stateKeyForEngine("full_length", "s1", "ci")).toBeNull();
  });

  it("never returns the practice key for a review launch", () => {
    // The one mistake that would look like it worked.
    expect(stateKeyForEngine("review", "s1", "ci")).not.toBe(
      stateKeyForEngine("practice", "s1", "ci"),
    );
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
      outcome = await result.current.launch(BLOCK_ID);
    });

    expect(outcome?.kind).toBe("navigated");
    expect(navigate).toHaveBeenCalledWith(NEXT);

    // The same QueryClient the launch warmed. This is the page's query, spelled the way
    // `resume-practice.tsx` spells it.
    const page = renderHook(
      () =>
        useQuery<typeof SESSION_STATE>({
          queryKey: [practiceStateKey(SESSION_ID, CID)],
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
      await result.current.launch(BLOCK_ID);
    });

    const launchCall = csrfFetchMock.mock.calls.find(([url]) =>
      String(url).includes("/launch"),
    );
    const sent = JSON.parse(
      String((launchCall?.[1] as RequestInit | undefined)?.body),
    ) as Record<string, unknown>;
    expect(sent.client_instance_id).toBe(CID);

    expect(
      queryClient.getQueryData([practiceStateKey(SESSION_ID, CID)]),
    ).toEqual(SESSION_STATE);
  });

  it("awaits the prefetch BEFORE navigating — a fire-and-forget would race the route change", async () => {
    routeByUrl(() => jsonResponse(LAUNCH_BODY));
    const { queryClient, wrapper } = harness();
    let cacheAtNavigate: unknown;
    const navigate = vi.fn(() => {
      cacheAtNavigate = queryClient.getQueryData([
        practiceStateKey(SESSION_ID, CID),
      ]);
    });

    const { result } = renderHook(() => useLaunchBlock(navigate), { wrapper });
    await act(async () => {
      await result.current.launch(BLOCK_ID);
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
      outcome = await result.current.launch(BLOCK_ID);
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
      outcome = await result.current.launch(BLOCK_ID);
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
      outcome = await result.current.launch(BLOCK_ID);
    });

    expect(outcome?.kind).toBe("failed");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("nothing is prefetched when the launch fails — no cache slot is warmed for a session that does not exist", async () => {
    routeByUrl(() => errorResponse(500, "INTERNAL"));
    const { queryClient, wrapper } = harness();

    const { result } = renderHook(() => useLaunchBlock(vi.fn()), { wrapper });
    await act(async () => {
      await result.current.launch(BLOCK_ID);
    });

    await waitFor(() =>
      expect(
        queryClient.getQueryData([practiceStateKey(SESSION_ID, CID)]),
      ).toBeUndefined(),
    );
  });
});
