// @vitest-environment jsdom
/**
 * The practice runner's calculator saves, through the real hook against a mocked API.
 *
 * @spec [Doc-02B_v4 §14, §28; register G-NEW-14; owner brief 2026-10-12 ("Calculator state
 *       saves: only when needed")] | @implemented [2026-10-12]
 *
 * plain English:
 *   - changes alone make no request; the state the server already holds (from `/next`, keys in
 *     another order) produces no request at any save moment;
 *   - a save moment after a real change posts once, and a second one with nothing new does not;
 *   - the page going hidden posts with `keepalive`;
 *   - leaving the question posts the change BEFORE `/next` is read;
 *   - `/next` serving back the state the calculator already shows does not replace it.
 */
import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCanonicalPractice } from "./useCanonicalPractice";

const SESSION_ID = "sess-calc";
const SERVER_STATE = {
  scientific: { expressions: ["1+1"], version: 1 },
  graphing: null,
};
const SAME_STATE_OTHER_KEY_ORDER = {
  graphing: null,
  scientific: { version: 1, expressions: ["1+1"] },
};

type Call = { url: string; method: string; keepalive: boolean; body: unknown };
let calls: Call[] = [];
let hook: ReturnType<typeof useCanonicalPractice> | null = null;
let calculatorStateSets = 0;

function Harness(): JSX.Element {
  const state = useCanonicalPractice("math", undefined, SESSION_ID);
  hook = state;
  const seen = React.useRef<unknown>(undefined);
  if (seen.current !== state.calculatorState) {
    seen.current = state.calculatorState;
    calculatorStateSets += 1;
  }
  return <div>{state.question?.stem ?? ""}</div>;
}

function asPath(input: RequestInfo | URL): string {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  return new URL(raw, "http://localhost").pathname;
}

beforeEach(() => {
  calls = [];
  hook = null;
  calculatorStateSets = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = asPath(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      keepalive: init?.keepalive === true,
      body: init?.body ? (JSON.parse(String(init.body)) as unknown) : null,
    });
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    if (url === "/api/csrf-token") return json({ csrfToken: "t" });
    if (url.endsWith("/next")) {
      return json({
        sessionId: SESSION_ID,
        sessionItemId: `item-${calls.length}`,
        state: "active",
        calculatorState: SERVER_STATE,
        question: {
          stem: "What is 1+1?",
          questionType: "multiple_choice",
          options: [{ id: "A", text: "2" }],
          correct_answer: null,
          explanation: null,
        },
      });
    }
    if (url.endsWith("/calculator-state"))
      return json({ sessionId: SESSION_ID });
    return json({});
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const saves = () => calls.filter((c) => c.url.endsWith("/calculator-state"));

async function mounted(): Promise<ReturnType<typeof useCanonicalPractice>> {
  render(<Harness />);
  await waitFor(() => expect(hook?.question).not.toBeNull());
  return hook!;
}

describe("practice calculator saves (G-NEW-14)", () => {
  it("an identical state produces no request at any save moment", async () => {
    const h = await mounted();
    act(() => h.noteCalculatorChange(SAME_STATE_OTHER_KEY_ORDER));
    await act(async () => {
      await h.commitCalculatorState();
      await h.commitCalculatorState({ keepalive: true });
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(saves()).toHaveLength(0);
  });

  it("changes make no request; a save moment posts once; a second posts nothing", async () => {
    const h = await mounted();
    act(() => {
      for (let i = 0; i < 60; i += 1) h.noteCalculatorChange({ n: i });
    });
    expect(saves()).toHaveLength(0);
    await act(async () => {
      await h.commitCalculatorState();
      await h.commitCalculatorState();
    });
    expect(saves()).toHaveLength(1);
    expect(saves()[0]?.body).toMatchObject({ calculator_state: { n: 59 } });
  });

  it("the page going hidden saves with keepalive", async () => {
    const h = await mounted();
    act(() => h.noteCalculatorChange({ n: 1 }));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0]?.keepalive).toBe(true);
  });

  it("leaving the question saves before /next is read", async () => {
    const h = await mounted();
    act(() => h.noteCalculatorChange({ n: 7 }));
    const mark = calls.length;
    await act(async () => {
      await h.nextQuestion();
    });
    const after = calls.slice(mark).map((c) => c.url);
    const saveAt = after.findIndex((u) => u.endsWith("/calculator-state"));
    const nextAt = after.findIndex((u) => u.endsWith("/next"));
    expect(saveAt).toBeGreaterThanOrEqual(0);
    expect(saveAt).toBeLessThan(nextAt);
  });

  it("/next serving back the state the calculator shows does not replace it", async () => {
    const h = await mounted();
    const setsAfterMount = calculatorStateSets;
    act(() => h.noteCalculatorChange(SAME_STATE_OTHER_KEY_ORDER));
    await act(async () => {
      await h.nextQuestion();
    });
    expect(saves()).toHaveLength(0);
    expect(calculatorStateSets).toBe(setsAfterMount);
  });
});
