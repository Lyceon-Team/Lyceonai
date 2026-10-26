// @vitest-environment jsdom
/**
 * The LISA chat dock: the bubble, the lock, the panel, Esc, the shared thread, anti-leak and the
 * crisis flow, against the REAL tutor router.
 *
 * @spec [owner brief "LISA chat dock" (Karl, 2026-10-22): "Free → lock + upgrade modal; paid →
 *        dock opens"; "Non-modal: answer choices stay clickable with the dock open; Esc
 *        minimizes"; "One thread: a message sent in the dock appears on the LISA page"; "no
 *        correct_answer or explanation before submit in any dock state (assert presence of a
 *        non-trivial payload before asserting absence)"; "the crisis flow (flag → pause →
 *        Continue) behaves identically inside the dock"; "Phones (<768px): unchanged"]
 *       [DESIGN.md §2 Free plan (LISA's lock opens the upgrade modal in place, no gated call)]
 * @implemented [2026-10-22]
 *
 * plain English: the dock is mounted in the real App shell, under the real upgrade modal, inside
 * a memory router, with the REAL tutor router behind the REAL tutor-client hooks (supertest over
 * the in-memory FakeTutorDb, the way chat.ui56.test.tsx and ScopedTutorPanel.contract.test.tsx
 * run it). Only the model call (`orchestrateTurn`) and the services that would reach Google are
 * replaced. The feature-access map is `resolveFeatureAccess`'s own output. The LISA page in the
 * shared-thread test is the real `ChatPage`, reached through the dock's own link, after the
 * tutor cache is dropped, so what it shows was read back from the server.
 *
 * PRESENCE BEFORE ABSENCE: every "not there" check runs after something beside it is drawn.
 */
import React from "react";
import express from "express";
import request from "supertest";
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Router, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { FeatureAccessMap } from "@lyceon/shared/feature-access";
import { FakeTutorDb } from "../../../../tests/helpers/fake-tutor-db";

Element.prototype.scrollIntoView = vi.fn();

// ── Server side: the tutor route is real; its collaborators are stubbed ───────────────────

const db = { current: new FakeTutorDb() };

vi.mock("../../../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return db.current.client();
  },
}));
vi.mock("../../../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
const entitlement = vi.hoisted(() => ({ paid: true }));
vi.mock("../../../../server/services/entitlement-service", () => ({
  EntitlementService: {
    canAccessFeature: async () => entitlement.paid,
    isEntitlementActiveForProfile: async () => entitlement.paid,
  },
}));
const orchestrateTurn = vi.fn();
vi.mock("../../../../server/lib/tutor-orchestrator-client", () => ({
  orchestrateTurn: (...args: unknown[]) => orchestrateTurn(...args),
}));
vi.mock("../../../../server/services/tutor-crisis", () => ({
  runCrisisClassifier: vi.fn(async () => ({
    crisis: false,
    forceReview: false,
  })),
  getCrisisResponse: vi.fn(),
  flagConversationForReview: vi.fn(),
  notifyCrisisEvent: vi.fn(),
  evaluateNotificationPolicy: vi.fn(),
}));
vi.mock("../../../../server/services/tutor-policy-logger", () => ({
  logContextResolution: vi.fn(async () => undefined),
  logTurnMetrics: vi.fn(async () => undefined),
}));
vi.mock("../../../../server/services/tutor-runtime-writer", () => ({
  persistInstructionAssignment: vi.fn(async () => ({
    ok: true,
    assignmentId: "assignment-1",
  })),
}));
vi.mock("../../../../server/services/cloud-tasks-enqueue", () => ({
  enqueueCloudTask: vi.fn(async () => undefined),
}));

const STUDENT_ID = "38383838-3838-4383-8383-383838383838";

import tutorRuntimeRouter from "../../../../server/routes/tutor-runtime";
import { resolveFeatureAccess } from "../../../../server/lib/feature-access";

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: { id: string; role: string } }).user = {
      id: STUDENT_ID,
      role: "student",
    };
    next();
  });
  app.use("/api/tutor", tutorRuntimeRouter);
  return app;
}

// ── Client transport: apiRequest → supertest → the real router ─────────────────────────────

type Call = {
  method: string;
  path: string;
  body: unknown;
  status: number;
  response: string;
};
const calls: Call[] = [];

vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queryClient")>();
  const { parseApiErrorFromResponse } = await import("@/lib/api-error");
  return {
    ...actual,
    apiRequest: async (
      url: string,
      options?: { method?: string; body?: string },
    ): Promise<Response> => {
      const method = (options?.method ?? "GET").toUpperCase();
      const agent = request(makeApp());
      const body: unknown = options?.body ? JSON.parse(options.body) : {};
      const res =
        method === "POST"
          ? await agent
              .post(url)
              .set("Content-Type", "application/json")
              .send(options?.body ?? "{}")
          : await agent.get(url);
      // The response as the server sent it (its own bytes, whatever their formatting), so the
      // leak walker below reads the wire, not a re-serialisation of it.
      const text = res.text;
      calls.push({
        method,
        path: url,
        body,
        status: res.status,
        response: text,
      });
      const response = new Response(text, {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        throw await parseApiErrorFromResponse(response, "Request failed");
      }
      return response;
    },
  };
});

// Everything that is not the tutor (the shell's notification bell) goes through csrfFetch.
vi.mock("@/lib/csrf", () => ({
  csrfFetch: async (url: string): Promise<Response> => {
    if (url.startsWith("/api/notifications")) {
      return new Response(JSON.stringify({ data: { unread: 0 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
    });
  },
}));
vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({
    user: {
      id: STUDENT_ID,
      email: "sam@example.test",
      display_name: "Sam Rivera",
      role: "student",
    },
    isLoading: false,
    authLoading: false,
    isAuthenticated: true,
    isAdmin: false,
    isGuardian: false,
    signOut: async () => undefined,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => undefined }),
}));

