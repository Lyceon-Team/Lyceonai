// @vitest-environment jsdom
/**
 * G3-04 — a student who stops being linked leaves the guardian's screens, in words.
 *
 * @spec [Guardian_Closure_Plan G3-04; owner ruling R7; audit G-AUD-06/19; Doc 05B §10.3 (404,
 *        not 403, for "not yours")] | @implemented [2026-09-30]
 *
 * plain English: the named proof. A 404 on the mastery read, on the dashboard (KPI) read and on
 * the calendar read each shows "no longer linked", refetches the roster, and drops that
 * student's panels and cached reads; and a guardian unlinking the SELECTED student removes its
 * panels. The real dashboard, the real calendar page, the real roster hook and the real query
 * layer run; only the network is scripted (`csrfFetch`, the one transport every read uses).
 *
 * THE STUDENT ROW COMES FROM POSTGRES (schema-truth gate Rule B), as in
 * `guardian-dashboard.calendar-link.pg.ci.test.tsx`: inserted, read back with the route's own
 * column list, and passed through the shared roster contract. Only the two derived flags are
 * stated here, because they are not columns.
 *
 * Presence before absence: every case first sees the student's panels render with data, so
 * "the panels are gone" cannot pass on a page that never drew them.
 */
import React from "react";
import { Client } from "pg";
import { Route, Router as WouterRouter } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { bootstrapPgDatabase } from "../../../tests/helpers/pg-supabase";
import { guardianStudentsResponseSchema } from "../../../packages/shared/src/guardian-student-schema";

const PG_AVAILABLE =
  process.env.PGHOST !== undefined && process.env.PGHOST !== "";

const ADA = "33333333-3333-4333-8333-333333333333";
const GUARDIAN = "guardian-1";

/** Ada's roster entry, from a real `profiles` row. Filled in `beforeAll`. */
let adaEntry: Record<string, unknown> | null = null;

/** The scripted server. `linked` is the truth; `notFound` forces a 404 on one read. */
const server = vi.hoisted(() => ({
  linked: new Set<string>(),
  notFound: new Set<"kpi" | "mastery" | "calendar">(),
  log: [] as string[],
}));

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: {
      id: "guardian-1",
      email: "guardian@example.test",
      display_name: "Pat",
      role: "guardian",
    },
    isLoading: false,
    authLoading: false,
    isAuthenticated: true,
    isGuardian: true,
    signOut: vi.fn(async () => {}),
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
/** The subject resolver's 404 body, verbatim in shape: no code, identical for every cause. */
const NOT_FOUND = {
  error: "Not found",
  message: "No such student, or you do not have access to them",
};

vi.mock("@/lib/csrf", () => ({
  getCsrfToken: vi.fn(async () => "t"),
  clearCsrfToken: vi.fn(),
  csrfFetch: vi.fn(async (url: string, init?: RequestInit) => {
    server.log.push(`${init?.method ?? "GET"} ${url}`);
    if (url === "/api/guardian/students") {
      return json({
        students: adaEntry && server.linked.has(ADA) ? [adaEntry] : [],
      });
    }
    if (url === `/api/guardian/link/${ADA}` && init?.method === "DELETE") {
      server.linked.delete(ADA);
      return json({ ok: true });
    }
    const m = /^\/api\/students\/([^/]+)\/([a-z/]+)/.exec(url);
    if (m) {
      const [, id, resource] = m;
      const which =
        resource === "kpi/overall"
          ? "kpi"
          : resource === "mastery/domains"
            ? "mastery"
            : resource === "calendar"
              ? "calendar"
              : null;
      if (!server.linked.has(id!) || (which && server.notFound.has(which))) {
        return json(NOT_FOUND, 404);
      }
      if (which === "kpi")
        return json({ ok: true, currentStreakDays: 4, requestId: "r" });
      if (which === "mastery")
        return json({ ok: true, domains: [], requestId: "r" });
    }
    // Billing answers its real shape (G4-09: the one reader now parses it).
    if (url === "/api/billing/status") {
      const { billingStatus } =
        await import("@/features/guardian/test-harness");
      return json(billingStatus());
    }
    // Every other mount-time read (notifications) answers its empty shape.
    return json({ data: {}, requestId: "r" });
  }),
}));

const { default: GuardianDashboard } = await import("./guardian-dashboard");
const { default: GuardianStudentCalendarPage } =
  await import("./guardian-student-calendar");
const { guardianStudentsQueryKey } =
  await import("@/hooks/useGuardianStudents");

function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

const rosterReads = (): number =>
  server.log.filter((l) => l === "GET /api/guardian/students").length;
const adaKeys = (client: QueryClient): unknown[] =>
  client
    .getQueryCache()
    .getAll()
    .map((q) => q.queryKey)
    .filter((key) =>
      key.some(
        (part) =>
          part === ADA ||
          (typeof part === "string" && part.includes(`/students/${ADA}/`)),
      ),
    );

/** Render the dashboard and select Ada, with her panels drawn from real responses. */
async function openAda(client: QueryClient): Promise<void> {
  render(
    <QueryClientProvider client={client}>
      <GuardianDashboard />
    </QueryClientProvider>,
  );
  const row = await screen.findByTestId(`guardian-calendar-link-${ADA}`);
  const name = within(row.closest("div.p-4") as HTMLElement).getByText("Ada");
  fireEvent.click(name);
  // Presence first: the student's own (unlocked) streak tile rendered the served value.
  const tile = await screen.findByTestId("guardian-metric-tile");
  await waitFor(() => expect(tile.textContent).toContain("4"));
}

