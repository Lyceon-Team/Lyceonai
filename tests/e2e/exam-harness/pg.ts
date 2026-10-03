/**
 * The harness's one Postgres connection, shared by the stubs.
 * @implemented [2026-09-25]
 */
import pg, { type Client } from "pg";
import {
  makePgSupabase,
  type PgSupabaseResult,
} from "../../helpers/pg-supabase";

let client: Client | null = null;

// PostgREST sends dates and timestamps as STRINGS; node-pg parses them into Date objects.
// The calendar's row schemas are written against the real transport, so the harness reads
// them the way production does (E9b). Harness process only.
for (const oid of [1082, 1114, 1184])
  pg.types.setTypeParser(oid, (v: string) => v);

export function setHarnessPg(pg: Client): void {
  client = pg;
}

/**
 * PostgREST turns a JSON body into typed arguments by the function signature; node-pg
 * cannot see it. So the signature is read here: an object or array bound for a json/jsonb
 * argument goes as JSON text, and anything else (a text[] / uuid[] / int[] argument such as
 * the exam's p_eliminated or practice's p_sections) goes as a JS array, which node-pg sends
 * as a Postgres array.
 *
 * @implemented [2026-10-03] (student screenshot harness): was a fixed list ("every object or
 * array as JSON except p_eliminated"), which is the same answer for every exam-surface call and
 * the wrong one for practice selection's array arguments. Read once per function name.
 */
const jsonArgCache = new Map<string, ReadonlySet<string>>();

async function jsonArgsOf(
  pgClient: Client,
  fn: string,
): Promise<ReadonlySet<string>> {
  const cached = jsonArgCache.get(fn);
  if (cached) return cached;
  const r = await pgClient.query<{ name: string }>(
    `SELECT a.name
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace,
            LATERAL unnest(coalesce(p.proallargtypes, p.proargtypes::oid[]), p.proargnames) AS a(typ, name)
      WHERE n.nspname = 'public' AND p.proname = $1
        AND a.typ IN ('json'::regtype, 'jsonb'::regtype)`,
    [fn],
  );
  const names = new Set<string>(
    r.rows.map((row: { name: string }) => row.name),
  );
  jsonArgCache.set(fn, names);
  return names;
}

function encodeArgs(
  args: Record<string, unknown> | undefined,
  jsonArgs: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  if (!args) return args;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] =
      v !== null && typeof v === "object" && jsonArgs.has(k)
        ? JSON.stringify(v)
        : v;
  }
  return out;
}

export function harnessSupabase() {
  if (client === null) throw new Error("harness Postgres is not connected");
  const pgClient = client;
  const sb = makePgSupabase(pgClient);
  return {
    from: sb.from,
    rpc: async (
      fn: string,
      args?: Record<string, unknown>,
    ): Promise<PgSupabaseResult> => {
      let jsonArgs: ReadonlySet<string>;
      try {
        jsonArgs = await jsonArgsOf(pgClient, fn);
      } catch (err: unknown) {
        // supabase-js reports a failed call in `error`, never by throwing; so does the harness.
        return {
          data: null,
          error: { message: err instanceof Error ? err.message : String(err) },
        };
      }
      return sb.rpc(fn, encodeArgs(args, jsonArgs));
    },
  };
}