import { UpgradeModalProvider } from "@/components/billing/UpgradeModal";
import {
  UPGRADE_MODAL_AGE_BODY,
  UPGRADE_MODAL_COPY,
} from "@/components/billing/upgrade-modal";
import { AppShell } from "@/components/layout/app-shell";
import { PROFILE_QUERY_KEY } from "@/hooks/useProfileQuery";
import {
  evaluateNotificationPolicy,
  flagConversationForReview,
  getCrisisResponse,
  runCrisisClassifier,
} from "../../../../server/services/tutor-crisis";
import { bottomChromeHeight, useReportBottomChrome } from "@/lib/bottom-chrome";
import ChatPage from "@/pages/chat";
import { ChatDock, type ChatDockHandle, type ChatDockScope } from "./ChatDock";

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────

const STUDENT_TEXT = "Can you help me with slope?";
const TUTOR_TEXT = "Sure. What does slope measure, in your own words?";
const QUESTION_ID = "SATM1DOCK01";
const STEM = "If 3x - 4 = 11, what is x?";
const EXPLANATION = "zqx-dock-explanation: add 4, then divide by 3.";
const CRISIS_WORDS = "I don't want to be here anymore";
const CRISIS_RESOURCES =
  "You're not alone. If you are in immediate danger, call or text 988.";

function workerReply(content: string = TUTOR_TEXT): unknown {
  return {
    ok: true,
    value: {
      response: {
        content,
        content_kind: "message",
        suggested_action: { type: "none", label: null },
        ui_hints: {
          show_accept_decline: false,
          allow_freeform_reply: true,
          suggested_chip: null,
        },
      },
      question_links: [],
      instruction_exposures: [],
      orchestration_meta: {
        model_name: "test-model",
        prompt_version: "v1",
        cache_used: false,
        compaction_recommended: false,
      },
      learner_observation: null,
    },
  };
}

/** A served (not yet answered) review item, as the review runtime writes it. */
function seedReviewItem(): string {
  const session = db.current.seed("review_sessions", {
    student_id: STUDENT_ID,
  });
  return db.current.seed("review_session_items", {
    session_id: session.id,
    student_id: STUDENT_ID,
    question_id: QUESTION_ID,
    status: "served",
    ordinal: 1,
    question_stem: STEM,
    question_passage: null,
    question_options: [
      { key: "A", text: "3" },
      { key: "B", text: "5" },
    ],
    question_item_type: "mcq",
    question_explanation: EXPLANATION,
    question_correct_answer: "B",
    selected_answer: null,
  }).id as string;
}

/** A practice item, as the practice runtime writes it (owner column `user_id`). */
function seedPracticeItem(status: "served" | "answered"): string {
  const session = db.current.seed("practice_sessions", {
    user_id: STUDENT_ID,
  });
  return db.current.seed("practice_session_items", {
    session_id: session.id,
    user_id: STUDENT_ID,
    question_id: QUESTION_ID,
    status,
    ordinal: 1,
    question_stem: STEM,
    question_passage: null,
    question_options: [
      { key: "A", text: "3" },
      { key: "B", text: "5" },
    ],
    question_item_type: "mcq",
    question_explanation: EXPLANATION,
    question_correct_answer: "B",
    selected_answer: status === "answered" ? "B" : null,
  }).id as string;
}

type Plan = "paid" | "free" | "under13";

async function accessMap(plan: Plan): Promise<FeatureAccessMap> {
  entitlement.paid = plan === "paid";
  const map = await resolveFeatureAccess({
    id: STUDENT_ID,
    role: "student",
    is_under_13: plan === "under13",
  });
  if (map === null) throw new Error("a student always gets a map");
  return map;
}

const GENERAL: ChatDockScope = { kind: "general", surface: "home" };

/** A page with a choice beside the dock: the "answer choices stay clickable" stand-in. */
function DockPage({
  scope,
  onChoice,
  handle,
}: {
  scope: ChatDockScope;
  onChoice: () => void;
  handle?: React.Ref<ChatDockHandle>;
}): JSX.Element {
  return (
    <>
      <button type="button" data-testid="page-choice" onClick={onChoice}>
        Choice A
      </button>
      <ChatDock ref={handle} scope={scope} />
    </>
  );
}

async function mount(
  plan: Plan,
  opts: {
    scope?: ChatDockScope;
    onChoice?: () => void;
    path?: string;
    handle?: React.Ref<ChatDockHandle>;
  } = {},
): Promise<{ client: QueryClient; history: string[] }> {
  const map = await accessMap(plan);
  const { hook, history } = memoryLocation({
    path: opts.path ?? "/dashboard",
    record: true,
  });
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(PROFILE_QUERY_KEY, {
    authenticated: true,
    featureAccess: map,
    user: null,
  });
  render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <UpgradeModalProvider autoOpenOnDenial={false}>
          <Switch>
            <Route path="/chat">
              <AppShell panel={320} content="full">
                <ChatPage />
              </AppShell>
            </Route>
            <Route>
              <AppShell panel={360}>
                <DockPage
                  scope={opts.scope ?? GENERAL}
                  onChoice={opts.onChoice ?? (() => undefined)}
                  handle={opts.handle}
                />
              </AppShell>
            </Route>
          </Switch>
        </UpgradeModalProvider>
      </Router>
    </QueryClientProvider>,
  );
  return { client, history };
}

/**
 * Every key on the answer side of the reveal matrix, as the wire spells it in either case style.
 * A pre-submit payload may carry them only as null (Coding Standards §5.2).
 */
const ANSWER_KEYS = new Set([
  "correct_answer",
  "correctAnswer",
  "correct_option_id",
  "correctOptionId",
  "explanation",
]);

/**
 * The paths at which `value` carries an answer-side key with a non-null value. Parsed and walked
 * (objects and arrays, any depth), so it does not depend on how the JSON is formatted, which key
 * order the server used, or what shape the leaked value has: a regex over the text matched only
 * one compact spelling.
 */
