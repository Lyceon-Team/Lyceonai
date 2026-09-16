/**
 * @spec [Coding Standards §12.1 structured logging, §13 error handling;
 *        owner directive 2026-09-16 — "fix the silent catch"]
 * @implemented 2026-09-16
 *
 * plain English: every handler in the calendar router that answers 500 must say
 * so in the log, not only in the response body.
 *
 * WHY THIS FILE EXISTS. On 2026-09-16 `/api/calendar/profile` and
 * `/api/calendar/month` returned 500 in production for an entitled student. The
 * router caught the error, put the message in the RESPONSE, and logged nothing —
 * the whole file contained zero `logger.` calls. The message went to the client
 * and to nowhere else, so it was absent from the Vercel runtime log and from the
 * error group. The cause had to be recovered from the database schema instead,
 * which worked once and is not a method.
 *
 * A caught error that is reported only to the person who triggered it is a
 * silent catch with extra steps: §13 forbids swallowing, and the test for
 * "swallowed" is whether an operator can see it afterwards.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROUTER = path.resolve(
  __dirname,
  "../../apps/api/src/routes/calendar.ts",
);

function source(): string {
  return fs.readFileSync(ROUTER, "utf-8");
}

/** Comments must not satisfy an assertion about code. */
function code(): string {
  return source()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("calendar router observability", () => {
  it("imports the one house logger", () => {
    // The shared structured logger, not console. It redacts by default and
    // truncates identifiers — `user_id` is in its IDENTIFIER_KEY_EXACT set — so
    // passing the id through its context parameter is what keeps §12.1 held.
    expect(code()).toMatch(
      /import \{ logger \} from "\.\.\/\.\.\/\.\.\/\.\.\/server\/logger"/,
    );
    expect(code(), "console logging in a route").not.toMatch(
      /console\.(log|error|warn)\(/,
    );
  });

  it("logs before every 500 it returns — one log per 500, paired", () => {
    // PAIRED, not merely "present in the enclosing block". The first draft of
    // this test searched from the nearest `try {` or `} catch` to the return,
    // which a neighbour could satisfy: the day-edit handler has THREE inline
    // 500s in one try, so deleting the log for one of them left the other two
    // in the slice and the test stayed green. The plant caught it.
    //
    // So each 500 must have a logger.error before it with NO other 500 in
    // between. That makes the pairing one-to-one and a deleted log unmaskable.
    const src = code();
    const sites = [...src.matchAll(/return res\.status\(500\)\.json\(/g)];
    expect(sites.length, "no 500 sites found — has the file moved?")
      .toBeGreaterThan(0);

    const unlogged: number[] = [];
    for (const site of sites) {
      const before = src.slice(0, site.index);
      const lastLog = before.lastIndexOf("logger.error(");
      const prevFive = before.lastIndexOf("return res.status(500).json(");
      // A log that predates an intervening 500 belongs to that one, not this.
      if (lastLog === -1 || lastLog < prevFive) {
        unlogged.push(before.split("\n").length);
      }
    }
    expect(unlogged, `500 returned without its own log at line(s) ${unlogged}`)
      .toEqual([]);
  });

  it("logs the message it returns, so the two cannot drift", () => {
    // The log carries the SAME `message` the response carries. A log that said
    // something else would send an operator hunting for a string no client ever
    // saw.
    const src = code();
    const logged = [...src.matchAll(/logger\.error\([\s\S]{0,200}?\{ error: (\w+) \}/g)]
      .map((m) => m[1]);
    expect(logged.length, "no logger.error with an error payload").toBeGreaterThan(0);
    for (const name of logged) expect(name).toBe("message");
  });

  it("never logs a student answer, a token or a raw row", () => {
    // §12.1, asserted STRUCTURALLY rather than by forbidden words. A word list
    // over the whole call is the wrong shape: the first draft of this test
    // matched `tasks` inside the operation label `save_day_tasks` and failed a
    // log that carries no task data at all. What matters is the PAYLOAD.
    //
    // So: every call passes exactly `{ error: message }` and exactly
    // `{ userId, requestId }`. Nothing else can ride along — not a row, not a
    // request body, not a variable that happens to be in scope.
    const src = code();
    const calls = src.match(/logger\.error\([\s\S]{0,400}?\n *\);/g) ?? [];
    expect(calls.length, "no logger.error calls found").toBeGreaterThan(0);
    for (const call of calls) {
      const args = call.slice(call.indexOf("(") + 1, call.lastIndexOf(")"));
      const payload = /\{ error: (\w+) \}/.exec(args);
      expect(payload, `payload is not { error: <local> } in:\n${call}`)
        .not.toBeNull();
      expect(payload?.[1]).toBe("message");
      const context = /\{ userId: user\.id, requestId: req\.requestId \}/.test(
        args,
      );
      expect(context, `context is not { userId, requestId } in:\n${call}`)
        .toBe(true);
      // The optional `data` slot stays empty — it is the one that would carry a
      // row if somebody reached for it.
      expect(args).toContain("undefined");
    }
  });
});
