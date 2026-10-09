/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md R18, Q1 ("deterministic scheduler"); Coding
 *       Standards §4.1 (no randomness), §4.2 (idempotent); owner Step 0 decisions 2026-10-05
 *       (Vercel cron; deploy hook; candidates screened against the shared banned-phrase list)]
 *       | @implemented [2026-10-05]
 *
 * plain English: the scheduler over an in-memory stand-in for the SQL functions it calls, which
 * keeps their contracts — candidates in canonical-id order a page at a time (keyset on the id),
 * never an already-scheduled question; inserts refused for a filled date ("exists") or a used
 * question ("taken"); a release refused for today or the past. The SQL itself (eligibility, the
 * date PK, the question_id UNIQUE, the release guard) is proven on Postgres by
 * scripts/ci/qotd-schema-gates.sql; this file proves the TypeScript decisions on top: the
 * rotation, determinism, idempotent reruns, the banned-phrase skip, the readability rules
 * (owner brief "QOTD — readability filter (Karl's option B)", 2026-10-09), the replacement of
 * upcoming days, the sweep and the hook.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CANONICAL_DOMAINS_BY_SECTION } from "../../shared/canonical-domains";
import {
  BANNED,
  firstUnapprovedOutcome,
} from "../../shared/seo/banned-phrases";
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
  passage?: string;
  explanation?: string;
  itemType?: "mcq" | "grid_in";
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

