// @vitest-environment jsdom
/**
 * E7b plants, driven through the real module page against an in-memory server.
 *
 * @spec [Doc-04A_V2.2 §10.2, §11.2, §15.1; SCL-133, SCL-145, SCL-146; Coding
 *        Standards §5.2]
 *       [E7b plants: elimination on a shuffled option survives reload; selection
 *        survives reload and matches what the server stored; no correct_answer or
 *        explanation in client state; review counts match the navigator's; a
 *        submitted module cannot be re-entered by URL; no heartbeat while hidden]
 * @implemented [2026-09-25]
 *
 * plain English: `exam-api` is replaced by a fake that behaves like the server —
 * it stores what it is sent and serves it back — so "reload" is a real unmount and
 * a fresh mount reading only what the fake stored. Options are served in a
 * shuffled order under opaque tokens; the canonical letters live only in the fake.
 */
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type {
  ExamQuestionPayload,
  ExamSessionResponse,
  ExamWorkspaceItem,
} from "@lyceon/shared/exam-runtime-schema";

const SID = "5e551011-0000-4000-8000-000000000001";
const FORM = "f0f00000-0000-4000-8000-000000000001";

type Fake = {
  rwState: "module1_active" | "module2_active";
  currentOrdinal: number | null;
  answers: Map<number, string | null>;
  workspace: Map<number, ExamWorkspaceItem>;
  answerBodies: unknown[];
  heartbeats: Array<number | null>;
  /** canonical letter behind each token — server-side only. */
  letters: Map<string, string>;
};

let fake: Fake;

function items(): ExamQuestionPayload[] {
  // Served (shuffled) order differs from canonical A-D; tokens are opaque.
  const served = [
    ["tok_c7", "C"],
    ["tok_a2", "A"],
    ["tok_d9", "D"],
    ["tok_b4", "B"],
  ] as const;
  return [0, 1, 2].map((ordinal) => ({
    question_id: `SATRW1Q${ordinal}`,
    ordinal,
    question_type: "multiple_choice" as const,
    stem: `Which choice best completes question ${ordinal + 1}?`,
    passage: `Passage for question ${ordinal + 1}. Kelp forests recover where predators return.`,
    options: served.map(([id], i) => ({ id: `${id}_${ordinal}`, text: `Option text ${i + 1} for ${ordinal + 1}` })),
    assets: null,
    current_answer: fake.answers.get(ordinal) ?? null,
    correct_answer: null,
    explanation: null,
  }));
}

function sectionState() {
  return { section: "RW" as const, state: fake.rwState, remaining_ms: 1_800_000 };
}

function session(): ExamSessionResponse {
  return {
    session_id: SID,
    test_form_id: FORM,
    state: "active",
    mode: "strict",
    active_section: "RW",
    grace_expires_at: "2026-09-26T00:00:00Z",
    attempt_number_for_form: 1,
    is_first_seen_form_attempt: true,
    break_remaining_ms: null,
    sections: [
      { section: "RW", state: fake.rwState, remaining_ms: 1_800_000, module2_path_locked: false, current_ordinal: fake.currentOrdinal },
      { section: "M", state: "not_started", remaining_ms: null, module2_path_locked: false, current_ordinal: null },
    ],
  };
}

vi.mock("../api/exam-api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../api/exam-api")>();
  return {
    ...real,
    fetchExamSession: vi.fn(async () => session()),
    fetchModuleItems: vi.fn(async () => ({ section_state: sectionState(), items: items() })),
    fetchModuleWorkspace: vi.fn(async () => ({ section_state: sectionState(), items: [...fake.workspace.values()] })),
    submitExamAnswer: vi.fn(async (body: { ordinal: number; answer: string | null; question_id: string }) => {
      fake.answerBodies.push(body);
      fake.answers.set(body.ordinal, body.answer);
      return {
        response_schema_version: "tests-answer-v1" as const,
        stored: { question_id: body.question_id, ordinal: body.ordinal, answer: body.answer, submitted_at: "2026-09-25T10:00:00Z" },
        section_state: sectionState(),
        idempotent_replay: false,
      };
    }),
    saveItemWorkspace: vi.fn(async (_s: string, _sec: string, _m: string, item: ExamWorkspaceItem) => {
      fake.workspace.set(item.ordinal, item);
      return { section_state: sectionState(), item };
    }),
    sendExamHeartbeat: vi.fn(async (_s: string, _sec: string, ordinal: number | null) => {
      fake.heartbeats.push(ordinal);
      if (ordinal !== null) fake.currentOrdinal = ordinal;
      return { section_state: sectionState() };
    }),
    submitExamModule: vi.fn(),
    startExamModule: vi.fn(),
  };
});

vi.mock("@/contexts/SupabaseAuthContext", () => ({
  useSupabaseAuth: () => ({ user: { display_name: "Test Student" } }),
}));

import ExamModulePage from "./ExamModulePage";

