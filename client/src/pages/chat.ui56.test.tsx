// @vitest-environment jsdom
/**
 * UI-56: LISA (`/chat`) on the App shell — paid, free and under 13.
 *
 * @spec [student-UI register UI-56; §2 Free versus paid (LISA is paid; tutor denials stay 403
 *        nested with `tutor_access`, SCL-185; LISA's own predicate), OQ-29 (the feature-access
 *        map; an under-13 student gets the age message, not the upgrade modal), OQ-39 (f)
 *        (history includes ended sessions), OQ-44 (LISA's shipped headline), UI-16 (history on
 *        the server's cursor); DESIGN.md §1 (motion only for the dots, never under reduced
 *        motion), §3 (Typing indicator; Keyboard hook), §4 LISA; prototype Lisa.dc.html;
 *        Coding Standards §12.1 (tutor exchanges are never logged)]
 * @implemented [2026-10-03]
 *
 * plain English: the page is mounted in the real App shell (the history panel portals into it),
 * under the real upgrade modal with its denial listener on, inside a memory router, with the
 * REAL tutor router behind the REAL tutor-client hooks (supertest over the in-memory
 * FakeTutorDb, the way the tutor's own route tests run it). Only the model call
 * (`orchestrateTurn`) and the services that would reach Google are replaced, exactly as the
 * other chat contract tests replace them. So conversations, messages and pages are what the
 * route produces, not hand-written fixtures. The feature-access map is `resolveFeatureAccess`'s
 * own output for a paid, a free and an under-13 student.
 *
 * PRESENCE BEFORE ABSENCE: every "not there" check runs after the page has drawn what sits
 * beside it.
 */
import React from "react";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import postcss, { type AtRule, type Rule } from "postcss";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { FeatureAccessMap } from "@lyceon/shared/feature-access";
import { FakeTutorDb } from "../../../tests/helpers/fake-tutor-db";

Element.prototype.scrollIntoView = vi.fn();

// ── Server side: the tutor route is real; its collaborators are stubbed ───────────────────

const db = { current: new FakeTutorDb() };

vi.mock("../../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return db.current.client();
  },
}));
vi.mock("../../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
const entitlement = vi.hoisted(() => ({ paid: true }));
vi.mock("../../../server/services/entitlement-service", () => ({
  EntitlementService: {
    canAccessFeature: async () => entitlement.paid,
    isEntitlementActiveForProfile: async () => entitlement.paid,
  },
}));
const orchestrateTurn = vi.fn();
vi.mock("../../../server/lib/tutor-orchestrator-client", () => ({
  orchestrateTurn: (...args: unknown[]) => orchestrateTurn(...args),
}));
vi.mock("../../../server/services/tutor-context", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../server/services/tutor-context")
  >()),
  resolveFullEnvelope: vi.fn(async () => ({
    recent_messages: [],
    memory_summaries: [],
    student_learning_context: { mastery_snapshot: null },
    resolved_scope: {
      source_session_id: null,
      source_session_item_id: null,
      source_question_row_id: null,
      source_question_canonical_id: null,
    },
  })),
}));
vi.mock("../../../server/services/tutor-memory", () => ({
  getRecentMessages: vi.fn(async () => []),
}));
vi.mock("../../../server/services/tutor-crisis", () => ({
  runCrisisClassifier: vi.fn(async () => ({
    crisis: false,
    forceReview: false,
  })),
  getCrisisResponse: vi.fn(),
  flagConversationForReview: vi.fn(),
  notifyCrisisEvent: vi.fn(),
  evaluateNotificationPolicy: vi.fn(),
}));
vi.mock("../../../server/services/tutor-policy-logger", () => ({
  logContextResolution: vi.fn(async () => undefined),
  logTurnMetrics: vi.fn(async () => undefined),
}));
vi.mock("../../../server/services/tutor-runtime-writer", () => ({
  persistInstructionAssignment: vi.fn(async () => ({
    ok: true,
    assignmentId: "assignment-1",
  })),
}));
vi.mock("../../../server/services/cloud-tasks-enqueue", () => ({
  enqueueCloudTask: vi.fn(async () => undefined),
}));

