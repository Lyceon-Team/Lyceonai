/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md R18, Q1 ("deterministic scheduler"); Coding
 *       Standards §4.1 (no randomness), §4.2 (idempotent); owner Step 0 decisions 2026-10-05
 *       (Vercel cron; deploy hook; candidates screened against the shared banned-phrase list)]
 *       | @implemented [2026-10-05]
 *
 * plain English: the scheduler over an in-memory stand-in for the three SQL functions it calls,
 * which keeps their contracts — candidates in canonical-id order, never an already-scheduled
 * question; inserts refused for a filled date ("exists") or a used question ("taken"). The SQL
 * itself (eligibility, the date PK, the question_id UNIQUE) is proven on Postgres by
 * scripts/ci/qotd-schema-gates.sql; this file proves the TypeScript decisions on top: the
 * rotation, determinism, idempotent reruns, the banned-phrase skip, the sweep and the hook.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CANONICAL_DOMAINS_BY_SECTION } from "../../shared/canonical-domains";
import { BANNED } from "../../shared/seo/banned-phrases";
import {
  QOTD_DAYS_AHEAD,
  rotationFor,
  runQotdSchedule,
} from "../../server/services/qotd/schedule-job";
import type { QotdDbClient } from "../../server/services/qotd/qotd-service";

type Q = {
  id: string;
  section: "M" | "RW";
  domain: string;
  stem: string;
  explanation?: string;
};

function makePool(perDomain: number): Q[] {
  const pool: Q[] = [];
  for (const section of ["M", "RW"] as const) {
    CANONICAL_DOMAINS_BY_SECTION[section].forEach((domain, d) => {
      for (let n = 0; n < perDomain; n += 1) {
        pool.push({
          id: `SAT${section}1D${d}${String(n).padStart(4, "0")}`,
          section,
          domain,
          stem: `Stem ${section} ${domain} ${n}`,
        });
      }
    });
  }
  return pool;
}

function makeDb(pool: Q[]) {
  const schedule = new Map<string, string>();
  const calls: string[] = [];
  const client: QotdDbClient = {
    rpc: async (fn, args = {}) => {
      calls.push(fn);
      if (fn === "qotd_schedule_candidates") {
        const used = new Set(schedule.values());
        const data = pool
          .filter(
            (q) =>
              q.section === args.p_section &&
              q.domain === args.p_domain &&
              !used.has(q.id),
          )
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .slice(0, Number(args.p_limit))
          .map((q) => ({
            question_id: q.id,
            stem: q.stem,
            passage: null,
            options: [{ key: "A", text: "x" }],
            explanation: q.explanation ?? "e",
          }));
        return { data, error: null };
      }
      if (fn === "qotd_schedule_insert") {
        const date = String(args.p_date);
        const id = String(args.p_question_id);
        if (schedule.has(date)) return { data: "exists", error: null };
        if ([...schedule.values()].includes(id))
          return { data: "taken", error: null };
        schedule.set(date, id);
        return { data: "inserted", error: null };
      }
      if (fn === "sweep_rate_limit_ledger_anon")
        return { data: 3, error: null };
      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    },
  };
  return { client, schedule, calls };
}

const NOW = new Date("2026-10-05T17:00:00Z"); // 2026-10-05 in America/Chicago

describe("rotationFor", () => {
  it("alternates the section day by day and steps the domain every two days, all eight pairs every day", () => {
    const days = Array.from({ length: 16 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      return rotationFor(d);
    });
    for (const order of days) {
      expect(order).toHaveLength(8);
      expect(new Set(order.map((o) => `${o.section}|${o.domain}`)).size).toBe(
        8,
      );
    }
    expect(days.map((o) => o[0]?.section)).toEqual(
      Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? "M" : "RW")),
    );
    const firstMathDomains = days
      .filter((_, i) => i % 2 === 0)
      .map((o) => o[0]?.domain);
    expect(firstMathDomains.slice(0, 4)).toEqual([
      ...CANONICAL_DOMAINS_BY_SECTION.M,
    ]);
    expect(firstMathDomains.slice(4, 8)).toEqual([
      ...CANONICAL_DOMAINS_BY_SECTION.M,
    ]);
  });

  it("is a pure function of the date (no randomness, no clock)", () => {
    const a = rotationFor("2026-10-05");
    const spy = vi.spyOn(Math, "random");
    const b = rotationFor("2026-10-05");
    expect(b).toEqual(a);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("the source has no randomness", () => {
    const src = readFileSync("server/services/qotd/schedule-job.ts", "utf8");
    expect(src).not.toMatch(/Math\.random|randomInt|randomUUID|crypto\./);
  });
});

