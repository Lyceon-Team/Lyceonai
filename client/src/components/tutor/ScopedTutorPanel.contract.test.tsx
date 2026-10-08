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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
import { EntitlementService } from "../../../../server/services/entitlement-service";
import { runCrisisClassifier } from "../../../../server/services/tutor-crisis";
import { LISA_UPGRADE_PITCH } from "./LisaUpgradeCard";
import { UpgradeModalProvider } from "@/components/billing/UpgradeModal";
import { UPGRADE_MODAL_COPY } from "@/components/billing/upgrade-modal";

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

type Call = { method: string; path: string; status: number };
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
      calls.push({ method, path: url, status: res.status });
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
// The denial card is real (2026-10-05): LISA's headline and the approved body from the upgrade
// modal's copy table, and "Unlock LISA", which opens the app's one upgrade modal (also real).

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
  // The app root mounts the upgrade modal's provider (App.tsx). Its auto-open on a refusal is
  // off here, so a modal on screen can only have come from the card's own button.
  const wrap = (x: Props): React.ReactElement => (
    <QueryClientProvider client={qc}>
      <UpgradeModalProvider autoOpenOnDenial={false}>
        <ScopedTutorPanel {...x} />
      </UpgradeModalProvider>
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

// ── W4-11 — an unpaid student never holds a composer ─────────────────────
//
// The server checks entitlement before anything else on every tutor route,
// crisis detection included (Doc 03B §6.5, kept by owner ruling 2026-09-27).
// So the panel must not offer a composer the server will refuse unread: the
// server's refusal — on load, not on send — replaces opener and composer with
// the LISA upgrade card. The refusals below are the REAL router's.

function setEntitled(active: boolean): void {
  vi.mocked(EntitlementService.isEntitlementActiveForProfile).mockResolvedValue(
    active,
  );
}

function refusals(): Call[] {
  return calls.filter((c) => c.status === 403);
}

describe("W4-11 — upgrade card instead of a composer for an unpaid student", () => {
  beforeEach(() => {
    // Earlier tests' panels are still mounted; flipping entitlement would make
    // them refetch into this test's call log. Unmount them first.
    cleanup();
    calls.length = 0;
    setEntitled(true);
  });
  afterEach(() => setEntitled(true));

  it("unpaid, on load: the card replaces opener AND composer before anything is typed", async () => {
    setEntitled(false);
    const itemId = seedReviewItem(1);
    renderPanel(props(itemId));

    const card = await screen.findByTestId("lisa-upgrade");
    // Approved copy only (OQ-44; OQ-57 (f)): the headline and the prototype body the /chat locked
    // card shows. (The unapproved W4-11 draft body is deleted, OQ-61 (h).)
    const approved = UPGRADE_MODAL_COPY.tutor_access.plan;
    expect(within(card).getByRole("heading", { level: 2 }).textContent).toBe(
      approved.title,
    );
    expect(approved.title).toBe(LISA_UPGRADE_PITCH.title);
    expect(card.textContent).toContain(approved.body);
    expect(screen.queryByLabelText("Message")).toBeNull();
    expect(screen.queryByTestId("tutor-opener")).toBeNull();
    // It was the server's refusal of THIS item's on-load lookup that drew the
    // card, and nothing was created. (Nothing can be sent: there is no
    // composer. A `/messages` count here would be polluted by requests still
    // in flight from earlier tests, which carry no item to filter on.)
    expect(
      refusals().some(
        (c) =>
          c.method === "GET" &&
          c.path.includes(`source_session_item_id=${itemId}`),
      ),
    ).toBe(true);
    expect(conversationCreates()).toHaveLength(0);
  });

  it("unpaid: the card stays inside the panel — the question and Desmos beside it stay usable", async () => {
    setEntitled(false);
    const itemId = seedReviewItem(1);
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={qc}>
        <UpgradeModalProvider autoOpenOnDenial={false}>
          <div>
            <label>
              Answer
              <input aria-label="Answer" />
            </label>
            <div data-testid="desmos-host">
              <input aria-label="Desmos expression" />
            </div>
            <ScopedTutorPanel {...props(itemId)} />
          </div>
        </UpgradeModalProvider>
      </QueryClientProvider>,
    );
    await screen.findByTestId("lisa-upgrade");

    // Inside the panel, never page-covering: nothing modal is open until the student asks.
    const panel = screen.getByTestId("scoped-tutor-panel");
    expect(within(panel).getByTestId("lisa-upgrade")).toBeTruthy();
    expect(screen.queryByTestId("upgrade-modal")).toBeNull();

    for (const label of ["Answer", "Desmos expression"]) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      expect(input.disabled).toBe(false);
      fireEvent.change(input, { target: { value: "3x - 4 = 11" } });
      expect(input.value).toBe("3x - 4 = 11");
    }
  });

  it("entitlement lapses after load: the first send is refused and the card replaces the composer", async () => {
    const itemId = seedReviewItem(1);
    renderPanel(props(itemId));
    await ready();

    setEntitled(false);
    send("How do I start?");

    await screen.findByTestId("lisa-upgrade");
    expect(screen.queryByLabelText("Message")).toBeNull();
    // One message, not two: the generic "isn't available" line is not drawn
    // over an entitlement refusal.
    expect(screen.queryByText(/isn.t available right now/i)).toBeNull();
    expect(db.current.rows("tutor_conversations")).toHaveLength(0);
  });

  it("entitlement lapsed on a returning student's thread: the card, not a composer", async () => {
    const itemId = seedReviewItem(1);
    seedConversation(itemId, [
      { role: "student", message: "How do I start?" },
      { role: "tutor", message: TUTOR_TEXT },
    ]);
    setEntitled(false);
    renderPanel(props(itemId));

    await screen.findByTestId("lisa-upgrade");
    expect(screen.queryByLabelText("Message")).toBeNull();
  });

  it("a paying student never sees the card — on load, on first send, or in the thread", async () => {
    const itemId = seedReviewItem(1);
    renderPanel(props(itemId));
    await ready();
    expect(screen.queryByTestId("lisa-upgrade")).toBeNull();

    send("How do I start?");
    await screen.findByText(TUTOR_TEXT);
    expect(screen.queryByTestId("lisa-upgrade")).toBeNull();
    expect(screen.queryByTestId("lisa-upgrade-unlock")).toBeNull();
    expect(screen.getByLabelText("Message")).toBeTruthy();
    expect(refusals()).toHaveLength(0);
  });

  it("a transport failure is not a paywall: no card, the composer stays", async () => {
    const itemId = seedReviewItem(1);
    renderPanel(props(itemId));
    await ready();

    // A 5xx from the create call — not an entitlement refusal.
    const insert = vi.spyOn(db.current, "client").mockImplementation(() => {
      throw new Error("db down");
    });
    send("How do I start?");
    await screen.findByText(/isn.t available right now/i);
    insert.mockRestore();

    expect(screen.queryByTestId("lisa-upgrade")).toBeNull();
    expect(screen.getByLabelText("Message")).toBeTruthy();
  });
});

