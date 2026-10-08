// @vitest-environment jsdom
/**
 * UI-51: Practice (`/practice`), paid and free, rendered in the real App shell.
 *
 * @spec [student-UI register UI-51, §6 UI-43 (the bar's value is `SessionCriteria`); DESIGN.md
 *        §3 (Filter bar, Mastery row compact, Locked mastery card), §4 Practice; prototype
 *        Practice.dc.html; evidence/wiring-table.md §4 Practice (the endpoint behind each
 *        element); register §2 (free = 40 a day; mastery_level only; no raw accuracy; no bank
 *        counts; "Suggested for you" is paid-only), OQ-21, OQ-22, OQ-23, OQ-29]
 *        | @implemented [2026-10-03]
 *
 * plain English: the page is mounted with the real query layer, the real App shell (the right
 * panel portals into it), the real upgrade modal, the real filter bar and the real
 * `usePractice`, over a scripted network standing in for `csrfFetch`. Every request is logged,
 * so "this element reads that endpoint" and "Start sends exactly these criteria" are asserted
 * from the log and from the request body.
 *
 * FIXTURES FROM REAL PRODUCERS. The taxonomy is the REAL topics route's body over the canonical
 * catalog (`topics.fixture.ts`, shared with the filter bar's tests). The feature-access map is
 * `resolveFeatureAccess`'s output; the quota is `toPracticeQuota`'s; session criteria come from
 * `toSessionCriteria`; every other body is parsed by its shared schema before it is served. The
 * two refusal bodies (402, 422) are written as `practice-canonical.ts` builds them (cited at
 * each), since no shared schema describes them.
 *
 * PRESENCE BEFORE ABSENCE. The no-count and no-percent checks run after the page is proven to
 * have drawn the filter bar, the summary, the quota line, suggestions, recent practice and the
 * mastery rows, and after the payloads are proven to carry a bank-sized figure.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
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
import { practiceOpenSessionsResponseSchema } from "@lyceon/shared/practice-response-schema";
import { reviewPoolSummaryResponseSchema } from "@lyceon/shared/review-schema";
import {
  sessionCriteriaSchema,
  toSessionCriteria,
} from "@lyceon/shared/session-criteria";
import { UpgradeModalProvider } from "@/components/billing/UpgradeModal";
import { AppShell } from "@/components/layout/app-shell";
import {
  canonicalCatalogRows,
  topicsFromRoute,
} from "@/components/student-ui/filter-bar/topics.fixture";
import { PROFILE_QUERY_KEY } from "@/hooks/useProfileQuery";
import { usePractice } from "@/hooks/usePractice";
import { getQueryFn } from "@/lib/queryClient";
import { resolveFeatureAccess } from "../../../server/lib/feature-access";
import { toPracticeQuota } from "../../../server/lib/practice-quota";
import { getPracticeTopics } from "../../../server/routes/practice-topics-routes";
import Practice from "./practice";

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

const STUDENT = "00000000-0000-4000-8000-000000000051";
const NEW_SESSION = "66666666-6666-4666-8666-666666666666";
const OPEN_ID = "11111111-1111-4111-8111-111111111111";
const PAST_PRACTICE = "22222222-2222-4222-8222-222222222222";
const PAST_REVIEW = "33333333-3333-4333-8333-333333333333";

let TOPICS: PracticeTopicsResponse;
beforeAll(async () => {
  TOPICS = await topicsFromRoute(getPracticeTopics);
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

/**
 * Math: Algebra L2, Advanced Math L0, Problem Solving unmeasured (no row), Geometry L0. The two
 * lowest are the two L0 domains, in canonical order; the unmeasured domain is not among them.
 */
const MASTERY = masteryDomainsResponseSchema.parse({
  ok: true,
  domains: [
    {
      section: "M",
      domain: "Algebra",
      levelKey: "L2",
      level: 2,
      displayName: "Developing",
    },
    {
      section: "M",
      domain: "Geometry and Trigonometry",
      levelKey: "L0",
      level: 0,
      displayName: "Foundations",
    },
    {
      section: "M",
      domain: "Advanced Math",
      levelKey: "L0",
      level: 0,
      displayName: "Foundations",
    },
    {
      section: "RW",
      domain: "Craft and Structure",
      levelKey: "L3",
      level: 3,
      displayName: "Proficient",
    },
    {
      section: "RW",
      domain: "Information and Ideas",
      levelKey: "L1",
      level: 1,
      displayName: "Building",
    },
  ],
});

