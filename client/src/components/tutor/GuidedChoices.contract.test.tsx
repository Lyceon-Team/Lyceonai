// @vitest-environment jsdom
/**
 * @spec [owner brief "LISA guided choices in review, Phase A" (Karl, 2026-10-27) build 5 and
 *        rulings 1–3 of 2026-10-27; SCL-252, SCL-253; DESIGN.md §5] | @implemented [2026-10-27]
 *
 * plain English: the review panel's guided choices, against the REAL tutor router (the REAL
 * tutor-client hooks call `apiRequest`, routed through supertest into the router over the
 * in-memory DB, as ScopedTutorPanel.contract.test.tsx runs it). Only the model call
 * (`orchestrateTurn`) and the crisis service are replaced.
 *  - The choices come from the server for the item: three on a math item, two on a Reading and
 *    Writing item (Phase B off); none on practice, which never asks.
 *  - A tap sends the choice's exact label with its intent, through the one send path: a video
 *    choice is answered by the server with the video card and no model call; "Walk me through
 *    it" is a model turn.
 *  - After the first message the choices sit behind "Other ways LISA can help"; a video choice
 *    that found no video opens them again.
 *  - A typed message carries no intent.
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
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTutorDb } from "../../../../tests/helpers/fake-tutor-db";

Element.prototype.scrollIntoView = vi.fn();

// ── Server side: the route is real ─────────────────────────────────────────

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

const STUDENT_ID = "78787878-7878-4787-8787-787878787878";

import tutorRuntimeRouter from "../../../../server/routes/tutor-runtime";
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

type Call = { method: string; path: string; status: number; body: unknown };
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
      calls.push({
        method,
        path: url,
        status: res.status,
        body: options?.body ? (JSON.parse(options.body) as unknown) : null,
      });
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
import { ScopedTutorPanel } from "./ScopedTutorPanel";

// ── Fixtures ────────────────────────────────────────────────────────────

const MATH_QUESTION = "SATM1GC0001";
const RW_QUESTION = "SATRW1GC0001";
const TUTOR_TEXT = "What would you do first to get x by itself?";
const DESMOS_VIDEO = {
  video_id: "DesmosLes10",
  title: "Desmos Lesson #10",
  channel_name: "Desmos Prep",
  duration_seconds: 1200,
  start_seconds: 30,
  methods: ["desmos"],
  format: "lesson",
};

function seedQuestions(): void {
  db.current.seed("questions", {
    id: MATH_QUESTION,
    section: "M",
    skill_codes: ["H.C.1"],
    correct_answer: "B",
  });
  db.current.seed("questions", {
    id: RW_QUESTION,
    section: "RW",
    skill_codes: ["CAS.TRN"],
    correct_answer: "C",
  });
}

function seedReviewItem(questionId: string): string {
  const session = db.current.seed("review_sessions", {
    student_id: STUDENT_ID,
  });
  return db.current.seed("review_session_items", {
    session_id: session.id,
    student_id: STUDENT_ID,
    question_id: questionId,
    status: "served",
    ordinal: 1,
    question_stem: "If 3x - 4 = 11, what is x?",
    question_passage: null,
    question_options: [
      { key: "A", text: "3" },
      { key: "B", text: "5" },
    ],
    question_item_type: "mcq",
    question_explanation: "isolate x first.",
    question_correct_answer: "B",
    selected_answer: null,
  }).id as string;
}

function library(videos: Array<typeof DESMOS_VIDEO>): void {
  db.current.onRpc("video_resources_for_skills", () => ({
    data: videos,
    error: null,
  }));
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

function renderPanel(
  itemId: string,
  sourceSurface: "review" | "practice" = "review",
): void {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={qc}>
      <UpgradeModalProvider autoOpenOnDenial={false}>
        <ScopedTutorPanel
          sourceSurface={sourceSurface}
          sessionItemId={itemId}
          questionLabel="Question 1 / 5"
          onHide={vi.fn()}
        />
      </UpgradeModalProvider>
    </QueryClientProvider>,
  );
}

function messagePosts(): Array<Record<string, unknown>> {
  return calls
    .filter((c) => c.method === "POST" && c.path === "/api/tutor/messages")
    .map((c) => c.body as Record<string, unknown>);
}

function choiceNames(): string[] {
  return screen
    .getAllByRole("button")
    .filter((b) => b.dataset.testid?.startsWith("tutor-choice-"))
    .map((b) => b.textContent ?? "");
}

beforeEach(() => {
  db.current = new FakeTutorDb();
  calls.length = 0;
  orchestrateTurn.mockReset();
  orchestrateTurn.mockResolvedValue(workerReply());
  seedQuestions();
  library([DESMOS_VIDEO]);
});
afterEach(() => {
  cleanup();
});

describe("the choices come from the server, per item", () => {
  it("a math item: Walk me through it, Desmos video, Explanation video (Phase B hidden)", async () => {
    renderPanel(seedReviewItem(MATH_QUESTION));
    await screen.findByTestId("tutor-guided-choices");
    expect(choiceNames()).toEqual([
      "Walk me through it",
      "Desmos video",
      "Explanation video",
    ]);
    expect(screen.queryByText("Show me on Desmos")).toBeNull();
  });

  it("a Reading and Writing item: Walk me through it, Explanation video", async () => {
    renderPanel(seedReviewItem(RW_QUESTION));
    await screen.findByTestId("tutor-guided-choices");
    expect(choiceNames()).toEqual(["Walk me through it", "Explanation video"]);
    expect(screen.queryByText("Explain the rule")).toBeNull();
    expect(screen.queryByText("Desmos video")).toBeNull();
  });

  it("practice never asks and shows none", async () => {
    renderPanel(seedReviewItem(MATH_QUESTION), "practice");
    await screen.findByLabelText("Message");
    // Presence: the opener is drawn.
    expect(screen.getByTestId("tutor-opener")).toBeTruthy();
    expect(screen.queryByTestId("tutor-guided-choices")).toBeNull();
    expect(
      calls.some((c) => c.path.startsWith("/api/tutor/guided-choices")),
    ).toBe(false);
  });
});

describe("a tap sends the exact label with its intent", () => {
  it("'Desmos video': the server answers with the video card, no model call", async () => {
    renderPanel(seedReviewItem(MATH_QUESTION));
    fireEvent.click(await screen.findByTestId("tutor-choice-video_desmos"));
    await screen.findByTestId("tutor-video-card");
    expect(screen.getByTestId("tutor-video-title").textContent).toContain(
      "Desmos Lesson #10",
    );
    expect(messagePosts()).toHaveLength(1);
    expect(messagePosts()[0]).toMatchObject({
      message: "Desmos video",
      intent: "video_desmos",
    });
    expect(orchestrateTurn).not.toHaveBeenCalled();
  });

  it("'Walk me through it' is a model turn; then 'Other ways' reopens the choices and sends the next one", async () => {
    renderPanel(seedReviewItem(MATH_QUESTION));
    fireEvent.click(await screen.findByTestId("tutor-choice-walkthrough"));
    await screen.findByText(TUTOR_TEXT);
    expect(orchestrateTurn).toHaveBeenCalledTimes(1);
    expect(messagePosts()[0]).toMatchObject({
      message: "Walk me through it",
      intent: "walkthrough",
    });
    // Folded after the first message.
    const otherWays = await screen.findByTestId("tutor-other-ways");
    expect(otherWays.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("tutor-guided-choices")).toBeNull();
    fireEvent.click(otherWays);
    fireEvent.click(
      await screen.findByTestId("tutor-choice-video_explanation"),
    );
    await waitFor(() => expect(messagePosts()).toHaveLength(2));
    expect(messagePosts()[1]).toMatchObject({
      message: "Explanation video",
      intent: "video_explanation",
    });
  });

  it("a video choice with no video: the fixed sentence, and the choices open again", async () => {
    library([]);
    renderPanel(seedReviewItem(MATH_QUESTION));
    fireEvent.click(await screen.findByTestId("tutor-choice-video_desmos"));
    await screen.findByText(/I don't have a video for this skill yet/);
    await waitFor(() =>
      expect(
        screen.getByTestId("tutor-other-ways").getAttribute("aria-expanded"),
      ).toBe("true"),
    );
    expect(choiceNames()).toEqual([
      "Walk me through it",
      "Desmos video",
      "Explanation video",
    ]);
    expect(screen.queryByTestId("tutor-video-card")).toBeNull();
  });

  it("a typed message carries no intent", async () => {
    renderPanel(seedReviewItem(MATH_QUESTION));
    await screen.findByTestId("tutor-guided-choices");
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Desmos video" },
    });
    fireEvent.submit(
      screen.getByRole("form", { name: /send a message to lisa/i }),
    );
    await screen.findByText(TUTOR_TEXT);
    expect(messagePosts()).toHaveLength(1);
    expect(messagePosts()[0]).not.toHaveProperty("intent");
    expect(orchestrateTurn).toHaveBeenCalledTimes(1);
  });
});