describe("W4-11 — accepted gap: the server refuses an unpaid student before crisis detection", () => {
  beforeEach(() => {
    cleanup();
    vi.mocked(runCrisisClassifier).mockClear();
  });
  afterEach(() => setEntitled(true));

  /**
   * Pinned, not endorsed by accident. Doc 03B §6.5 orders entitlement before
   * orchestration, where the crisis classifier runs; the owner kept that order
   * (2026-09-27) and closed the scenario on the client instead — an unpaid
   * student is never given a composer (tests above). If this test starts
   * failing because the classifier now runs for an unpaid student, the order
   * changed: update the closure plan's accepted-gap row with it.
   */
  it("every tutor route refuses an unpaid student, and a message is never classified", async () => {
    setEntitled(false);
    const conversationId = seedConversation(seedReviewItem(1), []);
    const app = makeApp();

    const list = await request(app).get("/api/tutor/conversations");
    const create = await request(app).post("/api/tutor/conversations").send({
      entry_mode: "general",
      source_surface: "dashboard",
      idempotency_key: crypto.randomUUID(),
    });
    const message = await request(app).post("/api/tutor/messages").send({
      conversation_id: conversationId,
      message: "a message the server must refuse unread",
      client_turn_id: crypto.randomUUID(),
    });

    for (const res of [list, create, message]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("entitlement_required");
      // SCL-185 (UI-01): every paid-feature denial names its Doc 01 feature key.
      expect(res.body.error.details).toEqual({ feature: "tutor_access" });
    }
    expect(vi.mocked(runCrisisClassifier)).not.toHaveBeenCalled();
    expect(orchestrateTurn).not.toHaveBeenCalled();
  });
});

