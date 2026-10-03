// @vitest-environment jsdom
/**
 * UI-53 — the practice and review runners on the Focus shell, driven end to end through the
 * REAL page, the REAL hook (useCanonicalPractice) and the REAL route→shell table, over a
 * scripted network.
 *
 * @spec [DESIGN.md §4 Question runner; design/prototype/Runner.dc.html; student-UI register
 *        UI-53, §2 Keyboard, §9 OQ-22, OQ-35, §8 F-53, F-64; wiring table §1, §5; Coding
 *        Standards §5.2 (no reveal before submit)] | @implemented [2026-10-03]
 *
 * Fixtures come from the real producers: each served question is built by the shared
 * `projectStudentSafeQuestion` (fed a canonical row that DOES carry the correct answer and the
 * explanation, which the producer nulls) and `buildStudentSafeOptionTokens` (the per-session
 * `opt_…` tokens, in a stored order where the canonical correct option "A" is shown SECOND),
 * then parsed by the shared engine response schemas. The answer and skip bodies are parsed by
 * the same schemas the A14 parity test holds both engines to.
 *
 * Anti-leak is asserted presence first: the post-submit screen is shown to carry the
 * explanation and the "Correct answer" tag, and only then is the pre-submit screen shown not to.
 */
import React from "react";
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
import {
  buildStudentSafeOptionTokens,
  projectStudentSafeQuestion,
  type CanonicalMcOption,
} from "@shared/question-bank-contract";
import {
  engineAnswerResponseSchema,
  engineNextItemResponseSchema,
  engineSkipResponseSchema,
} from "@lyceon/shared/practice-response-schema";
import { StudentRouteFrame } from "@/components/layout/StudentRouteFrame";
import {
  PRACTICE_ENGINE_CONFIG,
  REVIEW_ENGINE_CONFIG,
  type EngineConfig,
} from "@/lib/engine-config";
import CanonicalPracticePage, {
  SHORTER_SESSION_NOTE,
} from "./CanonicalPracticePage";
import { MISS_NOTE } from "@/components/question-renderer";

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({ user: { id: "u-1", role: "student" } }),
}));
vi.mock("@/components/math/DesmosCalculator", () => ({
  default: () => <div data-testid="desmos-mock" />,
}));
vi.mock("@/components/MathRenderer", () => ({
  default: ({ content }: { content: string }) => <span>{content}</span>,
  MathRenderer: ({ content }: { content: string }) => <span>{content}</span>,
}));

const tutorProps = vi.hoisted(() => ({
  last: null as Record<string, unknown> | null,
}));
vi.mock("@/components/tutor/ScopedTutorPanel", () => ({
  ScopedTutorPanel: (props: Record<string, unknown>) => {
    tutorProps.last = props;
    return <div data-testid="scoped-tutor-panel-mock" />;
  },
}));

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const EXPLANATION = "Subtract 3 from both sides, then divide by 2, so x = 4.";
/** Canonical options; "A" is correct. Shown in the stored order C, A, D, B. */
const CANONICAL: CanonicalMcOption[] = [
  { key: "A", text: "x = 4" },
  { key: "B", text: "x = 6" },
  { key: "C", text: "x = 8" },
  { key: "D", text: "x = 12" },
];
const STORED_ORDER = ["C", "A", "D", "B"] as const;
const CORRECT_TEXT = "x = 4"; // canonical A, shown second → display letter B
const FIRST_TEXT = "x = 8"; // canonical C, shown first → display letter A

type ServedItem = {
  id: string;
  tokens: Record<string, string>; // token → canonical key
  body: unknown;
};

