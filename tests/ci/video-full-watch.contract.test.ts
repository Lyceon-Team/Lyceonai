/**
 * @spec [owner brief "Phase C follow-up: show the segment, not the whole video", Karl
 *       2026-11-04, build 4: "Record whether 'Watch full video' was used, as an ID and a flag
 *       only"] | @implemented [2026-11-04]
 *
 * plain English: POST /api/perf/video-full-watch through the real handler.
 *  - A valid report → 204 and one PERF line, `video_watch_full`, carrying exactly the segment id
 *    and the flag.
 *  - Anything else in the body, or an id that is not a UUID → 400, nothing logged. No user → 401.
 *  - It is registered on the /api/perf router, whose mount carries the tutor gates (auth, the
 *    student-only gate, CSRF) and the beacon limiter (asserted in tutor-reply-timing-h1).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logged = vi.hoisted(() => ({ info: [] as unknown[][] }));
vi.mock("../../server/logger", () => ({
  logger: {
    info: vi.fn((...args: unknown[]) => logged.info.push(args)),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { postVideoFullWatch } from "../../server/routes/video-full-watch";

const SEGMENT_ID = "5e9a0000-0000-4000-8000-000000000000";

function beaconApp(user: boolean): express.Express {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    if (user) {
      (req as unknown as { user: { id: string } }).user = { id: "student" };
    }
    next();
  });
  a.post("/api/perf/video-full-watch", postVideoFullWatch);
  return a;
}

function lines(): unknown[][] {
  return logged.info.filter(
    (args) => args[0] === "PERF" && args[1] === "video_watch_full",
  );
}

beforeEach(() => {
  logged.info.length = 0;
});

describe("POST /api/perf/video-full-watch: an id and a flag, refused otherwise", () => {
  it("a valid report → 204 and one line with exactly the segment id and the flag", async () => {
    const res = await request(beaconApp(true))
      .post("/api/perf/video-full-watch")
      .send({ segment_id: SEGMENT_ID });
    expect(res.status).toBe(204);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]![3]).toEqual({
      segment_id: SEGMENT_ID,
      watched_full: true,
    });
  });

  it.each([
    [
      "an extra field (nothing can ride along)",
      { segment_id: SEGMENT_ID, student_id: "s-1" },
    ],
    ["a non-uuid id", { segment_id: "my answer is B" }],
    ["no id", {}],
  ])("%s → 400 and nothing logged", async (_name, body) => {
    const res = await request(beaconApp(true))
      .post("/api/perf/video-full-watch")
      .send(body);
    expect(res.status).toBe(400);
    expect(lines()).toHaveLength(0);
  });

  it("no authenticated user → 401 and nothing logged", async () => {
    const res = await request(beaconApp(false))
      .post("/api/perf/video-full-watch")
      .send({ segment_id: SEGMENT_ID });
    expect(res.status).toBe(401);
    expect(lines()).toHaveLength(0);
  });

  it("is registered on the gated /api/perf router", () => {
    const router = readFileSync(
      resolve(__dirname, "../../server/routes/tutor-turn-timing.ts"),
      "utf8",
    );
    expect(router).toMatch(
      /router\.post\("\/video-full-watch", postVideoFullWatch\);/,
    );
  });
});