const STUDENT_ID = "56565656-5656-4565-8565-565656565656";

import tutorRuntimeRouter from "../../../server/routes/tutor-runtime";
import { resolveFeatureAccess } from "../../../server/lib/feature-access";

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

type Call = { method: string; path: string; body: unknown; status: number };
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
      calls.push({ method, path: url, body, status: res.status });
      const response = new Response(JSON.stringify(res.body), {
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
import { LISA_UPGRADE_PITCH } from "@/components/tutor/LisaUpgradeCard";
import { PROFILE_QUERY_KEY } from "@/hooks/useProfileQuery";
import ChatPage, { LISA_COMPOSER_PLACEHOLDER } from "./chat";

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────

const STUDENT_TEXT = "I keep getting slope questions wrong";
const TUTOR_TEXT =
  "Let's start with what slope tells you. What do you get with y by itself?";

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

/** A conversation row as the tutor's own route tests seed it. */
function seedConversation(
  overrides: { title?: string; status?: string; updated_at?: string } = {},
): string {
  const row = db.current.seed("tutor_conversations", {
    student_id: STUDENT_ID,
    entry_mode: "general",
    source_surface: "dashboard",
    surface: "standalone",
    source_session_id: null,
    source_session_item_id: null,
    source_question_row_id: null,
    source_question_canonical_id: null,
    status: overrides.status ?? "active",
    crisis_flagged: false,
    deleted_at: null,
    updated_at: overrides.updated_at ?? "2026-09-24T10:00:00.000Z",
    closed_at: null,
    title: overrides.title ?? "New session",
    crisis_paused_at: null,
    ended_at: null,
  });
  return row.id as string;
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

async function mount(
  plan: Plan,
  search = "",
): Promise<{ history: string[]; client: QueryClient }> {
  const map = await accessMap(plan);
  const { hook, history } = memoryLocation({
    path: `/chat${search}`,
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
        <UpgradeModalProvider autoOpenOnDenial>
          <AppShell panel={320} content="full">
            <ChatPage />
          </AppShell>
        </UpgradeModalProvider>
      </Router>
    </QueryClientProvider>,
  );
  return { history, client };
}

function tutorCalls(): Call[] {
  return calls.filter((c) => c.path.startsWith("/api/tutor"));
}

function composer(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Message" });
}

function sendButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Send message" });
}

function keydown(el: Element, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  el.dispatchEvent(event);
  return event;
}

async function conversationLoaded(convId: string): Promise<void> {
  await waitFor(() =>
    expect(
      calls.some(
        (c) =>
          c.method === "GET" &&
          c.path === `/api/tutor/conversations/${convId}` &&
          c.status === 200,
      ),
    ).toBe(true),
  );
  await screen.findByRole("textbox", { name: "Message" });
}

function historyItems(): HTMLElement[] {
  return screen.queryAllByTestId("lisa-history-item");
}

beforeEach(() => {
  db.current = new FakeTutorDb();
  calls.length = 0;
  orchestrateTurn.mockReset();
  entitlement.paid = true;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ── Paid ───────────────────────────────────────────────────────────────────────────────────

describe("UI-56 paid: the conversation, the composer and the right panel", () => {
  it("Enter sends; Shift+Enter adds a line and sends nothing (the shared keyboard hook)", async () => {
    orchestrateTurn.mockResolvedValue(workerReply());
    const convId = seedConversation();
    await mount("paid", `?conversationId=${convId}`);
    await conversationLoaded(convId);

    fireEvent.change(composer(), { target: { value: STUDENT_TEXT } });
    const shiftEnter = keydown(composer(), { key: "Enter", shiftKey: true });
    // The textarea keeps its default (the new line) and nothing is posted.
    expect(shiftEnter.defaultPrevented).toBe(false);
    expect(
      tutorCalls().filter(
        (c) => c.method === "POST" && c.path === "/api/tutor/messages",
      ),
    ).toHaveLength(0);

    const enter = keydown(composer(), { key: "Enter" });
    expect(enter.defaultPrevented).toBe(true);
    await screen.findByText(TUTOR_TEXT);
    const posts = tutorCalls().filter(
      (c) => c.method === "POST" && c.path === "/api/tutor/messages",
    );
    expect(posts).toHaveLength(1);
    expect((posts[0]?.body as { message: string }).message).toBe(STUDENT_TEXT);
    // The turn is labelled as the prototype labels it.
    const student = screen.getByTestId("student-bubble");
    expect(within(student).getByText("You")).toBeTruthy();
    const tutor = screen.getByTestId("tutor-bubble");
    expect(within(tutor).getByText("LISA")).toBeTruthy();
  });

  it("while LISA is thinking: a LISA-labelled typing bubble of three dots, and Send is disabled", async () => {
    let finish: (v: unknown) => void = () => undefined;
    orchestrateTurn.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const convId = seedConversation();
    await mount("paid", `?conversationId=${convId}`);
    await conversationLoaded(convId);

    fireEvent.change(composer(), { target: { value: STUDENT_TEXT } });
    expect(sendButton().disabled).toBe(false);
    fireEvent.click(sendButton());
    await waitFor(() => expect(orchestrateTurn).toHaveBeenCalledTimes(1));

    const typing = screen.getByRole("status", { name: "LISA is thinking" });
    expect(within(typing).getByText("LISA")).toBeTruthy();
    expect(typing.querySelectorAll(".lyc-dot")).toHaveLength(3);
    // No sentence beside the dots (DESIGN.md §3), and the button reads the prototype's "Send".
    expect(typing.textContent).toBe("LISA");
    expect(sendButton().textContent).toBe("Send");
    expect(sendButton().disabled).toBe(true);
    // Disabled because LISA is thinking, not because the draft is empty: with words in the
    // box it stays disabled, and Enter sends nothing.
    fireEvent.change(composer(), { target: { value: "and one more thing" } });
    expect(composer().value).toBe("and one more thing");
    expect(sendButton().disabled).toBe(true);
    keydown(composer(), { key: "Enter" });
    expect(orchestrateTurn).toHaveBeenCalledTimes(1);

    finish(workerReply());
    await screen.findByText(TUTOR_TEXT);
    expect(
      screen.queryByRole("status", { name: "LISA is thinking" }),
    ).toBeNull();
  });

  it("the composer and the disclaimer are the prototype's, word for word, with no key hint", async () => {
    const convId = seedConversation();
    await mount("paid", `?conversationId=${convId}`);
    await conversationLoaded(convId);

    expect(composer().getAttribute("placeholder")).toBe(
      "Ask LISA about a question or a skill",
    );
    expect(LISA_COMPOSER_PLACEHOLDER).toBe(
      "Ask LISA about a question or a skill",
    );
    const form = screen.getByRole("form", { name: "Send a message to LISA" });
    expect(
      within(form).getByText(
        "LISA can make mistakes; your practice results are the source of truth.",
      ),
    ).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(
      /shift|enter to|press enter|new line/i,
    );
  });

  it("history: GET /api/tutor/conversations, 20 rows, then Show older on the server's cursor; ended sessions included (OQ-39 (f))", async () => {
    // 21 conversations, newest first by updated_at; the oldest is ended.
    for (let i = 0; i < 21; i += 1) {
      seedConversation({
        title: `Session ${String(i).padStart(2, "0")}`,
        status: i === 0 ? "ended" : "active",
        updated_at: new Date(Date.UTC(2026, 8, 1, 10, i)).toISOString(),
      });
    }
    await mount("paid");

    await waitFor(() => expect(historyItems()).toHaveLength(20));
    const first = calls.find(
      (c) =>
        c.method === "GET" && c.path.startsWith("/api/tutor/conversations?"),
    );
    expect(first?.path).toBe("/api/tutor/conversations?surface=standalone");
    expect(first?.path).not.toContain("status=");
    expect(historyItems()[0]?.textContent).toContain("Session 20");

    fireEvent.click(screen.getByRole("button", { name: "Show older" }));
    await waitFor(() => expect(historyItems()).toHaveLength(21));
    const second = calls.filter(
      (c) =>
        c.method === "GET" && c.path.startsWith("/api/tutor/conversations?"),
    )[1];
    expect(second?.path).toMatch(/[?&]cursor=/);
    const titles = historyItems().map(
      (a) => a.querySelector("span")?.textContent ?? "",
    );
    expect(new Set(titles).size).toBe(21);
    // The ended conversation (the oldest) is listed.
    expect(titles[20]).toBe("Session 00");
    expect(screen.queryByRole("button", { name: "Show older" })).toBeNull();
  });

  it("New session creates a conversation and opens its empty column", async () => {
    orchestrateTurn.mockResolvedValue(workerReply());
    const convId = seedConversation({ title: "Slope from standard form" });
    const { history } = await mount("paid", `?conversationId=${convId}`);
    await conversationLoaded(convId);
    fireEvent.change(composer(), { target: { value: STUDENT_TEXT } });
    fireEvent.click(sendButton());
    await screen.findByText(TUTOR_TEXT);
    expect(screen.getAllByTestId("student-bubble")).toHaveLength(1);

    fireEvent.click(screen.getByTestId("lisa-new-session"));

    await waitFor(() =>
      expect(db.current.rows("tutor_conversations")).toHaveLength(2),
    );
    const created = db.current
      .rows("tutor_conversations")
      .find((r) => r.id !== convId);
    await waitFor(() =>
      expect(history[history.length - 1]).toBe(
        `/chat?conversationId=${String(created?.id)}`,
      ),
    );
    await conversationLoaded(String(created?.id));
    expect(screen.getByTestId("lisa-title").textContent).toBe("New session");
    expect(screen.queryAllByTestId("student-bubble")).toHaveLength(0);
    expect(screen.queryAllByTestId("tutor-bubble")).toHaveLength(0);
    const post = calls.find(
      (c) => c.method === "POST" && c.path === "/api/tutor/conversations",
    );
    expect(post?.body).toMatchObject({
      entry_mode: "general",
      source_surface: "dashboard",
    });
  });

  it("with no conversation open, the first message creates one and is sent there, once", async () => {
    orchestrateTurn.mockResolvedValue(workerReply());
    const { history } = await mount("paid");
    await screen.findByText("No sessions yet");
    expect(screen.getByTestId("lisa-title").textContent).toBe("New session");

    fireEvent.change(composer(), { target: { value: STUDENT_TEXT } });
    fireEvent.click(sendButton());

    await screen.findByText(TUTOR_TEXT);
    const conversations = db.current.rows("tutor_conversations");
    expect(conversations).toHaveLength(1);
    expect(history[history.length - 1]).toBe(
      `/chat?conversationId=${String(conversations[0]?.id)}`,
    );
    const posts = calls.filter(
      (c) => c.method === "POST" && c.path === "/api/tutor/messages",
    );
    expect(posts).toHaveLength(1);
    expect(screen.getAllByTestId("student-bubble")).toHaveLength(1);
  });

  it("an ended conversation opens read-only: its turns, no composer, no End session", async () => {
    orchestrateTurn.mockResolvedValue(workerReply());
    const convId = seedConversation();
    await mount("paid", `?conversationId=${convId}`);
    await conversationLoaded(convId);
    fireEvent.change(composer(), { target: { value: STUDENT_TEXT } });
    fireEvent.click(sendButton());
    await screen.findByText(TUTOR_TEXT);
    expect(screen.getByRole("button", { name: "End session" })).toBeTruthy();
    cleanup();

    const row = db.current
      .rows("tutor_conversations")
      .find((r) => r.id === convId);
    if (row) row.status = "ended";
    await mount("paid", `?conversationId=${convId}`);
    await screen.findByText(TUTOR_TEXT);
    expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
    expect(screen.queryByRole("button", { name: "End session" })).toBeNull();
  });

  it("nothing on the page logs a tutor exchange (console spied through a full turn)", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (method) => vi.spyOn(console, method),
    );
    orchestrateTurn.mockResolvedValue(workerReply());
    const convId = seedConversation();
    await mount("paid", `?conversationId=${convId}`);
    await conversationLoaded(convId);
    fireEvent.change(composer(), { target: { value: STUDENT_TEXT } });
    fireEvent.click(sendButton());
    // Presence first: the exchange happened and is on screen.
    await screen.findByText(TUTOR_TEXT);
    expect(
      within(screen.getByTestId("student-bubble")).getByText(STUDENT_TEXT),
    ).toBeTruthy();

    const logged = spies
      .flatMap((spy) => spy.mock.calls)
      .map((args) =>
        args
          .map((a) => (typeof a === "string" ? a : (JSON.stringify(a) ?? "")))
          .join(" "),
      )
      .join("\n");
    expect(logged).not.toContain(STUDENT_TEXT);
    expect(logged).not.toContain("slope");
    expect(logged).not.toContain(TUTOR_TEXT);
  });
});

// ── Free and under 13 ──────────────────────────────────────────────────────────────────────

describe("UI-56 free and under 13: no tutor request, and the right words", () => {
  it("free plan: the shipped headline and Unlock LISA, which opens the modal for tutor_access; no tutor request", async () => {
    await mount("free");
    const card = await screen.findByTestId("lisa-locked");
    expect(card.getAttribute("data-reason")).toBe("plan");
    const heading = within(card).getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe(LISA_UPGRADE_PITCH.title);
    expect(heading.textContent).toBe(
      "A Tutor That Knows The SAT And Knows You",
    );
    expect(card.textContent).toContain(
      UPGRADE_MODAL_COPY.tutor_access.plan.body,
    );
    const unlock = within(card).getByRole("button", { name: "Unlock LISA" });
    // Nothing of the paid page: no composer, no history.
    expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
    expect(screen.queryByTestId("lisa-history")).toBeNull();
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();

    fireEvent.click(unlock);
    const modal = await screen.findByTestId("upgrade-modal");
    expect(modal.textContent).toContain(LISA_UPGRADE_PITCH.title);
    expect(within(modal).getByTestId("upgrade-modal-see-plans")).toBeTruthy();
    expect(tutorCalls()).toEqual([]);
  });

  it("under 13: the age message, not the upgrade pitch; no button, no modal, no tutor request", async () => {
    await mount("under13");
    const card = await screen.findByTestId("lisa-locked");
    expect(card.getAttribute("data-reason")).toBe("age");
    expect(card.textContent).toContain(UPGRADE_MODAL_AGE_BODY);
    expect(card.textContent).toContain(
      UPGRADE_MODAL_COPY.tutor_access.age.title,
    );
    expect(card.textContent).not.toContain(
      UPGRADE_MODAL_COPY.tutor_access.plan.body,
    );
    expect(within(card).queryByRole("button")).toBeNull();
    expect(screen.queryByText("Unlock LISA")).toBeNull();
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
    expect(tutorCalls()).toEqual([]);
  });
});

// ── Motion ─────────────────────────────────────────────────────────────────────────────────

describe("UI-56 motion: the dots pulse, and reduced motion stops them (DESIGN.md §1)", () => {
  const css = postcss.parse(
    fs.readFileSync(
      path.resolve(__dirname, "../styles/student-tokens.css"),
      "utf8",
    ),
  );

  function dotRule(inside: "top" | "reduced"): Rule | null {
    let found: Rule | null = null;
    css.walkRules((rule) => {
      if (rule.selector !== ".lyc-dot") return;
      const parent = rule.parent;
      const inReduced =
        parent?.type === "atrule" &&
        (parent as AtRule).name === "media" &&
        (parent as AtRule).params.includes("prefers-reduced-motion: reduce");
      if ((inside === "reduced") === inReduced) found = rule;
    });
    return found;
  }

  function decl(rule: Rule | null, prop: string): string | null {
    let value: string | null = null;
    rule?.walkDecls(prop, (d) => {
      value = d.value;
    });
    return value;
  }

  it("the indicator's dots are .lyc-dot, which animates; under reduced motion the animation is none", () => {
    // Presence: the pulse exists outside the media query.
    expect(decl(dotRule("top"), "animation")).toMatch(/^lyc-dot /);
    // And the reduced-motion rule removes it.
    expect(decl(dotRule("reduced"), "animation")).toBe("none");
  });
});