function openSessions(withOpen: boolean, max = 5) {
  return practiceOpenSessionsResponseSchema.parse({
    sessions: withOpen
      ? [
          {
            id: OPEN_ID,
            section: "M",
            mode: "custom",
            status: "active",
            created_at: "2026-09-30T14:00:00Z",
            target_question_count: 10,
            total_items: 10,
            answered_items: 3,
            criteria: toSessionCriteria({
              sections: ["M"],
              domains: ["Algebra"],
            }),
          },
        ]
      : [],
    maxConcurrentSessions: max,
    // The seeded practice_runtime_config values (OQ-68 (d): config numbers on this read).
    diagnosticTotalQuestions: 40,
    diagnosticPerDomain: 5,
    requestId: "r",
  });
}

/**
 * Two past sessions with open misses: one practice, one review. Since F-52 the pool sends each
 * row's criteria only (`toSessionCriteria`), never the stored `filters` with `source_pool_count`;
 * the strict schema refuses a row that carries it (asserted below).
 */
const POOL = reviewPoolSummaryResponseSchema.parse({
  total: 6,
  timezone: "UTC",
  timezoneFallback: false,
  bySection: [],
  byDomain: [],
  bySkill: [],
  sessions: [
    {
      source_engine: "practice",
      source_session_id: PAST_PRACTICE,
      created_at: "2026-09-25T17:49:00Z",
      local_date: "2026-09-25",
      local_time: "12:49 PM",
      mode: "custom",
      // As review-pool.ts sends it (F-52): the four criteria arrays only.
      filters: {
        sections: ["M"],
        domains: ["Algebra"],
        skills: [],
        difficulties: [],
      },
      open_count: 4,
    },
    {
      source_engine: "review",
      source_session_id: PAST_REVIEW,
      created_at: "2026-09-24T02:12:00Z",
      local_date: "2026-09-24",
      local_time: "2:12 AM",
      mode: "queue",
      filters: null,
      open_count: 2,
    },
  ],
  sessions_next_cursor: null,
});

function quota(remaining: number | "unlimited") {
  const result = toPracticeQuota(
    remaining === "unlimited"
      ? {
          allowed: true,
          code: "PRACTICE_BYPASS_ENTITLED",
          message: "",
          limitType: "practice",
          current: null,
          limit: null,
          remaining: null,
          resetAt: null,
          cooldownUntil: null,
          reservationId: null,
          duplicate: false,
        }
      : {
          allowed: remaining > 0,
          code:
            remaining > 0
              ? "PRACTICE_QUOTA_OK"
              : "PRACTICE_FREE_DAILY_QUOTA_EXCEEDED",
          message: "",
          limitType: "practice",
          current: 40 - remaining,
          limit: 40,
          remaining,
          resetAt: "2026-10-02T05:00:00.000Z",
          cooldownUntil: null,
          reservationId: null,
          duplicate: false,
        },
    // `freeDailyLimitFor`: the seeded daily_quota_free (OQ-68 (d)).
    40,
  );
  if (!result.ok) throw new Error("quota fixture did not serialize");
  return result.value;
}

/** The 402 `startOrReplaySession` returns from the quota dry run (practice-canonical.ts). */
const QUOTA_402 = {
  error: "Usage limit reached",
  code: "PRACTICE_FREE_DAILY_QUOTA_EXCEEDED",
  limitType: "practice",
  current: 40,
  limit: 40,
  remaining: 0,
  resetAt: "2026-10-02T05:00:00.000Z",
  message: "You've reached your daily practice question limit.",
  requestId: "r",
};

/** The 422 for a pool the filters leave empty (practice-canonical.ts), plus the requestId. */
const POOL_EMPTY_422 = {
  error: "empty_pool",
  code: "PRACTICE_POOL_EMPTY",
  message: "No questions match the requested filters.",
  requestId: "r",
};

type Scenario = {
  quota?: number | "unlimited";
  open?: boolean;
  max?: number;
  start?: "ok" | "402" | "422";
};

