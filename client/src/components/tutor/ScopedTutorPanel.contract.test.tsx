// @vitest-environment jsdom
/**
 * @spec [Doc-02B_V4 §21 (Question Awareness), CR-02B-29; closure plan W4-1,
 *        W4-4 (LISA always open in review; no conversation on load)]
 * @implemented 2026-09-25 | @updated 2026-09-25 — W4-4
 *
 * plain English: LISA is open beside every review question, and being open
 * costs nothing: on load the panel only LOOKS for the item's conversation (a
 * GET) and shows an opener — an invitation, not a message. The conversation
 * is created on the student's first real message, and only then. One
 * conversation per item; before submit, the wire carries the question and
 * neither the answer nor the explanation.
 *
 * Nothing is mocked between the panel and the envelope: the REAL tutor-client
 * hooks call `apiRequest`, routed through supertest into the REAL tutor router,
 * which builds the REAL envelope over the in-memory DB. Every request is
 * recorded, so "zero POST /conversations" is a count, not an assumption.
 */
import React from "react";
import express from "express";
import request from "supertest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTutorDb } from "../../../../tests/helpers/fake-tutor-db";

Element.prototype.scrollIntoView = vi.fn();

// ── Server side: the route and the envelope builder are real ──────────────

const db = { current: new FakeTutorDb() };

