/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md Q3; owner Step 0 decision 6, 2026-10-05]
 *       | @implemented [2026-10-05]
 *
 * plain English: the build-time archive read. Each outcome the prerender depends on: no
 * credentials (skip, except a production build, which fails), the function not deployed yet
 * (skip — the migration is applied out of band after the code ships), any other failure (fail
 * the build), and a real response projected through the shared projection.
 */
import { describe, expect, it } from "vitest";
import { loadQotdArchiveForBuild } from "./qotd-archive-source";
import { QOTD_ARCHIVE_ROWS } from "../../../tests/lib/qotd-fixture";

const CREDS = {
  SUPABASE_URL: "https://example.supabase.co/",
  SUPABASE_SERVICE_ROLE_KEY: "service-key-not-real",
};

function respond(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("loadQotdArchiveForBuild", () => {
  it("no credentials: skipped outside a production build, fatal in one", async () => {
    const f = respond(200, []);
    expect(await loadQotdArchiveForBuild({}, f.impl)).toEqual({
      source: "skipped_no_credentials",
      days: [],
    });
    await expect(
      loadQotdArchiveForBuild(
        { VERCEL: "1", VERCEL_ENV: "production" },
        f.impl,
      ),
    ).rejects.toThrow("cannot be built");
    expect(f.calls).toHaveLength(0);
  });

  it("calls the rpc endpoint with the service key", async () => {
    const f = respond(200, []);
    await loadQotdArchiveForBuild(CREDS, f.impl);
    expect(f.calls[0]?.url).toBe(
      "https://example.supabase.co/rest/v1/rpc/qotd_archive",
    );
    expect(f.calls[0]?.init?.method).toBe("POST");
  });

  it("a database without qotd_archive() yet (404) builds no archive and says so", async () => {
    const f = respond(404, { code: "PGRST202" });
    expect(await loadQotdArchiveForBuild(CREDS, f.impl)).toEqual({
      source: "skipped_function_missing",
      days: [],
    });
  });

  it("any other failure fails the build", async () => {
    await expect(
      loadQotdArchiveForBuild(CREDS, respond(500, {}).impl),
    ).rejects.toThrow("HTTP 500");
    await expect(
      loadQotdArchiveForBuild(CREDS, respond(401, {}).impl),
    ).rejects.toThrow("HTTP 401");
    await expect(
      loadQotdArchiveForBuild(CREDS, respond(200, [{ nope: 1 }]).impl),
    ).rejects.toThrow("unexpected row shape");
  });

  it("real rows (the shared fixture) come back as archive payloads", async () => {
    const out = await loadQotdArchiveForBuild(
      CREDS,
      respond(200, QOTD_ARCHIVE_ROWS).impl,
    );
    expect(out.source).toBe("database");
    expect(out.days.map((d) => d.qotd_date)).toEqual(
      QOTD_ARCHIVE_ROWS.map((r) => r.qotd_date),
    );
    expect(out.days[0]?.question.explanation).toBe(
      QOTD_ARCHIVE_ROWS[0]?.explanation,
    );
  });
});
