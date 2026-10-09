/**
 * UI-07 — students never see question-bank counts.
 *
 * @spec [Doc-02B_V4 §14; Coding Standards §5.2, §6.1, §7.2; owner ruling UI-07 2026-09-29]
 * @implemented [2026-09-29]
 *
 * plain English: drives the REAL Express app (server/index.ts) with supertest. Only the
 * identity step and the database are replaced:
 *   - `requireSupabaseAuth` / `supabaseAuthMiddleware` attach a student or an admin from a
 *     test header; the REAL `requireStudentOrAdmin` and `requireSupabaseAdmin` decide access;
 *   - `supabaseServer` is a PostgREST-shaped fake that returns ONLY the selected columns.
 * expected outcome:
 *   1. a student calling `GET /api/questions/stats` gets 403; an admin gets 200;
 *   2. the student responses of `GET /api/practice/topics` and
 *      `GET /api/practice/reference/questions` parse against the strict shared schemas, so a
 *      `count` / `total` field (or any unnamed field) fails, and neither body carries one.
 * trade-offs: the DB fake is shared by all three routes; `servable_questions` is served, and
 *   `canonical_skill_catalog` (the topics route's source since F-56) is derived from the same rows.
 * edge cases: presence is asserted before absence — the topics body must contain both
 * sections with a non-empty skill list, and the reference body its `questions` array and
 * `filters` echo, before the no-count assertions run. With a column-faithful fake the
 * reference route's `questions` array is EMPTY: the route selects neither `correct_answer`
 * nor `question_type`/`item_type`, and `isCanonicalPublishedMcQuestion` requires both, so
 * every published row is filtered out (practice-topics-routes.ts, pre-existing; reported
 * for the register's §8, not fixed here). The per-question schema is therefore exercised
 * only by shape, not by a served row; the top-level `.strict()` still refuses `count`.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";
import type { Express, NextFunction, Request, Response } from "express";
import {
  practiceReferenceQuestionsResponseSchema,
  practiceTopicsResponseSchema,
} from "../../packages/shared/src/practice-reference-schema";
import type { SupabaseUser } from "../../server/middleware/supabase-auth";

type BankRow = Record<string, unknown>;

const bank = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

const ROLE_HEADER = "x-test-role";

function userFor(req: Request): SupabaseUser | undefined {
  const role = req.header(ROLE_HEADER);
  if (role === "student") {
    return {
      id: "ui07-student",
      email: "ui07-student@example.test",
      display_name: null,
      role: "student",
      isAdmin: false,
      isGuardian: false,
      actor_id: "ui07-student-actor",
      // G2-06 (merged from `main`): a real session always carries the derived `is_under_13`;
      // a student without it (age unknown) is refused. This student is 13+.
      is_under_13: false,
    };
  }
  if (role === "admin") {
    return {
      id: "ui07-admin",
      email: "ui07-admin@example.test",
      display_name: null,
      role: "admin",
      isAdmin: true,
      isGuardian: false,
      actor_id: "ui07-admin-actor",
    };
  }
  return undefined;
}

vi.mock("../../server/middleware/supabase-auth", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/middleware/supabase-auth")
  >("../../server/middleware/supabase-auth");

  const attach = (req: Request, _res: Response, next: NextFunction): void => {
    const user = userFor(req);
    if (user) req.user = user;
    next();
  };

  return {
    ...actual,
    supabaseAuthMiddleware: attach,
    requireSupabaseAuth: (req: Request, res: Response, next: NextFunction) => {
      const user = userFor(req);
      if (!user) {
        res.status(401).json({ error: "unauthenticated" });
        return;
      }
      req.user = user;
      next();
    },
    // requireStudentOrAdmin and requireSupabaseAdmin are the REAL implementations.
  };
});

/** PostgREST-shaped fake: filters apply, and only the selected columns come back. */
class BankQuery {
  private columns: string[] | null = null;
  private readonly filters: Array<(row: BankRow) => boolean> = [];
  private max: number | null = null;

  select(columns?: string): this {
    if (typeof columns === "string" && columns.trim() !== "*") {
      this.columns = columns
        .split(",")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
    }
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  contains(column: string, values: unknown[]): this {
    this.filters.push((row) => {
      const cell = row[column];
      return Array.isArray(cell) && values.every((v) => cell.includes(v));
    });
    return this;
  }

  order(): this {
    return this;
  }

  limit(count: number): this {
    this.max = count;
    return this;
  }

  then<T>(
    resolve: (value: { data: BankRow[]; error: null }) => T,
    reject?: (reason: unknown) => T,
  ): Promise<T> {
    return Promise.resolve(this.execute()).then(resolve, reject);
  }

  private execute(): { data: BankRow[]; error: null } {
    let rows = bank.rows.filter((row) => this.filters.every((f) => f(row)));
    if (this.max !== null) rows = rows.slice(0, this.max);
    const columns = this.columns;
    const data = columns
      ? rows.map((row) => {
          const projected: BankRow = {};
          for (const col of columns) {
            if (Object.prototype.hasOwnProperty.call(row, col)) {
              projected[col] = row[col];
            }
          }
          return projected;
        })
      : rows;
    return { data, error: null };
  }
}

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table !== "servable_questions") {
        throw new Error(`Unexpected table access in UI-07 test: ${table}`);
      }
      return new BankQuery();
    },
  },
}));

/**
 * `canonical_skill_catalog` as the view computes it: DISTINCT (section, domain, skill) over the
 * same bank rows. The topics route reads it since F-56 (2026-10-02).
 */
