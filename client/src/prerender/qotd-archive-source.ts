/**
 * The Question of the Day archive, read once at build time for the prerender.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md Q3 (prerendered archive pages, in the
 *       sitemap); owner Step 0 decision 6, 2026-10-05 (option A: a daily deploy hook rebuilds the
 *       site, so each finished day gets its page)] | @implemented [2026-10-05]
 *
 * plain English: one POST to PostgREST's rpc endpoint for public.qotd_archive() with the
 * service-role key the API already uses (no new dependency, no new secret). The function returns
 * only days strictly before today in America/Chicago whose question is still published, so the
 * build cannot emit today's or a future answer. Each row goes through the shared projection the
 * API route uses (shared/qotd/projection.ts), so the static page and GET /api/public/qotd/:date
 * agree.
 *
 * Without credentials (a local or CI build) the archive is empty and the result says so; a
 * Vercel PRODUCTION build without them fails, because shipping production without its archive
 * pages would silently drop them from the sitemap.
 *
 * A database that does not have qotd_archive() yet (PostgREST answers 404, PGRST202 — the QOTD
 * migrations are applied out of band, after the code deploys) builds no archive pages and says
 * so in the build log, rather than failing every deploy of every change until the migration
 * lands. There are no archive days to lose in that state: the schedule lives in the same
 * migration. Any other failure (auth, 5xx, an unexpected shape) fails the build.
 */
import { z } from "zod";
import { qotdRowSchema, toArchiveResponse } from "@shared/qotd/projection";
import type { QotdArchiveResponse } from "../../../packages/shared/src/qotd-schema";

export type QotdArchiveSource =
  | { source: "database"; days: QotdArchiveResponse[] }
  | { source: "fixture"; days: QotdArchiveResponse[] }
  | { source: "skipped_no_credentials"; days: [] }
  | { source: "skipped_function_missing"; days: [] };

type BuildEnv = Readonly<Record<string, string | undefined>>;

export async function loadQotdArchiveForBuild(
  env: BuildEnv,
  fetchImpl: typeof fetch,
): Promise<QotdArchiveSource> {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    if (env.VERCEL === "1" && env.VERCEL_ENV === "production") {
      throw new Error(
        "prerender: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not available to the production build, so the Question of the Day archive cannot be built",
      );
    }
    return { source: "skipped_no_credentials", days: [] };
  }
  const res = await fetchImpl(
    `${url.replace(/\/+$/, "")}/rest/v1/rpc/qotd_archive`,
    {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    },
  );
  if (res.status === 404) {
    // PostgREST's "function not found" (PGRST202): the migration is not applied here yet.
    return { source: "skipped_function_missing", days: [] };
  }
  if (!res.ok) {
    // Status only: the response body could echo request details.
    throw new Error(`prerender: qotd_archive returned HTTP ${res.status}`);
  }
  const rows = z.array(qotdRowSchema).safeParse(await res.json());
  if (!rows.success) {
    throw new Error("prerender: qotd_archive returned an unexpected row shape");
  }
  return { source: "database", days: rows.data.map(toArchiveResponse) };
}
