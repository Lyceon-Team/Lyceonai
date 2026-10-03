// @vitest-environment jsdom
/**
 * UI-44: the upgrade modal opens for each feature's real denial, keyed by the code.
 *
 * @spec [student-UI register UI-44 (proof: "a 402 entitlement_required for each feature opens
 *        the matching modal"); §2 Free versus paid (ruling 1 / SCL-185: the modal keys off the
 *        code, never the status; ruling 3: the calendar renders its own upsell); §8 F-07; OQ-29;
 *        OQ-39(e); DESIGN.md §3] | @implemented [2026-10-03]
 *
 * plain English: the bodies are the servers' own output, not literals. Calendar and mastery come
 * from `sendPaymentRequired` (402, flat), the tutor from `sendTutorError` (403, nested), and the
 * exam from the REAL exam router over HTTP (403, nested), with only the entitlement answer
 * stubbed. Each body is served by a stubbed `fetch` at the surface's real status and travels the
 * client's real path: `apiRequest` → `parseApiErrorFromResponse` → a real QueryClient → the
 * provider's cache listener → the modal. The tutor and exam denials are 403 and still open it;
 * a 402 that is not `entitlement_required` (the practice quota, F-07; the legacy guardian body)
 * does not. The calendar case drives the real `useCalendar` hook, so the opt-out is proven on the
 * query the calendar page actually runs.
 */
import { useEffect, type ReactNode } from "react";
import express from "express";
import request from "supertest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LockableFeatureKey } from "@lyceon/shared/feature-access";
import { apiRequest } from "@/lib/queryClient";
import { useCalendar } from "@/features/calendar/api/queries";
import { UpgradeModalProvider, useUpgradeModal } from "./UpgradeModal";
import { UPGRADE_MODAL_COPY, UPGRADE_PLANS_DESTINATION } from "./upgrade-modal";
import { sendPaymentRequired } from "../../../../server/lib/http-errors";
import { sendTutorError } from "../../../../server/services/tutor-error-codes";

const STUDENT = "11111111-1111-4111-8111-111111111111";

vi.mock("../../../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    rpc: () => {
      throw new Error("no database in this test");
    },
    from: () => {
      throw new Error("no database in this test");
    },
  },
}));
const canAccessFeature = vi.fn(async () => false);
vi.mock("../../../../server/services/entitlement-service", () => ({
  EntitlementService: { canAccessFeature },
}));

type Served = { status: number; body: unknown };

/** A minimal express-like `res` that records what a real serializer sends. */
function capture(send: (res: never) => unknown): Served {
  const served: Served = { status: 0, body: undefined };
  const res = {
    req: { requestId: "req-ui44" },
    status(code: number) {
      served.status = code;
      return res;
    },
    json(body: unknown) {
      served.body = body;
      return res;
    },
  };
  send(res as never);
  return served;
}

async function examDenial(): Promise<Served> {
  const { default: examRuntimeRouter } =
    await import("../../../../server/routes/exam-runtime-routes");
  const app = express();
  app.use((req, _res, next) => {
    req.requestId = "req-ui44";
    req.user = {
      id: STUDENT,
      email: "s@example.test",
      display_name: null,
      role: "student",
      isAdmin: false,
      isGuardian: false,
      actor_id: STUDENT,
      profile_completed_at: "2026-09-01T00:00:00.000Z",
      is_under_13: false,
      guardian_consent: false,
    } as Express.Request["user"];
    next();
  });
  app.use("/api/tests", examRuntimeRouter);
  const res = await request(app).get("/api/tests/forms");
  return { status: res.status, body: res.body };
}

/** Each feature's real denial, keyed by the URL the client reads. */
async function realDenials(): Promise<Record<LockableFeatureKey, Served>> {
  return {
    exam_full_length: await examDenial(),
    tutor_access: capture((res) =>
      sendTutorError(res, "entitlement_required", { feature: "tutor_access" }),
    ),
    calendar_access: capture((res) =>
      sendPaymentRequired(res, "calendar_access", "req-ui44"),
    ),
    mastery_detail: capture((res) =>
      sendPaymentRequired(res, "mastery_detail", "req-ui44"),
    ),
  };
}

