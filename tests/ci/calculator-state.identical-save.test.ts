/**
 * Calculator-state routes: an identical save writes nothing.
 *
 * @spec [register G-NEW-14; owner brief 2026-10-12 ("Server: if the saved state is identical,
 *       return early and don't write. The existing idempotency and ownership checks stay as
 *       they are.")] | @implemented [2026-10-12]
 *
 * plain English: the practice and review routers are mounted on a bare app with the auth gates
 * passed through and a fake Supabase that records every UPDATE. For each route:
 *   - a state identical to the stored one (keys in another order, as jsonb returns them) → 200
 *     and NO update;
 *   - a different state → exactly one update carrying it;
 *   - ownership is still checked first: another student's session → 404 and no update;
 *   - practice only: a closed session is still 409, and a request that BINDS the client
 *     instance still writes (the binding is new even if the state is not).
 */
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const SESSION = "22222222-2222-4222-8222-222222222222";

const STORED = {
  scientific: { expressions: ["1+1"], version: 1 },
  graphing: null,
};
const SAME_OTHER_ORDER = {
  graphing: null,
  scientific: { version: 1, expressions: ["1+1"] },
};

const db = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  updates: [] as Array<{ table: string; values: unknown }>,
  user: "",
}));

vi.mock("../../apps/api/src/lib/supabase-server", () => {
  const from = (table: string) => {
    let update: unknown = undefined;
    const filters: Record<string, unknown> = {};
    const result = () => {
      const row = db.row;
      if (!row) return { data: null, error: null };
      for (const [k, v] of Object.entries(filters)) {
        if (row[k] !== v) return { data: null, error: null };
      }
      return { data: row, error: null };
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      update: (values: unknown) => {
        update = values;
        return chain;
      },
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return chain;
      },
      single: async () => result(),
      maybeSingle: async () => result(),
      then: (resolve: (v: { data: null; error: null }) => unknown) => {
        if (update !== undefined) db.updates.push({ table, values: update });
        return resolve({ data: null, error: null });
      },
    };
    return chain;
  };
  return { supabaseServer: { from } };
});

vi.mock("../../server/middleware/supabase-auth.js", () => {
  const pass = (_req: Request, _res: Response, next: NextFunction) => next();
  return {
    requireSupabaseAuth: (req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as { user: unknown }).user = {
        id: db.user,
        role: "student",
        isAdmin: false,
        isGuardian: false,
      };
      next();
    },
    requireProfileComplete: pass,
    requireGuardianLinkForUnder13: pass,
    requireStudentOrAdmin: pass,
  };
});

async function app(kind: "practice" | "review"): Promise<express.Express> {
  const mod =
    kind === "practice"
      ? await import("../../server/routes/practice-canonical")
      : await import("../../server/routes/review-canonical");
  const a = express();
  a.use(express.json());
  a.use(`/api/${kind}`, mod.default);
  return a;
}

function practiceRow(filters: Record<string, unknown>, status = "in_progress") {
  return {
    id: SESSION,
    user_id: OWNER,
    status,
    mode: "balanced",
    filters,
    client_instance_id: "tab-1",
  };
}

function reviewRow(filters: Record<string, unknown>) {
  return { id: SESSION, student_id: OWNER, status: "in_progress", filters };
}

beforeEach(() => {
  db.updates = [];
  db.user = OWNER;
});

describe("POST /api/practice/sessions/:id/calculator-state", () => {
  const url = `/api/practice/sessions/${SESSION}/calculator-state`;

  it("an identical state (other key order) → 200 and no write", async () => {
    db.row = practiceRow({
      client_instance_id: "tab-1",
      calculator_state: STORED,
    });
    const res = await request(await app("practice"))
      .post(url)
      .send({
        client_instance_id: "tab-1",
        calculator_state: SAME_OTHER_ORDER,
      });
    expect(res.status).toBe(200);
    expect(db.updates).toEqual([]);
  });

  it("a different state → one write carrying it", async () => {
    db.row = practiceRow({
      client_instance_id: "tab-1",
      calculator_state: STORED,
    });
    const next = { graphing: null, scientific: { expressions: ["2+2"] } };
    const res = await request(await app("practice"))
      .post(url)
      .send({ client_instance_id: "tab-1", calculator_state: next });
    expect(res.status).toBe(200);
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]?.values).toMatchObject({
      filters: { calculator_state: next },
    });
  });

  it("binding a client instance still writes, even with an identical state", async () => {
    db.row = practiceRow({ calculator_state: STORED });
    const res = await request(await app("practice"))
      .post(url)
      .send({
        client_instance_id: "tab-1",
        calculator_state: SAME_OTHER_ORDER,
      });
    expect(res.status).toBe(200);
    expect(db.updates).toHaveLength(1);
  });

  it("ownership first: another student's session → 404, no write", async () => {
    db.row = practiceRow({
      client_instance_id: "tab-1",
      calculator_state: STORED,
    });
    db.user = OTHER;
    const res = await request(await app("practice"))
      .post(url)
      .send({
        client_instance_id: "tab-1",
        calculator_state: SAME_OTHER_ORDER,
      });
    expect(res.status).toBe(404);
    expect(db.updates).toEqual([]);
  });

  it("a closed session is still 409, identical state or not", async () => {
    db.row = practiceRow(
      { client_instance_id: "tab-1", calculator_state: STORED },
      "completed",
    );
    const res = await request(await app("practice"))
      .post(url)
      .send({
        client_instance_id: "tab-1",
        calculator_state: SAME_OTHER_ORDER,
      });
    expect(res.status).toBe(409);
    expect(db.updates).toEqual([]);
  });
});

describe("POST /api/review/sessions/:id/calculator-state", () => {
  const url = `/api/review/sessions/${SESSION}/calculator-state`;

  it("an identical state (other key order) → 200 and no write", async () => {
    db.row = reviewRow({ calculator_state: STORED });
    const res = await request(await app("review"))
      .post(url)
      .send({ calculator_state: SAME_OTHER_ORDER });
    expect(res.status).toBe(200);
    expect(db.updates).toEqual([]);
  });

  it("a different state → one write", async () => {
    db.row = reviewRow({ calculator_state: STORED });
    const res = await request(await app("review"))
      .post(url)
      .send({ calculator_state: { graphing: null, scientific: null } });
    expect(res.status).toBe(200);
    expect(db.updates).toHaveLength(1);
  });

  it("ownership first: another student's session → 404, no write", async () => {
    db.row = reviewRow({ calculator_state: STORED });
    db.user = OTHER;
    const res = await request(await app("review"))
      .post(url)
      .send({ calculator_state: SAME_OTHER_ORDER });
    expect(res.status).toBe(404);
    expect(db.updates).toEqual([]);
  });
});
