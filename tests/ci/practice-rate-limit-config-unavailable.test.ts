/**
 * @spec [Coding Standards §12.1; register F-34; owner ruling Brief 6] | @implemented [2026-09-30] |
 * plain English: when the practice runtime config cannot be read, the answer rate limiter fails
 * closed with 503 CONFIG_UNAVAILABLE and logs one warning that carries its component, event name
 * and message. The call used to pass only the message, so the production line had no `message`
 * and no `event` and a search for this outage found nothing. No test reached this branch before.
 */
import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

vi.mock("../../apps/api/src/lib/supabase-server", () => {
  const failing = {
    then: (resolve: (v: { data: null; error: { message: string } }) => void) =>
      resolve({ data: null, error: { message: "config read failed" } }),
  };
  const chain: Record<string, unknown> = new Proxy(failing, {
    get(target, prop) {
      if (prop in target) return (target as Record<string, unknown>)[prop];
      return () => chain;
    },
  });
  return { supabaseServer: { from: () => chain } };
});

const { practiceAnswerRateLimiter } =
  await import("../../server/routes/practice-canonical");
const { logger } = await import("../../server/logger");

function fakeResponse(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe("practice answer rate limiter, config unavailable (F-34)", () => {
  it("fails closed with 503 and logs PRACTICE_ANSWER/rate_limit_config_unavailable with its message", async () => {
    const warn = vi.spyOn(logger, "warn");
    const res = fakeResponse();
    const next = vi.fn();

    await practiceAnswerRateLimiter({} as Request, res, next);

    // Presence: the branch ran and refused.
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ error: { code: "CONFIG_UNAVAILABLE" } });
    expect(next).not.toHaveBeenCalled();

    const line = warn.mock.calls.find(
      (call) =>
        call[0] === "PRACTICE_ANSWER" &&
        call[1] === "rate_limit_config_unavailable",
    );
    expect(line).toBeDefined();
    expect(line?.[2]).toBe(
      "Rate limiter config unavailable; rejecting request (fail-closed)",
    );
  });
});