function install(s: Scenario): void {
  net.handlers = [
    (url, init) => {
      const path = url.split("?")[0];
      const method = init?.method ?? "GET";
      if (path === "/api/practice/topics") return json(TOPICS);
      if (path === `/api/students/${STUDENT}/mastery/domains`)
        return json(MASTERY);
      if (path === "/api/practice/sessions/open")
        return json(openSessions(s.open ?? false, s.max ?? 5));
      if (path === "/api/review/pool") return json(POOL);
      if (path === "/api/practice/quota") return json(quota(s.quota ?? 12));
      if (method === "POST" && path === "/api/practice/sessions") {
        if (s.start === "402") return json(QUOTA_402, 402);
        if (s.start === "422") return json(POOL_EMPTY_422, 422);
        return json({ id: NEW_SESSION, sessionId: NEW_SESSION });
      }
      if (
        method === "POST" &&
        path === `/api/practice/sessions/${OPEN_ID}/terminate`
      )
        return json({ ok: true });
      return undefined;
    },
  ];
}

// ── Mount ──────────────────────────────────────────────────────────────────────────────────

async function mount(
  plan: "paid" | "free",
  scenario: Scenario,
): Promise<{ container: HTMLElement; history: string[] }> {
  install(scenario);
  const map = await accessMap(plan === "paid");
  const { hook, history } = memoryLocation({
    path: "/practice",
    record: true,
  });
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
            <Practice />
          </AppShell>
        </UpgradeModalProvider>
      </Router>
    </QueryClientProvider>,
  );
  await screen.findByTestId("filter-bar");
  return { container, history };
}

function gets(): string[] {
  return net.log
    .filter((l) => l.startsWith("GET "))
    .map((l) => l.slice(4).split("?")[0] ?? "");
}

function startBodies(): unknown[] {
  return net.bodies
    .filter((b) => b.url === "/api/practice/sessions")
    .map((b) => b.body);
}

function chipTexts(): string[] {
  return within(screen.getByTestId("filter-chips"))
    .queryAllByTestId("filter-chip")
    .map((c) => c.textContent ?? "");
}

/** Opens a filter dropdown, clicks each named option, and closes it. */
async function choose(
  menuName: "Domain" | "Skill" | "Difficulty",
  options: readonly string[],
): Promise<void> {
  const trigger = screen.getByRole("button", { name: menuName });
  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key: "Enter" });
  const menu = screen.getByRole("menu", { name: menuName });
  for (const name of options) {
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name }));
  }
  fireEvent.keyDown(menu, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("menu", { name: menuName })).toBeNull(),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 1, 15, 0, 0));
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

// ── Start sends exactly the criteria ───────────────────────────────────────────────────────

describe("Start sends the filter bar's criteria to POST /api/practice/sessions", () => {
  it("sends the chosen section, domain, skill and difficulty and the size, then lands in the runner", async () => {
    const { history } = await mount("paid", { quota: "unlimited" });
    fireEvent.click(screen.getByRole("button", { name: "Reading & Writing" }));
    await choose("Domain", ["Craft and Structure"]);
    await choose("Skill", ["Words in Context"]);
    await choose("Difficulty", ["Medium", "Hard"]);
    expect(chipTexts()).toEqual([
      "Domain: Craft and Structure",
      "Skill: Words in Context",
      "Difficulty: Medium",
      "Difficulty: Hard",
    ]);
    fireEvent.change(screen.getByTestId("practice-size"), {
      target: { value: "15" },
    });
    const start = screen.getByTestId("practice-start");
    expect(start.textContent).toBe("Start 15 questions");
    fireEvent.click(start);

    await waitFor(() => expect(startBodies()).toHaveLength(1));
    const body = startBodies()[0] as Record<string, unknown>;
    const {
      client_instance_id,
      idempotency_key,
      target_question_count,
      ...rest
    } = body;
    expect(typeof client_instance_id).toBe("string");
    expect(typeof idempotency_key).toBe("string");
    expect(target_question_count).toBe(15);
    // The criteria keys are EXACTLY the shared schema's, with the chosen values.
    expect(sessionCriteriaSchema.parse(rest)).toEqual({
      sections: ["RW"],
      domains: ["Craft and Structure"],
      skills: ["Words in Context"],
      difficulties: ["medium", "hard"],
    });
    await waitFor(() =>
      expect(history.at(-1)).toBe(`/practice/session/${NEW_SESSION}`),
    );
  });

  it("with nothing narrowed, sends the section alone and the default size of 10", async () => {
    await mount("free", { quota: 12 });
    fireEvent.click(screen.getByTestId("practice-start"));
    await waitFor(() => expect(startBodies()).toHaveLength(1));
    const body = startBodies()[0] as Record<string, unknown>;
    expect(body.sections).toEqual(["M"]);
    expect(body.target_question_count).toBe(10);
    // An empty criterion is not sent (OQ-22: empty means no constraint).
    for (const key of ["domains", "skills", "difficulties"]) {
      expect(key in body, key).toBe(false);
    }
  });

  it("'Practice this domain' sets the filter to that domain, and Start sends it", async () => {
    await mount("paid", { quota: "unlimited" });
    const rows = await screen.findAllByTestId("practice-suggestion");
    fireEvent.click(
      within(rows[0] as HTMLElement).getByRole("button", {
        name: /Practice this domain/,
      }),
    );
    expect(chipTexts()).toEqual(["Domain: Advanced Math"]);
    fireEvent.click(screen.getByTestId("practice-start"));
    await waitFor(() => expect(startBodies()).toHaveLength(1));
    expect(startBodies()[0]).toMatchObject({
      sections: ["M"],
      domains: ["Advanced Math"],
    });
  });
});

