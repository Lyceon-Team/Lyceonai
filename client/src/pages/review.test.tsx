// @vitest-environment jsdom
/**
 * UI-52: Review (`/review`), paid and free, rendered in the real App shell.
 *
 * @spec [student-UI register UI-52, §8 F-52; DESIGN.md §3 (Domain chips from the student's own
 *        queue; Mastery row compact; Locked mastery card), §4 Review; prototype Review.dc.html;
 *        evidence/wiring-table.md §6 Review (the endpoint behind each element); register §2
 *        (free = unlimited review, SCL-110; mastery_level only; no bank counts), OQ-22, OQ-24
 *        ruling (no past-session count), UI-16 (the picker's cursor); Doc-02B_V4 §16; brief R4
 *        §2.3 (an empty queue is not an error); ruling 17 (abandoned never appears)]
 *        | @implemented [2026-10-03]
 *
 * plain English: the page is mounted with the real query layer, the real review hooks
 * (`useReviewPool`, `useActiveReviewSessions`, `useCreateReviewSession`), the real App shell (the
 * right panel portals into it) and the real upgrade modal, over a scripted network standing in
 * for `csrfFetch`. Every request is logged, so "this element reads that endpoint" and "this
 * button sends exactly this body" are asserted from the log and the request body.
 *
 * FIXTURES FROM REAL PRODUCERS. The taxonomy is the REAL topics route's body; the feature-access
 * map is `resolveFeatureAccess`'s output; each pool row's `filters` is what `review-pool.ts` now
 * builds (`toSessionCriteria` over practice's stored `session_spec` or review's flat filters,
 * F-52); its local date and time come from the server's own `localParts`; the past-session pages
 * are cut by the server's own `pageSourceSessions` at `REVIEW_POOL_SESSIONS_PAGE_SIZE` and the
 * cursor is decoded by its `decodeSourceSessionsCursor`. Every body is parsed by its shared schema
 * before it is served.
 *
 * PRESENCE BEFORE ABSENCE. Absence checks run after the page is proven to have drawn the thing
 * whose neighbour must be absent (the queue, the chips, the rows, the mastery rows).
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { FeatureAccessMap } from "@lyceon/shared/feature-access";
import { masteryDomainsResponseSchema } from "@lyceon/shared/mastery-levels";
import type { PracticeTopicsResponse } from "@lyceon/shared/practice-reference-schema";
import {
  REVIEW_POOL_SESSIONS_PAGE_SIZE,
  reviewOpenSessionsResponseSchema,
  reviewPoolSummaryResponseSchema,
  type ReviewPoolSourceSession,
  type ReviewPoolSummaryResponse,
  type ReviewSourceEngine,
} from "@lyceon/shared/review-schema";
import { toSessionCriteria } from "@lyceon/shared/session-criteria";
import { UpgradeModalProvider } from "@/components/billing/UpgradeModal";
import { AppShell } from "@/components/layout/app-shell";
import {
  canonicalCatalogRows,
  topicsFromRoute,
} from "@/components/student-ui/filter-bar/topics.fixture";
import { PROFILE_QUERY_KEY } from "@/hooks/useProfileQuery";
import { getQueryFn } from "@/lib/queryClient";
import { resolveFeatureAccess } from "../../../server/lib/feature-access";
import { getPracticeTopics } from "../../../server/routes/practice-topics-routes";
import {
  compareSourceSessions,
  decodeSourceSessionsCursor,
  localParts,
  pageSourceSessions,
  reviewDifficultyLabel,
} from "../../../server/services/review-pool";
import ReviewPage from "./review";

// ── The network ────────────────────────────────────────────────────────────────────────────

const net = vi.hoisted(() => ({
  log: [] as string[],
  bodies: [] as Array<{ url: string; body: unknown }>,
  handlers: [] as Array<
    (url: string, init: RequestInit | undefined) => Response | undefined
  >,
  /** QA item 5: requests matching `pattern` wait for `gate` (a slow server). */
  hold: null as null | { pattern: RegExp; gate: Promise<void> },
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

