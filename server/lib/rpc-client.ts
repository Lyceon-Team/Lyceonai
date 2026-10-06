/**
 * The one shape a service needs from a Supabase client to call a SQL function.
 *
 * @implemented [2026-10-05] | plain English: services that only call `rpc` take this instead of
 * the whole Supabase client, so a test can hand them an in-memory stand-in that keeps the SQL
 * function's contract. It was `QotdDbClient` in the QOTD service; the product-feedback and
 * marketing-consent services need the same thing, so it lives here once and QOTD aliases it.
 */
export type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};
