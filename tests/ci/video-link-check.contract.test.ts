/**
 * @spec [CC Brief "Video Library (ships now)", Karl 2026-10-15, §10 (link rot: a scheduled
 *       YouTube Data API check marks unavailable videos; the Cloud Scheduler pattern)]
 * @implemented 2026-10-15
 *
 * plain English: the link-rot check, through the real functions.
 *  - Classification against a REAL videos.list response
 *    (fixtures/youtube-videos-list.status.json, captured 2026-10-15 for two library videos and
 *    one id that does not exist): the two are available, the missing one is unavailable.
 *  - Each reason a video cannot play in our embed marks it unavailable.
 *  - Fail safe: an API error writes nothing; a run where most of the library comes back
 *    unavailable writes nothing.
 *  - The key goes in a header, never the URL.
 *  - The caller: Terraform schedules a daily OIDC POST; the route refuses without its audience
 *    (500), without a token (401), and without its API key (500, nothing checked).
 */
import fs from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import internalCronRoutes from "../../server/routes/internal-cron-routes";
import {
  type LinkCheckResult,
  type VideosListItem,
  classifyVideos,
  runVideoLinkCheck,
  unavailableReason,
  youtubeFetcher,
} from "../../server/services/video-link-check";

const REAL = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "fixtures/youtube-videos-list.status.json"),
    "utf8",
  ),
) as { items: VideosListItem[] };
const PLAYABLE = REAL.items[0] as VideosListItem;

describe("classification", () => {
  it("a real response: the returned videos are available, the missing id is unavailable", () => {
    expect(REAL.items.map((i) => i.id)).toEqual(["f9DxgfyvRKg", "o8mfb_2bQ50"]);
    expect(
      classifyVideos(["f9DxgfyvRKg", "o8mfb_2bQ50", "AAAAAAAAAAA"], REAL.items),
    ).toEqual({
      available: ["f9DxgfyvRKg", "o8mfb_2bQ50"],
      unavailable: ["AAAAAAAAAAA"],
    });
  });

  it("each reason a video cannot play in the embed", () => {
    expect(unavailableReason(PLAYABLE)).toBeNull();
    const status = PLAYABLE.status ?? {};
    expect(
      unavailableReason({
        ...PLAYABLE,
        status: { ...status, privacyStatus: "private" },
      }),
    ).toBe("private");
    expect(
      unavailableReason({
        ...PLAYABLE,
        status: { ...status, uploadStatus: "rejected" },
      }),
    ).toBe("not_processed");
    expect(
      unavailableReason({
        ...PLAYABLE,
        status: { ...status, embeddable: false },
      }),
    ).toBe("not_embeddable");
    expect(
      unavailableReason({
        ...PLAYABLE,
        contentDetails: { regionRestriction: { blocked: ["US"] } },
      }),
    ).toBe("region_blocked");
    expect(
      unavailableReason({
        ...PLAYABLE,
        contentDetails: { regionRestriction: { allowed: ["GB"] } },
      }),
    ).toBe("region_blocked");
    // Unlisted plays in an embed: not a reason.
    expect(
      unavailableReason({
        ...PLAYABLE,
        status: { ...status, privacyStatus: "unlisted" },
      }),
    ).toBeNull();
  });
});

describe("runVideoLinkCheck", () => {
  const ids = Array.from(
    { length: 12 },
    (_, i) => `vid${String(i).padStart(8, "0")}`,
  );
  const item = (id: string): VideosListItem => ({ ...PLAYABLE, id });

  it("batches by 50 and writes once", async () => {
    const many = Array.from(
      { length: 120 },
      (_, i) => `v${String(i).padStart(10, "0")}`,
    );
    const batches: number[] = [];
    const writes: LinkCheckResult[] = [];
    const out = await runVideoLinkCheck({
      listVideoIds: async () => many,
      fetchVideos: async (b) => {
        batches.push(b.length);
        return b.filter((id) => id !== many[7]).map(item);
      },
      markChecked: async (r) => {
        writes.push(r);
      },
    });
    expect(batches).toEqual([50, 50, 20]);
    expect(writes).toHaveLength(1);
    expect(out).toMatchObject({ kind: "written", checked: 120 });
    expect(writes[0]?.unavailable).toEqual([many[7]]);
    expect(writes[0]?.available).toHaveLength(119);
  });

  it("an API error writes nothing", async () => {
    const markChecked = vi.fn();
    await expect(
      runVideoLinkCheck({
        listVideoIds: async () => ids,
        fetchVideos: async () => {
          throw new Error("youtube videos.list returned 403");
        },
        markChecked,
      }),
    ).rejects.toThrow("403");
    expect(markChecked).not.toHaveBeenCalled();
  });

  it("most of the library unavailable in one run → breaker, nothing written", async () => {
    const markChecked = vi.fn();
    const out = await runVideoLinkCheck({
      listVideoIds: async () => ids,
      fetchVideos: async () => [item(ids[0] ?? "")],
      markChecked,
    });
    expect(out.kind).toBe("breaker_tripped");
    expect(markChecked).not.toHaveBeenCalled();
  });

  it("half or fewer unavailable is written", async () => {
    const markChecked = vi.fn();
    const out = await runVideoLinkCheck({
      listVideoIds: async () => ids,
      fetchVideos: async (b) => b.slice(0, 6).map(item),
      markChecked,
    });
    expect(out.kind).toBe("written");
    expect(markChecked).toHaveBeenCalledTimes(1);
  });
});