function servedItem(ordinal: number, total: number, leak = false): ServedItem {
  const id = `item-${ordinal}`;
  const projected = projectStudentSafeQuestion({
    id: `SATM1Q0000${ordinal}`,
    section_code: "M",
    item_type: "mcq",
    stem: `Question ${ordinal}: if 2x + 3 = 11, what is x?`,
    options: CANONICAL,
    correct_answer: "A",
    explanation: EXPLANATION,
  });
  const { optionTokenMap, safeOptions } = buildStudentSafeOptionTokens(
    CANONICAL,
    [...STORED_ORDER],
  );
  const body = engineNextItemResponseSchema.parse({
    sessionId: SESSION_ID,
    sessionItemId: id,
    ordinal,
    state: "active",
    calculatorState: null,
    question: {
      sessionItemId: id,
      section: projected.section_code ?? "M",
      stem: projected.stem,
      passage: projected.passage,
      assets: null,
      questionType: projected.question_type,
      itemType: projected.item_type,
      inputMode: projected.inputMode,
      options: safeOptions,
      difficulty: null,
      correct_answer: projected.correct_answer,
      explanation: projected.explanation,
    },
    stats: { correct: 0, incorrect: 0, skipped: 0, total: 0, streak: 0 },
    totalQuestions: total,
  });
  if (leak) {
    // A server that HAS leaked (the schema above refuses this shape, so it is added after).
    const q = (body as { question: Record<string, unknown> }).question;
    q.correct_answer = Object.keys(optionTokenMap).find(
      (t) => optionTokenMap[t] === "A",
    );
    q.explanation = EXPLANATION;
  }
  return { id, tokens: optionTokenMap, body };
}

