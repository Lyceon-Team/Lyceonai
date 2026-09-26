/**
 * The harness's one Postgres connection, shared by the stubs.
 * @implemented [2026-09-25]
 */
import pg, { type Client } from "pg";
import { makePgSupabase } from "../../helpers/pg-supabase";

let client: Client | null = null;

// PostgREST sends dates and timestamps as STRINGS; node-pg parses them into Date objects.
// The calendar's row schemas are written against the real transport, so the harness reads
// them the way production does (E9b). Harness process only.
for (const oid of [1082, 1114, 1184]) pg.types.setTypeParser(oid, (v: string) => v);

export function setHarnessPg(pg: Client): void {
  client = pg;
}

/**
 * PostgREST turns a JSON body into typed arguments by the function signature; node-pg
 * cannot see it. Objects and arrays go as JSON, except the one text[] argument on the
 * exam surface (p_eliminated) — the same rule as the handler-pg tests.
 */
const TEXT_ARRAY_ARGS = new Set(["p_eliminated"]);

function jsonArgs(args?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!args) return args;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = v !== null && typeof v === "object" && !TEXT_ARRAY_ARGS.has(k) ? JSON.stringify(v) : v;
  }
  return out;
}

export function harnessSupabase() {
  if (client === null) throw new Error("harness Postgres is not connected");
  const sb = makePgSupabase(client);
  return {
    from: sb.from,
    rpc: (fn: string, args?: Record<string, unknown>) => sb.rpc(fn, jsonArgs(args)),
  };
}