// ── Your session ───────────────────────────────────────────────────────────────────────────

describe("Your session", () => {
  it("offers 5 to 30 questions in steps of 5, and 10 to start", async () => {
    await mount("paid", { quota: "unlimited" });
    const select = screen.getByTestId("practice-size") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "5",
      "10",
      "15",
      "20",
      "25",
      "30",
    ]);
    expect(select.value).toBe("10");
    expect(screen.getByTestId("practice-start").textContent).toBe(
      "Start 10 questions",
    );
  });

  it("summarises the selection in the prototype's words", async () => {
    await mount("paid", { quota: "unlimited" });
    const summary = (): string =>
      screen.getByTestId("practice-summary").textContent ?? "";
    expect(summary()).toBe("Math: every domain, questions of any difficulty.");
    await choose("Domain", ["Algebra", "Advanced Math"]);
    expect(summary()).toBe(
      "Math: Algebra and Advanced Math, questions of any difficulty.",
    );
    await choose("Difficulty", ["Easy", "Hard"]);
    expect(summary()).toBe(
      "Math: Algebra and Advanced Math, easy and hard questions.",
    );
    // Skills win over domains (the narrower choice).
    await choose("Skill", ["Linear Functions"]);
    expect(summary()).toBe("Math: Linear Functions, easy and hard questions.");
  });

  it("free: the quota line from GET /api/practice/quota", async () => {
    await mount("free", { quota: 12 });
    expect((await screen.findByTestId("practice-quota")).textContent).toBe(
      "You have 12 of 40 free practice questions left today. Review is always unlimited.",
    );
    expect(gets()).toContain("/api/practice/quota");
    expect(
      (screen.getByTestId("practice-start") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("paid (unlimited): no quota line", async () => {
    await mount("paid", { quota: "unlimited" });
    // Presence first: the quota was read and the session section drew.
    await waitFor(() => expect(gets()).toContain("/api/practice/quota"));
    expect(screen.getByTestId("practice-summary")).toBeTruthy();
    expect(screen.queryByTestId("practice-quota")).toBeNull();
  });

  it("free with none left: Start is disabled and the one upgrade card shows", async () => {
    await mount("free", { quota: 0 });
    expect((await screen.findByTestId("practice-quota")).textContent).toBe(
      "You have 0 of 40 free practice questions left today. Review is always unlimited.",
    );
    expect(
      (screen.getByTestId("practice-start") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId("premium-upgrade-prompt")).toBeTruthy();
  });

  it("a 402 from Start shows the upgrade card, not an error", async () => {
    await mount("free", { quota: 3, start: "402" });
    expect(screen.queryByTestId("premium-upgrade-prompt")).toBeNull();
    fireEvent.click(screen.getByTestId("practice-start"));
    expect(await screen.findByTestId("premium-upgrade-prompt")).toBeTruthy();
    expect(screen.queryByTestId("practice-start-error")).toBeNull();
  });

  it("a refused start is shared by a joining call without escaping, and not replayed", async () => {
    install({ start: "402" });
    const { result } = renderHook(() => usePractice());
    const ask = {
      criteria: { sections: ["M"], domains: [], skills: [], difficulties: [] },
      targetQuestionCount: 25,
    };
    // Two calls while the first is in flight: one request, both settle to null (no rejection).
    let answers: Array<string | null> = [];
    await act(async () => {
      answers = await Promise.all([
        result.current.startSession(ask),
        result.current.startSession(ask),
      ]);
    });
    expect(answers).toEqual([null, null]);
    expect(startBodies()).toHaveLength(1);
    expect(result.current.quotaExhausted).toBe(true);
    // The refusal left the in-flight map at once: the next click asks the server again.
    install({ start: "ok" });
    let again: string | null = null;
    await act(async () => {
      again = await result.current.startSession(ask);
    });
    expect(again).toBe(NEW_SESSION);
    expect(startBodies()).toHaveLength(2);
  });

  it("a 422 PRACTICE_POOL_EMPTY says 'No questions match these filters', with no count", async () => {
    await mount("paid", { quota: "unlimited", start: "422" });
    fireEvent.click(screen.getByTestId("practice-start"));
    const notice = await screen.findByTestId("practice-pool-empty");
    expect(notice.textContent).toContain("No questions match these filters");
    expect(notice.textContent).not.toMatch(/\d/);
    expect(screen.queryByTestId("practice-start-error")).toBeNull();
  });

  it("at the open-session limit, Start is disabled and says why", async () => {
    await mount("paid", { quota: "unlimited", open: true, max: 1 });
    expect((await screen.findByTestId("practice-limit")).textContent).toContain(
      "You've reached the limit of 1 active sessions.",
    );
    expect(
      (screen.getByTestId("practice-start") as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

// ── Open sessions ──────────────────────────────────────────────────────────────────────────

describe("Pick up where you left off", () => {
  it("names an open session by its criteria (OQ-22); End asks first, then terminates it", async () => {
    await mount("paid", { quota: "unlimited", open: true });
    const row = await screen.findByTestId("practice-open-row");
    expect(row.textContent).toContain("Algebra");
    expect(row.textContent).toContain("3 of 10 answered");
    expect(
      within(row).getByRole("link", { name: "Continue" }).getAttribute("href"),
    ).toBe(`/practice/session/${OPEN_ID}`);
    fireEvent.click(within(row).getByRole("button", { name: "End" }));
    const modal = await screen.findByTestId("practice-end-modal");
    expect(modal.textContent).toContain("End this session?");
    fireEvent.click(within(modal).getByRole("button", { name: "End session" }));
    await waitFor(() =>
      expect(net.log).toContain(
        `POST /api/practice/sessions/${OPEN_ID}/terminate`,
      ),
    );
  });
});

// ── Suggested for you ──────────────────────────────────────────────────────────────────────

describe("Suggested for you", () => {
  it("paid: the two lowest-level domains in the section, ties in canonical order, unmeasured last", async () => {
    await mount("paid", { quota: "unlimited" });
    const rows = await screen.findAllByTestId("practice-suggestion");
    expect(
      rows.map((r) => [
        r.querySelector("span span")?.textContent,
        r.getAttribute("data-level-key"),
      ]),
    ).toEqual([
      ["Advanced Math", "L0"],
      ["Geometry and Trigonometry", "L0"],
    ]);
    expect(screen.getByTestId("practice-suggested").textContent).toContain(
      "Your lowest mastery levels in Math come first.",
    );
    // The section switch moves the suggestions to that section's two lowest.
    fireEvent.click(screen.getByRole("button", { name: "Reading & Writing" }));
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId("practice-suggestion")
          .map((r) => r.querySelector("span span")?.textContent),
      ).toEqual(["Information and Ideas", "Craft and Structure"]),
    );
  });

  it("free: no suggestions and no mastery read; the panel shows the locked card", async () => {
    await mount("free", { quota: 12 });
    expect(await screen.findByTestId("locked-mastery-card")).toBeTruthy();
    expect(screen.queryByTestId("practice-suggested")).toBeNull();
    expect(gets().some((g) => g.includes("/mastery/"))).toBe(false);
  });
});

// ── Recent practice ────────────────────────────────────────────────────────────────────────

describe("Recent practice (OQ-23: /api/review/pool)", () => {
  it("lists the practice rows with their own review counts and links to review", async () => {
    await mount("paid", { quota: "unlimited" });
    const rows = await screen.findAllByTestId("practice-recent-row");
    expect(gets()).toContain("/api/review/pool");
    expect(rows).toHaveLength(1);
    // OQ-66 (g): "Fri, Sep 25, 12:49 PM", the ruling's own example.
    expect(rows[0]?.textContent).toContain("Fri, Sep 25, 12:49 PM");
    // UI-66 (OQ-53 (e)): the row leads with its criteria title, as the open rows do
    // (`sessionTitle`: the domain, the narrowest choice made), then the day and time.
    expect(rows[0]?.firstElementChild?.firstElementChild?.textContent).toBe(
      "Algebra",
    );
    expect(rows[0]?.textContent).toMatch(/^AlgebraFri, Sep 25, 12:49 PM/);
    expect(rows[0]?.textContent).toContain("4 to review");
    // The review-engine row belongs to Review, not to "Recent practice".
    expect(screen.getByTestId("practice-recent").textContent).not.toContain(
      "2 to review",
    );
    expect(
      within(screen.getByTestId("practice-recent"))
        .getByRole("link", { name: "Review what you missed" })
        .getAttribute("href"),
    ).toBe("/review");
  });
});

// ── What the page never shows ──────────────────────────────────────────────────────────────

describe("no bank counts, no percentages, no Domain Library", () => {
  it("paid: the full page carries no bank figure, no '%' and no Domain Library", async () => {
    // F-52: a pool row carrying the stored bank-sized figure is refused by the schema the
    // hook parses with, so the figure cannot reach the page through the pool at all.
    const leaking = structuredClone(POOL) as {
      sessions: Array<{ filters: unknown }>;
    };
    if (leaking.sessions[0]) {
      leaking.sessions[0].filters = {
        sections: ["M"],
        domains: ["Algebra"],
        skills: [],
        difficulties: [],
        source_pool_count: 327,
      };
    }
    expect(reviewPoolSummaryResponseSchema.safeParse(leaking).success).toBe(
      false,
    );
    const { container } = await mount("paid", {
      quota: "unlimited",
      open: true,
    });
    await screen.findAllByTestId("practice-suggestion");
    await screen.findAllByTestId("practice-recent-row");
    await screen.findByTestId("practice-open-row");
    const panel = await screen.findByTestId("practice-panel");
    expect(within(panel).getAllByTestId("mastery-row")).toHaveLength(8);
    await choose("Skill", ["Linear Functions", "Circles"]);

    const text = container.ownerDocument.body.textContent ?? "";
    expect(text).toContain("Your session");
    expect(text).not.toContain("%");
    expect(text).not.toContain("327");
    expect(text).not.toMatch(
      /in bank|question bank|questions available|questions match|found \d+/i,
    );
    // The only "N questions" on the page is the student's own session size.
    expect(text.match(/\d+\s+questions?/gi)).toEqual(["10 questions"]);
    expect(text).not.toMatch(/Domain Library|Topic Explorer/);
    expect(
      container.ownerDocument.querySelector('a[href="/practice/topics"]'),
    ).toBeNull();
    expect(gets()).not.toContain("/api/questions/stats");
  });

  it("free: the same, with the quota line as the only other count", async () => {
    const { container } = await mount("free", { quota: 12 });
    await screen.findByTestId("practice-quota");
    await screen.findAllByTestId("practice-recent-row");
    const text = container.ownerDocument.body.textContent ?? "";
    expect(text).not.toContain("%");
    expect(text).not.toContain("327");
    expect(text.match(/\d+\s+questions?/gi)).toEqual(["10 questions"]);
    expect(text).not.toMatch(/Domain Library|Topic Explorer/);
  });
});

// ── Owner QA list (Karl, 2026-10-07) item 5 ───────────────────────────────────────────────────

describe("QA item 5: Practice's Start shows a pending state from the first click", () => {
  it("'Starting…', disabled and busy while the create is in flight; one create", async () => {
    let release: () => void = () => undefined;
    net.hold = {
      pattern: /^\/api\/practice\/sessions$/,
      gate: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    const { history } = await mount("free", { quota: 12 });
    const start = (await screen.findByTestId(
      "practice-start",
    )) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    expect(start.textContent).toBe("Start 10 questions");
    fireEvent.click(start);
    expect(start.textContent).toBe("Starting…");
    expect(start.disabled).toBe(true);
    expect(start.getAttribute("aria-busy")).toBe("true");
    expect(within(start).getByTestId("button-pending-spinner")).toBeTruthy();
    fireEvent.click(start);
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(history.at(-1)).toBe(`/practice/session/${NEW_SESSION}`),
    );
    expect(startBodies()).toHaveLength(1);
  });
});
