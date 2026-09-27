// E7b harness stub (see ../hooks.mjs): the production service-role client, backed
// by the harness Postgres. Same surface the exam services use: rpc() and from().
import { harnessSupabase } from "../pg";

export const supabaseServer = new Proxy(
  {},
  {
    get(_target, prop: string) {
      const sb = harnessSupabase() as Record<string, unknown>;
      return sb[prop];
    },
  },
) as ReturnType<typeof harnessSupabase>;
