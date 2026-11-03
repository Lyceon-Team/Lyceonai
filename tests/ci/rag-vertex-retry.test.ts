/**
 * @spec [Karl's ruling 2 on #1406 (G2-1), 2026-11-02: backoff and retry on Vertex 429 so rate
 *       limits stop cutting eval runs short] | @implemented [2026-11-02]
 *
 * plain English: withVertexRetry (scripts/rag/vertex.ts) retries an SDK call on 429 and 5xx,
 * 6 tries on the doubling schedule, and rethrows anything else at once. The errors are the
 * SDK's own ApiError, the class @google/genai throws, not a hand-built look-alike.
 */
import { ApiError } from "@google/genai";
import { describe, expect, it } from "vitest";
import { withVertexRetry } from "../../scripts/rag/vertex";

function failingThen<T>(
  errors: ApiError[],
  value: T,
): { call: () => Promise<T>; calls: () => number } {
  let n = 0;
  return {
    call: () => {
      n += 1;
      const err = errors[n - 1];
      return err === undefined ? Promise.resolve(value) : Promise.reject(err);
    },
    calls: () => n,
  };
}

const rateLimited = (): ApiError =>
  new ApiError({ message: "Resource exhausted", status: 429 });

describe("withVertexRetry", () => {
  it("retries 429 and 5xx with doubling waits, then returns the result", async () => {
    const waits: number[] = [];
    const f = failingThen(
      [rateLimited(), new ApiError({ message: "unavailable", status: 503 })],
      "ok",
    );
    const out = await withVertexRetry("t", f.call, (ms) => {
      waits.push(ms);
      return Promise.resolve();
    });
    expect(out).toBe("ok");
    expect(f.calls()).toBe(3);
    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeGreaterThanOrEqual(5_000);
    expect(waits[0]).toBeLessThan(6_000);
    expect(waits[1]).toBeGreaterThanOrEqual(10_000);
    expect(waits[1]).toBeLessThan(11_000);
  });

  it("gives up after 6 tries on a persistent 429, naming the status", async () => {
    const f = failingThen(Array.from({ length: 10 }, rateLimited), "never");
    await expect(
      withVertexRetry("g0-2-tutor", f.call, () => Promise.resolve()),
    ).rejects.toThrow("g0-2-tutor: Vertex returned 429 after 6 tries");
    expect(f.calls()).toBe(6);
  });

  it("does not retry a 400 or a non-HTTP error", async () => {
    const bad = failingThen(
      [new ApiError({ message: "bad request", status: 400 })],
      "x",
    );
    await expect(
      withVertexRetry("t", bad.call, () => Promise.resolve()),
    ).rejects.toThrow("bad request");
    expect(bad.calls()).toBe(1);

    let n = 0;
    await expect(
      withVertexRetry(
        "t",
        () => {
          n += 1;
          return Promise.reject(new Error("boom"));
        },
        () => Promise.resolve(),
      ),
    ).rejects.toThrow("boom");
    expect(n).toBe(1);
  });
});