let served: Served = { status: 200, body: {} };
beforeEach(() => {
  window.history.replaceState({}, "", "/dashboard");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/csrf-token"
        ? new Response(JSON.stringify({ csrfToken: "t" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        : new Response(JSON.stringify(served.body), {
            status: served.status,
            headers: { "Content-Type": "application/json" },
          }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function freshClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0 },
      mutations: { retry: false },
    },
  });
}

function Harness({
  children,
  autoOpenOnDenial,
}: {
  children: ReactNode;
  autoOpenOnDenial?: boolean;
}) {
  return (
    <QueryClientProvider client={freshClient()}>
      <UpgradeModalProvider
        {...(autoOpenOnDenial === undefined ? {} : { autoOpenOnDenial })}
      >
        {children}
      </UpgradeModalProvider>
    </QueryClientProvider>
  );
}

/** A page read through the app's real fetch helper; reports when it has failed. */
function Read({ url }: { url: string }) {
  const q = useQuery({
    queryKey: [url],
    queryFn: async () => (await apiRequest(url)).json(),
  });
  return q.isError ? <p data-testid="read-failed">failed</p> : null;
}

function Write({ url }: { url: string }) {
  const { mutate, isError } = useMutation({
    mutationFn: async () => (await apiRequest(url, { method: "POST" })).json(),
  });
  useEffect(() => mutate(), [mutate]);
  return isError ? <p data-testid="write-failed">failed</p> : null;
}

function modalTitle(): string {
  return (
    screen.getByTestId("upgrade-modal").querySelector("h2")?.textContent ?? ""
  );
}

describe("UI-44: each feature's real denial opens its own modal", () => {
  it("the servers' real bodies are denials, at their real statuses (presence)", async () => {
    const denials = await realDenials();
    expect(denials.exam_full_length.status).toBe(403);
    expect(denials.tutor_access.status).toBe(403);
    expect(denials.calendar_access.status).toBe(402);
    expect(denials.mastery_detail.status).toBe(402);
    expect(JSON.stringify(denials.exam_full_length.body)).toContain(
      '"code":"entitlement_required"',
    );
  });

  it.each([
    ["exam_full_length"],
    ["tutor_access"],
    ["calendar_access"],
    ["mastery_detail"],
  ] as const)(
    "%s: the query denial opens that feature's modal",
    async (feature) => {
      served = (await realDenials())[feature];
      render(
        <Harness>
          <Read url={`/api/ui44/${feature}`} />
        </Harness>,
      );
      await screen.findByTestId("upgrade-modal");
      expect(modalTitle()).toBe(UPGRADE_MODAL_COPY[feature].plan.title);
      expect(screen.getByTestId("upgrade-modal").textContent).toContain(
        UPGRADE_MODAL_COPY[feature].plan.body,
      );
      expect(screen.getByRole("button", { name: "See plans" })).toBeTruthy();
    },
  );

  it("LISA's modal carries the shipped headline exactly", () => {
    expect(UPGRADE_MODAL_COPY.tutor_access.plan.title).toBe(
      "A Tutor That Knows The SAT And Knows You",
    );
  });

  it("a mutation denial opens it too (exam, 403)", async () => {
    served = (await realDenials()).exam_full_length;
    render(
      <Harness>
        <Write url="/api/ui44/write" />
      </Harness>,
    );
    await screen.findByTestId("upgrade-modal");
    expect(modalTitle()).toBe(UPGRADE_MODAL_COPY.exam_full_length.plan.title);
  });
});

describe("UI-44: the code decides, not the status", () => {
  it.each([
    [
      "the practice quota 402 (F-07)",
      {
        status: 402,
        body: {
          error: "Usage limit reached",
          code: "PRACTICE_FREE_DAILY_QUOTA_EXCEEDED",
          limitType: "practice",
          current: 40,
          limit: 40,
          remaining: 0,
          resetAt: "2026-10-04T00:00:00.000Z",
          message:
            "You've reached your daily practice question limit. Upgrade to unlock unlimited access.",
          requestId: "r",
        },
      },
    ],
    [
      "the legacy guardian-view 402 PAYMENT_REQUIRED",
      {
        status: 402,
        body: {
          error: "Subscription required",
          code: "PAYMENT_REQUIRED",
          message: "x",
          requestId: "r",
        },
      },
    ],
    [
      "the exam session-ownership 403 forbidden",
      {
        status: 403,
        body: { error: { code: "forbidden", message: "Not your session." } },
      },
    ],
  ])("%s does not open the modal", async (_label, response) => {
    served = response;
    render(
      <Harness>
        <Read url="/api/ui44/not-a-denial" />
      </Harness>,
    );
    // Presence before absence: the request did fail and reached the listener.
    await screen.findByTestId("read-failed");
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
  });

  it("a denial naming a seed key with no modal (practice_unlimited) does not open it", async () => {
    served = capture((res) => sendPaymentRequired(res, "practice_unlimited"));
    render(
      <Harness>
        <Read url="/api/ui44/unlimited" />
      </Harness>,
    );
    await screen.findByTestId("read-failed");
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
  });
});

describe("UI-44: where it stays closed", () => {
  it("the calendar's own query (real useCalendar) opts out: the page renders its own upsell", async () => {
    served = (await realDenials()).calendar_access;
    function CalendarRead() {
      const q = useCalendar("2026-09-28", "2026-10-04");
      return q.isError ? <p data-testid="read-failed">failed</p> : null;
    }
    render(
      <Harness>
        <CalendarRead />
      </Harness>,
    );
    await screen.findByTestId("read-failed");
    expect(vi.mocked(fetch)).toHaveBeenCalled();
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
  });

  it("with auto-open off (a guardian), a denial does not open it", async () => {
    served = (await realDenials()).mastery_detail;
    render(
      <Harness autoOpenOnDenial={false}>
        <Read url="/api/ui44/guardian" />
      </Harness>,
    );
    await screen.findByTestId("read-failed");
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
  });
});

function Opener({
  feature,
  reason,
}: {
  feature: LockableFeatureKey;
  reason?: "plan" | "age";
}) {
  const { open } = useUpgradeModal();
  return (
    <button type="button" onClick={() => open(feature, reason)}>
      Locked item
    </button>
  );
}

describe("UI-44: explicit open, actions and keyboard", () => {
  it('open("tutor_access", "age") shows the age message and no plans button', () => {
    render(
      <Harness>
        <Opener feature="tutor_access" reason="age" />
      </Harness>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Locked item" }));
    expect(modalTitle()).toBe(UPGRADE_MODAL_COPY.tutor_access.age.title);
    expect(screen.getByTestId("upgrade-modal").textContent).toContain(
      "This feature requires an older account.",
    );
    expect(screen.queryByRole("button", { name: "See plans" })).toBeNull();
    expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy();
  });

  it('"See plans" navigates to Settings → Billing and closes', () => {
    render(
      <Harness>
        <Opener feature="exam_full_length" />
      </Harness>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Locked item" }));
    fireEvent.click(screen.getByRole("button", { name: "See plans" }));
    expect(`${window.location.pathname}${window.location.search}`).toBe(
      UPGRADE_PLANS_DESTINATION,
    );
    expect(UPGRADE_PLANS_DESTINATION).toBe("/profile?tab=billing");
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
  });

  it('"Not now" closes it', () => {
    render(
      <Harness>
        <Opener feature="mastery_detail" />
      </Harness>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Locked item" }));
    expect(screen.getByTestId("upgrade-modal")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
  });

  it("Esc closes it and focus returns to the opener", async () => {
    render(
      <Harness>
        <Opener feature="tutor_access" />
      </Harness>,
    );
    const opener = screen.getByRole("button", { name: "Locked item" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByTestId("upgrade-modal");
    expect(modalTitle()).toBe(UPGRADE_MODAL_COPY.tutor_access.plan.title);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("upgrade-modal")).toBeNull(),
    );
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
