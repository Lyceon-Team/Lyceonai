/**
 * `validationFieldPaths` — the one rule every 400 log on every surface now obeys.
 *
 * @spec [lyceon-coding-standards §12.1 (never log request bodies or student content);
 *        Doc_05F §8.1] | @implemented [2026-09-29]
 *
 * plain English: it proves the helper reports WHICH field failed and never WHAT was in it.
 * Expected outcome: an operator can diagnose a 400 from the logs, and a student's input is
 * not in them.
 *
 * WHY THE ENUM CASE IS THE LOAD-BEARING ONE. The obvious implementation of "log the
 * validation errors" is `{ errors: parsed.error.flatten() }`, and four sites in this
 * codebase had exactly that. `fieldErrors` holds Zod's MESSAGE strings, and a `z.enum`
 * failure renders the rejected value inside the message:
 *
 *   "Invalid enum value. Expected 'close' | 'threshold' | 'stale', received 'xyz'"
 *
 * So the obvious implementation leaks. Nothing about the key list hints at that, which is
 * why it is asserted here rather than left to a reviewer's eye.
 *
 * THE FIXTURES ARE DERIVED FROM REAL OUTPUT. Every `flatten()` below comes from calling a
 * real Zod schema with a real bad value — never hand-written — because a hand-written
 * flatten can assert a shape Zod does not produce, and then both the fixture and the code
 * it guards pass against something neither of them emits.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validationFieldPaths } from "../../server/lib/validation-log";

describe("validationFieldPaths", () => {
  it("names the fields a BASE object parse rejected", () => {
    const schema = z
      .object({
        idempotency_key: z.string().uuid(),
        daily_minutes: z.number().int(),
      })
      .strict();
    const parsed = schema.safeParse({ daily_minutes: 60 });
    // Presence before absence: the parse really failed, so there is something to report.
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("unreachable");

    expect(validationFieldPaths(parsed.error.flatten())).toEqual([
      "idempotency_key",
    ]);
  });

  it("does NOT carry a rejected enum value out — the leak four sites had", () => {
    const schema = z.object({
      trigger_reason: z.enum(["close", "threshold", "stale"]),
    });
    const parsed = schema.safeParse({ trigger_reason: "SENTINEL_VALUE" });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("unreachable");

    const flat = parsed.error.flatten();
    // The leak, proved to exist before it is proved to be closed. Asserting only the
    // absence would pass against a Zod that had stopped quoting the value, and then this
    // test would be guarding nothing.
    expect(JSON.stringify(flat)).toContain("SENTINEL_VALUE");

    const paths = validationFieldPaths(flat);
    expect(paths).toEqual(["trigger_reason"]);
    expect(JSON.stringify(paths)).not.toContain("SENTINEL_VALUE");
  });

  it("reports a form-level refusal as <root> rather than as nothing", () => {
    // A cross-field rule, which is what `superRefine` issues with an empty path — the shape
    // `makeStudyProfileUpsertSchema` uses for "a profile update must change at least one
    // field". A 400 that named no field at all is the case the helper exists to end.
    const schema = z
      .object({ a: z.string().optional(), b: z.string().optional() })
      .refine((v) => v.a !== undefined || v.b !== undefined, {
        message: "one of a or b is required",
      });
    const parsed = schema.safeParse({});
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("unreachable");

    expect(validationFieldPaths(parsed.error.flatten())).toEqual(["<root>"]);
  });

  it("carries the field names a non-Zod refusal states directly", () => {
    // `CALENDAR_SETUP_INCOMPLETE` refuses with `{ missing: [...] }` rather than a flatten.
    // Those are field NAMES already, and they are the reason for the refusal.
    expect(
      validationFieldPaths({ missing: ["study_days_mask", "daily_minutes"] }),
    ).toEqual(["study_days_mask", "daily_minutes"]);
  });

  it("is total over what a caller may actually hand it", () => {
    // `details` is `unknown` at every call site, and a refusal without details is ordinary
    // — a helper that threw on one would turn a 400 into a 500.
    for (const value of [undefined, null, "a string", 42, [], {}]) {
      expect(validationFieldPaths(value)).toEqual([]);
    }
    // A non-string inside `missing` is dropped rather than rendered as "[object Object]".
    expect(validationFieldPaths({ missing: ["ok", 7, null] })).toEqual(["ok"]);
  });
});