/**
 * OQ-54 (a) / OQ-57 (f), owner ruling 2026-10-05: the review runner's LISA panel draws with the
 * student tokens only, so the review runner can follow the device theme (route-shells.ts). A
 * legacy utility here reads the app-wide light tokens and would leave text dark on dark.
 *
 * PRESENCE BEFORE ABSENCE: each state is proved on screen (and the frame proved to carry the
 * student tokens) before the "no legacy class, no raw colour, nothing below 14px" sweep runs.
 */
const LEGACY_OR_SMALL =
  /(^|\s)(text-xs|text-sm|text-base|text-(muted-|card-|primary-|secondary-)?foreground|text-primary|bg-(card|secondary|muted|background|primary|accent|popover)(\/\d+)?|border-(border|input|primary)(\/\d+)?|hover:bg-(secondary|muted|accent)|text-\[(\d|1[0-3])(\.\d+)?px\])(\s|$)/;
const RAW_COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

function panelTokenFindings(): {
  classes: string[];
  legacy: string[];
  rawColour: string[];
} {
  const panel = screen.getByTestId("scoped-tutor-panel");
  const nodes = [panel, ...Array.from(panel.querySelectorAll("*"))];
  const classes = nodes
    .map((el) => el.getAttribute("class") ?? "")
    .filter((c) => c.length > 0);
  const legacy = classes.filter((c) => LEGACY_OR_SMALL.test(c));
  const rawColour = nodes
    .flatMap((el) => [el.getAttribute("class"), el.getAttribute("style")])
    .filter((v): v is string => v !== null && RAW_COLOUR.test(v));
  return { classes, legacy, rawColour };
}

function expectOnStudentTokens(minClasses: number): void {
  const panel = screen.getByTestId("scoped-tutor-panel");
  expect(panel.className).toContain("bg-lyc-sheet");
  expect(panel.className).toContain("border-lyc-rule");
  const chip = screen.getByTestId("tutor-question-chip");
  expect(chip.className).toContain("bg-lyc-chip");
  const { classes, legacy, rawColour } = panelTokenFindings();
  expect(classes.length).toBeGreaterThan(minClasses);
  expect(legacy).toEqual([]);
  expect(rawColour).toEqual([]);
}

