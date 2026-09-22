// @vitest-environment jsdom
/**
 * A guardian can reach EACH linked student's calendar from the dashboard.
 *
 * @spec [Doc_05F_Study_Calendar, §16 guardian view (derived from link AND the STUDENT's
 *        entitlement), formula sheet item 14 — GET /api/students/:studentId/calendar]
 *       [lyceon-coding-standards §11.3, §6.2 — the server always enforces]
 *       [owner instruction 2026-08-28 Gate B — no hand-written row fixtures]
 * | @implemented [2026-09-22]
 *
 * WHY PER STUDENT. The route is scoped to a student id and a guardian may have several
 * linked, so one global "Calendar" link could not say whose. The link belongs on the row.
 *
 * WHY IT IS NEVER HIDDEN. `has_active_entitlement` is on the wire and the tempting thing is
 * to hide the link when it is false. That would be the client deciding access, which §7.12
 * forbids, and it would strand a guardian whose student paid a minute ago until this
 * component happened to refetch. §16 is derived SERVER-side and the route answers 402 on its
 * own. The unfunded case is asserted below precisely so a future "tidy-up" that hides the
 * link turns this file red.
 *
 * THE STUDENT ROWS COME FROM POSTGRES, NOT FROM THIS FILE. The first version of this test
 * spelled `{ id, email, display_name, … }` by hand and the guardian schema-truth gate reded
 * it on arrival, correctly: a hand-written row is a private copy of the schema, and if
 * `display_name` were renamed tomorrow this test would keep passing while the dashboard
 * rendered blanks. The two profiles are now INSERTED into a real database and READ BACK, so
 * the keys this component destructures are the keys the table actually has. Only
 * `has_active_entitlement` and `entitlement_lapsed` are stated here, because they are not
 * columns — the guardian students route derives them.
 *
 * That makes the suite PG-gated, like every other data-shaped test in this repo, hence the
 * `.pg.ci` name. The alternative — keeping it fast by keeping the fixture imaginary — is the
 * exact trade the gate exists to refuse.
 *
 * IT IS NAMED IN `practice-integration`, behind `vitest-summary-gate`. The plain `ci` job has
 * no Postgres service, so without that step this file would skip everywhere and prove
 * nothing — a test that never runs is worse than no test, and a skipped file exits 0, which
 * looks exactly like a pass.
 */
import React from "react";
import { Client } from "pg";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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

const PG_AVAILABLE =
  process.env.PGHOST !== undefined && process.env.PGHOST !== "";

const ADA = "11111111-1111-1111-1111-111111111111";
const BO = "22222222-2222-2222-2222-222222222222";

/** Filled from real profile rows in `beforeAll`. Never spelled by hand — see the note. */
let students: Record<string, unknown>[] = [];

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
vi.mock("@/hooks/useGuardianStudents", async () => {
  const actual = await vi.importActual<
    typeof import("@/hooks/useGuardianStudents")
  >("@/hooks/useGuardianStudents");
  return {
    ...actual,
    useGuardianStudents: () => ({
      data: { students },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});
// Every other call this page makes on mount answers with its empty shape. None of them is
// what this file is about; they only have to not throw.
vi.mock("@/lib/csrf", () => ({
  csrfFetch: vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: {}, requestId: "test" }),
  })),
}));
vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: { unread: 0 }, requestId: "test" }),
  })),
}));

const { default: GuardianDashboard } = await import("./guardian-dashboard");

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <GuardianDashboard />
    </QueryClientProvider>,
  );
}

describe.skipIf(!PG_AVAILABLE)(
  "guardian dashboard — a calendar link per linked student (§16)",
  () => {
    let pg: Client;
    /** The rows as Postgres returns them, keyed by student id. */
    let rows: Map<string, Record<string, unknown>>;

    beforeAll(async () => {
      pg = await bootstrapPgDatabase("guardian_calendar_link");

      for (const [id, email, name] of [
        [ADA, "ada@example.test", "Ada"],
        [BO, "bo@example.test", "Bo"],
      ]) {
        await pg.query(
          `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [id, email],
        );
        await pg.query(
          `INSERT INTO public.profiles (id, email, display_name, role)
           VALUES ($1,$2,$3,'student') ON CONFLICT (id) DO UPDATE SET display_name = $3`,
          [id, email, name],
        );
      }

      // Read back. If `display_name` is ever renamed, this SELECT raises 42703 and the
      // test fails — which is the whole point of not writing the row here.
      const result = await pg.query(
        `SELECT id, email, display_name FROM public.profiles WHERE id = ANY($1::uuid[])`,
        [[ADA, BO]],
      );
      rows = new Map(
        result.rows.map((row: Record<string, unknown>) => [
          String(row.id),
          row,
        ]),
      );
      expect(rows.size).toBe(2);
    }, 180_000);

    afterAll(async () => {
      await pg?.end();
    });

    beforeEach(() => {
      // The two derived fields are NOT columns — the guardian students route computes them
      // — so they are the only things stated here.
      students = [
        {
          ...rows.get(ADA),
          has_active_entitlement: true,
          entitlement_lapsed: false,
        },
        {
          ...rows.get(BO),
          has_active_entitlement: false,
          entitlement_lapsed: true,
        },
      ];
    });

    it("renders one link per student, each to that student's calendar route", async () => {
      renderDashboard();

      for (const id of [ADA, BO]) {
        const link = await screen.findByTestId(`guardian-calendar-link-${id}`);
        // The anchor that carries the destination is the wouter <Link> wrapping the button.
        const anchor = link.closest("a");
        expect(anchor).not.toBeNull();
        expect(anchor?.getAttribute("href")).toBe(`/students/${id}/calendar`);
      }
    });

    it("names the student, so two linked students are told apart", async () => {
      renderDashboard();
      const link = await screen.findByTestId(`guardian-calendar-link-${ADA}`);
      // "Ada" reaches the title through the real `display_name` column.
      expect(link.getAttribute("title")).toBe("View Ada's calendar");
    });

    it("still renders for a student whose entitlement LAPSED — the route answers 402, not the client", async () => {
      renderDashboard();
      // Bo is unfunded and lapsed. Hiding the link here would be the client gating access;
      // §16 is derived server-side and the page has its own 402 state.
      const link = await screen.findByTestId(`guardian-calendar-link-${BO}`);
      expect(link.closest("a")?.getAttribute("href")).toBe(
        `/students/${BO}/calendar`,
      );
    });

    it("negative control: with no linked students there are no calendar links", async () => {
      students = [];
      renderDashboard();
      await waitFor(() => {
        expect(
          screen.queryAllByTestId(/^guardian-calendar-link-/),
        ).toHaveLength(0);
      });
    });
  },
);