function mount(path: string) {
  const { hook, history } = memoryLocation({ path, record: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <Switch>
          <Route path="/tests/:sessionId/:section/:module" component={ExamModulePage} />
          <Route path="/tests/:sessionId">
            <p>session hub</p>
          </Route>
        </Switch>
      </Router>
    </QueryClientProvider>,
  );
  return { view, history, client };
}

async function reload(path: string) {
  cleanup();
  return mount(path);
}

const RW1 = `/tests/${SID}/RW/1`;

beforeEach(() => {
  fake = {
    rwState: "module1_active",
    currentOrdinal: null,
    answers: new Map(),
    workspace: new Map(),
    answerBodies: [],
    heartbeats: [],
    letters: new Map([["tok_c7", "C"], ["tok_a2", "A"], ["tok_d9", "D"], ["tok_b4", "B"]]),
  };
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function choiceButtons() {
  return screen.getAllByTestId("exam-choice").map((li) => within(li).getAllByRole("button")[0]!);
}

describe("E7b module page plants", () => {
  it("PLANT: elimination on a shuffled option crosses out that same option after reload", async () => {
    mount(RW1);
    await screen.findByTestId("exam-module");
    const crossOut = screen.getAllByRole("button", { name: "Cross out choice 3" })[0]!;
    fireEvent.click(crossOut);
    await waitFor(() => expect(fake.workspace.get(0)?.eliminated_option_ids).toEqual(["tok_d9_0"]));
    // The token went to the server, never a letter.
    expect(fake.workspace.get(0)?.eliminated_option_ids.some((t) => /^[A-D]$/.test(t))).toBe(false);

    await reload(RW1);
    await screen.findByTestId("exam-module");
    const third = screen.getAllByTestId("exam-choice")[2]!;
    expect(within(third).getAllByRole("button")[0]!.getAttribute("data-choice-token")).toBe("tok_d9_0");
    expect(within(third).getByRole("button", { name: "Cross out choice 3" }).getAttribute("aria-pressed")).toBe("true");
    for (const i of [0, 1, 3]) {
      const li = screen.getAllByTestId("exam-choice")[i]!;
      expect(within(li).getByRole("button", { name: `Cross out choice ${i + 1}` }).getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("PLANT: selection survives reload and matches what the server stored", async () => {
    mount(RW1);
    await screen.findByTestId("exam-module");
    fireEvent.click(choiceButtons()[1]!);
    await waitFor(() => expect(fake.answers.get(0)).toBe("tok_a2_0"));
    expect(fake.answerBodies).toHaveLength(1);
    expect(fake.answerBodies[0]).toMatchObject({ answer: "tok_a2_0", section: "RW", module: "1", ordinal: 0 });

    await reload(RW1);
    await screen.findByTestId("exam-module");
    const pressed = choiceButtons().filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    expect(pressed[0]!.getAttribute("data-choice-token")).toBe(fake.answers.get(0));
  });

  it("RESUME: a reload lands on the question last reported by the heartbeat", async () => {
    mount(RW1);
    await screen.findByTestId("exam-module");
    fireEvent.click(screen.getByTestId("exam-next"));
    fireEvent.click(screen.getByTestId("exam-next"));
    await waitFor(() => expect(fake.currentOrdinal).toBe(2));
    await reload(RW1);
    await screen.findByTestId("exam-module");
    expect(screen.getByTestId("exam-navigator-open").textContent).toContain("Question 3 of 3");
  });

  it("PLANT: no correct_answer or explanation in client state during a module", async () => {
    const { client } = mount(RW1);
    await screen.findByTestId("exam-module");
    const cached = client.getQueryCache().getAll().map((q) => q.state.data);
    const text = JSON.stringify(cached);
    expect(text).toContain("SATRW1Q0");
    // Keys are present by contract (Coding Standards §5.2) and always null.
    for (const m of text.matchAll(/"(correct_answer|explanation|correct_variants)":(.*?)[,}]/g)) {
      expect(m[1]).not.toBe("correct_variants");
      expect(m[2]).toBe("null");
    }
    expect(document.body.textContent ?? "").not.toMatch(/\b(correct|incorrect|explanation)\b/i);
  });

  it("PLANT: the review page's counts match the navigator's", async () => {
    mount(RW1);
    await screen.findByTestId("exam-module");
    fireEvent.click(choiceButtons()[0]!);
    fireEvent.click(screen.getByTestId("exam-mark-review"));
    fireEvent.click(screen.getByTestId("exam-next"));
    fireEvent.click(screen.getByTestId("exam-mark-review"));
    await waitFor(() => expect(fake.workspace.size).toBe(2));

    fireEvent.click(screen.getByTestId("exam-navigator-open"));
    const grid = await screen.findByTestId("exam-navigator-grid");
    const cells = within(grid).getAllByTestId("exam-question-cell");
    const nav = {
      answered: cells.filter((c) => c.getAttribute("data-answered") === "true").length,
      marked: cells.filter((c) => c.getAttribute("data-marked") === "true").length,
      total: cells.length,
    };
    fireEvent.click(screen.getByRole("button", { name: "Go to review page" }));
    const counts = await screen.findByTestId("exam-review-counts");
    const read = (label: string) => Number(within(counts).getByText(label).nextElementSibling?.textContent);
    expect(nav).toEqual({ answered: 1, marked: 2, total: 3 });
    expect(read("Answered")).toBe(nav.answered);
    expect(read("Unanswered")).toBe(nav.total - nav.answered);
    expect(read("Marked for review")).toBe(nav.marked);
  });

  it("PLANT: a submitted module can't be re-entered by URL", async () => {
    fake.rwState = "module2_active";
    const { history } = mount(RW1);
    await waitFor(() => expect(history.at(-1)).toBe(`/tests/${SID}/RW/2`));
  });

  it("the header names Module 2 as 'Module 2 of 2' and nothing more", async () => {
    fake.rwState = "module2_active";
    mount(`/tests/${SID}/RW/2`);
    await screen.findByTestId("exam-module");
    expect(screen.getByTestId("exam-module-label").textContent).toBe("Module 2 of 2");
    expect(document.body.textContent ?? "").not.toMatch(/harder|easier|2A|2B/);
  });

  it("MECHANISM: no heartbeat is sent while the tab is hidden", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      mount(RW1);
      await screen.findByTestId("exam-module");
      await act(async () => {
        vi.advanceTimersByTime(20_000);
      });
      expect(fake.heartbeats).toEqual([]);
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await waitFor(() => expect(fake.heartbeats.length).toBeGreaterThan(0));
    } finally {
      vi.useRealTimers();
    }
  });
});