type Net = {
  calls: string[];
  nextCount: () => number;
  answerBodies: Array<Record<string, unknown>>;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function pathOf(input: RequestInfo | URL): string {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  const u = new URL(raw, "http://localhost");
  return u.pathname;
}

/** A session of `total` items. Item 1 is served first; an answer or skip resolves the current one. */
function installNetwork(opts: { total: number; leak?: boolean }): Net {
  const items = Array.from({ length: opts.total }, (_, i) =>
    servedItem(i + 1, opts.total, opts.leak === true),
  );
  let current = 0;
  let resolved = false;
  const calls: string[] = [];
  const answerBodies: Array<Record<string, unknown>> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const path = pathOf(input);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${path}`);
    if (path === "/api/csrf-token") return jsonResponse({ csrfToken: "t" });
    if (/\/sessions\/[^/]+\/resume$/.test(path)) {
      return jsonResponse({
        sessionId: SESSION_ID,
        sessionItemId: items[current]?.id ?? null,
      });
    }
    if (/\/sessions\/[^/]+\/next$/.test(path)) {
      if (resolved) {
        current += 1;
        resolved = false;
      }
      const item = items[current];
      if (!item) {
        return jsonResponse(
          { error: "session_closed", message: "Practice session is read-only" },
          409,
        );
      }
      return jsonResponse(item.body);
    }
    if (/\/api\/(practice|review)\/answer$/.test(path)) {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<
        string,
        unknown
      >;
      answerBodies.push(body);
      const item = items[current]!;
      const picked = item.tokens[String(body.selectedOptionId)];
      const correctToken = Object.keys(item.tokens).find(
        (t) => item.tokens[t] === "A",
      )!;
      resolved = true;
      const last = current === items.length - 1;
      return jsonResponse(
        engineAnswerResponseSchema.parse({
          sessionId: SESSION_ID,
          sessionItemId: item.id,
          isCorrect: picked === "A",
          mode: "multiple_choice",
          correctOptionId: correctToken,
          explanation: EXPLANATION,
          feedback: picked === "A" ? "Correct" : "Incorrect",
          stats: { correct: 0, incorrect: 0, skipped: 0, total: 1, streak: 0 },
          state: last ? "completed" : "active",
        }),
      );
    }
    if (/\/sessions\/[^/]+\/skip$/.test(path)) {
      const item = items[current]!;
      resolved = true;
      const last = current === items.length - 1;
      return jsonResponse(
        engineSkipResponseSchema.parse({
          sessionId: SESSION_ID,
          sessionItemId: item.id,
          skipped: true,
          mode: "multiple_choice",
          feedback: "Skipped",
          stats: { correct: 0, incorrect: 0, skipped: 1, total: 1, streak: 0 },
          state: last ? "completed" : "active",
        }),
      );
    }
    return jsonResponse({ error: `unexpected ${method} ${path}` }, 500);
  });
  return {
    calls,
    nextCount: () => calls.filter((c) => /\/next$/.test(c)).length,
    answerBodies,
  };
}

function mountRunner(
  opts: {
    engine?: EngineConfig;
    shortened?: boolean;
    strict?: boolean;
  } = {},
) {
  const engine = opts.engine ?? PRACTICE_ENGINE_CONFIG;
  const route =
    engine.domain === "review"
      ? ("/review/session/:sessionId" as const)
      : ("/practice/session/:sessionId" as const);
  const page = (
    <StudentRouteFrame route={route}>
      <CanonicalPracticePage
        title={engine.domain === "review" ? "Review session" : "Algebra"}
        section="M"
        sessionId={SESSION_ID}
        engine={engine}
        shortened={opts.shortened}
        completionHref={engine.completionHref}
      />
    </StudentRouteFrame>
  );
  return render(
    opts.strict ? <React.StrictMode>{page}</React.StrictMode> : page,
  );
}

async function loaded(ordinal = 1): Promise<void> {
  await waitFor(() =>
    expect(
      screen.getByText(`Question ${ordinal}: if 2x + 3 = 11, what is x?`),
    ).toBeTruthy(),
  );
}

function choice(text: string): HTMLElement {
  return screen.getByRole("radio", {
    name: new RegExp(text.replace(/[=]/g, "\\=")),
  });
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(el);
  });
}

const submitButton = (): HTMLButtonElement =>
  screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement;

beforeEach(() => {
  tutorProps.last = null;
  window.history.replaceState(null, "", `/practice/session/${SESSION_ID}`);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("UI-53 runner: letters, anti-leak, submit and feedback", () => {
  it("letters choices A–D by on-screen position: the stored correct option (canonical A), shown second, is B", async () => {
    installNetwork({ total: 3 });
    mountRunner();
    await loaded();
    const choices = screen.getAllByTestId("runner-choice");
    const letters = choices.map(
      (c) => within(c).getByTestId("runner-choice-letter").textContent ?? "",
    );
    expect(letters).toEqual(["A", "B", "C", "D"]);
    expect(choices[0]!.textContent).toContain(FIRST_TEXT);
    expect(choices[1]!.textContent).toContain(CORRECT_TEXT);
    // The canonical letter of the correct option ("A") is NOT on it.
    expect(
      within(choices[1]!).getByTestId("runner-choice-letter").textContent,
    ).toBe("B");
  });

  it("anti-leak: post-submit shows the explanation and the correct answer; pre-submit shows neither and marks no choice", async () => {
    // Presence first: the post-submit screen carries both.
    installNetwork({ total: 3 });
    const first = mountRunner();
    await loaded();
    await click(choice(FIRST_TEXT));
    await click(submitButton());
    await waitFor(() =>
      expect(screen.getByTestId("runner-feedback")).toBeTruthy(),
    );
    expect(document.body.textContent).toContain(EXPLANATION);
    expect(
      within(choice(CORRECT_TEXT)).getByText("Correct answer"),
    ).toBeTruthy();
    first.unmount();
    vi.restoreAllMocks();

    // Then absence, on a fresh pre-submit screen.
    installNetwork({ total: 3 });
    mountRunner();
    await loaded();
    const html = document.body.innerHTML;
    expect(html).not.toContain(EXPLANATION);
    for (const word of ["Correct answer", "Your answer", "Not quite"]) {
      expect(document.body.textContent).not.toContain(word);
    }
    expect(screen.queryByTestId("runner-feedback")).toBeNull();
    // No mapping marks the correct choice: before a pick, every choice is drawn alike.
    const classes = screen
      .getAllByTestId("runner-choice")
      .map((c) => c.className);
    expect(new Set(classes).size).toBe(1);
  });

  it("anti-leak: even a LEAKING /next payload (answer and explanation filled) shows nothing before submit", async () => {
    installNetwork({ total: 3, leak: true });
    mountRunner();
    await loaded();
    expect(document.body.innerHTML).not.toContain(EXPLANATION);
    expect(document.body.textContent).not.toContain("Correct answer");
    const classes = screen
      .getAllByTestId("runner-choice")
      .map((c) => c.className);
    expect(new Set(classes).size).toBe(1);
  });

  it("Submit is disabled until a choice is made", async () => {
    installNetwork({ total: 3 });
    mountRunner();
    await loaded();
    expect(submitButton().disabled).toBe(true);
    await click(choice(CORRECT_TEXT));
    expect(submitButton().disabled).toBe(false);
    expect(choice(CORRECT_TEXT).getAttribute("aria-checked")).toBe("true");
  });

  it("a miss: 'Not quite', 'Your answer' on the pick, 'Correct answer' on the right choice, the explanation, the review-queue note", async () => {
    const net = installNetwork({ total: 3 });
    mountRunner();
    await loaded();
    await click(choice(FIRST_TEXT));
    await click(submitButton());
    const panel = await screen.findByTestId("runner-feedback");
    expect(within(panel).getByText("Not quite")).toBeTruthy();
    expect(within(panel).getByText(EXPLANATION)).toBeTruthy();
    expect(within(panel).getByText(MISS_NOTE)).toBeTruthy();
    expect(within(choice(FIRST_TEXT)).getByText("Your answer")).toBeTruthy();
    expect(
      within(choice(CORRECT_TEXT)).getByText("Correct answer"),
    ).toBeTruthy();
    // The answer sent is the opaque token of the choice on screen, nothing else.
    expect(Object.keys(net.answerBodies[0]!).sort()).toEqual([
      "clientAttemptId",
      "selectedOptionId",
      "sessionId",
      "sessionItemId",
    ]);
    expect(String(net.answerBodies[0]!.selectedOptionId)).toMatch(/^opt_/);
    // Then Next question.
    expect(screen.getByRole("button", { name: "Next question" })).toBeTruthy();
  });

  it("a right answer: 'Correct', the explanation, no review-queue note", async () => {
    installNetwork({ total: 3 });
    mountRunner();
    await loaded();
    await click(choice(CORRECT_TEXT));
    await click(submitButton());
    const panel = await screen.findByTestId("runner-feedback");
    expect(within(panel).getByText("Correct")).toBeTruthy();
    expect(within(panel).getByText(EXPLANATION)).toBeTruthy();
    expect(within(panel).queryByText(MISS_NOTE)).toBeNull();
    expect(
      within(choice(CORRECT_TEXT)).getByText("Correct answer"),
    ).toBeTruthy();
  });

  it("review: a miss shows no review-queue note (the item is already in the queue)", async () => {
    installNetwork({ total: 3 });
    mountRunner({ engine: REVIEW_ENGINE_CONFIG });
    await loaded();
    await click(choice(FIRST_TEXT));
    await click(submitButton());
    const panel = await screen.findByTestId("runner-feedback");
    expect(within(panel).getByText("Not quite")).toBeTruthy();
    expect(within(panel).queryByText(MISS_NOTE)).toBeNull();
  });
});

describe("UI-53 runner: bar, steps, keys", () => {
  it("'Question N of M' and the progress strip; Next lands on 'Question 2 of 3'", async () => {
    installNetwork({ total: 3 });
    mountRunner();
    await loaded();
    expect(screen.getByTestId("runner-position").textContent).toBe(
      "Question 1 of 3",
    );
    const segments = () =>
      Array.from(
        screen
          .getByTestId("runner-progress")
          .querySelectorAll("[data-segment]"),
      ).map((s) => s.getAttribute("data-segment"));
    expect(segments()).toEqual(["current", "todo", "todo"]);
    expect(screen.getByTestId("runner-session-name").textContent).toBe(
      "Algebra",
    );

    await click(choice(CORRECT_TEXT));
    await click(submitButton());
    await click(await screen.findByRole("button", { name: "Next question" }));
    await loaded(2);
    expect(screen.getByTestId("runner-position").textContent).toBe(
      "Question 2 of 3",
    );
    expect(segments()).toEqual(["done", "current", "todo"]);
  });

  it("Skip resolves the item and serves the next one, with no feedback panel", async () => {
    const net = installNetwork({ total: 3 });
    mountRunner();
    await loaded();
    await click(screen.getByRole("button", { name: "Skip" }));
    await loaded(2);
    expect(net.calls.some((c) => /POST .*\/skip$/.test(c))).toBe(true);
    expect(screen.queryByTestId("runner-feedback")).toBeNull();
    expect(screen.getByTestId("runner-position").textContent).toBe(
      "Question 2 of 3",
    );
  });

  it("F-53: skipping the last question finishes the session (back to Practice), never 'Unable to load session'", async () => {
    installNetwork({ total: 1 });
    mountRunner();
    await loaded();
    await click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(window.location.pathname).toBe("/practice"));
    expect(document.body.textContent).not.toContain("Unable to load session");
  });

  it("the last answer's feedback stays on screen; Done then finishes the session", async () => {
    installNetwork({ total: 1 });
    mountRunner();
    await loaded();
    await click(choice(CORRECT_TEXT));
    await click(submitButton());
    // The answer response says the session is completed; the feedback must still be read.
    await screen.findByTestId("runner-feedback");
    expect(window.location.pathname).toBe(`/practice/session/${SESSION_ID}`);
    await click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(window.location.pathname).toBe("/practice"));
  });

  it("keys through the shared hook: ↓ chooses, Enter submits, → goes next", async () => {
    const net = installNetwork({ total: 3 });
    mountRunner();
    await loaded();
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(choice(FIRST_TEXT).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(choice(CORRECT_TEXT).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(choice(FIRST_TEXT).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    await act(async () => {
      fireEvent.keyDown(window, { key: "Enter" });
    });
    await screen.findByTestId("runner-feedback");
    expect(net.answerBodies).toHaveLength(1);
    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowRight" });
    });
    await loaded(2);
  });

  it("back goes to the section home: Practice → /practice, Review → /review (route-shells)", async () => {
    installNetwork({ total: 3 });
    const practice = mountRunner();
    await loaded();
    const back = screen.getByTestId("focus-back");
    expect(back.getAttribute("href")).toBe("/practice");
    expect(back.textContent).toBe("Practice");
    practice.unmount();

    vi.restoreAllMocks();
    installNetwork({ total: 3 });
    mountRunner({ engine: REVIEW_ENGINE_CONFIG });
    await loaded();
    expect(screen.getByTestId("focus-back").getAttribute("href")).toBe(
      "/review",
    );
  });

  it("no old chrome: no eyebrow, no answered/streak chips, no guidance card, no End Session, no keystroke hints", async () => {
    installNetwork({ total: 3 });
    mountRunner();
    await loaded();
    const body = document.body.textContent ?? "";
    for (const gone of [
      "Academic Practice Runner",
      "Review Runner",
      "answered",
      "Session Guidance",
      "End Session",
      "Check Answer",
      "runtime session truth",
      "canonical practice endpoints",
    ]) {
      expect(body, gone).not.toContain(gone);
    }
    expect(body).not.toMatch(/press enter|arrow keys|shortcut/i);
  });
});

describe("UI-53 runner: OQ-35, F-64, LISA", () => {
  it("OQ-35: a shortened session says so on its first question, with no number", async () => {
    installNetwork({ total: 3 });
    mountRunner({ shortened: true });
    await loaded();
    const note = screen.getByTestId("runner-shorter-note");
    expect(note.textContent).toContain(SHORTER_SESSION_NOTE);
    expect(SHORTER_SESSION_NOTE).toBe(
      "Fewer questions match these filters, so this session is shorter.",
    );
    expect(note.textContent).not.toMatch(/\d/);
  });

  it("OQ-35: a full-length session shows no such note", async () => {
    installNetwork({ total: 3 });
    mountRunner({ shortened: false });
    await loaded();
    expect(screen.queryByTestId("runner-shorter-note")).toBeNull();
    expect(document.body.textContent).not.toContain(SHORTER_SESSION_NOTE);
  });

  it("F-64: under React StrictMode (double mount effects) the runner asks /next once for the first step", async () => {
    const net = installNetwork({ total: 3 });
    mountRunner({ strict: true });
    await loaded();
    expect(net.nextCount()).toBe(1);
  });

  it("LISA (review) gets the served item id and 'Question N of M' — no choices, no letters, no correctness", async () => {
    installNetwork({ total: 3 });
    mountRunner({ engine: REVIEW_ENGINE_CONFIG });
    await loaded();
    expect(tutorProps.last).not.toBeNull();
    const props = tutorProps.last!;
    expect(Object.keys(props).sort()).toEqual([
      "onHide",
      "questionLabel",
      "sessionItemId",
      "sourceSurface",
    ]);
    expect(props.sourceSurface).toBe("review");
    expect(props.sessionItemId).toBe("item-1");
    expect(props.questionLabel).toBe("Question 1 of 3");
    const serialised = JSON.stringify(props);
    for (const leak of [CORRECT_TEXT, FIRST_TEXT, "opt_", EXPLANATION]) {
      expect(serialised).not.toContain(leak);
    }
  });
});
