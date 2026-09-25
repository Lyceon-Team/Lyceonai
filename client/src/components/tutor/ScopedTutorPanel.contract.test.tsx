// @vitest-environment jsdom
/**
 * @spec [Doc-02B_V4 §21 (Question Awareness), CR-02B-29; closure plan W4-1]
 * @implemented 2026-09-25
 *
 * plain English: LISA beside a review question. The panel names the question,
 * closes, opens ONE conversation per review item, and — before the student
 * answers — what reaches the model carries the question and neither the
 * answer nor the explanation.
 *
 * Nothing is mocked between the panel and the envelope: the REAL tutor-client
 * hooks call `apiRequest`, routed through supertest into the REAL tutor router,
 * which builds the REAL envelope over the in-memory DB. Only the worker call is
 * replaced, and the envelope handed to it is exactly what would go on the wire.
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

import { ScopedTutorPanel } from "./ScopedTutorPanel";

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

function renderPanel(props: Props): {
  rerender: (next: Props) => void;
  unmount: () => void;
} {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrap = (p: Props): React.ReactElement => (
    <QueryClientProvider client={qc}>
      <ScopedTutorPanel {...p} />
    </QueryClientProvider>
  );
  const r = render(wrap(props));
  return { rerender: (next) => r.rerender(wrap(next)), unmount: r.unmount };
}

async function composerReady(): Promise<void> {
  await screen.findByLabelText("Message");
}

beforeEach(() => {
  // The in-memory DB's clock starts 2026-09-23; pin "now" beside it so the
  // 7-day conversation-reuse window is not a function of the calendar.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-23T12:00:00.000Z"));
  db.current = new FakeTutorDb();
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

describe("W4-1 — LISA panel on a review item", () => {
  it("names the question under review, and opens a review conversation scoped to the item", async () => {
    const itemId = seedReviewItem(1);
    renderPanel({
      sourceSurface: "review",
      sessionItemId: itemId,
      questionLabel: "Question 3 / 10",
      onClose: vi.fn(),
    });

    expect(screen.getByTestId("tutor-question-chip").textContent).toBe(
      "Question 3 / 10",
    );
    await composerReady();

    const [conv] = conversationsFor(itemId);
    expect(conv?.entry_mode).toBe("scoped_question");
    expect(conv?.source_surface).toBe("review");
    expect(conv?.source_question_row_id).toBe(QUESTION_ID);
  });

  it("BEFORE the student answers: a turn from the panel sends the question, and neither the answer nor the explanation", async () => {
    const itemId = seedReviewItem(1);
    renderPanel({
      sourceSurface: "review",
      sessionItemId: itemId,
      questionLabel: "Question 1 / 5",
      onClose: vi.fn(),
    });
    await composerReady();

    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "where do I start?" },
    });
    fireEvent.submit(
      screen.getByRole("form", { name: /send a message to lisa/i }),
    );

    await screen.findByText(TUTOR_TEXT);
    expect(orchestrateTurn).toHaveBeenCalledTimes(1);
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

  it("one conversation per item: closing and reopening the panel returns to the same thread", async () => {
    const itemId = seedReviewItem(1);
    const props: Props = {
      sourceSurface: "review",
      sessionItemId: itemId,
      questionLabel: "Question 1 / 5",
      onClose: vi.fn(),
    };
    const first = renderPanel(props);
    await composerReady();
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "where do I start?" },
    });
    fireEvent.submit(
      screen.getByRole("form", { name: /send a message to lisa/i }),
    );
    await screen.findByText(TUTOR_TEXT);
    first.unmount();

    renderPanel(props);
    // The earlier exchange is there — the same conversation, not a new one.
    await screen.findByText(TUTOR_TEXT);
    expect(conversationsFor(itemId)).toHaveLength(1);
  });

  it("moving to the next item opens THAT item's conversation; the previous thread does not follow", async () => {
    const first = seedReviewItem(1);
    const second = seedReviewItem(2);
    const view = renderPanel({
      sourceSurface: "review",
      sessionItemId: first,
      questionLabel: "Question 1 / 5",
      onClose: vi.fn(),
    });
    await composerReady();
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "where do I start?" },
    });
    fireEvent.submit(
      screen.getByRole("form", { name: /send a message to lisa/i }),
    );
    await screen.findByText(TUTOR_TEXT);

    view.rerender({
      sourceSurface: "review",
      sessionItemId: second,
      questionLabel: "Question 2 / 5",
      onClose: vi.fn(),
    });

    await waitFor(() => expect(conversationsFor(second)).toHaveLength(1));
    expect(screen.getByTestId("tutor-question-chip").textContent).toBe(
      "Question 2 / 5",
    );
    await screen.findByText("Ask LISA about this question.");
    expect(screen.queryByText(TUTOR_TEXT)).toBeNull();
    expect(conversationsFor(first)[0]?.id).not.toBe(
      conversationsFor(second)[0]?.id,
    );
  });

  it("the close control closes the panel", async () => {
    const onClose = vi.fn();
    renderPanel({
      sourceSurface: "review",
      sessionItemId: seedReviewItem(1),
      questionLabel: "Question 1 / 5",
      onClose,
    });
    fireEvent.click(screen.getByRole("button", { name: "Close LISA" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