function makeDb(pool: Q[], today = "2026-10-05") {
  const schedule = new Map<string, string>();
  const calls: string[] = [];
  const client: QotdDbClient = {
    rpc: async (fn, args = {}) => {
      calls.push(fn);
      if (fn === "qotd_schedule_candidate_page") {
        const used = new Set(schedule.values());
        const after = args.p_after_id === null ? null : String(args.p_after_id);
        const data = pool
          .filter(
            (q) =>
              q.section === args.p_section &&
              q.domain === args.p_domain &&
              !used.has(q.id) &&
              (after === null || q.id > after),
          )
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .slice(0, Number(args.p_limit))
          .map((q) => ({
            question_id: q.id,
            item_type: q.itemType ?? "mcq",
            stem: q.stem,
            passage: q.passage ?? null,
            options:
              (q.itemType ?? "mcq") === "mcq" ? [{ key: "A", text: "x" }] : [],
            explanation: q.explanation ?? "e",
          }));
        return { data, error: null };
      }
      if (fn === "qotd_schedule_upcoming") {
        const after = String(args.p_after);
        const data = [...schedule.entries()]
          .filter(([d]) => d > after)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([d, id]) => {
            const q = pool.find((x) => x.id === id);
            if (!q) throw new Error(`no question ${id}`);
            return {
              qotd_date: d,
              question_id: id,
              section: q.section,
              item_type: q.itemType ?? "mcq",
              stem: q.stem,
              passage: q.passage ?? null,
            };
          });
        return { data, error: null };
      }
      if (fn === "qotd_schedule_release") {
        // The SQL guard: never today or the past (the database's own clock).
        const date = String(args.p_date);
        if (date <= today) return { data: false, error: null };
        if (schedule.get(date) !== String(args.p_question_id))
          return { data: false, error: null };
        schedule.delete(date);
        return { data: true, error: null };
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
    target.stem = "A SAT tutor at your finger tips";
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

  it("F13: skips a candidate carrying an unapproved outcome phrase (an archive page is public), and takes the next", async () => {
    const pool = makePool(2);
    const first = rotationFor("2026-10-05")[0];
    const target = pool
      .filter((q) => q.section === first?.section && q.domain === first?.domain)
      .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    if (!target) throw new Error("no candidate");
    target.stem = "Practice to score higher on test day";
    expect(firstUnapprovedOutcome(target.stem)).not.toBeNull();
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

  it("skips a question whose stem repeats its passage (no prompt; owner 2026-10-08), and takes the next", async () => {
    const pool = makePool(3);
    const first = rotationFor("2026-10-05")[0];
    const inDomain = pool
      .filter((q) => q.section === first?.section && q.domain === first?.domain)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const [copied, padded, good] = inDomain;
    if (!copied || !padded || !good) throw new Error("no candidates");
    const passage =
      "Historians have argued that the uprising was driven by tax grievances.";
    copied.passage = passage;
    copied.stem = passage;
    // Whitespace differences do not hide the copy.
    padded.passage = passage;
    padded.stem = `  ${passage.replace(" ", "\n")}  `;
    // A real stem under the same passage is a normal question.
    good.passage = passage;
    good.stem = "Which choice best states the main idea of the text?";
    const db = makeDb(pool);
    const summary = await runQotdSchedule({
      client: db.client,
      now: NOW,
      daysAhead: 0,
    });
    expect(summary.skippedStemRepeatsPassage).toBe(2);
    expect(db.schedule.get("2026-10-05")).toBe(good.id);
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
    ).rejects.toThrow("qotd_schedule_upcoming failed");
  });
});

// ── Readability (owner brief "QOTD — readability filter (Karl's option B)", 2026-10-09) ──────
describe("readability rules", () => {
  /** The first-choice domain of a day, and its candidates in canonical-id order. */
  function firstDomain(pool: Q[], date: string): Q[] {
    const first = rotationFor(date)[0];
    return pool
      .filter((q) => q.section === first?.section && q.domain === first?.domain)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  // 2026-10-05 opens with Reading and Writing; 2026-10-06 opens with Math.
  const RW_DAY = new Date("2026-10-05T17:00:00Z");
  const M_DAY = new Date("2026-10-06T17:00:00Z");

  async function scheduleOne(
    pool: Q[],
    now: Date,
  ): Promise<string | undefined> {
    const db = makeDb(pool, qotdDayOf(now));
    await runQotdSchedule({ client: db.client, now, daysAhead: 0 });
    return db.schedule.get(qotdDayOf(now));
  }
  function qotdDayOf(now: Date): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  }

  it("a grid-in is skipped (multiple choice only)", async () => {
    const pool = makePool(2);
    const [grid, mcq] = firstDomain(pool, "2026-10-06");
    if (!grid || !mcq) throw new Error("no candidates");
    grid.itemType = "grid_in";
    expect(await scheduleOne(pool, M_DAY)).toBe(mcq.id);
  });

  it("a paired-passage item ('Text 1' and 'Text 2') is skipped", async () => {
    const pool = makePool(2);
    const [paired, single] = firstDomain(pool, "2026-10-05");
    if (!paired || !single) throw new Error("no candidates");
    paired.passage = "Text 1: Bees dance. Text 2: Ants march.";
    single.passage = "Bees dance to share where food is.";
    expect(await scheduleOne(pool, RW_DAY)).toBe(single.id);
  });

  it("an over-length Math item (passage + question > 400) is skipped; one at 400 is scheduled", async () => {
    const pool = makePool(2);
    const [long, exact] = firstDomain(pool, "2026-10-06");
    if (!long || !exact) throw new Error("no candidates");
    long.passage = "x".repeat(200);
    long.stem = "y".repeat(200); // 200 + 1 (the joining space) + 200 = 401
    exact.passage = "x".repeat(200);
    exact.stem = "y".repeat(199); // 400
    expect(await scheduleOne(pool, M_DAY)).toBe(exact.id);
  });

  it("an over-length Reading and Writing passage (> 300) is skipped; one at 300 is scheduled", async () => {
    const pool = makePool(2);
    const [long, exact] = firstDomain(pool, "2026-10-05");
    if (!long || !exact) throw new Error("no candidates");
    long.passage = "w".repeat(301);
    exact.passage = `<p>${"w".repeat(300)}</p>`; // tags are not counted
    expect(await scheduleOne(pool, RW_DAY)).toBe(exact.id);
  });

  it("a short Reading and Writing item and a short Math item are each scheduled", async () => {
    const pool = makePool(1);
    const [rw] = firstDomain(pool, "2026-10-05");
    const [m] = firstDomain(pool, "2026-10-06");
    if (!rw || !m) throw new Error("no candidates");
    rw.passage = "The committee approved the plan after a short debate.";
    rw.stem = "Which choice best states the main idea of the text?";
    m.stem = "If 3x + 2 = 11, what is the value of x?";
    expect(await scheduleOne(pool, RW_DAY)).toBe(rw.id);
    expect(await scheduleOne(pool, M_DAY)).toBe(m.id);
  });

  it("a domain with no readable question left is skipped without error: the next domain fills the day", async () => {
    const pool = makePool(2);
    for (const q of firstDomain(pool, "2026-10-05"))
      q.passage = "z".repeat(500);
    const db = makeDb(pool);
    const summary = await runQotdSchedule({
      client: db.client,
      now: RW_DAY,
      daysAhead: 0,
    });
    const day = summary.days[0];
    expect(day?.outcome).toBe("inserted");
    if (day?.outcome === "inserted") {
      expect(day.domain).toBe(rotationFor("2026-10-05")[1]?.domain);
    }
    expect(summary.skippedUnreadable).toBe(2);
  });

  it("pages past a full page of long items to the readable one behind it in the same domain", async () => {
    const pool = makePool(60);
    const inDomain = firstDomain(pool, "2026-10-05");
    // The first 55 (more than one page of 50) are too long; the 56th is short.
    inDomain.slice(0, 55).forEach((q) => (q.passage = "z".repeat(500)));
    const target = inDomain[55];
    if (!target) throw new Error("no candidate");
    const db = makeDb(pool);
    const summary = await runQotdSchedule({
      client: db.client,
      now: RW_DAY,
      daysAhead: 0,
    });
    expect(db.schedule.get("2026-10-05")).toBe(target.id);
    const day = summary.days[0];
    if (day?.outcome === "inserted") {
      expect(day.domain).toBe(rotationFor("2026-10-05")[0]?.domain);
    }
  });

  it("replaces only UPCOMING days whose question fails the rules; today and past days never change", async () => {
    const pool = makePool(8);
    const long = (q: Q | undefined): Q => {
      if (!q) throw new Error("no candidate");
      q.itemType = "grid_in";
      return q;
    };
    const ids = pool.map((q) => q.id);
    const pastQ = long(pool[0]);
    const todayQ = long(pool[1]);
    const futureBad = long(pool[2]);
    const futureGood = pool.find(
      (q, i) => i > 2 && (q.itemType ?? "mcq") === "mcq",
    );
    if (!futureGood) throw new Error("no good question");
    const db = makeDb(pool, "2026-10-05");
    db.schedule.set("2026-10-03", pastQ.id);
    db.schedule.set("2026-10-05", todayQ.id);
    db.schedule.set("2026-10-07", futureBad.id);
    db.schedule.set("2026-10-08", futureGood.id);
    const summary = await runQotdSchedule({ client: db.client, now: NOW });
    // Past and today keep their (unreadable) questions: never changed.
    expect(db.schedule.get("2026-10-03")).toBe(pastQ.id);
    expect(db.schedule.get("2026-10-05")).toBe(todayQ.id);
    // The readable upcoming day is untouched; the unreadable one got a new, readable question.
    expect(db.schedule.get("2026-10-08")).toBe(futureGood.id);
    const replacement = db.schedule.get("2026-10-07");
    expect(replacement).toBeDefined();
    expect(replacement).not.toBe(futureBad.id);
    expect(ids).toContain(replacement);
    expect(pool.find((q) => q.id === replacement)?.itemType ?? "mcq").toBe(
      "mcq",
    );
    // The summary reports which dates changed, and why.
    expect(summary.replaced).toEqual([
      {
        date: "2026-10-07",
        previousQuestionId: futureBad.id,
        reason: "not_multiple_choice",
      },
    ]);
  });
});