vi.mock("../../../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return db.current.client();
  },
}));
vi.mock("../../../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../../server/services/entitlement-service", () => ({
  EntitlementService: {
    isEntitlementActiveForProfile: vi.fn(async () => true),
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

const STUDENT_ID = "77777777-7777-4777-8777-777777777777";

import tutorRuntimeRouter from "../../../../server/routes/tutor-runtime";

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

type Call = { method: string; path: string };
const calls: Call[] = [];

function conversationCreates(): Call[] {
  return calls.filter(
    (c) => c.method === "POST" && c.path === "/api/tutor/conversations",
  );
}

vi.mock("@/lib/queryClient", async () => {
  const { parseApiErrorFromResponse } = await import("@/lib/api-error");
  return {
    apiRequest: async (
      url: string,
      options?: { method?: string; body?: string },
    ): Promise<Response> => {
      const method = (options?.method ?? "GET").toUpperCase();
      const agent = request(makeApp());
      const res =
        method === "POST"
          ? await agent
              .post(url)
              .set("Content-Type", "application/json")
              .send(options?.body ?? "{}")
          : await agent.get(url);
      calls.push({ method, path: url });
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
vi.mock("@/components/billing/PremiumUpgradePrompt", () => ({
  PremiumUpgradePrompt: () => null,
}));

import {
  OPENER_BODY,
  OPENER_TITLE,
  ScopedTutorPanel,
} from "./ScopedTutorPanel";

// ── Fixtures ────────────────────────────────────────────────────────────

const QUESTION_ID = "SATM1REV001";
const EXPLANATION = "zqx-panel-explanation: isolate x first.";
const TUTOR_TEXT = "What would you do first to get x by itself?";

function seedReviewItem(ordinal: number): string {
  const session = db.current.seed("review_sessions", {
    student_id: STUDENT_ID,
  });
  return db.current.seed("review_session_items", {
    session_id: session.id,
    student_id: STUDENT_ID,
    question_id: QUESTION_ID,
    status: "served",
    ordinal,
    question_stem: "If 3x - 4 = 11, what is x?",
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

function workerReply(): unknown {
  return {
    ok: true,
    value: {
      response: {
        content: TUTOR_TEXT,
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

function conversationsFor(itemId: string): Array<Record<string, unknown>> {
  return db.current
    .rows("tutor_conversations")
    .filter((r) => r.source_session_item_id === itemId);
}

type Props = React.ComponentProps<typeof ScopedTutorPanel>;

function props(itemId: string, label = "Question 1 / 5"): Props {
  return {
    sourceSurface: "review",
    sessionItemId: itemId,
    questionLabel: label,
    onHide: vi.fn(),
  };
}

function renderPanel(p: Props): {
  rerender: (next: Props) => void;
  unmount: () => void;
} {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrap = (x: Props): React.ReactElement => (
    <QueryClientProvider client={qc}>
      <ScopedTutorPanel {...x} />
    </QueryClientProvider>
  );
  const r = render(wrap(p));
  return { rerender: (next) => r.rerender(wrap(next)), unmount: r.unmount };
}

/** The panel has finished looking and is ready for the student. */
async function ready(): Promise<void> {
  await screen.findByLabelText("Message");
}

function send(text: string): void {
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: text },
  });
  fireEvent.submit(
    screen.getByRole("form", { name: /send a message to lisa/i }),
  );
}

function seedConversation(
  itemId: string,
  messages: Array<{ role: "student" | "tutor"; message: string }>,
): string {
  const conv = db.current.seed("tutor_conversations", {
    student_id: STUDENT_ID,
    entry_mode: "scoped_question",
    source_surface: "review",
    surface: "review",
    source_session_id: null,
    source_session_item_id: itemId,
    source_question_row_id: QUESTION_ID,
    source_question_canonical_id: QUESTION_ID,
    status: "active",
    updated_at: "2026-09-23T11:00:00.000Z",
  });
  messages.forEach((m, i) =>
    db.current.seed("tutor_messages", {
      conversation_id: conv.id,
      role: m.role,
      content_kind: "message",
      message: m.message,
      client_turn_id: m.role === "student" ? crypto.randomUUID() : null,
      created_at: `2026-09-23T11:00:0${i}.000Z`,
    }),
  );
  return conv.id as string;
}

beforeEach(() => {
  // The in-memory DB's clock starts 2026-09-23; pin "now" beside it so the
  // 7-day conversation-reuse window is not a function of the calendar.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-23T12:00:00.000Z"));
  db.current = new FakeTutorDb();
  calls.length = 0;
  orchestrateTurn.mockReset();
  orchestrateTurn.mockResolvedValue(workerReply());
  db.current.seed("questions", {
    id: QUESTION_ID,
    correct_answer: "B",
    section: "M",
    domain: "Algebra",
    skill_codes: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe("W4-4 — open on load, and nothing created by being open", () => {
  it("on load: the chip names the question, the opener is shown, and ZERO POST /conversations", async () => {
    const itemId = seedReviewItem(1);
    renderPanel(props(itemId, "Question 3 / 10"));
    await ready();

    expect(screen.getByTestId("tutor-question-chip").textContent).toBe(
      "Question 3 / 10",
    );
    const opener = screen.getByTestId("tutor-opener");
    expect(opener.textContent).toContain(OPENER_TITLE);
    expect(opener.textContent).toContain(OPENER_BODY);

    expect(conversationCreates()).toHaveLength(0);
    expect(db.current.rows("tutor_conversations")).toHaveLength(0);
    // It looked — with a GET scoped to this item.
    expect(
      calls.some(
        (c) =>
          c.method === "GET" &&
          c.path.startsWith("/api/tutor/conversations?") &&
          c.path.includes(`source_session_item_id=${itemId}`),
      ),
    ).toBe(true);
  });

  it("the opener is not a message: no bubble, nothing persisted, not in the thread", async () => {
    renderPanel(props(seedReviewItem(1)));
    await ready();
    expect(screen.queryAllByTestId("tutor-bubble")).toHaveLength(0);
    expect(screen.queryAllByTestId("student-bubble")).toHaveLength(0);
    expect(db.current.rows("tutor_messages")).toHaveLength(0);
  });

  it("the FIRST message creates the conversation — exactly once — and the opener is gone", async () => {
    const itemId = seedReviewItem(1);
    renderPanel(props(itemId));
    await ready();

    send("where do I start?");
    // Gone at once — the student's text replaces it, before the reply.
    expect(screen.queryByTestId("tutor-opener")).toBeNull();
    expect(screen.getAllByTestId("student-bubble")[0].textContent).toContain(
      "where do I start?",
    );

    await screen.findByText(TUTOR_TEXT);
    expect(screen.queryByTestId("tutor-opener")).toBeNull();
    expect(conversationCreates()).toHaveLength(1);
    const [conv] = conversationsFor(itemId);
    expect(conv?.entry_mode).toBe("scoped_question");
    expect(conv?.source_surface).toBe("review");
    expect(conv?.source_question_row_id).toBe(QUESTION_ID);
    // The first message went through the turn machine exactly once.
    expect(orchestrateTurn).toHaveBeenCalledTimes(1);
    const studentRows = db.current
      .rows("tutor_messages")
      .filter((r) => r.role === "student");
    expect(studentRows).toHaveLength(1);
    expect(studentRows[0].message).toBe("where do I start?");

    // A second message goes to the same conversation; no second create.
    send("and then?");
    await waitFor(() => expect(orchestrateTurn).toHaveBeenCalledTimes(2));
    expect(conversationCreates()).toHaveLength(1);
  });

  it("BEFORE the student answers: the first turn's wire carries the question, and neither the answer nor the explanation", async () => {
    renderPanel(props(seedReviewItem(1)));
    await ready();
    send("where do I start?");
    await screen.findByText(TUTOR_TEXT);

    const env = orchestrateTurn.mock.calls[0][0] as {
      source_surface: string;
      is_post_submit: boolean;
      correct_answer: string | null;
      question_content: { stem: string; explanation: string | null } | null;
    };
    expect(env.source_surface).toBe("review");
    expect(env.is_post_submit).toBe(false);
    expect(env.question_content?.stem).toBe("If 3x - 4 = 11, what is x?");
    expect(env.correct_answer).toBeNull();
    expect(env.question_content?.explanation).toBeNull();
    expect(JSON.stringify(env)).not.toContain("zqx-panel-explanation");
  });

  it("revisit: an item with a thread shows that thread — found by GET, zero POST, no opener", async () => {
    const itemId = seedReviewItem(1);
    seedConversation(itemId, [
      { role: "student", message: "where do I start?" },
      { role: "tutor", message: TUTOR_TEXT },
    ]);
    renderPanel(props(itemId));

    await screen.findByText(TUTOR_TEXT);
    expect(screen.queryByTestId("tutor-opener")).toBeNull();
    expect(conversationCreates()).toHaveLength(0);
  });

  it("a conversation that exists with no messages still shows the opener, and creates nothing", async () => {
    const itemId = seedReviewItem(1);
    seedConversation(itemId, []);
    renderPanel(props(itemId));
    await screen.findByTestId("tutor-opener");
    expect(conversationCreates()).toHaveLength(0);
  });

  it("moving to the next item: its own opener, the previous thread does not follow, still zero creates for it", async () => {
    const first = seedReviewItem(1);
    const second = seedReviewItem(2);
    const view = renderPanel(props(first, "Question 1 / 5"));
    await ready();
    send("where do I start?");
    await screen.findByText(TUTOR_TEXT);
    expect(conversationCreates()).toHaveLength(1);

    view.rerender(props(second, "Question 2 / 5"));
    await screen.findByTestId("tutor-opener");
    expect(screen.getByTestId("tutor-question-chip").textContent).toBe(
      "Question 2 / 5",
    );
    expect(screen.queryByText(TUTOR_TEXT)).toBeNull();
    expect(conversationCreates()).toHaveLength(1);
    expect(conversationsFor(second)).toHaveLength(0);

    // Back to the first: its thread, by GET.
    view.rerender(props(first, "Question 1 / 5"));
    await screen.findByText(TUTOR_TEXT);
    expect(conversationCreates()).toHaveLength(1);
  });

  it("Hide LISA calls onHide", async () => {
    const p = props(seedReviewItem(1));
    renderPanel(p);
    fireEvent.click(screen.getByRole("button", { name: "Hide LISA" }));
    expect(p.onHide).toHaveBeenCalledTimes(1);
  });
});