vi.mock("@/lib/csrf", () => ({
  csrfFetch: async (url: string, init?: RequestInit): Promise<Response> => {
    net.log.push(`${init?.method ?? "GET"} ${url}`);
    if (net.hold !== null && net.hold.pattern.test(url)) await net.hold.gate;
    if (typeof init?.body === "string") {
      net.bodies.push({ url, body: JSON.parse(init.body) as unknown });
    }
    for (const handler of net.handlers) {
      const answer = handler(url, init);
      if (answer !== undefined) return answer;
    }
    if (url.startsWith("/api/notifications")) {
      return json({ data: { unread: 0 }, requestId: "r" });
    }
    return json({ error: "Not found" }, 404);
  },
}));

const auth = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    email: string;
    display_name: string;
    role: "student";
  },
}));
vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: auth.user,
    isLoading: false,
    authLoading: false,
    isAuthenticated: auth.user !== null,
    isAdmin: false,
    isGuardian: false,
    signOut: async () => undefined,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => undefined }),
}));

// The browser's zone, as the page reads it (the pool hook sends its own; the server is scripted).
const zone = vi.hoisted(() => ({ tz: "America/Los_Angeles" as string | null }));
vi.mock("@/hooks/useReview", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useReview")>()),
  browserTimeZone: () => zone.tz,
}));

// The server modules the producers import reach for a database; the topics route reads the
// catalog view, answered with the canonical tree; nothing else is used.
vi.mock("../../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    rpc: () => {
      throw new Error("no database in this test");
    },
    from: () => {
      throw new Error("no database in this test");
    },
  },
}));
vi.mock("../../../apps/api/src/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== "canonical_skill_catalog")
        throw new Error(`unexpected table ${table}`);
      return {
        select: () =>
          Promise.resolve({ data: canonicalCatalogRows(), error: null }),
      };
    },
  }),
}));
const entitlement = vi.hoisted(() => ({ paid: false }));
vi.mock("../../../server/services/entitlement-service", () => ({
  EntitlementService: {
    canAccessFeature: async () => entitlement.paid,
    isEntitlementActiveForProfile: async () => entitlement.paid,
  },
}));

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────

const STUDENT = "00000000-0000-4000-8000-000000000052";
const NEW_SESSION = "66666666-6666-4666-8666-666666666652";
const OPEN_FILTER = "11111111-1111-4111-8111-111111111152";
const OPEN_QUEUE = "22222222-2222-4222-8222-222222222252";
const ABANDONED = "33333333-3333-4333-8333-333333333352";

/** 2026-09-18T02:30Z is still the 17th in Los Angeles (the browser-zone case). */
const NOW_UTC = "2026-09-18T02:30:00.000Z";
const TZ = "America/Los_Angeles";

let TOPICS: PracticeTopicsResponse;
let M_DOMAINS: string[];
let RW_DOMAINS: string[];
beforeAll(async () => {
  TOPICS = await topicsFromRoute(getPracticeTopics);
  const domainsOf = (code: string): string[] =>
    TOPICS.sections
      .find((s) => s.section === code)
      ?.domains.map((d) => d.domain) ?? [];
  M_DOMAINS = domainsOf("M");
  RW_DOMAINS = domainsOf("RW");
});

async function accessMap(paid: boolean): Promise<FeatureAccessMap> {
  entitlement.paid = paid;
  const map = await resolveFeatureAccess({
    id: STUDENT,
    role: "student",
    is_under_13: false,
  });
  if (map === null) throw new Error("a student always gets a map");
  return map;
}

function mastery() {
  return masteryDomainsResponseSchema.parse({
    ok: true,
    domains: [
      {
        section: "M",
        domain: M_DOMAINS[0],
        levelKey: "L1",
        level: 1,
        displayName: "Building",
      },
      {
        section: "RW",
        domain: RW_DOMAINS[0],
        levelKey: "L3",
        level: 3,
        displayName: "Proficient",
      },
    ],
  });
}

