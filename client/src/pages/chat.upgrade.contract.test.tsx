// @vitest-environment jsdom
/**
 * @spec [Doc-03B §6.5 (entitlement before every other step, kept by owner
 *        ruling 2026-09-27), §12.3 ("UI surfaces renewal path"); Coding
 *        Standards §6.1, §11.3, §13 (no empty catch); closure plan W4-11]
 * @implemented 2026-09-27
 *
 * plain English: an unpaid student on the standalone chat never gets a
 * composer. The session list is a tutor route, so the server refuses it on
 * load and the LISA upgrade card takes the place of "New session"; a
 * refusal later (entitlement lapsed) on "New session", on a conversation or
 * on a send puts the card where the composer was. A paying student never
 * sees the card, and a non-entitlement failure is never drawn as one.
 *
 * @updated 2026-10-03 — UI-56: the card is the page's locked state (`lisa-locked`: LISA's
 * shipped headline and "Unlock LISA", which opens the app's upgrade modal), replacing the whole
 * page, history panel included; the app's denial listener opens the modal on the same refusal.
 * These tests run with NO feature-access map, so the server's refusal is the only signal.
 *
 * WHY THIS TEST EXISTS. "New session" used to call `mutateAsync` inside an
 * empty `catch {}` whose comment said the error was handled by
 * `createConversation.error` — which nothing read. An unpaid student clicked,
 * saw a spinner, and then nothing. Every refusal below is the REAL router's,
 * reaching the page through the REAL tutor-client hooks.
 */
import React from "react";
import express from "express";
import request from "supertest";
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
import { FakeTutorDb } from "../../../tests/helpers/fake-tutor-db";

Element.prototype.scrollIntoView = vi.fn();

// ── Server side: the route is real; its collaborators are stubbed ─────────

const db = { current: new FakeTutorDb() };

vi.mock("../../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return db.current.client();
  },
}));
vi.mock("../../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../server/services/entitlement-service", () => ({
  EntitlementService: {
    isEntitlementActiveForProfile: vi.fn(async () => true),
  },
}));

const orchestrateTurn = vi.fn();
vi.mock("../../../server/lib/tutor-orchestrator-client", () => ({
  orchestrateTurn: (...args: unknown[]) => orchestrateTurn(...args),
}));
// The real module, so "New session" can resolve its scope; only the envelope
// a turn builds is replaced.
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

const STUDENT_ID = "44444444-4444-4444-8444-444444444444";

import tutorRuntimeRouter from "../../../server/routes/tutor-runtime";
import { EntitlementService } from "../../../server/services/entitlement-service";
import { LISA_UPGRADE_PITCH } from "@/components/tutor/LisaUpgradeCard";
import { UpgradeModalProvider } from "@/components/billing/UpgradeModal";

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

// ── Client transport: apiRequest → supertest → the real router ─────────────

type Call = { method: string; path: string; body: unknown; status: number };
const calls: Call[] = [];

