/**
 * @spec [Doc 05 Parent AC#20 / RB-05P-V1-14 — student AND guardian read surfaces return
 *   `mastery_level` and entity identifiers only; `mastery_score` / `mastery_pct` are
 *   admin/internal/audit-only. Doc 05 Parent AC#19 — no guardian route exposes per-skill
 *   rows, per-question rows, or audit rows. Doc 05B §10.5 — column projection, never
 *   `SELECT *` then serialise. Doc 04C invariant #7 — the guardian payload is a strict
 *   SUBSET of the student payload. Owner ruling 2026-08-23 — "the guardian sees exactly
 *   what the student sees, no more and no less."]
 * | @implemented [2026-08-24] | @revised [2026-11-02 — converted to real Postgres]
 *
 * plain English: the guardian roster route is driven against a real database in which the
 * linked student HAS real RULE-4-bearing rows (`student_domain_mastery`, every internal column
 * populated), and the response is walked to every depth to prove none of it crossed. The
 * roster's own shape is then held to the canonical contract, `linkedStudentSchema`, strictly —
 * so a column the route was never meant to project fails here even when it is not a RULE-4
 * name.
 *
 * WHAT CHANGED ON 2026-11-02, AND WHY. This file was `guardian.anti-leak.ci.test.ts`, accepted
 * by scripts/ci/guardian-schema-truth-gate.mjs until 2026-11-01. It mocked `supabaseServer`
 * with a fake that returned a hand-written `profiles` row carrying `mastery_score`,
 * `acc_test`, `kpi_refresh_version` and the rest — columns `profiles` has never had. So the
 * walk was proving the route stripped a shape nothing in the system produces (CLAUDE.md: "a
 * hand-written fixture can assert a shape nothing in the system produces"). The two mutations
 * it was built for are kept, each now against what Postgres actually holds:
 *
 *   `SELECT *` on profiles  → real columns the contract does not carry (`role`,
 *                             `date_of_birth`, `actor_id`, …) reach the body; the strict
 *                             contract parse reds.
 *   a `...row` spread of the student's mastery row into a roster entry (the MA-07 class, #419)
 *                           → real `mastery_score` / `acc_test` / … reach the body; the
 *                             RULE-4 walk reds, naming the keys.
 *
 * The forbidden list is the ONE shared list (`packages/shared/src/rule4-columns.ts`), which was
 * extracted from this file; it is consumed here rather than re-declared.
 *
 * WHAT IS SUBSTITUTED: the database transport (tests/helpers/pg-supabase) and the auth
 * boundary (a fixed guardian session). The route, the role gate, the link reader, the
 * entitlement probe and the schema are real.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import express from "express";
import request from "supertest";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import {
  RULE_4_COLUMNS,
  findRule4Keys,
} from "../../packages/shared/src/rule4-columns";
import { linkedStudentSchema } from "../../packages/shared/src/guardian-student-schema";

const DB_NAME = "guardian_anti_leak_ci";
const GUARDIAN = "a1e11111-1111-4111-8111-111111111111";
const STUDENT = "a1e22222-2222-4222-8222-222222222222";

let pg: Client;

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return makePgSupabase(pg);
  },
  supabaseAdmin: {
    get from() {
      return makePgSupabase(pg).from;
    },
  },
}));

vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    requireSupabaseAuth: (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      const r = req as express.Request & { user?: unknown; requestId?: string };
      r.user = { id: GUARDIAN, email: "g@example.test", role: "guardian" };
      r.requestId ??= "req-guardian-antileak";
      next();
    },
  };
});

async function buildGuardianApp(): Promise<express.Express> {
  const router = (await import("../../server/routes/guardian-routes")).default;
  const app = express();
  app.use(express.json());
  app.use("/api/guardian", router);
  return app;
}

describe.skipIf(!PG_AVAILABLE)(
  "Guardian surfaces strip every RULE-4 column, at every depth (real Postgres)",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1,'g@example.test'),($2,'s@example.test')`,
        [GUARDIAN, STUDENT],
      );
      await pg.query(
        `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth) VALUES
         ($1,'g@example.test','guardian','Gia Guardian','1980-01-01'),
         ($2,'s@example.test','student','Sam Student','2010-01-01')`,
        [GUARDIAN, STUDENT],
      );
      await pg.query(
        `INSERT INTO public.guardian_links (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at, accepted_at, accepted_by_profile_id)
         VALUES ($1, $2, 'active', 'student', now(), now(), $2)`,
        [GUARDIAN, STUDENT],
      );
      await pg.query(
        `INSERT INTO public.entitlements (profile_id, tier, status) VALUES ($1, 'premium', 'active')`,
        [STUDENT],
      );
      // The student's REAL internal mastery machinery, every RULE-4 column populated.
      await pg.query(
        `INSERT INTO public.student_domain_mastery
           (student_id, section, domain, mastery_score, mastery_pct, mastery_level, event_count_total,
            mastery_model_version, constants_snapshot_hash, acc_test, acc_practice, acc_review,
            last_event_id, last_event_occurred_at)
         VALUES ($1, 'M', 'Algebra', 0.42, 42, 2, 37, 'v1.0', '0f2037d1deadbeef', 0.4, 0.44, 0.41,
                 gen_random_uuid(), now())`,
        [STUDENT],
      );
    });

    afterAll(async () => {
      if (pg) await pg.end();
    });

    it("the database really holds RULE-4 values for this student (the poison is real, not typed)", async () => {
      const r = await pg.query(
        `SELECT * FROM public.student_domain_mastery WHERE student_id = $1`,
        [STUDENT],
      );
      expect(r.rows).toHaveLength(1);
      // Read back from Postgres: the columns are named by the schema, not by this file.
      const carried = findRule4Keys(r.rows[0]);
      expect(carried).toEqual(
        expect.arrayContaining([
          "mastery_score",
          "mastery_pct",
          "acc_test",
          "event_count_total",
          "constants_snapshot_hash",
        ]),
      );
    });

    it("linked students — /guardian/students", async () => {
      const res = await request(await buildGuardianApp()).get(
        "/api/guardian/students",
      );
      expect(res.status).toBe(200);
      // PRESENCE BEFORE ABSENCE (G1-10, audit G-AUD-15d). An empty roster contains no
      // forbidden key either, so without this the walk below passes for the wrong reason.
      expect(res.body.students).toHaveLength(1);
      expect(res.body.students[0].id).toBe(STUDENT);
      expect(res.body.students[0].has_active_entitlement).toBe(true);

      // The walk first, so a spread of the mastery row reds HERE, naming the keys.
      expect(
        findRule4Keys(res.body),
        "students: response carries RULE-4 key(s) at some depth",
      ).toEqual([]);

      // Then the projection: exactly the canonical contract's keys, no more. A route that
      // regressed to `SELECT *` leaks real profile columns no RULE-4 list would name.
      const strict = linkedStudentSchema
        .strict()
        .array()
        .safeParse(res.body.students);
      expect(
        strict.success,
        strict.success ? "" : JSON.stringify(strict.error.issues),
      ).toBe(true);
    });

    it("the walk itself catches a leak one layer down (gate self-check)", () => {
      // Without this, a walk that silently stopped at depth 1 would make the case above
      // pass vacuously — which is exactly how the MA-07 leak survived a top-level check.
      // Every forbidden key is planted, one at a time, two levels deep.
      for (const key of RULE_4_COLUMNS) {
        const nested = { ok: true, data: { nodes: [{ [key]: 0.42 }] } };
        expect(findRule4Keys(nested)).toEqual([`data.nodes[].${key}`]);
      }
    });
  },
);