function sessionId(n: number): string {
  return `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;
}

type Source = {
  engine: ReviewSourceEngine;
  id: string;
  createdAt: string;
  mode: string | null;
  /** What the source session row stores in `filters` (practice nests its choice). */
  stored: unknown;
  open: number;
};

/** One picker row exactly as `describeSourceSessions` now builds it (F-52). */
function poolRow(src: Source): ReviewPoolSourceSession {
  const parts = localParts(src.createdAt, TZ);
  const bag =
    src.stored && typeof src.stored === "object"
      ? (src.stored as Record<string, unknown>)
      : {};
  const filters =
    src.engine === "practice"
      ? toSessionCriteria(bag.session_spec)
      : src.engine === "review"
        ? toSessionCriteria(src.stored, reviewDifficultyLabel)
        : typeof bag.test_form_name === "string"
          ? { test_form_name: bag.test_form_name }
          : null;
  return {
    source_engine: src.engine,
    source_session_id: src.id,
    created_at: src.createdAt,
    local_date: parts.date,
    local_time: parts.time,
    mode: src.mode,
    filters,
    open_count: src.open,
  };
}

/**
 * 23 past sessions, one more than a server page plus three: a practice session (Math, the first
 * Math domain) at 2:40 PM today in Los Angeles; a review queue session yesterday; a scored
 * full-length test; then twenty older ones, alternating engine.
 */
function sources(): Source[] {
  const out: Source[] = [
    {
      engine: "practice",
      id: sessionId(1),
      createdAt: "2026-09-17T21:40:00.000Z",
      mode: "custom",
      // As practice-canonical.ts stores it: the choice under `session_spec`, bookkeeping beside.
      stored: {
        prebuilt: true,
        session_spec: { sections: ["M"], domains: [M_DOMAINS[0]] },
        selection_mode: "exact_reuse",
        requested_count: 10,
        source_pool_count: 327,
        client_instance_id: "tab-1",
      },
      open: 4,
    },
    {
      engine: "review",
      id: sessionId(2),
      createdAt: "2026-09-16T22:10:00.000Z",
      mode: "queue",
      stored: { client_instance_id: "tab-1", target_question_count: 7 },
      open: 3,
    },
    {
      engine: "full_length",
      id: sessionId(3),
      createdAt: "2026-09-15T16:05:00.000Z",
      mode: null,
      stored: { test_form_name: "Practice Test 3" },
      open: 12,
    },
  ];
  for (let i = 4; i <= 23; i += 1) {
    out.push({
      engine: i % 2 === 0 ? "practice" : "review",
      id: sessionId(i),
      createdAt: new Date(
        Date.parse("2026-09-14T18:00:00.000Z") - (i - 4) * 9 * 3_600_000,
      ).toISOString(),
      mode: i % 2 === 0 ? "custom" : "filter",
      stored:
        i % 2 === 0
          ? { session_spec: { sections: ["RW"], domains: [] } }
          : { sections: ["RW"] },
      open: 1,
    });
  }
  return out;
}

let ROWS: ReviewPoolSourceSession[] = [];

/** The pool summary for one page of the picker, cut by the server's own pager. */
function poolPage(
  cursor: string | null,
  empty = false,
): ReviewPoolSummaryResponse {
  const anchor =
    cursor === null ? null : (decodeSourceSessionsCursor(cursor) ?? null);
  const page = pageSourceSessions(
    empty ? [] : ROWS,
    anchor,
    REVIEW_POOL_SESSIONS_PAGE_SIZE,
  );
  return reviewPoolSummaryResponseSchema.parse({
    total: empty ? 0 : 23,
    timezone: TZ,
    timezoneFallback: false,
    bySection: empty
      ? []
      : [
          { key: "M", count: 15 },
          { key: "RW", count: 8 },
        ],
    byDomain: empty
      ? []
      : [
          { key: M_DOMAINS[0], count: 9 },
          { key: M_DOMAINS[1], count: 6 },
          { key: RW_DOMAINS[0], count: 8 },
        ],
    bySkill: [],
    sessions: page.rows,
    sessions_next_cursor: page.nextCursor,
  });
}

function openSessions(): unknown {
  const parsed = reviewOpenSessionsResponseSchema.parse({
    sessions: [
      {
        id: OPEN_FILTER,
        section: "M",
        mode: "filter",
        status: "active",
        created_at: "2026-09-17T20:00:00.000Z",
        target_question_count: 5,
        total_items: 5,
        answered_items: 2,
        criteria: toSessionCriteria(
          { sections: ["M"], domains: [M_DOMAINS[0]] },
          reviewDifficultyLabel,
        ),
      },
      {
        id: OPEN_QUEUE,
        section: null,
        mode: "queue",
        status: "created",
        created_at: "2026-09-17T19:00:00.000Z",
        target_question_count: 17,
        total_items: 17,
        answered_items: 0,
        criteria: toSessionCriteria({}, reviewDifficultyLabel),
      },
    ],
    maxConcurrentSessions: 5,
    requestId: "r",
  });
  // A closed row the client must drop before it parses (ruling 17), alongside the two open ones.
  return {
    ...parsed,
    sessions: [
      ...parsed.sessions,
      {
        ...parsed.sessions[0],
        id: ABANDONED,
        status: "abandoned",
        criteria: toSessionCriteria({ domains: ["Abandoned Domain"] }),
      },
    ],
  };
}

type Scenario = {
  pool?: "full" | "empty" | "error" | "tz-fallback";
  open?: boolean;
  max?: number;
};

function install(s: Scenario): void {
  net.handlers = [
    (url, init) => {
      const [path, query = ""] = url.split("?");
      const method = init?.method ?? "GET";
      if (path === "/api/practice/topics") return json(TOPICS);
      if (path === `/api/students/${STUDENT}/mastery/domains`)
        return json(mastery());
      if (path === "/api/review/sessions/open") {
        const body = openSessions() as { sessions: unknown[] };
        return json(
          s.open === false
            ? { ...body, sessions: [], maxConcurrentSessions: s.max ?? 5 }
            : { ...body, maxConcurrentSessions: s.max ?? 5 },
        );
      }
      if (path === "/api/review/pool") {
        if (s.pool === "error") return json({ error: "boom" }, 500);
        const cursor = new URLSearchParams(query).get("sessions_cursor");
        const page = poolPage(cursor, s.pool === "empty");
        return json(
          s.pool === "tz-fallback"
            ? { ...page, timezone: "UTC", timezoneFallback: true }
            : page,
        );
      }
      if (method === "POST" && path === "/api/review/sessions")
        return json({ sessionId: NEW_SESSION, id: NEW_SESSION });
      if (
        method === "POST" &&
        path === `/api/review/sessions/${OPEN_FILTER}/terminate`
      )
        return json({
          sessionId: OPEN_FILTER,
          state: "abandoned",
          readOnly: true,
        });
      return undefined;
    },
  ];
}

// ── Mount ──────────────────────────────────────────────────────────────────────────────────

async function mount(
  plan: "paid" | "free",
  scenario: Scenario = {},
): Promise<{ container: HTMLElement; history: string[] }> {
  install(scenario);
  const map = await accessMap(plan === "paid");
  const { hook, history } = memoryLocation({ path: "/review", record: true });
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: getQueryFn({ on401: "throw" }),
        retry: false,
        staleTime: Infinity,
      },
      mutations: { retry: false },
    },
  });
  client.setQueryData(PROFILE_QUERY_KEY, {
    authenticated: true,
    featureAccess: map,
    user: null,
  });
  const { container } = render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <UpgradeModalProvider autoOpenOnDenial>
          <AppShell panel={360} footer>
            <ReviewPage />
          </AppShell>
        </UpgradeModalProvider>
      </Router>
    </QueryClientProvider>,
  );
  await screen.findByTestId("review");
  return { container, history };
}

function gets(): string[] {
  return net.log.filter((l) => l.startsWith("GET ")).map((l) => l.slice(4));
}

function startBodies(): Array<Record<string, unknown>> {
  return net.bodies
    .filter((b) => b.url === "/api/review/sessions")
    .map((b) => b.body as Record<string, unknown>);
}

/** The create body without its per-request ids (asserted separately). */
function startSpec(body: Record<string, unknown>): Record<string, unknown> {
  const { client_instance_id, idempotency_key, ...rest } = body;
  expect(typeof client_instance_id).toBe("string");
  expect(typeof idempotency_key).toBe("string");
  return rest;
}

async function openPast(): Promise<HTMLElement> {
  const toggle = await screen.findByTestId("review-past-toggle");
  fireEvent.click(toggle);
  return screen.findByTestId("review-past-list");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW_UTC));
  zone.tz = TZ;
  ROWS = sources().map(poolRow).sort(compareSourceSessions);
  net.log.length = 0;
  net.bodies.length = 0;
  net.handlers = [];
  net.hold = null;
  auth.user = {
    id: STUDENT,
    email: "sam@example.test",
    display_name: "Sam Rivera",
    role: "student",
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ── Queue card ─────────────────────────────────────────────────────────────────────────────

describe("queue card (DESIGN.md §4: 'N questions to review', Start reviewing)", () => {
  it("shows the pool's own total and starts a queue session, landing in the runner", async () => {
    const { history } = await mount("paid");
    const total = await screen.findByTestId("review-queue-total");
    expect(total.textContent).toBe("23 questions to review");
    expect(gets().some((g) => g.startsWith("/api/review/pool"))).toBe(true);

    const startBtn = screen.getByTestId("button-start-queue");
    expect(startBtn.textContent).toBe("Start reviewing");
    // The one filled primary action in the main column (DESIGN.md §1); a pressed toggle
    // (the section switch) is a selected state, not an action.
    const main = screen.getByTestId("review");
    expect(
      [...main.querySelectorAll("button:not([aria-pressed])")].filter((b) =>
        b.className.includes("bg-lyc-primary-bg"),
      ),
    ).toEqual([startBtn]);

    fireEvent.click(startBtn);
    await waitFor(() => expect(startBodies()).toHaveLength(1));
    expect(startSpec(startBodies()[0]!)).toEqual({ mode: "queue" });
    await waitFor(() =>
      expect(history.at(-1)).toBe(`/review/session/${NEW_SESSION}`),
    );
  });

  it("an empty queue shows the friendly empty state, not an error, with no topic or past list", async () => {
    await mount("paid", { pool: "empty" });
    const empty = await screen.findByTestId("review-empty-state");
    expect(empty.textContent).toContain("Nothing to review yet");
    expect(empty.textContent).toContain(
      "Questions you miss or skip in practice show up here.",
    );
    expect(screen.queryByTestId("review-pool-error")).toBeNull();
    expect(empty.className).not.toMatch(/danger|red|destructive/);
    expect(screen.queryByTestId("review-topic-picker")).toBeNull();
    expect(screen.queryByTestId("review-session-picker")).toBeNull();
    expect(
      within(empty).getByRole("button", { name: "Go to Practice" }),
    ).toBeTruthy();
  });

  it("a pool that fails to LOAD gets the error notice instead; the two are different", async () => {
    await mount("paid", { pool: "error" });
    const error = await screen.findByTestId("review-pool-error");
    expect(error.textContent).toContain("Couldn't load your review queue");
    expect(screen.queryByTestId("review-empty-state")).toBeNull();
  });

  it("says so when the server fell back to UTC", async () => {
    await mount("paid", { pool: "tz-fallback" });
    expect(
      (await screen.findByTestId("review-tz-fallback")).textContent,
    ).toContain("Times are shown in UTC");
  });
});

// ── Open sessions ──────────────────────────────────────────────────────────────────────────

describe("open sessions (OQ-22: named by their criteria, End and Continue)", () => {
  it("names each open session by its criteria, shows progress, and never shows an abandoned one", async () => {
    await mount("paid");
    const rows = await screen.findAllByTestId("review-open-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain(M_DOMAINS[0]);
    expect(rows[0]?.textContent).toContain("2 of 5 answered");
    expect(rows[1]?.textContent).toContain("Review session");
    expect(rows[1]?.textContent).toContain("0 of 17 answered");
    expect(
      within(rows[0] as HTMLElement)
        .getByRole("link", { name: "Continue" })
        .getAttribute("href"),
    ).toBe(`/review/session/${OPEN_FILTER}`);
    // The served payload carried an abandoned row; the page drew none of it.
    expect(document.body.textContent).not.toContain("Abandoned Domain");
  });

  it("End asks first, then terminates that session", async () => {
    await mount("paid");
    const rows = await screen.findAllByTestId("review-open-row");
    fireEvent.click(
      within(rows[0] as HTMLElement).getByRole("button", {
        name: `End ${M_DOMAINS[0]}`,
      }),
    );
    const modal = await screen.findByTestId("review-end-modal");
    expect(modal.textContent).toContain("End this review session?");
    expect(net.log).not.toContain(
      `POST /api/review/sessions/${OPEN_FILTER}/terminate`,
    );
    fireEvent.click(within(modal).getByRole("button", { name: "End session" }));
    await waitFor(() =>
      expect(net.log).toContain(
        `POST /api/review/sessions/${OPEN_FILTER}/terminate`,
      ),
    );
  });

  it("at the open-session limit, says so and disables every start", async () => {
    await mount("paid", { max: 2 });
    const limit = await screen.findByTestId("review-limit");
    expect(limit.textContent).toContain(
      "You have 2 open review sessions. Finish or end one first.",
    );
    expect(
      (screen.getByTestId("button-start-queue") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("button-start-topic") as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

// ── Review by topic ────────────────────────────────────────────────────────────────────────

describe("Review by topic (section switch; domain chips counted from the student's own queue)", () => {
  it("chips are the section's domains with the queue's own counts; several may be chosen and started", async () => {
    await mount("paid");
    const picker = await screen.findByTestId("review-topic-picker");
    const math = within(picker).getByRole("button", { name: "Math" });
    expect(math.getAttribute("aria-pressed")).toBe("true");
    const chips = within(picker).getAllByTestId("review-domain-chip");
    expect(chips.map((c) => c.textContent)).toEqual([
      `${M_DOMAINS[0]} (9)`,
      `${M_DOMAINS[1]} (6)`,
      `${M_DOMAINS[2]} (0)`,
      `${M_DOMAINS[3]} (0)`,
    ]);
    // A domain with nothing waiting cannot be chosen.
    expect((chips[2] as HTMLButtonElement).disabled).toBe(true);
    // Nothing chosen: the whole section's own count.
    expect(screen.getByTestId("review-topic-summary").textContent).toBe(
      "15 waiting in Math",
    );

    fireEvent.click(chips[0] as HTMLElement);
    fireEvent.click(chips[1] as HTMLElement);
    expect(chips[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("review-topic-summary").textContent).toBe(
      `15 waiting in ${M_DOMAINS[0]}, ${M_DOMAINS[1]}`,
    );
    const cta = screen.getByTestId("button-start-topic");
    expect(cta.textContent).toBe("Review these 15");
    fireEvent.click(cta);
    await waitFor(() => expect(startBodies()).toHaveLength(1));
    expect(startSpec(startBodies()[0]!)).toEqual({
      mode: "filter",
      filters: { sections: ["M"], domains: [M_DOMAINS[0], M_DOMAINS[1]] },
    });
  });

  it("the section switch shows that section's chips and clears the choice", async () => {
    await mount("paid");
    const picker = await screen.findByTestId("review-topic-picker");
    fireEvent.click(within(picker).getAllByTestId("review-domain-chip")[0]!);
    fireEvent.click(
      within(picker).getByRole("button", { name: "Reading & Writing" }),
    );
    const chips = within(picker).getAllByTestId("review-domain-chip");
    expect(chips[0]?.textContent).toBe(`${RW_DOMAINS[0]} (8)`);
    expect(chips.every((c) => c.getAttribute("aria-pressed") === "false")).toBe(
      true,
    );
    expect(screen.getByTestId("review-topic-summary").textContent).toBe(
      "8 waiting in Reading & Writing",
    );
    fireEvent.click(screen.getByTestId("button-start-topic"));
    await waitFor(() => expect(startBodies()).toHaveLength(1));
    expect(startSpec(startBodies()[0]!)).toEqual({
      mode: "filter",
      filters: { sections: ["RW"] },
    });
  });
});

// ── Redo a past session ────────────────────────────────────────────────────────────────────

describe("Redo a past session (collapsed; grouped by date; 5, then Load more over the UI-16 cursor; no count)", () => {
  it("is collapsed and reads 'Past sessions' with no count (OQ-24)", async () => {
    await mount("paid");
    const toggle = await screen.findByTestId("review-past-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toBe("Past sessions");
    expect(screen.queryAllByTestId("review-past-row")).toHaveLength(0);
  });

  it("opens to five rows grouped by the browser's own day, each named by its criteria", async () => {
    await mount("paid");
    const list = await openPast();
    expect(
      screen.getByTestId("review-past-toggle").getAttribute("aria-expanded"),
    ).toBe("true");
    const rows = within(list).getAllByTestId("review-past-row");
    expect(rows).toHaveLength(5);
    const days = within(list)
      .getAllByTestId("review-past-day")
      .map((d) => d.textContent);
    // 2:40 PM on the 17th in Los Angeles IS today there (computing today in UTC says Yesterday).
    expect(days[0]).toBe("Today");
    expect(days[1]).toBe("Yesterday");
    expect(rows[0]?.textContent).toContain("Practice, 2:40 PM");
    // F-52: the practice row names its criteria (it used to read "Mixed").
    expect(rows[0]?.textContent).toContain(`Math · ${M_DOMAINS[0]}`);
    expect(rows[0]?.textContent).toContain("4 to review");
    expect(rows[1]?.textContent).toContain("Review, 3:10 PM");
    expect(rows[2]?.textContent).toContain("Full-length test, 9:05 AM");
    // OQ-62 (b): the source label is never "Practice test". The form's own name, a database
    // value, is "Practice Test 3" on the wire and is shown as "Full-Length Test 3" (owner ruling
    // 2026-10-05, `displayFormName`).
    expect(list.textContent).not.toMatch(/\bPractice test\b/);
    expect(rows[2]?.textContent).toContain("Full-Length Test 3");
    expect(list.textContent).not.toContain("Practice Test");
    expect(rows[2]?.textContent).toContain("12 to review");
  });

  it("Load more adds five at a time and asks the server for its next page by cursor", async () => {
    await mount("paid");
    const list = await openPast();
    const more = (): HTMLElement =>
      screen.getByTestId("button-review-more-sessions");
    expect(more().textContent).toBe("Load more");
    for (const expected of [10, 15, 20]) {
      fireEvent.click(more());
      expect(within(list).getAllByTestId("review-past-row")).toHaveLength(
        expected,
      );
    }
    // Page 1 held 20 rows: no cursor read yet.
    expect(gets().filter((g) => g.includes("sessions_cursor="))).toHaveLength(
      0,
    );
    fireEvent.click(more());
    await waitFor(() =>
      expect(within(list).getAllByTestId("review-past-row")).toHaveLength(23),
    );
    const cursorReads = gets().filter((g) => g.includes("sessions_cursor="));
    expect(cursorReads).toHaveLength(1);
    expect(screen.queryByTestId("button-review-more-sessions")).toBeNull();
    // No total of past sessions anywhere (OQ-24).
    expect(screen.getByTestId("review-session-picker").textContent).not.toMatch(
      /Past sessions \(|\b23\b/,
    );
  });

  it("Redo starts a session over that past session", async () => {
    const { history } = await mount("paid");
    const list = await openPast();
    fireEvent.click(within(list).getAllByTestId("review-past-redo")[2]!);
    await waitFor(() => expect(startBodies()).toHaveLength(1));
    expect(startSpec(startBodies()[0]!)).toEqual({
      mode: "session",
      filters: {
        source_engine: "full_length",
        source_session_id: sessionId(3),
      },
    });
    await waitFor(() =>
      expect(history.at(-1)).toBe(`/review/session/${NEW_SESSION}`),
    );
  });

  it("'Review by topic' sits above the past-sessions list (R4.1)", async () => {
    await mount("paid");
    const topic = await screen.findByTestId("review-topic-picker");
    const past = screen.getByTestId("review-session-picker");
    expect(
      topic.compareDocumentPosition(past) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

// ── Right panel ────────────────────────────────────────────────────────────────────────────

describe("right panel: what's waiting by section, and mastery", () => {
  it("paid: waiting by section from the pool, and compact mastery rows from mastery/domains", async () => {
    await mount("paid");
    const panel = await screen.findByTestId("review-panel");
    await waitFor(() =>
      expect(
        within(panel).getAllByTestId("review-waiting-row")[0]?.textContent,
      ).toBe("Math15"),
    );
    expect(
      within(panel).getAllByTestId("review-waiting-row")[1]?.textContent,
    ).toBe("Reading & Writing8");
    // The one rule, stated right (one correct answer graduates a question): never "twice".
    expect(panel.textContent).toContain(
      "Get a question right once and it leaves your queue.",
    );
    expect(document.body.textContent).not.toContain("twice");

    const rows = await within(panel).findAllByTestId("mastery-row");
    expect(rows).toHaveLength(8);
    expect(gets()).toContain(`/api/students/${STUDENT}/mastery/domains`);
    expect(within(panel).queryByTestId("locked-mastery-card")).toBeNull();
    expect(
      within(panel)
        .getByRole("link", { name: "See every skill" })
        .getAttribute("href"),
    ).toBe("/mastery");
  });

  it("free: the locked card, no mastery read, and its button opens the upgrade modal in place", async () => {
    await mount("free");
    const panel = await screen.findByTestId("review-panel");
    const card = await within(panel).findByTestId("locked-mastery-card");
    expect(within(panel).queryAllByTestId("mastery-row")).toHaveLength(0);
    expect(gets().some((g) => g.includes("/mastery/"))).toBe(false);
    fireEvent.click(within(card).getByTestId("locked-mastery-see-included"));
    expect(await screen.findByTestId("upgrade-modal")).toBeTruthy();
  });
});

// ── Free plan: full review ─────────────────────────────────────────────────────────────────

describe("free plan has full review (SCL-110): nothing on the review path is gated", () => {
  it("free gets the queue, open sessions, topics and past sessions, starts a session, and sees no upgrade prompt", async () => {
    const { history } = await mount("free");
    expect((await screen.findByTestId("review-queue-total")).textContent).toBe(
      "23 questions to review",
    );
    expect(await screen.findAllByTestId("review-open-row")).toHaveLength(2);
    expect(
      (await screen.findByTestId("review-topic-picker")).textContent,
    ).toContain(`${M_DOMAINS[0]} (9)`);
    const list = await openPast();
    expect(within(list).getAllByTestId("review-past-row")).toHaveLength(5);
    const main = screen.getByTestId("review");
    const panel = screen.getByTestId("review-panel");
    // The only gated thing is the panel's mastery card; the main column offers no upgrade.
    const mainOnly = (main.textContent ?? "").replace(
      panel.textContent ?? "",
      "",
    );
    expect(mainOnly).not.toMatch(/upgrade|See plans|paid plan|Unlock/i);
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();

    fireEvent.click(screen.getByTestId("button-start-queue"));
    await waitFor(() =>
      expect(history.at(-1)).toBe(`/review/session/${NEW_SESSION}`),
    );
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
  });
});

// ── Owner QA list (Karl, 2026-10-07) item 5 ───────────────────────────────────────────────────

describe("QA item 5: Review's starts show a pending state from the first click", () => {
  it("Start reviewing: 'Starting…', disabled and busy while the create is in flight; one create; the other starts wait", async () => {
    let release: () => void = () => undefined;
    net.hold = {
      pattern: /^\/api\/review\/sessions$/,
      gate: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    const { history } = await mount("paid");
    await screen.findByTestId("review-queue-total");
    const start = screen.getByTestId("button-start-queue") as HTMLButtonElement;
    expect(start.textContent).toBe("Start reviewing");
    fireEvent.click(start);
    expect(start.textContent).toBe("Starting…");
    expect(start.disabled).toBe(true);
    expect(start.getAttribute("aria-busy")).toBe("true");
    expect(within(start).getByTestId("button-pending-spinner")).toBeTruthy();
    // Every other start waits, and none of them claims to be the one starting.
    const topic = screen.getByTestId("button-start-topic") as HTMLButtonElement;
    expect(topic.disabled).toBe(true);
    expect(topic.getAttribute("aria-busy")).toBeNull();
    fireEvent.click(start);
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(history.at(-1)).toBe(`/review/session/${NEW_SESSION}`),
    );
    expect(startBodies()).toHaveLength(1);
  });

  it("the topic picker's start: that button says 'Starting…', Start reviewing keeps its label", async () => {
    net.hold = {
      pattern: /^\/api\/review\/sessions$/,
      gate: new Promise<void>(() => undefined),
    };
    await mount("paid");
    await screen.findByTestId("review-queue-total");
    const topic = screen.getByTestId("button-start-topic") as HTMLButtonElement;
    fireEvent.click(topic);
    expect(topic.textContent).toBe("Starting…");
    expect(topic.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByTestId("button-start-queue").textContent).toBe(
      "Start reviewing",
    );
  });
});
