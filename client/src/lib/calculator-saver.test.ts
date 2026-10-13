/**
 * The calculator saver: changes are local, saves happen at save moments, an identical state
 * never posts.
 *
 * @spec [register G-NEW-14; owner brief 2026-10-12 ("Calculator state saves: only when needed")]
 * @implemented [2026-10-12]
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CALCULATOR_IDLE_SAVE_MS,
  createCalculatorSaver,
  type CalculatorSendOptions,
} from "./calculator-saver";

type Sent = { state: unknown; opts: CalculatorSendOptions };

function setup(overrides?: { fail?: () => boolean; canSend?: () => boolean }) {
  const sent: Sent[] = [];
  const results: boolean[] = [];
  const saver = createCalculatorSaver({
    send: async (state, opts) => {
      if (overrides?.fail?.()) throw new Error("save failed (500)");
      sent.push({ state, opts });
    },
    ...(overrides?.canSend ? { canSend: overrides.canSend } : {}),
    onResult: (ok) => results.push(ok),
  });
  return { saver, sent, results };
}

const S1 = { graphing: null, scientific: { version: 1, expressions: ["1+1"] } };
const S1_REORDERED = {
  scientific: { expressions: ["1+1"], version: 1 },
  graphing: null,
};
const S2 = { graphing: null, scientific: { version: 1, expressions: ["2+2"] } };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("calculator saver", () => {
  it("a change alone makes no request", async () => {
    const { saver, sent } = setup();
    for (let i = 0; i < 60; i += 1) saver.change({ n: i });
    await vi.advanceTimersByTimeAsync(CALCULATOR_IDLE_SAVE_MS - 1);
    expect(sent).toHaveLength(0);
  });

  it("an identical state produces no request (the seeded state, in any key order)", async () => {
    const { saver, sent } = setup();
    saver.seed(S1);
    saver.change(S1_REORDERED);
    await saver.flush();
    await saver.flush({ keepalive: true });
    await vi.advanceTimersByTimeAsync(CALCULATOR_IDLE_SAVE_MS * 2);
    expect(sent).toHaveLength(0);
  });

  it("a flush saves the latest state once; a second flush with nothing new sends nothing", async () => {
    const { saver, sent } = setup();
    saver.seed(S1);
    saver.change(S2);
    await Promise.all([saver.flush(), saver.flush()]);
    await saver.flush({ keepalive: true });
    expect(sent).toEqual([{ state: S2, opts: { keepalive: false } }]);
  });

  it("the safety net: one save 10 s after the last change, and only one", async () => {
    const { saver, sent } = setup();
    for (let i = 0; i < 20; i += 1) {
      saver.change({ n: i });
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(CALCULATOR_IDLE_SAVE_MS);
    expect(sent).toEqual([{ state: { n: 19 }, opts: { keepalive: false } }]);
    await vi.advanceTimersByTimeAsync(CALCULATOR_IDLE_SAVE_MS * 3);
    expect(sent).toHaveLength(1);
  });

  it("keepalive is passed through for the page going away", async () => {
    const { saver, sent } = setup();
    saver.change(S2);
    await saver.flush({ keepalive: true });
    expect(sent[0]?.opts).toEqual({ keepalive: true });
  });

  it("a failed save is reported and retried at the next save moment", async () => {
    let failing = true;
    const { saver, sent, results } = setup({ fail: () => failing });
    saver.change(S2);
    await saver.flush();
    expect(results).toEqual([false]);
    expect(saver.hasUnsaved()).toBe(true);
    failing = false;
    await saver.flush();
    expect(results).toEqual([false, true]);
    expect(sent).toEqual([{ state: S2, opts: { keepalive: false } }]);
    expect(saver.hasUnsaved()).toBe(false);
  });

  it("nothing is sent while sending is not allowed (no session, or the session is over)", async () => {
    const { saver, sent } = setup({ canSend: () => false });
    saver.change(S2);
    await saver.flush();
    await vi.advanceTimersByTimeAsync(CALCULATOR_IDLE_SAVE_MS);
    expect(sent).toHaveLength(0);
  });
});