function answerLeaks(value: unknown, at = "$"): string[] {
  if (Array.isArray(value))
    return value.flatMap((v, i) => answerLeaks(v, `${at}[${i}]`));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, v]) => [
    ...(ANSWER_KEYS.has(key) && v !== null && v !== undefined
      ? [`${at}.${key}`]
      : []),
    ...answerLeaks(v, `${at}.${key}`),
  ]);
}

/**
 * The shared anti-leak check over every tutor response the dock read: each is parsed and walked
 * for an answer-side key with a value, and searched for the explanation's sentinel text.
 * Presence first: the caller proves the payload was non-trivial before calling this.
 */
function expectNoAnswerOnTheWire(responses: readonly Call[]): void {
  expect(responses.length).toBeGreaterThan(0);
  for (const c of responses) {
    const parsed: unknown = JSON.parse(c.response);
    expect(answerLeaks(parsed), `${c.method} ${c.path}`).toEqual([]);
    expect(c.response, `${c.method} ${c.path}`).not.toContain(
      "zqx-dock-explanation",
    );
  }
}

/** The opener's words (its lines, joined), without the avatar mark beside them. */
function openerText(panel: HTMLElement): string {
  return Array.from(
    within(panel).getByTestId("tutor-opener").querySelectorAll("p"),
  )
    .map((line) => line.textContent ?? "")
    .join(" ");
}

function tutorCalls(): Call[] {
  return calls.filter((c) => c.path.startsWith("/api/tutor"));
}

function bubble(): HTMLElement {
  return screen.getByTestId("chat-dock-bubble");
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog", { name: "LISA" });
}

function send(text: string): void {
  const panel = dialog();
  fireEvent.change(within(panel).getByRole("textbox", { name: "Message" }), {
    target: { value: text },
  });
  fireEvent.submit(
    within(panel).getByRole("form", { name: /send a message to lisa/i }),
  );
}

