/**
 * @spec [Coding Standards §5.2, §7.1; Doc-04A_V2.2 §10.2] | @implemented [2026-09-25]
 *
 * plain English: the client refuses, at the boundary, a question payload that
 * carries an answer — the leak fails the call instead of reaching client state.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", () => ({ apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { fetchModuleItems, sendExamHeartbeat } from "./exam-api";

const item = {
  question_id: "SATRW1Q0",
  ordinal: 0,
  question_type: "multiple_choice",
  stem: "Stem",
  passage: null,
  options: [{ id: "tok_1", text: "One" }],
  assets: null,
  current_answer: null,
  correct_answer: null,
  explanation: null,
};
const body = (items: unknown[]) =>
  new Response(JSON.stringify({ section_state: { section: "RW", state: "module1_active", remaining_ms: 1000 }, items }));

afterEach(() => {
  apiRequest.mockReset();
  vi.restoreAllMocks();
});

describe("exam-api anti-leak boundary", () => {
  it("accepts the contract payload (answer fields null)", async () => {
    apiRequest.mockResolvedValueOnce(body([item]));
    await expect(fetchModuleItems("s", "RW", "1")).resolves.toMatchObject({ items: [item] });
  });

  it.each([
    ["correct_answer", { ...item, correct_answer: "A" }],
    ["explanation", { ...item, explanation: "Because" }],
    ["correct_variants", { ...item, correct_variants: ["1"] }],
    ["difficulty", { ...item, difficulty: 3 }],
  ])("rejects an item carrying %s", async (_name, leaky) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    apiRequest.mockResolvedValueOnce(body([leaky]));
    await expect(fetchModuleItems("s", "RW", "1")).rejects.toThrow(/cannot read/);
  });

  it("the heartbeat sends the ordinal (SCL-146) and an empty body without one", async () => {
    const ok = () => new Response(JSON.stringify({ section_state: { section: "RW", state: "module1_active", remaining_ms: 5 } }));
    apiRequest.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());
    await sendExamHeartbeat("s", "RW", 4);
    await sendExamHeartbeat("s", "RW", null);
    expect(apiRequest.mock.calls[0]![1]).toEqual({ method: "POST", body: '{"ordinal":4}' });
    expect(apiRequest.mock.calls[1]![1]).toEqual({ method: "POST", body: "{}" });
  });
});