describe("OQ-54 (a) — the panel on the student tokens (ruling 2026-10-05)", () => {
  beforeEach(() => {
    cleanup();
    calls.length = 0;
    setEntitled(true);
  });
  afterEach(() => setEntitled(true));

  it("opener and composer: frame, header, chip, opener and composer are student tokens only", async () => {
    const itemId = seedReviewItem(1);
    renderPanel(props(itemId, "Question 1 of 10"));
    await ready();
    const opener = screen.getByTestId("tutor-opener");
    expect(opener.textContent).toContain(OPENER_TITLE);
    expect(opener.className).toContain("bg-lyc-paper");
    expect(screen.getByTestId("tutor-question-chip").textContent).toBe(
      "Question 1 of 10",
    );
    expect(screen.getByRole("button", { name: "Hide LISA" })).toBeTruthy();
    expectOnStudentTokens(15);
  });

  it("a thread: the message list and composer are student tokens only", async () => {
    const itemId = seedReviewItem(1);
    seedConversation(itemId, [
      { role: "student", message: "How do I start?" },
      { role: "tutor", message: TUTOR_TEXT },
    ]);
    renderPanel(props(itemId, "Question 1 of 10"));
    expect(await screen.findByText(TUTOR_TEXT)).toBeTruthy();
    expect(screen.getByText("How do I start?")).toBeTruthy();
    expect(screen.getByLabelText("Message")).toBeTruthy();
    expectOnStudentTokens(15);
  });

  it("the composer sits on the panel inset (16px sides at every width), not the /chat column's", async () => {
    const itemId = seedReviewItem(1);
    renderPanel(props(itemId));
    await ready();
    const form = screen.getByRole("form", { name: /send a message to lisa/i });
    const bar = form.parentElement;
    expect(bar).not.toBeNull();
    expect(bar!.className).toContain("px-4");
    expect(bar!.className).not.toContain("lg:px-10");
  });

  it("unpaid: the LISA card is student tokens only, approved copy only, and Unlock LISA opens the upgrade modal for tutor_access", async () => {
    setEntitled(false);
    const itemId = seedReviewItem(1);
    renderPanel(props(itemId));
    const card = await screen.findByTestId("lisa-upgrade");
    const approved = UPGRADE_MODAL_COPY.tutor_access.plan;
    expect(card.textContent).toContain(approved.title);
    expect(card.textContent).toContain(approved.body);
    // The card's words are exactly the approved title, body and button, nothing more.
    expect(card.textContent).toBe(
      `${approved.title}${approved.body}${LISA_UPGRADE_PITCH.actionLabel}`,
    );
    expectOnStudentTokens(5);
    expect(within(card).getByRole("heading", { level: 2 }).className).toContain(
      "font-lyc-serif",
    );

    expect(screen.queryByTestId("upgrade-modal")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Unlock LISA" }));
    const modal = await screen.findByTestId("upgrade-modal");
    expect(modal.textContent).toContain(approved.title);
    expect(modal.textContent).toContain(approved.body);
  });
});

// ── QA 2026-10-07: Send's pending state (item 5) and Show LISA on a phone (item 8) ──────────
//
// Item 5 (Karl): "LISA Send shows an immediate pressed/pending state (disabled, visible pending)
// from the first click, standalone and in the runner panel." In the panel a first message goes
// opener → create → a NEW thread composer, whose first render precedes the effect that sends
// the message; the old thread composer drew "Send", enabled, in between. A MutationObserver
// keeps every committed change to Send's `disabled` attribute, so a Send that was enabled at any
// moment between the click and LISA's reply is a record, not a missed frame.

/** Records each time a Send button went from enabled to disabled (it was enabled before). */
function watchSendReenabled(): { violations: () => number; stop: () => void } {
  let count = 0;
  const tally = (records: MutationRecord[]): void => {
    for (const r of records) {
      const el = r.target as Element;
      if (
        r.type === "attributes" &&
        r.attributeName === "disabled" &&
        r.oldValue === null &&
        el.getAttribute("aria-label") === "Send message"
      ) {
        count += 1;
      }
    }
  };
  const observer = new MutationObserver(tally);
  observer.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled"],
    attributeOldValue: true,
  });
  return {
    violations: () => {
      tally(observer.takeRecords());
      return count;
    },
    stop: () => observer.disconnect(),
  };
}

function sendButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Send message" });
}