describe("runQotdSchedule", () => {
  it("fills today through today + QOTD_DAYS_AHEAD, one distinct question per day, following the rotation", async () => {
    const db = makeDb(makePool(5));
    const summary = await runQotdSchedule({ client: db.client, now: NOW });
    expect(summary.today).toBe("2026-10-05");
    expect(summary.days).toHaveLength(QOTD_DAYS_AHEAD + 1);
    expect(summary.days.every((d) => d.outcome === "inserted")).toBe(true);
    expect(new Set(db.schedule.values()).size).toBe(QOTD_DAYS_AHEAD + 1);
    for (const day of summary.days) {
      if (day.outcome !== "inserted") continue;
      const first = rotationFor(day.date)[0];
      expect({ section: day.section, domain: day.domain }).toEqual(first);
    }
    expect(summary.sweptLedgerRows).toBe(3);
    expect(summary.deploy).toBe("skipped_no_hook");
  });

  it("is deterministic: the same database state yields the same schedule", async () => {
    const a = makeDb(makePool(5));
    const b = makeDb(makePool(5));
    await runQotdSchedule({ client: a.client, now: NOW });
    await runQotdSchedule({ client: b.client, now: NOW });
    expect([...a.schedule.entries()]).toEqual([...b.schedule.entries()]);
  });

  it("is idempotent: a rerun inserts nothing and changes nothing", async () => {
    const db = makeDb(makePool(5));
    await runQotdSchedule({ client: db.client, now: NOW });
    const before = [...db.schedule.entries()];
    const again = await runQotdSchedule({ client: db.client, now: NOW });
    expect(again.days.every((d) => d.outcome === "exists")).toBe(true);
    expect([...db.schedule.entries()]).toEqual(before);
  });

  it("skips a candidate whose text carries a banned public phrase, and takes the next", async () => {
    const pool = makePool(2);
    const phrase = BANNED[0];
    expect(phrase).toBeDefined();
    const first = rotationFor("2026-10-05")[0];
    const target = pool
      .filter((q) => q.section === first?.section && q.domain === first?.domain)
      .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    if (!target) throw new Error("no candidate");
    target.stem = "Practice to score higher on test day";
    expect(phrase?.pattern.test(target.stem)).toBe(true);
    const db = makeDb(pool);
    const summary = await runQotdSchedule({
      client: db.client,
      now: NOW,
      daysAhead: 0,
    });
    expect(summary.skippedBanned).toBe(1);
    expect(db.schedule.get("2026-10-05")).not.toBe(target.id);
    expect(db.schedule.get("2026-10-05")).toBeDefined();
  });

  it("skips an MCQ whose explanation names a choice letter (options are shuffled per request), and takes the next", async () => {
    const pool = makePool(2);
    const first = rotationFor("2026-10-05")[0];
    const inDomain = pool
      .filter((q) => q.section === first?.section && q.domain === first?.domain)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const [lettered, plain] = inDomain;
    if (!lettered || !plain) throw new Error("no candidates");
    lettered.explanation = "Choice B is correct because the slope is 3.";
    // A capital letter that is not an answer choice must NOT be screened out.
    plain.explanation = "Let B be the midpoint of segment AC; then AB = BC.";
    const db = makeDb(pool);
    const summary = await runQotdSchedule({
      client: db.client,
      now: NOW,
      daysAhead: 0,
    });
    expect(summary.skippedLetterReference).toBe(1);
    expect(db.schedule.get("2026-10-05")).toBe(plain.id);
  });

  it("moves to the next domain in the rotation when one has nothing left, and reports a day it cannot fill", async () => {
    const first = rotationFor("2026-10-05")[0];
    const pool = makePool(1).filter(
      (q) => !(q.section === first?.section && q.domain === first?.domain),
    );
    const db = makeDb(pool);
    const summary = await runQotdSchedule({
      client: db.client,
      now: NOW,
      daysAhead: 0,
    });
    const day = summary.days[0];
    expect(day?.outcome).toBe("inserted");
    if (day?.outcome === "inserted") {
      expect(day.domain).toBe(rotationFor("2026-10-05")[1]?.domain);
    }
    const empty = makeDb([]);
    const none = await runQotdSchedule({
      client: empty.client,
      now: NOW,
      daysAhead: 0,
    });
    expect(none.days[0]?.outcome).toBe("unfilled");
  });

  it("calls the deploy hook with POST when it is set, and reports a failure without throwing", async () => {
    const db = makeDb(makePool(2));
    const hook = vi.fn(async () => new Response("{}", { status: 201 }));
    const ok = await runQotdSchedule({
      client: db.client,
      now: NOW,
      daysAhead: 0,
      deployHookUrl: "https://api.vercel.com/v1/integrations/deploy/test/hook",
      fetchImpl: hook as unknown as typeof fetch,
    });
    expect(ok.deploy).toBe("triggered");
    expect(hook).toHaveBeenCalledTimes(1);
    expect((hook.mock.calls[0] as unknown[])[1]).toMatchObject({
      method: "POST",
    });
    // The summary never carries the hook URL (it is a credential).
    expect(JSON.stringify(ok)).not.toContain("deploy/test/hook");

    const failing = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const bad = await runQotdSchedule({
      client: db.client,
      now: NOW,
      daysAhead: 0,
      deployHookUrl: "https://example.invalid/hook",
      fetchImpl: failing as unknown as typeof fetch,
    });
    expect(bad.deploy).toBe("failed");
  });

  it("a database error fails the run (the cron answers 500), rather than reporting success", async () => {
    const client: QotdDbClient = {
      rpc: async () => ({ data: null, error: { message: "boom" } }),
    };
    await expect(
      runQotdSchedule({ client, now: NOW, daysAhead: 0 }),
    ).rejects.toThrow("qotd_schedule_candidates failed");
  });
});