function crisisTurnOnce(): void {
  vi.mocked(runCrisisClassifier).mockResolvedValueOnce({
    crisis: true,
    source: "signature",
    category: "crisis",
    signatureId: "sig-dock",
    modelConfidence: null,
    forceReview: false,
  });
  vi.mocked(flagConversationForReview).mockImplementationOnce(
    async (conversationId: string) => {
      const row = db.current
        .rows("tutor_conversations")
        .find((r) => r.id === conversationId);
      if (row) row.crisis_flagged = true;
      return {
        caseId: "case-dock",
        isNewCase: true,
        caseStatus: "open",
        slaDeadline: "2026-10-24T00:00:00.000Z",
      } as Awaited<ReturnType<typeof flagConversationForReview>>;
    },
  );
  vi.mocked(evaluateNotificationPolicy).mockReturnValueOnce({
    shouldNotify: false,
    suppressionReason: "dock-test",
  } as ReturnType<typeof evaluateNotificationPolicy>);
  vi.mocked(getCrisisResponse).mockReturnValueOnce(CRISIS_RESOURCES);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-23T12:00:00.000Z"));
  db.current = new FakeTutorDb();
  calls.length = 0;
  orchestrateTurn.mockReset();
  orchestrateTurn.mockResolvedValue(workerReply());
  entitlement.paid = true;
  db.current.seed("questions", {
    id: QUESTION_ID,
    correct_answer: "B",
    section: "M",
    domain: "Algebra",
    skill_codes: [],
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── The bubble and the lock ────────────────────────────────────────────────────────────────

/**
 * Owner brief "LISA launcher" (Karl, 2026-10-23, option D): the speech-bubble launcher. 14px
 * corners with the bottom-right one 4px, the sparkle (lucide `Sparkles`, one component), the
 * label "Ask LISA", the accent fill and its on-accent ink, 40px tall, the focus ring.
 */
function expectLauncherShape(b: HTMLElement): void {
  expect(b.tagName).toBe("BUTTON");
  expect(b.className).toContain("rounded-[14px]");
  expect(b.className).toContain("rounded-br-[4px]");
  expect(b.className).toContain("bg-lyc-primary-bg");
  expect(b.className).toContain("text-lyc-primary-ink");
  expect(b.className).toContain("focus-visible:outline-lyc-focus");
  expect(b.style.height).toBe("40px");
  expect(b.textContent).toBe("Ask LISA");
}

describe("collapsed: the 'Ask LISA' speech-bubble launcher, bottom-right, that never opens by itself", () => {
  it("paid: the launcher is drawn (shape, sparkle, name), collapsed, and nothing is asked of the tutor until it is clicked", async () => {
    await mount("paid");
    const b = bubble();
    expect(b.getAttribute("aria-label")).toBe("Ask LISA");
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expectLauncherShape(b);
    expect(within(b).getByTestId("lisa-sparkle")).toBeTruthy();
    expect(screen.getByTestId("chat-dock").getAttribute("data-view")).toBe(
      "collapsed",
    );
    // Presence before absence: the shell around it is drawn.
    expect(screen.getByTestId("app-rail")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("chat-dock-lock")).toBeNull();
    expect(tutorCalls()).toHaveLength(0);
  });

  it("free: the bubble carries the rail's lock and opens the EXISTING upgrade modal for tutor_access, with no tutor request", async () => {
    await mount("free");
    const b = bubble();
    // The same lock the rail draws for LISA, from the same map.
    expect(screen.getByTestId("rail-lisa-lock")).toBeTruthy();
    // The same launcher shape, the lock in the sparkle's place.
    expectLauncherShape(b);
    expect(within(b).getByTestId("chat-dock-lock")).toBeTruthy();
    expect(within(b).queryByTestId("lisa-sparkle")).toBeNull();
    expect(b.getAttribute("aria-label")).toBe(
      "Ask LISA, included with a paid plan",
    );
    fireEvent.click(b);
    const modal = await screen.findByTestId("upgrade-modal");
    expect(modal.textContent).toContain(
      UPGRADE_MODAL_COPY.tutor_access.plan.title,
    );
    // The panel never mounted, so no tutor route was called.
    expect(screen.queryByTestId("chat-dock-panel")).toBeNull();
    expect(tutorCalls()).toHaveLength(0);
  });

  it("under 13: the lock opens the modal with the age message, as the rail's does", async () => {
    await mount("under13");
    fireEvent.click(bubble());
    const modal = await screen.findByTestId("upgrade-modal");
    expect(modal.textContent).toContain(UPGRADE_MODAL_AGE_BODY);
    expect(tutorCalls()).toHaveLength(0);
  });

  it("phones (below 768px): no bubble and no dock; the LISA tab is still in the tab bar", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      // A 390px phone: every `min-width` query fails, so every "not all and" phone query holds.
      matches: query.startsWith("not all and"),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      await mount("paid");
      expect(screen.getByTestId("tab-lisa")).toBeTruthy();
      expect(screen.queryByTestId("chat-dock")).toBeNull();
      expect(screen.queryByTestId("chat-dock-bubble")).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });
});

// ── Open, non-modal, Esc ───────────────────────────────────────────────────────────────────

describe("expanded: a non-modal, labelled panel; Esc minimizes", () => {
  it("paid: the bubble opens the panel (role=dialog, aria-modal=false, named 'LISA'), focused, with Minimize and Close", async () => {
    await mount("paid");
    fireEvent.click(bubble());
    const panel = dialog();
    expect(panel.getAttribute("aria-modal")).toBe("false");
    // No data-state: index.css hides the cookie banner for an OPEN Radix dialog, never for this.
    expect(panel.hasAttribute("data-state")).toBe(false);
    expect(document.activeElement).toBe(panel);
    expect(
      within(panel).getByRole("button", { name: "Minimize LISA" }),
    ).toBeTruthy();
    expect(
      within(panel).getByRole("button", { name: "Close LISA" }),
    ).toBeTruthy();
    // Owner brief 2026-10-23: the header shows the sparkle and "LISA".
    const header = within(panel).getByRole("heading", { name: "LISA" })
      .parentElement as HTMLElement;
    expect(within(header).getByTestId("lisa-sparkle")).toBeTruthy();
    // General mode on Home: Home's opening line, and the composer.
    await within(panel).findByRole("textbox", { name: "Message" });
    expect(openerText(panel)).toBe("What do you want to work on?");
    // Looking is a GET; opening creates nothing.
    expect(tutorCalls().filter((c) => c.method === "POST")).toHaveLength(0);
  });

  // Owner ruling (Karl, 2026-10-23, ruling 4 on #1300): Send in the dock is an outline icon button
  // (a paper plane) named "Send", so the page keeps its one filled button.
  it("Send is an outline paper-plane icon button named 'Send': the dock adds no filled button", async () => {
    await mount("paid");
    fireEvent.click(bubble());
    const panel = dialog();
    await within(panel).findByRole("textbox", { name: "Message" });
    // Presence first: the Send control is there, with its icon.
    const send = within(panel).getByRole("button", { name: "Send" });
    expect(send.querySelector("svg")).not.toBeNull();
    expect(send.className).toContain("border-lyc-ink-strong");
    expect(send.className).not.toContain("bg-lyc-primary-bg");
    // No filled (primary) button anywhere in the dock.
    const filled = within(panel)
      .getAllByRole("button")
      .filter((b) => b.className.includes("bg-lyc-primary-bg"));
    expect(filled).toEqual([]);
  });

  it("non-modal: with the dock open the page's controls still take clicks, and the dock stays open", async () => {
    const onChoice = vi.fn();
    await mount("paid", { onChoice });
    fireEvent.click(bubble());
    expect(dialog()).toBeTruthy();
    fireEvent.click(screen.getByTestId("page-choice"));
    expect(onChoice).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeTruthy();
    // No overlay, nothing inert: the choice is not hidden from assistive technology.
    expect(
      screen.getByTestId("page-choice").closest("[aria-hidden='true'],[inert]"),
    ).toBeNull();
  });

  it("Esc minimizes: back to the bubble, focus on it, and the draft is still there on reopen", async () => {
    await mount("paid");
    fireEvent.click(bubble());
    const box = await within(dialog()).findByRole("textbox", {
      name: "Message",
    });
    fireEvent.change(box, { target: { value: "half a thought" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(bubble());
    expect(screen.getByTestId("chat-dock").getAttribute("data-view")).toBe(
      "minimized",
    );
    // Kept mounted (the draft), and hidden by its display too: a `flex` class would override
    // the `hidden` attribute and leave it on screen (the browser spec caught that once).
    const kept = screen.getByTestId("chat-dock-panel");
    expect(kept.hidden).toBe(true);
    expect(kept.classList.contains("hidden")).toBe(true);
    expect(kept.classList.contains("flex")).toBe(false);
    fireEvent.click(bubble());
    expect(
      (
        within(dialog()).getByRole("textbox", {
          name: "Message",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("half a thought");
  });

  it("Close returns to the bubble and drops the panel's state", async () => {
    await mount("paid");
    fireEvent.click(bubble());
    const box = await within(dialog()).findByRole("textbox", {
      name: "Message",
    });
    fireEvent.change(box, { target: { value: "half a thought" } });
    fireEvent.click(
      within(dialog()).getByRole("button", { name: "Close LISA" }),
    );
    expect(screen.queryByTestId("chat-dock-panel")).toBeNull();
    expect(document.activeElement).toBe(bubble());
    fireEvent.click(bubble());
    const again = (await within(dialog()).findByRole("textbox", {
      name: "Message",
    })) as HTMLTextAreaElement;
    expect(again.value).toBe("");
  });
});

// ── One thread with the LISA page ──────────────────────────────────────────────────────────

describe("one thread: the dock (general mode) and the LISA page share the conversation", () => {
  it("a message sent in the dock appears on the LISA page, read back from the server", async () => {
    const { client, history } = await mount("paid");
    fireEvent.click(bubble());
    await within(dialog()).findByRole("textbox", { name: "Message" });
    send(STUDENT_TEXT);
    await within(dialog()).findByText(TUTOR_TEXT);

    // Anti-leak in general mode too. Presence first: the dock read a non-trivial thread from the
    // server (the student's turn and LISA's reply in a conversation detail).
    const detailReads = tutorCalls().filter(
      (c) =>
        c.method === "GET" &&
        /^\/api\/tutor\/conversations\/[^/?]+$/.test(c.path),
    );
    expect(
      detailReads.some((c) => {
        const body = JSON.parse(c.response) as {
          data?: { messages?: Array<{ message?: string }> };
        };
        const texts = (body.data?.messages ?? []).map((m) => m.message);
        return texts.includes(STUDENT_TEXT) && texts.includes(TUTOR_TEXT);
      }),
    ).toBe(true);
    expectNoAnswerOnTheWire(tutorCalls());

    // The dock created ONE general conversation, which is the LISA page's kind (standalone).
    const rows = db.current.rows("tutor_conversations");
    expect(rows).toHaveLength(1);
    const convId = rows[0]?.id as string;
    expect(rows[0]?.entry_mode).toBe("general");
    expect(rows[0]?.surface).toBe("standalone");

    // The dock's own way to the page names that conversation.
    const link = await waitFor(() => {
      const a = screen.getByTestId("chat-dock-open-page");
      expect(a.getAttribute("href")).toBe(`/chat?conversationId=${convId}`);
      return a;
    });
    // Nothing carried over in the cache: the page must read it from the server.
    client.removeQueries({ queryKey: ["tutor"] });
    fireEvent.click(link);
    await waitFor(() =>
      expect(history.at(-1)).toBe(`/chat?conversationId=${convId}`),
    );

    const page = await screen.findByTestId("lisa-page");
    // The page draws the dock's turn as its own: the student's bubble and LISA's reply.
    const student = await within(page).findByTestId("student-bubble");
    expect(student.textContent).toContain(STUDENT_TEXT);
    expect(within(page).getByTestId("tutor-bubble").textContent).toContain(
      TUTOR_TEXT,
    );
    // And it heads the page's history.
    const items = await screen.findAllByTestId("lisa-history-item");
    expect(items[0]?.getAttribute("href")).toBe(
      `/chat?conversationId=${convId}`,
    );
    expect(
      calls.some(
        (c) =>
          c.method === "GET" &&
          c.path === `/api/tutor/conversations/${convId}` &&
          c.status === 200,
      ),
    ).toBe(true);
  });

  it("the other way: the conversation the LISA page holds open is the one the dock opens on", async () => {
    const convId = db.current.seed("tutor_conversations", {
      student_id: STUDENT_ID,
      entry_mode: "general",
      source_surface: "dashboard",
      surface: "standalone",
      source_session_id: null,
      source_session_item_id: null,
      source_question_row_id: null,
      source_question_canonical_id: null,
      status: "active",
      crisis_flagged: false,
      deleted_at: null,
      updated_at: "2026-09-23T11:00:00.000Z",
      closed_at: null,
      title: "Slope",
      crisis_paused_at: null,
      ended_at: null,
    }).id as string;
    db.current.seed("tutor_messages", {
      conversation_id: convId,
      student_id: STUDENT_ID,
      role: "student",
      content_kind: "message",
      message: "Started on the LISA page",
      client_turn_id: crypto.randomUUID(),
      created_at: "2026-09-23T11:00:00.000Z",
    });
    await mount("paid");
    fireEvent.click(bubble());
    await within(dialog()).findByText("Started on the LISA page");
    expect(tutorCalls().filter((c) => c.method === "POST")).toHaveLength(0);
  });
});

// ── Question scope: anti-leak ──────────────────────────────────────────────────────────────

describe("question scope (the review runner): the item's own conversation, and no answer before submit", () => {
  it("before submit: the dock's wire and screen carry the question, never the answer or the explanation", async () => {
    const itemId = seedReviewItem();
    await mount("paid", {
      scope: {
        kind: "question",
        sourceSurface: "review",
        sessionItemId: itemId,
        questionLabel: "Question 1 of 5",
        submitted: false,
      },
    });
    fireEvent.click(bubble());
    const panel = dialog();
    expect(within(panel).getByTestId("tutor-question-chip").textContent).toBe(
      "Question 1 of 5",
    );
    await within(panel).findByRole("textbox", { name: "Message" });
    send("where do I start?");
    await within(dialog()).findByText(TUTOR_TEXT);

    // Scoped to the current question: one conversation, created for this item.
    const creates = tutorCalls().filter(
      (c) => c.method === "POST" && c.path === "/api/tutor/conversations",
    );
    expect(creates).toHaveLength(1);
    expect(creates[0]?.body).toMatchObject({
      entry_mode: "scoped_question",
      source_surface: "review",
      source_session_item_id: itemId,
    });

    // Presence: the envelope LISA was given holds the question.
    const env = orchestrateTurn.mock.calls[0]?.[0] as {
      is_post_submit: boolean;
      correct_answer: string | null;
      question_content: { stem: string; explanation: string | null } | null;
    };
    expect(env.question_content?.stem).toBe(STEM);
    // Absence: neither the answer nor the explanation, on the wire to LISA...
    expect(env.is_post_submit).toBe(false);
    expect(env.correct_answer).toBeNull();
    expect(env.question_content?.explanation).toBeNull();
    expect(JSON.stringify(env)).not.toContain("zqx-dock-explanation");
    // ...in any response the dock read (presence first: it read some)...
    expect(tutorCalls().length).toBeGreaterThan(2);
    expectNoAnswerOnTheWire(tutorCalls());
    // ...and on screen, in every dock state: open, then minimized and reopened.
    expect(dialog().textContent).toContain(TUTOR_TEXT);
    expect(document.body.textContent).not.toContain("zqx-dock-explanation");
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(document.body.textContent).not.toContain("zqx-dock-explanation");
    fireEvent.click(bubble());
    expect(dialog().textContent).toContain(TUTOR_TEXT);
    expect(document.body.textContent).not.toContain("zqx-dock-explanation");
  });
});

// ── Practice scope (owner ruling 2 on #1300): the dock after submit ─────────────────────────

describe("practice scope (the practice runner, after submit): the answered item's conversation; the server still gates", () => {
  type Envelope = {
    source_surface: string;
    is_post_submit: boolean;
    correct_answer: string | null;
    question_content: { stem: string; explanation: string | null } | null;
  };

  async function askInPractice(
    itemId: string,
    submitted: boolean,
  ): Promise<Envelope> {
    await mount("paid", {
      scope: {
        kind: "question",
        sourceSurface: "practice",
        sessionItemId: itemId,
        questionLabel: "Question 1 of 5",
        submitted,
      },
    });
    fireEvent.click(bubble());
    await within(dialog()).findByRole("textbox", { name: "Message" });
    send("why is it B?");
    await within(dialog()).findByText(TUTOR_TEXT);
    const creates = tutorCalls().filter(
      (c) => c.method === "POST" && c.path === "/api/tutor/conversations",
    );
    expect(creates).toHaveLength(1);
    expect(creates[0]?.body).toMatchObject({
      entry_mode: "scoped_question",
      source_surface: "practice",
      source_session_item_id: itemId,
    });
    return orchestrateTurn.mock.calls[0]?.[0] as Envelope;
  }

  it("after submit: the practice conversation is created for the answered item, and LISA may see the explanation (the post-submit reveal)", async () => {
    const env = await askInPractice(seedPracticeItem("answered"), true);
    expect(env.source_surface).toBe("practice");
    expect(env.question_content?.stem).toBe(STEM);
    expect(env.is_post_submit).toBe(true);
    expect(env.question_content?.explanation).toBe(EXPLANATION);
  });

  it("if a practice item were not yet submitted, the server still withholds the answer and explanation, on the wire and in every response", async () => {
    const env = await askInPractice(seedPracticeItem("served"), false);
    // Presence: the envelope carries the question itself.
    expect(env.question_content?.stem).toBe(STEM);
    expect(env.is_post_submit).toBe(false);
    expect(env.correct_answer).toBeNull();
    expect(env.question_content?.explanation).toBeNull();
    expect(JSON.stringify(env)).not.toContain("zqx-dock-explanation");
    expectNoAnswerOnTheWire(tutorCalls());
    expect(document.body.textContent).not.toContain("zqx-dock-explanation");
  });
});

// ── F-91 (owner ruling 1 on #1300): the runner's conversations on the LISA page ─────────────

describe("F-91: the LISA page lists the runner's per-question conversations, labelled with their question, read-only", () => {
  /**
   * A question's conversation as the runner's dock writes it, with one turn each way. Started on
   * September 21 and last active on September 23 (owner ruling 2026-10-24: the label's date is
   * when the chat happened, `created_at`), so the two dates can tell the fields apart.
   */
  function seedScopedConversation(
    itemId: string,
    surface: "review" | "practice" = "review",
  ): string {
    const convId = db.current.seed("tutor_conversations", {
      student_id: STUDENT_ID,
      entry_mode: "scoped_question",
      source_surface: surface,
      surface,
      created_at: "2026-09-21T15:00:00.000Z",
      source_session_id: null,
      source_session_item_id: itemId,
      source_question_row_id: QUESTION_ID,
      source_question_canonical_id: QUESTION_ID,
      status: "active",
      crisis_flagged: false,
      deleted_at: null,
      updated_at: "2026-09-23T11:30:00.000Z",
      closed_at: null,
      title: "where do I start?",
      crisis_paused_at: null,
      ended_at: null,
    }).id as string;
    db.current.seed("tutor_messages", {
      conversation_id: convId,
      student_id: STUDENT_ID,
      role: "student",
      content_kind: "message",
      message: "where do I start?",
      client_turn_id: crypto.randomUUID(),
      created_at: "2026-09-23T11:30:00.000Z",
    });
    db.current.seed("tutor_messages", {
      conversation_id: convId,
      student_id: STUDENT_ID,
      role: "tutor",
      content_kind: "message",
      message: TUTOR_TEXT,
      client_turn_id: null,
      created_at: "2026-09-23T11:30:01.000Z",
    });
    return convId;
  }

  it("the history lists it, labelled 'Review question', with no answer content in the label or on the wire (the item is not yet submitted)", async () => {
    const convId = seedScopedConversation(seedReviewItem());
    await mount("paid", { path: "/chat" });
    const items = await screen.findAllByTestId("lisa-history-item");
    const row = items.find(
      (a) => a.getAttribute("href") === `/chat?conversationId=${convId}`,
    );
    // Presence first: the row is there, with its title and its question label.
    expect(row).toBeTruthy();
    // Owner ruling 2026-10-24: type and the day it happened (created_at), U+00B7 between.
    expect(within(row!).getByTestId("lisa-history-scope").textContent).toBe(
      "Review question \u00b7 Sep 21",
    );
    expect(row!.textContent).toContain("where do I start?");
    // The label names the question by its surface only: no stem, no answer, no explanation.
    expect(row!.textContent).not.toContain(STEM);
    expect(row!.textContent).not.toContain("zqx-dock-explanation");
    expectNoAnswerOnTheWire(tutorCalls());
  });

  it("opened on the LISA page it shows its turns read-only: no composer, no End session, the note; the wire carries no answer", async () => {
    const convId = seedScopedConversation(seedReviewItem());
    await mount("paid", { path: `/chat?conversationId=${convId}` });
    const page = await screen.findByTestId("lisa-page");
    // Presence first: the conversation's turns, read back from the server.
    const tutor = await within(page).findByTestId("tutor-bubble");
    expect(tutor.textContent).toContain(TUTOR_TEXT);
    expect(within(page).getByTestId("student-bubble").textContent).toContain(
      "where do I start?",
    );
    // Approved wording (Karl, 2026-10-24).
    expect(within(page).getByTestId("lisa-scoped-note").textContent).toBe(
      "This chat was about one question. To keep going, open that question and ask LISA there.",
    );
    expect(within(page).queryByRole("textbox", { name: "Message" })).toBeNull();
    expect(
      within(page).queryByRole("button", { name: "End session" }),
    ).toBeNull();
    expect(page.textContent).not.toContain("zqx-dock-explanation");
    expectNoAnswerOnTheWire(tutorCalls());
  });

  it("a practice question's conversation is labelled 'Practice question · Sep 21'", async () => {
    const convId = seedScopedConversation(
      seedPracticeItem("answered"),
      "practice",
    );
    await mount("paid", { path: "/chat" });
    const items = await screen.findAllByTestId("lisa-history-item");
    const row = items.find(
      (a) => a.getAttribute("href") === `/chat?conversationId=${convId}`,
    );
    expect(row).toBeTruthy();
    expect(within(row!).getByTestId("lisa-history-scope").textContent).toBe(
      "Practice question \u00b7 Sep 21",
    );
  });

  it("the LISA page's own conversations are unchanged: no question label, and the composer", async () => {
    const convId = db.current.seed("tutor_conversations", {
      student_id: STUDENT_ID,
      entry_mode: "general",
      source_surface: "dashboard",
      surface: "standalone",
      source_session_id: null,
      source_session_item_id: null,
      source_question_row_id: null,
      source_question_canonical_id: null,
      status: "active",
      crisis_flagged: false,
      deleted_at: null,
      updated_at: "2026-09-23T11:00:00.000Z",
      closed_at: null,
      title: "Slope",
      crisis_paused_at: null,
      ended_at: null,
    }).id as string;
    await mount("paid", { path: `/chat?conversationId=${convId}` });
    const items = await screen.findAllByTestId("lisa-history-item");
    expect(items).toHaveLength(1);
    expect(within(items[0]!).queryByTestId("lisa-history-scope")).toBeNull();
    expect(
      await screen.findByRole("textbox", { name: "Message" }),
    ).toBeTruthy();
    expect(screen.queryByTestId("lisa-scoped-note")).toBeNull();
  });
});

// ── The crisis flow ────────────────────────────────────────────────────────────────────────

describe("the crisis flow inside the dock: flag → pause → Continue, as on the LISA page", () => {
  it("a crisis message shows the Support card and the paused bar; Continue brings the composer back with one /resume", async () => {
    await mount("paid");
    fireEvent.click(bubble());
    await within(dialog()).findByRole("textbox", { name: "Message" });
    crisisTurnOnce();
    send(CRISIS_WORDS);

    const card = await within(dialog()).findByTestId("crisis-support-card");
    expect(card.getAttribute("data-lane")).toBe("crisis");
    expect(card.textContent).toContain(CRISIS_RESOURCES);
    expect(within(dialog()).getByText("Tutoring is paused")).toBeTruthy();
    expect(orchestrateTurn).not.toHaveBeenCalled();
    const convId = db.current.rows("tutor_conversations")[0]?.id as string;
    await waitFor(() =>
      expect(
        db.current.rows("tutor_conversations")[0]?.crisis_paused_at,
      ).not.toBeNull(),
    );

    fireEvent.click(
      within(dialog()).getByRole("button", { name: /continue with lisa/i }),
    );
    await waitFor(() =>
      expect(within(dialog()).queryByText("Tutoring is paused")).toBeNull(),
    );
    expect(
      within(dialog()).getByRole("form", { name: /send a message to lisa/i }),
    ).toBeTruthy();
    const resumes = tutorCalls().filter((c) => c.path.endsWith("/resume"));
    expect(resumes.map((c) => [c.path, c.status])).toEqual([
      [`/api/tutor/conversations/${convId}/resume`, 200],
    ]);
    expect(
      db.current.rows("tutor_conversations")[0]?.crisis_paused_at,
    ).toBeNull();
  });
});

// ── Placement: above the measured bottom chrome ────────────────────────────────────────────

describe("placement: the dock sits above the tab bar + cookie banner, or the runner's footer, whichever is taller", () => {
  function Reporter({
    layer,
    height,
  }: {
    layer: "tab-bar" | "consent" | "runner-footer";
    height: number;
  }): JSX.Element {
    const ref = React.useRef<HTMLElement>(null);
    useReportBottomChrome(ref, layer);
    return (
      <div ref={ref as React.RefObject<HTMLDivElement>} data-height={height} />
    );
  }

  // jsdom's CSS parser garbles `env(...)` inside `calc()`, so the safe-area term is asserted only
  // as present; the measured px part is what this test pins.
  // Owner ruling 5 on #1300: the bubble reports itself (the `dock-bubble` layer) while drawn, so
  // the runner's side calculator can keep clear of it; the open panel replaces it, and reports 0.
  it("the drawn bubble reports its height as the `dock-bubble` layer, and stops when the panel opens", async () => {
    const proto = HTMLElement.prototype;
    const original = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function rect(this: HTMLElement) {
      return this.dataset.testid === "chat-dock-bubble"
        ? ({ height: 56 } as DOMRect)
        : original.call(this);
    };
    try {
      await mount("paid");
      expect(bubble()).toBeTruthy();
      await waitFor(() => expect(bottomChromeHeight(["dock-bubble"])).toBe(56));
      fireEvent.click(bubble());
      expect(dialog()).toBeTruthy();
      expect(bottomChromeHeight(["dock-bubble"])).toBe(0);
      fireEvent.keyDown(dialog(), { key: "Escape" });
      await waitFor(() => expect(bottomChromeHeight(["dock-bubble"])).toBe(56));
    } finally {
      proto.getBoundingClientRect = original;
    }
  });

  it("bottom = max(tab bar + banner, footer) + 16px, plus the safe area", async () => {
    const proto = HTMLElement.prototype;
    const original = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function rect(this: HTMLElement) {
      const h = this.dataset.height;
      return h !== undefined
        ? ({ height: Number(h) } as DOMRect)
        : original.call(this);
    };
    try {
      await mount("paid");
      const dock = screen.getByTestId("chat-dock");
      // Presence: the dock is drawn, at the bottom edge plus its 16px.
      expect(dock.style.bottom).toMatch(/^calc\(16px \+ env\(/);
      const extra = render(
        <>
          <Reporter layer="tab-bar" height={65} />
          <Reporter layer="consent" height={120} />
        </>,
      );
      await act(async () => undefined);
      expect(dock.style.bottom).toMatch(/^calc\(201px \+ env\(/);
      extra.unmount();
      const footer = render(<Reporter layer="runner-footer" height={81} />);
      await act(async () => undefined);
      expect(dock.style.bottom).toMatch(/^calc\(97px \+ env\(/);
      footer.unmount();
    } finally {
      proto.getBoundingClientRect = original;
    }
  });
});

// ── The launcher brief (owner brief, Karl, 2026-10-23) ──────────────────────────────────────

describe("opening lines per surface (owner brief, Karl, 2026-10-23)", () => {
  it("Review (general mode): 'Want help with your past mistakes?'", async () => {
    await mount("paid", { scope: { kind: "general", surface: "review" } });
    fireEvent.click(bubble());
    await within(dialog()).findByRole("textbox", { name: "Message" });
    expect(openerText(dialog())).toBe("Want help with your past mistakes?");
  });

  // Owner ruling (Karl, 2026-10-23): before submit the W4-4 opener, UNCHANGED; after submit the
  // walk-through line, on practice and on review.
  it("review, BEFORE submit: the W4-4 opener, unchanged", async () => {
    const itemId = seedReviewItem();
    await mount("paid", {
      scope: {
        kind: "question",
        sourceSurface: "review",
        sessionItemId: itemId,
        questionLabel: "Question 1 of 5",
        submitted: false,
      },
    });
    fireEvent.click(bubble());
    await within(dialog()).findByRole("textbox", { name: "Message" });
    expect(openerText(dialog())).toBe(
      "Need help with this question? " +
        "I can walk you through it. I won't give you the answer before you submit.",
    );
  });

  for (const surface of ["review", "practice"] as const) {
    it(`${surface}, AFTER submit: 'Want to walk through this one? Ask me about any step.'`, async () => {
      const itemId =
        surface === "review" ? seedReviewItem() : seedPracticeItem("answered");
      await mount("paid", {
        scope: {
          kind: "question",
          sourceSurface: surface,
          sessionItemId: itemId,
          questionLabel: "Question 1 of 5",
          submitted: true,
        },
      });
      fireEvent.click(bubble());
      await within(dialog()).findByRole("textbox", { name: "Message" });
      expect(openerText(dialog())).toBe(
        "Want to walk through this one? Ask me about any step.",
      );
    });
  }
});

describe("the dock's handle: open() is the launcher's click (\"Still confused? Ask LISA\")", () => {
  it("paid: open() opens the panel, focused", async () => {
    const handle = React.createRef<ChatDockHandle>();
    await mount("paid", { handle });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => handle.current?.open());
    expect(dialog()).toBeTruthy();
    expect(document.activeElement).toBe(dialog());
  });

  it("free: open() opens the upgrade modal, never the panel, and calls no tutor route", async () => {
    const handle = React.createRef<ChatDockHandle>();
    await mount("free", { handle });
    act(() => handle.current?.open());
    expect(await screen.findByTestId("upgrade-modal")).toBeTruthy();
    expect(screen.queryByTestId("chat-dock-panel")).toBeNull();
    expect(tutorCalls()).toHaveLength(0);
  });
});

describe("placement in the column (owner brief, Karl, 2026-10-23): bottom-right of the middle column", () => {
  it("right = the column's right edge + 16px; bottom never below the column's bottom edge; the panel min(380, column - 24)", async () => {
    const proto = HTMLElement.prototype;
    const originalRect = proto.getBoundingClientRect;
    const originalWidth = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "clientWidth",
    );
    const column = { left: 96, width: 568, bottom: 700 };
    proto.getBoundingClientRect = function rect(this: HTMLElement) {
      return this.id === "main"
        ? ({
            left: column.left,
            width: column.width,
            right: column.left + column.width,
            bottom: column.bottom,
            top: 0,
            height: column.bottom,
          } as DOMRect)
        : originalRect.call(this);
    };
    Object.defineProperty(Element.prototype, "clientWidth", {
      configurable: true,
      get(this: Element) {
        return this.id === "main" ? column.width : 0;
      },
    });
    try {
      await mount("paid");
      const dock = screen.getByTestId("chat-dock");
      // Presence: the column was measured (jsdom's window is 1024 × 768).
      await waitFor(() =>
        expect(dock.style.right).toBe(`${1024 - (96 + 568) + 16}px`),
      );
      // 768 - 700 = 68px of screen under the column's bottom edge, then the 16px.
      expect(dock.style.bottom).toMatch(/^calc\(84px \+ env\(/);
      fireEvent.click(bubble());
      expect(dialog().style.width).toBe("380px");
      // A narrower column: the panel takes the column's width less 24px.
      column.width = 300;
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(dialog().style.width).toBe("276px");
      expect(dock.style.right).toBe(`${1024 - (96 + 300) + 16}px`);
    } finally {
      proto.getBoundingClientRect = originalRect;
      if (originalWidth)
        Object.defineProperty(Element.prototype, "clientWidth", originalWidth);
    }
  });
});