vi.mock("../../apps/api/src/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== "canonical_skill_catalog") {
        throw new Error(
          `Unexpected admin table access in UI-07 test: ${table}`,
        );
      }
      const rows = new Map<string, BankRow>();
      for (const row of bank.rows) {
        const codes = Array.isArray(row.skill_codes) ? row.skill_codes : [];
        for (const skill of codes) {
          rows.set(
            `${String(row.section)}|${String(row.domain)}|${String(skill)}`,
            {
              section: row.section,
              domain: row.domain,
              skill,
            },
          );
        }
      }
      const q = {
        select: () => q,
        then: <T>(resolve: (v: { data: BankRow[]; error: null }) => T) =>
          Promise.resolve({ data: [...rows.values()], error: null }).then(
            resolve,
          ),
      };
      return q;
    },
  }),
}));

/** A servable_questions row as the view stores it, answer columns included. */
function bankRow(
  id: string,
  section: "M" | "RW",
  domain: string,
  skill: string,
): BankRow {
  return {
    id,
    canonical_id: `SAT${section}1ABC${id.slice(-3)}`,
    status: "published",
    section,
    section_code: section,
    item_type: "mcq",
    question_type: "multiple_choice",
    stem: `Question ${id}`,
    options: [
      { key: "A", text: "one" },
      { key: "B", text: "two" },
      { key: "C", text: "three" },
      { key: "D", text: "four" },
    ],
    difficulty: "medium",
    domain,
    skill_codes: [skill],
    created_at: "2026-09-01T00:00:00.000Z",
    correct_answer: "B",
    explanation: "Because two.",
  };
}

const COUNT_KEYS = /^(count|total|totalCount|questionCount|question_count|n)$/i;

/** Walks a JSON body and returns every key path whose key names a count or total. */
function countKeyPaths(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => countKeyPaths(v, `${path}[${i}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, v]) => [
        ...(COUNT_KEYS.test(key) ? [`${path}.${key}`] : []),
        ...countKeyPaths(v, `${path}.${key}`),
      ],
    );
  }
  return [];
}

describe("UI-07: students never see question-bank counts", () => {
  let app: Express;

  beforeAll(async () => {
    process.env.VITEST = "true";
    process.env.NODE_ENV = "test";
    const serverModule = await import("../../server/index");
    app = serverModule.default;
  });

  afterAll(() => {
    delete process.env.VITEST;
  });

  beforeEach(() => {
    bank.rows.splice(0, bank.rows.length);
    bank.rows.push(
      bankRow(
        "00000000-0000-0000-0000-000000000101",
        "M",
        "Algebra",
        "M.ALG.LIN",
      ),
      bankRow(
        "00000000-0000-0000-0000-000000000102",
        "M",
        "Algebra",
        "M.ALG.SYS",
      ),
      bankRow(
        "00000000-0000-0000-0000-000000000201",
        "RW",
        "Craft and Structure",
        "RW.CAS.WIC",
      ),
    );
  });

  describe("GET /api/questions/stats is admin-only", () => {
    it("denies a student with 403", async () => {
      const res = await request(app)
        .get("/api/questions/stats")
        .set(ROLE_HEADER, "student");
      expect(res.status).toBe(403);
      expect(countKeyPaths(res.body)).toEqual([]);
    });

    it("serves an admin with 200", async () => {
      const res = await request(app)
        .get("/api/questions/stats")
        .set(ROLE_HEADER, "admin");
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
    });

    it("still requires authentication (401)", async () => {
      const res = await request(app).get("/api/questions/stats");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/practice/topics (student)", () => {
    it("parses against the strict schema and carries no count or total field", async () => {
      const res = await request(app)
        .get("/api/practice/topics")
        .set(ROLE_HEADER, "student");
      expect(res.status).toBe(200);

      // Presence before absence: both sections, with the published skills.
      const sections = (res.body as { sections?: unknown[] }).sections ?? [];
      expect(sections).toHaveLength(2);
      expect(JSON.stringify(res.body)).toContain("M.ALG.LIN");

      const parsed = practiceTopicsResponseSchema.safeParse(res.body);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      expect(countKeyPaths(res.body)).toEqual([]);
    });
  });

  describe("GET /api/practice/reference/questions (student)", () => {
    it("parses against the strict schema and carries no count or total field", async () => {
      const res = await request(app)
        .get("/api/practice/reference/questions?section=M&limit=5")
        .set(ROLE_HEADER, "student");
      expect(res.status).toBe(200);

      // Presence before absence: the questions array and the filters echo are there.
      expect(Array.isArray(res.body.questions)).toBe(true);
      expect(res.body.filters).toMatchObject({ section: "M", limit: 5 });

      const parsed = practiceReferenceQuestionsResponseSchema.safeParse(
        res.body,
      );
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      expect(countKeyPaths(res.body)).toEqual([]);
    });
  });

  describe("the strict schemas refuse a count", () => {
    it("rejects a topics body with a per-domain count", () => {
      const withCount = {
        sections: [
          {
            section: "M",
            label: "Math",
            domains: [{ domain: "Algebra", skills: [], count: 12 }],
          },
        ],
      };
      expect(practiceTopicsResponseSchema.safeParse(withCount).success).toBe(
        false,
      );
    });

    it("rejects a reference body with a top-level count", () => {
      const withCount = {
        questions: [],
        count: 0,
        filters: { section: null, domain: null, skill: null, limit: 10 },
      };
      expect(
        practiceReferenceQuestionsResponseSchema.safeParse(withCount).success,
      ).toBe(false);
    });
  });
});