describe("youtubeFetcher", () => {
  it("sends the key as a header, never in the URL, and parses the real body", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push({ url, headers: init?.headers as Record<string, string> });
      return new Response(JSON.stringify(REAL), { status: 200 });
    }) as typeof fetch;
    const items = await youtubeFetcher(
      "SECRET-KEY",
      fetchImpl,
    )(["f9DxgfyvRKg"]);
    expect(items.map((i) => i.id)).toEqual(["f9DxgfyvRKg", "o8mfb_2bQ50"]);
    expect(seen[0]?.url).not.toContain("SECRET-KEY");
    expect(seen[0]?.url).toContain("youtube.googleapis.com/youtube/v3/videos?");
    expect(seen[0]?.url).toContain("part=status%2CcontentDetails");
    expect(seen[0]?.headers["X-goog-api-key"]).toBe("SECRET-KEY");
  });

  it("a non-200 throws", async () => {
    const fetchImpl = (async () =>
      new Response("{}", { status: 403 })) as typeof fetch;
    await expect(youtubeFetcher("k", fetchImpl)(["x"])).rejects.toThrow("403");
  });
});

describe("the scheduled caller and the route guard", () => {
  const savedEnv = { ...process.env };
  function app(): express.Express {
    const a = express();
    a.use(express.json());
    a.use("/api/internal", internalCronRoutes);
    return a;
  }
  beforeEach(() => {
    process.env = { ...savedEnv };
  });
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("Terraform schedules a daily OIDC POST to /api/internal/video-link-check", () => {
    const tf = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../infra/terraform/cloud-scheduler-video-link-check.tf",
      ),
      "utf-8",
    );
    const start = tf.indexOf(
      'resource "google_cloud_scheduler_job" "video_link_check"',
    );
    expect(start).toBeGreaterThan(-1);
    const job = tf.slice(start, tf.indexOf("\n}\n", start));
    expect(job).toMatch(/schedule\s+=\s+"10 6 \* \* \*"/);
    expect(job).toMatch(/http_method = "POST"/);
    expect(job).toContain(
      'uri         = "${var.app_base_url}/api/internal/video-link-check"',
    );
    expect(job).toContain(
      'audience              = "${var.app_base_url}/api/internal/video-link-check"',
    );
    expect(job).toContain(
      "service_account_email = google_service_account.cloud_tasks.email",
    );
  });

  it("audience unset → 500 (no fallback)", async () => {
    delete process.env.VIDEO_LINK_CHECK_OIDC_AUDIENCE;
    process.env.CRISIS_SLA_SWEEP_OIDC_AUDIENCE =
      "https://lyceon.ai/api/internal/crisis-sla-sweep";
    process.env.CLOUD_TASKS_SERVICE_ACCOUNT =
      "lisa-cloud-tasks@replit-cop.iam.gserviceaccount.com";
    const res = await request(app()).post("/api/internal/video-link-check");
    expect(res.status).toBe(500);
  });

  it("no bearer token → 401", async () => {
    process.env.VIDEO_LINK_CHECK_OIDC_AUDIENCE =
      "https://lyceon.ai/api/internal/video-link-check";
    process.env.CLOUD_TASKS_SERVICE_ACCOUNT =
      "lisa-cloud-tasks@replit-cop.iam.gserviceaccount.com";
    const res = await request(app()).post("/api/internal/video-link-check");
    expect(res.status).toBe(401);
  });

  it("GET is not a way in", async () => {
    process.env.CRON_SECRET = "test-secret";
    const res = await request(app())
      .get("/api/internal/video-link-check")
      .set("Authorization", "Bearer test-secret");
    expect(res.status).toBe(404);
  });
});
