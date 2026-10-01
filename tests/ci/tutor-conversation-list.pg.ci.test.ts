/**
 * GET /api/tutor/conversations — keyset pagination, against real PostgreSQL.
 *
 * @spec [Doc-03B_V4.1 §8.3 (limit default `validation.pagination_default` = 20,
 *        opaque cursor), §8.5 (pagination envelope), §7.3 (cursor format)]
 * | @implemented [2026-09-29]
 *
 * plain English: drives the REAL tutor-runtime router over HTTP against the
 * REAL migrations. What is substituted: the database transport
 * (`supabaseServer` → SQL via tests/helpers/pg-supabase), the auth boundary
 * (a fixed student on req.user) and the entitlement check. The harness
 * returns timestamps in PostgREST's wire form ("…T…+00:00"), so the cursor's
 * anchor_ts is the string production would encode.
 *
 * What it proves (register UI-16 / F-01):
 *   - 0, 20 and 21 rows at the default page size: `has_more` is true only when
 *     a further row exists, and `next_cursor` is null exactly when it is false
 *     (the old `length === limit` said "more" at exactly 20).
 *   - page 2 continues page 1 with no overlap and no gap (the old route
 *     ignored `cursor` and served page 1 again).
 *   - rows sharing one updated_at are still walked exactly once.
 *   - the default page size is read from `validation.pagination_default`.
 *   - each row's preview and message_count come from ONE tutor_messages read
 *     (before: two), with the same values.
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
import express from "express";
import request from "supertest";
import type { Client } from "pg";
import {
  bootstrapPgDatabase,
  makePgSupabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import { listConversationsResponseSchema } from "../../packages/shared/src/tutor-lifecycle-schema";

const DB_NAME = "tutor_conversation_list_ci";
const STUDENT = "0d1d1d1d-0000-4000-8000-00000000000a";
const OTHER_STUDENT = "0d1d1d1d-0000-4000-8000-00000000000b";

const holder: { pg: Client | null; tables: string[] } = {
  pg: null,
  tables: [],
};

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    if (!holder.pg) throw new Error("pg not bootstrapped");
    const real = makePgSupabase(holder.pg);
    return {
      ...real,
      from: (table: string) => {
        holder.tables.push(table);
        return real.from(table);
      },
    };
  },
}));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../server/services/entitlement-service", () => ({
  EntitlementService: {
    isEntitlementActiveForProfile: vi.fn(async () => true),
  },
}));

import tutorRuntimeRouter from "../../server/routes/tutor-runtime";
import { TutorConfig } from "../../server/services/tutor-config";

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: { id: string; role: string } }).user = {
      id: STUDENT,
      role: "student",
    };
    next();
  });
  app.use("/api/tutor", tutorRuntimeRouter);
  return app;
}

function pg(): Client {
  if (!holder.pg) throw new Error("pg not bootstrapped");
  return holder.pg;
}

/** Deterministic uuid per index, so id order is known: …0001 < …0002. */
function convId(i: number): string {
  return `0e0e0e0e-0000-4000-8000-${String(i).padStart(12, "0")}`;
}

/**
 * Seeds `n` conversations for STUDENT. `sameTimestamp` gives them all one
 * updated_at; otherwise conversation i is i minutes after a fixed base, so
 * the newest is the highest index.
 */
async function seedConversations(
  n: number,
  opts: { sameTimestamp?: boolean } = {},
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 1; i <= n; i += 1) {
    const id = convId(i);
    const minutes = opts.sameTimestamp ? 0 : i;
    await pg().query(
      `INSERT INTO public.tutor_conversations
         (id, student_id, entry_mode, source_surface, surface, status, created_at, updated_at)
       VALUES ($1, $2, 'general', 'dashboard', 'standalone', 'active',
               '2026-09-01T10:00:00.123456Z'::timestamptz,
               '2026-09-01T10:00:00.123456Z'::timestamptz + make_interval(mins => $3))`,
      [id, STUDENT, minutes],
    );
    ids.push(id);
  }
  return ids;
}