describe("QA 2026-10-07 — Send is pending from the click (item 5), Show LISA reveals the panel (item 8)", () => {
  beforeEach(() => {
    cleanup();
    calls.length = 0;
    setEntitled(true);
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
  });

  it("item 5: from the click to LISA's reply, Send reads 'Sending…' and is never enabled — opener, create, the new thread, the turn", async () => {
    let reply: (v: unknown) => void = () => undefined;
    orchestrateTurn.mockImplementation(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    const itemId = seedReviewItem(1);
    renderPanel(props(itemId));
    await ready();
    // Presence first: before the click Send is the plain, enabled button.
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "where do I start?" },
    });
    expect(sendButton().textContent).toBe("Send");
    expect(sendButton().disabled).toBe(false);

    fireEvent.click(sendButton());
    // The render the click causes: pending, before any request has answered.
    expect(sendButton().textContent).toBe("Sending…");
    expect(sendButton().disabled).toBe(true);
    expect(sendButton().getAttribute("aria-busy")).toBe("true");
    expect(conversationCreates()).toHaveLength(0);
    // From here to the reply, a Send that turns disabled was enabled in between: a violation.
    const watch = watchSendReenabled();

    // The conversation is created, the thread mounts and sends the turn; LISA has not answered.
    await waitFor(() => expect(orchestrateTurn).toHaveBeenCalledTimes(1));
    expect(conversationCreates()).toHaveLength(1);
    expect(sendButton().textContent).toBe("Sending…");
    expect(sendButton().disabled).toBe(true);
    expect(watch.violations()).toBe(0);

    reply(workerReply());
    await screen.findByText(TUTOR_TEXT);
    watch.stop();
    expect(sendButton().textContent).toBe("Send");
  });

  it("item 5: a later turn in the thread is pending from the click too", async () => {
    const itemId = seedReviewItem(1);
    seedConversation(itemId, [
      { role: "student", message: "How do I start?" },
      { role: "tutor", message: "Isolate x." },
    ]);
    let reply: (v: unknown) => void = () => undefined;
    orchestrateTurn.mockImplementation(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    renderPanel(props(itemId));
    await screen.findByText("Isolate x.");
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "and then?" },
    });
    expect(sendButton().disabled).toBe(false);
    fireEvent.click(sendButton());
    expect(sendButton().textContent).toBe("Sending…");
    expect(sendButton().disabled).toBe(true);
    await waitFor(() => expect(orchestrateTurn).toHaveBeenCalledTimes(1));
    reply(workerReply());
    await screen.findByText(TUTOR_TEXT);
    expect(sendButton().textContent).toBe("Send");
  });

  it("item 8: told to reveal itself (Show LISA on a phone), the panel scrolls its own frame into view on mount", async () => {
    renderPanel({ ...props(seedReviewItem(1)), revealOnOpen: true });
    await ready();
    const panel = screen.getByTestId("scoped-tutor-panel");
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    const onPanel = scroll.mock.contexts.filter((el) => el === panel);
    expect(onPanel.length).toBeGreaterThan(0);
    expect(scroll.mock.calls[scroll.mock.contexts.indexOf(panel)]?.[0]).toEqual(
      { behavior: "auto", block: "start" },
    );
  });

  // Measured at 390 in the harness: the runner's question column grows a frame after LISA mounts,
  // so one scroll stopped short (the panel's header ended near the bottom of the screen).
  it("item 8: the reveal follows the runner's late layout, frame by frame, and a scroll by the student stops it", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    const flush = (): void => {
      const due = frames.splice(0);
      for (const cb of due) cb(0);
    };
    renderPanel({ ...props(seedReviewItem(1)), revealOnOpen: true });
    await ready();
    const panel = screen.getByTestId("scoped-tutor-panel");
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    const panelCalls = (): number =>
      scroll.mock.contexts.filter((el) => el === panel).length;
    const first = panelCalls();
    expect(first).toBeGreaterThan(0);
    flush();
    flush();
    // Later frames scroll again: the runner may still be growing above it.
    const chased = panelCalls();
    expect(chased).toBeGreaterThan(first);
    // The student scrolls: the panel stops chasing its place.
    window.dispatchEvent(new Event("wheel"));
    flush();
    flush();
    expect(panelCalls()).toBe(chased);
    vi.mocked(window.requestAnimationFrame).mockRestore();
  });

  // QA 2026-10-08 item D (Karl: "tapping the icon always brings it into view"): the runner bumps
  // `revealKey` when the icon is tapped on an open panel scrolled out of view; the panel reveals
  // itself again without remounting (the draft typed into it survives).
  it("QA2-D: a new revealKey reveals the open panel again, without remounting it", async () => {
    const base = { ...props(seedReviewItem(1)), revealOnOpen: true };
    const view = renderPanel({ ...base, revealKey: 0 });
    await ready();
    const panel = screen.getByTestId("scoped-tutor-panel");
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "kept draft" },
    });
    // The student scrolls away: the mount's reveal stops.
    window.dispatchEvent(new Event("wheel"));
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    const panelCalls = (): number =>
      scroll.mock.contexts.filter((el) => el === panel).length;
    const before = panelCalls();
    expect(before).toBeGreaterThan(0);
    view.rerender({ ...base, revealKey: 1 });
    expect(panelCalls()).toBeGreaterThan(before);
    expect(screen.getByTestId("scoped-tutor-panel")).toBe(panel);
    expect(
      (screen.getByLabelText("Message") as HTMLTextAreaElement).value,
    ).toBe("kept draft");
  });

  it("item 8: LISA simply there (every question, W4-4) does not scroll the runner to itself", async () => {
    renderPanel(props(seedReviewItem(1)));
    await ready();
    const panel = screen.getByTestId("scoped-tutor-panel");
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    expect(scroll.mock.contexts.filter((el) => el === panel)).toHaveLength(0);
  });
});