describe.skipIf(!PG_AVAILABLE)(
  "G3-04 — a student no longer linked leaves the guardian's screens",
  () => {
    let pg: Client;

    beforeAll(async () => {
      pg = await bootstrapPgDatabase("guardian_no_longer_linked");
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [ADA, "ada@example.test"],
      );
      await pg.query(
        `INSERT INTO public.profiles (id, email, display_name, role)
         VALUES ($1,$2,'Ada','student') ON CONFLICT (id) DO UPDATE SET display_name = 'Ada'`,
        [ADA, "ada@example.test"],
      );
      // The route's own column list (server/routes/guardian-routes.ts, GET /students).
      const result = await pg.query(
        `SELECT id, email, display_name, created_at FROM public.profiles WHERE id = $1`,
        [ADA],
      );
      const row = result.rows[0] as Record<string, unknown>;
      adaEntry = guardianStudentsResponseSchema.parse({
        students: [
          {
            ...row,
            created_at:
              row.created_at instanceof Date
                ? row.created_at.toISOString()
                : row.created_at,
            has_active_entitlement: true,
            entitlement_lapsed: false,
          },
        ],
      }).students[0] as Record<string, unknown>;
    }, 180_000);

    afterAll(async () => {
      await pg?.end();
    });

    beforeEach(() => {
      server.linked = new Set([ADA]);
      server.notFound.clear();
      server.log.length = 0;
      window.history.pushState({}, "", "/guardian");
    });

    for (const [label, which] of [
      ["the mastery read", "mastery"],
      ["the dashboard (KPI) read", "kpi"],
    ] as const) {
      it(`a 404 on ${label}: "no longer linked", roster refetched, panels and caches gone`, async () => {
        const client = newClient();
        await openAda(client);
        const before = rosterReads();
        // The next read of this one resource answers the resolver's 404; the dashboard learns
        // from it, before any roster refetch could tell it.
        server.notFound.add(which);
        const resource = which === "kpi" ? "kpi/overall" : "mastery/domains";
        await act(async () => {
          await client.refetchQueries({
            predicate: (q) =>
              q.queryKey.some(
                (part) =>
                  part === "guardian-student-summary" ||
                  (typeof part === "string" && part.endsWith(resource)),
              ) &&
              q.queryKey.some(
                (part) => part === ADA || String(part).includes(ADA),
              ),
          });
        });

        const notice = await screen.findByTestId(
          "guardian-student-no-longer-linked",
        );
        expect(notice.textContent).toContain("Ada is no longer linked");
        await waitFor(() => expect(rosterReads()).toBeGreaterThan(before));
        await waitFor(() =>
          expect(screen.queryByTestId("guardian-metric-tile")).toBeNull(),
        );
        expect(screen.queryByText(/We couldn.t load/)).toBeNull();
        expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
        expect(adaKeys(client)).toEqual([]);
      });
    }

    it('a 404 on the calendar read: "no longer linked", roster refetched, no retry loop', async () => {
      const client = newClient();
      // The roster is cached (the guardian came from the dashboard) and must be refetched.
      client.setQueryData(guardianStudentsQueryKey(GUARDIAN), {
        students: [adaEntry],
      });
      server.linked.delete(ADA);
      // G4-01: the page reads the student from its route (`/guardian/:studentId/calendar`).
      render(
        <QueryClientProvider client={client}>
          <WouterRouter
            hook={memoryLocation({ path: `/guardian/${ADA}/calendar` }).hook}
          >
            <Route path="/guardian/:studentId/calendar">
              <GuardianStudentCalendarPage />
            </Route>
          </WouterRouter>
        </QueryClientProvider>,
      );

      // G4-06: the guardian surface's shared revoked state.
      const notice = await screen.findByTestId("guardian-state-revoked");
      expect(notice.textContent).toContain("no longer linked");
      expect(screen.queryByTestId("calendar-error")).toBeNull();
      expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
      await waitFor(() =>
        expect(
          client.getQueryState(guardianStudentsQueryKey(GUARDIAN))
            ?.isInvalidated,
        ).toBe(true),
      );
      // Settles: at most the first read and the one its own cache removal causes.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 200));
      });
      const calendarReads = server.log.filter((l) =>
        l.includes(`/api/students/${ADA}/calendar`),
      ).length;
      expect(calendarReads).toBeGreaterThan(0);
      expect(calendarReads).toBeLessThanOrEqual(2);
      expect(screen.getByTestId("guardian-state-revoked")).toBeTruthy();
    });

    it("unlinking the SELECTED student removes its panels and its cached reads", async () => {
      const client = newClient();
      await openAda(client);
      expect(adaKeys(client).length).toBeGreaterThan(0);

      fireEvent.click(screen.getByTitle("Unlink Student"));
      const confirm = await screen.findByRole("button", { name: /^unlink$/i });
      fireEvent.click(confirm);

      await waitFor(() =>
        expect(server.log).toContain(`DELETE /api/guardian/link/${ADA}`),
      );
      await waitFor(() =>
        expect(screen.queryByTestId("guardian-metric-tile")).toBeNull(),
      );
      expect(adaKeys(client)).toEqual([]);
      await waitFor(() =>
        expect(
          screen.queryByTestId(`guardian-calendar-link-${ADA}`),
        ).toBeNull(),
      );
    });
  },
);