/** Rows the student must never see: another student's, and a soft-deleted one. */
async function seedNoise(): Promise<void> {
  await pg().query(
    `INSERT INTO public.tutor_conversations
       (id, student_id, entry_mode, source_surface, surface, status, updated_at)
     VALUES ($1, $2, 'general', 'dashboard', 'standalone', 'active', now())`,
    [convId(900), OTHER_STUDENT],
  );
  await pg().query(
    `INSERT INTO public.tutor_conversations
       (id, student_id, entry_mode, source_surface, surface, status, updated_at, deleted_at)
     VALUES ($1, $2, 'general', 'dashboard', 'standalone', 'active', now(), now())`,
    [convId(901), STUDENT],
  );
}

type ListBody = {
  data: {
    conversations: Array<Record<string, unknown> & { conversation_id: string }>;
    pagination: { has_more: boolean; next_cursor: string | null };
  };
};

async function list(query = ""): Promise<ListBody> {
  const res = await request(makeApp()).get(`/api/tutor/conversations${query}`);
  expect(res.status).toBe(200);
  return res.body as ListBody;
}

/** Expected order: updated_at DESC, then id DESC. */
function expectedOrder(ids: string[]): string[] {
  return [...ids].reverse();
}

describe.skipIf(!PG_AVAILABLE)(
  "GET /api/tutor/conversations — keyset pagination (Doc 03B §8.3)",
  () => {
    beforeAll(async () => {
      holder.pg = await bootstrapPgDatabase(DB_NAME);
      for (const [id, email] of [
        [STUDENT, "list-a@example.test"],
        [OTHER_STUDENT, "list-b@example.test"],
      ] as const) {
        await pg().query(
          `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, email],
        );
        await pg().query(
          `INSERT INTO public.profiles (id, email, role)
           VALUES ($1, $2, 'student') ON CONFLICT (id) DO NOTHING`,
          [id, email],
        );
      }
    }, 240_000);

    afterAll(async () => {
      await holder.pg?.end();
    });

    beforeEach(async () => {
      await pg().query(`DELETE FROM public.tutor_messages`);
      await pg().query(`DELETE FROM public.tutor_conversations`);
      await pg().query(
        `DELETE FROM public.tutor_context_runtime_config WHERE key LIKE 'validation.%'`,
      );
      TutorConfig._resetForTests();
      holder.tables = [];
    });

    it("empty: nothing of this student's, has_more false, next_cursor null", async () => {
      // Rows exist — just none this student may see — so "empty" is the
      // filters' answer, not an empty table's.
      await seedNoise();
      const body = await list("?surface=standalone&status=active");
      expect(listConversationsResponseSchema.safeParse(body.data).success).toBe(
        true,
      );
      expect(body.data.conversations).toEqual([]);
      expect(body.data.pagination).toEqual({
        has_more: false,
        next_cursor: null,
      });
    });

    it("exactly 20 at the default page size: all 20, has_more false, next_cursor null", async () => {
      const ids = await seedConversations(20);
      const body = await list("?surface=standalone&status=active");
      expect(body.data.conversations.map((c) => c.conversation_id)).toEqual(
        expectedOrder(ids),
      );
      expect(body.data.pagination.has_more).toBe(false);
      expect(body.data.pagination.next_cursor).toBeNull();
    });

    it("21 rows: page 1 is 20 with a cursor; page 2 is the 21st, no overlap, no gap", async () => {
      const ids = await seedConversations(21);
      await seedNoise();

      const page1 = await list("?surface=standalone&status=active");
      expect(page1.data.conversations).toHaveLength(20);
      expect(page1.data.pagination.has_more).toBe(true);
      const cursor = page1.data.pagination.next_cursor;
      expect(typeof cursor).toBe("string");

      const page2 = await list(
        `?surface=standalone&status=active&cursor=${encodeURIComponent(String(cursor))}`,
      );
      const ids1 = page1.data.conversations.map((c) => c.conversation_id);
      const ids2 = page2.data.conversations.map((c) => c.conversation_id);
      expect(ids2).toHaveLength(1);
      expect(ids1.filter((id) => ids2.includes(id))).toEqual([]);
      expect([...ids1, ...ids2]).toEqual(expectedOrder(ids));
      expect(page2.data.pagination).toEqual({
        has_more: false,
        next_cursor: null,
      });
    });

    it("rows sharing one updated_at are walked exactly once, in id order", async () => {
      const ids = await seedConversations(45, { sameTimestamp: true });
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const suffix: string = cursor
          ? `&cursor=${encodeURIComponent(cursor)}`
          : "";
        const body = await list(`?surface=standalone${suffix}`);
        seen.push(...body.data.conversations.map((c) => c.conversation_id));
        cursor = body.data.pagination.next_cursor;
        pages += 1;
      } while (cursor && pages < 10);
      expect(pages).toBe(3);
      expect(seen).toEqual(expectedOrder(ids));
    });

    it("the default page size comes from validation.pagination_default", async () => {
      await seedConversations(7);
      await pg().query(
        `INSERT INTO public.tutor_context_runtime_config (key, value, value_type, owner, description)
         VALUES ('validation.pagination_default', '5', 'integer', 'product', 'test')`,
      );
      await TutorConfig.loadAll();
      const body = await list("?surface=standalone");
      expect(body.data.conversations).toHaveLength(5);
      expect(body.data.pagination.has_more).toBe(true);
    });

    it("an explicit limit still wins, and has_more is exact at that limit", async () => {
      await seedConversations(3);
      const body = await list("?surface=standalone&limit=3");
      expect(body.data.conversations).toHaveLength(3);
      expect(body.data.pagination.has_more).toBe(false);
    });

    it("a malformed cursor is 400, never page 1", async () => {
      await seedConversations(2);
      const res = await request(makeApp()).get(
        "/api/tutor/conversations?cursor=not-a-cursor",
      );
      expect(res.status).toBe(400);
    });

    it("preview and message_count are real, from one tutor_messages read per row; no answer fields", async () => {
      const [a, b] = await seedConversations(2);
      for (const [i, text] of ["first", "second", "latest words"].entries()) {
        await pg().query(
          `INSERT INTO public.tutor_messages (conversation_id, student_id, role, message, created_at)
           VALUES ($1, $2, 'student', $3, '2026-09-01T11:00:00Z'::timestamptz + make_interval(mins => $4))`,
          [a, STUDENT, text, i],
        );
      }
      holder.tables = [];
      const body = await list("?surface=standalone");
      const parsed = listConversationsResponseSchema.safeParse(body.data);
      expect(parsed.success).toBe(true);

      const byId = new Map(
        body.data.conversations.map((c) => [c.conversation_id, c]),
      );
      // Presence before absence: the payload is non-trivial.
      expect(byId.size).toBe(2);
      expect(byId.get(String(a))?.message_count).toBe(3);
      expect(byId.get(String(a))?.last_message_preview).toBe("latest words");
      expect(byId.get(String(b))?.message_count).toBe(0);
      expect(byId.get(String(b))?.last_message_preview).toBeNull();
      for (const c of body.data.conversations) {
        expect(Object.keys(c)).not.toContain("correct_answer");
        expect(Object.keys(c)).not.toContain("explanation");
      }

      // Query count: 1 list read + 1 message read per row (was 1 + 2N).
      expect(
        holder.tables.filter((t) => t === "tutor_conversations"),
      ).toHaveLength(1);
      expect(holder.tables.filter((t) => t === "tutor_messages")).toHaveLength(
        2,
      );
    });
  },
);