vi.mock("@/lib/queryClient", async () => {
  const { parseApiErrorFromResponse } = await import("@/lib/api-error");
  return {
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

let mockSearch = "";
// UI-56: the page reads the feature-access map (GET /api/profile, OQ-29) before any tutor
// request. These tests drive the conversation with NO map, which leaves every decision to the
// tutor routes themselves (the server's own refusal); the map's locked states are covered by
// chat.ui56.test.tsx.
vi.mock("@/hooks/useProfileQuery", () => ({
  useProfileQuery: () => ({ isPending: false, data: undefined }),
}));
// UI-56: the history is the App shell's right panel (a portal into the shell). Without the
// shell, draw it in place so these tests can reach New session and the list.
vi.mock("@/components/layout/app-shell", () => ({
  AppShellPanel: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/chat", vi.fn()],
  useSearch: () => mockSearch,
}));
// A visible stand-in for the one billing card, showing the pitch it was
// drawn with. Its own copy and destination are tested with the resolver.
vi.mock("@/components/billing/PremiumUpgradePrompt", () => ({
  PremiumUpgradePrompt: (p: { mode?: string; pitch?: { title: string } }) => (
    <div data-testid="premium-upgrade-prompt" data-mode={p.mode}>
      {p.pitch?.title}
    </div>
  ),
}));

// ── Fixtures ────────────────────────────────────────────────────────────

const STUDENT_TEXT = "how do I factor x^2 + 5x + 6";
const TUTOR_TEXT = "Look for two numbers that multiply to 6 and add to 5.";

function seedEmptyConversation(): string {
  const conv = db.current.seed("tutor_conversations", {
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
    updated_at: "2026-09-25T00:00:00.000Z",
    closed_at: null,
    title: "New session",
    crisis_paused_at: null,
    ended_at: null,
  });
  return conv.id as string;
}

function workerReply(
  suggestedAction: { type: string; label: string | null } = {
    type: "none",
    label: null,
  },
  content: string = TUTOR_TEXT,
): unknown {
  return {
    ok: true,
    value: {
      response: {
        content,
        content_kind: "message",
        suggested_action: suggestedAction,
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

async function renderChat(search = ""): Promise<void> {
  mockSearch = search;
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const { default: ChatPage } = await import("./chat");
  render(
    <QueryClientProvider client={qc}>
      <UpgradeModalProvider>
        <ChatPage />
      </UpgradeModalProvider>
    </QueryClientProvider>,
  );
}

/** The page's locked state, drawn only on the server's refusal here (no map). */
async function lockedCard(): Promise<HTMLElement> {
  const card = await screen.findByTestId("lisa-locked");
  expect(card.getAttribute("data-reason")).toBe("plan");
  expect(card.textContent).toContain(LISA_UPGRADE_PITCH.title);
  expect(within(card).getByTestId("lisa-unlock").textContent).toBe(
    "Unlock LISA",
  );
  return card;
}

/** The empty conversation has loaded: its GET returned and the composer is up. */
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
  await screen.findByLabelText("Message");
}

function setEntitled(active: boolean): void {
  vi.mocked(EntitlementService.isEntitlementActiveForProfile).mockResolvedValue(
    active,
  );
}

function send(text: string): void {
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: text },
  });
  fireEvent.submit(
    screen.getByRole("form", { name: /send a message to lisa/i }),
  );
}

/** The server refused this route with 403 (its path, query string ignored). */
function refused(method: string, path: string): boolean {
  return calls.some(
    (c) =>
      c.method === method && c.path.split("?")[0] === path && c.status === 403,
  );
}

beforeEach(() => {
  cleanup();
  db.current = new FakeTutorDb();
  calls.length = 0;
  orchestrateTurn.mockReset();
  setEntitled(true);
});

afterEach(() => setEntitled(true));

describe("W4-11 — standalone chat: an unpaid student never reaches a composer", () => {
  it("unpaid, on load: the card replaces the page and New session — refused by the server, nothing typed", async () => {
    setEntitled(false);
    await renderChat();

    await lockedCard();
    expect(refused("GET", "/api/tutor/conversations")).toBe(true);
    // The app's denial listener opened the modal on the same refusal (UI-44).
    expect(await screen.findByTestId("upgrade-modal")).toBeTruthy();
    expect(screen.queryByTestId("lisa-new-session")).toBeNull();
    expect(screen.queryByLabelText("Message")).toBeNull();
  });

  // QA 2026-10-07 item 9: New session creates nothing; the create is the first message's. So
  // the lapsed student's refusal arrives on that first message's create, and draws the card.
  it("New session after entitlement lapsed: nothing is created on the click; the first message's create is refused and draws the card", async () => {
    await renderChat();
    const newSession = await screen.findByTestId("lisa-new-session");
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "GET" &&
            c.path.startsWith("/api/tutor/conversations?") &&
            c.status === 200,
        ),
      ).toBe(true),
    );

    setEntitled(false);
    fireEvent.click(newSession);
    // Presence first: the empty column's composer is up; nothing was asked of the server.
    expect(await screen.findByLabelText("Message")).toBeTruthy();
    expect(
      calls.filter(
        (c) => c.method === "POST" && c.path === "/api/tutor/conversations",
      ),
    ).toHaveLength(0);

    send(STUDENT_TEXT);
    await lockedCard();
    expect(refused("POST", "/api/tutor/conversations")).toBe(true);
    expect(db.current.rows("tutor_conversations")).toHaveLength(0);
    expect(screen.queryByLabelText("Message")).toBeNull();
  });

  it("a returning student whose entitlement lapsed: the card where the composer was", async () => {
    const convId = seedEmptyConversation();
    setEntitled(false);
    await renderChat(`?conversationId=${convId}`);

    await lockedCard();
    expect(screen.queryByLabelText("Message")).toBeNull();
  });

  it("sending after entitlement lapsed: refused, and the composer is replaced — not left disabled", async () => {
    const convId = seedEmptyConversation();
    await renderChat(`?conversationId=${convId}`);
    await conversationLoaded(convId);

    setEntitled(false);
    send(STUDENT_TEXT);

    await lockedCard();
    expect(refused("POST", "/api/tutor/messages")).toBe(true);
    expect(screen.queryByLabelText("Message")).toBeNull();
    expect(orchestrateTurn).not.toHaveBeenCalled();
  });

  it("a paying student never sees the card — on load, on New session, or on send", async () => {
    orchestrateTurn.mockResolvedValue(workerReply());
    await renderChat();
    const newSession = await screen.findByTestId("lisa-new-session");
    expect(screen.queryAllByTestId("lisa-locked")).toHaveLength(0);

    // QA-9: New session creates nothing; its first message creates the conversation.
    fireEvent.click(newSession);
    expect(db.current.rows("tutor_conversations")).toHaveLength(0);
    // (This file's router is a fixed stub, so the page does not follow the create into the new
    // conversation; chat.ui56.test.tsx follows it through to the reply.)
    send(STUDENT_TEXT);
    await waitFor(() =>
      expect(db.current.rows("tutor_conversations")).toHaveLength(1),
    );
    expect(screen.queryAllByTestId("lisa-locked")).toHaveLength(0);

    cleanup();
    const convId = seedEmptyConversation();
    await renderChat(`?conversationId=${convId}`);
    await conversationLoaded(convId);
    send(STUDENT_TEXT);
    await screen.findByText(TUTOR_TEXT);

    expect(screen.queryAllByTestId("lisa-locked")).toHaveLength(0);
    expect(screen.queryAllByTestId("premium-upgrade-prompt")).toHaveLength(0);
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
    expect(screen.getByLabelText("Message")).toBeTruthy();
    expect(calls.filter((c) => c.status === 403)).toHaveLength(0);
  });

  it("a New session whose first message's create fails for any other reason says so — not a paywall; the words stay", async () => {
    await renderChat();
    const [welcomeButton] = await screen.findAllByRole("button", {
      name: /^new session$/i,
    });
    // QA-9: the click creates nothing; the create is the first message's.
    fireEvent.click(welcomeButton);
    expect(await screen.findByLabelText("Message")).toBeTruthy();

    const broken = vi.spyOn(db.current, "client").mockImplementation(() => {
      throw new Error("db down");
    });
    send(STUDENT_TEXT);
    const [alert] = await screen.findAllByRole("alert");
    broken.mockRestore();

    expect(alert.textContent).toMatch(/couldn.t start a session/i);
    expect(screen.queryAllByTestId("lisa-upgrade")).toHaveLength(0);
    expect(screen.queryAllByTestId("lisa-locked")).toHaveLength(0);
    // The student's words go back in the composer.
    expect(
      (screen.getByLabelText("Message") as HTMLTextAreaElement).value,
    ).toBe(STUDENT_TEXT);
  });
});
