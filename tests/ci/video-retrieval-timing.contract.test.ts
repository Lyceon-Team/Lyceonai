/**
 * @spec [owner brief "Video retrieval: method tags", Karl 2026-10-27 (build 3: "a
 *       `video_retrieval` timing sub-field recording the detected method and the result count;
 *       counts and codes only, never message text"; Step 0 ruling: the offered ids and the
 *       recommended index too, so the closing proof reads from route_timing)] | @implemented [2026-10-27]
 *
 * plain English: Step 13d inside a real timed request (timedRoute → the real step-timer), with
 * the real detection and the real retrieval against a mocked `video_resources_for_skills`.
 *  - "is there a Desmos video for this?" on an Equivalent Expressions item: the RPC is asked for
 *    method desmos; the route_timing line carries method, map version, result count, the
 *    offered ids in order and the index LISA recommended.
 *  - The line never carries the student's message, nor any word of it.
 *  - A message with no method: method null, the same RPC with p_method null.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  rpcArgs: [] as unknown[],
  rows: [] as unknown[],
}));
const logged = vi.hoisted(() => ({ info: [] as unknown[][] }));
const config = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: { skill_codes: ["Equivalent Expressions"] },
              error: null,
            }),
        }),
      }),
    }),
    rpc: (_fn: string, args: unknown) => {
      db.rpcArgs.push(args);
      return Promise.resolve({ data: db.rows, error: null });
    },
  },
}));
vi.mock("../../server/logger", () => ({
  logger: {
    info: vi.fn((...args: unknown[]) => logged.info.push(args)),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock("../../server/services/tutor-config", () => ({
  TutorConfig: { get: vi.fn(() => config.value) },
}));

import {
  recordVideoRecommendation,
  recordVideoRetrieval,
  timedRoute,
  timedStep,
  type RouteTimingLine,
} from "../../server/lib/step-timer";
import {
  requestedVideoMethod,
  retrieveOfferedVideos,
} from "../../server/services/tutor-video-library";

const MAP = {
  version: 1,
  methods: {
    desmos: ["desmos", "calculator"],
    algebraic: ["by hand", "without desmos"],
    backsolve: ["plug in"],
  },
};
const ROWS = [
  {
    video_id: "a1QNaRnn6cE",
    title: "Digital SAT Math - Desmos Lesson #10 Equivalent Expressions",
    channel_name: "Tutorllini Test Prep",
    duration_seconds: 398,
    start_seconds: null,
    methods: ["desmos"],
    format: "lesson",
  },
  {
    video_id: "jCT0jTVzKy0",
    title: "The only SAT Math Desmos Guide you'll ever need",
    channel_name: "c",
    duration_seconds: 2018,
    start_seconds: 751,
    methods: ["desmos"],
    format: "lesson",
  },
];

/** The 13d sequence the route runs (tutor-runtime.ts Step 13d and the Step 19 action). */
function app(message: string, recommended: number | null): express.Express {
  const a = express();
  a.post(
    "/turn",
    timedRoute("tutor.message", async (_req, res) => {
      const requested = requestedVideoMethod(message);
      const offered = await timedStep("video_retrieval", () =>
        retrieveOfferedVideos("q-1", "review", "c-1", requested.method),
      );
      recordVideoRetrieval({
        method: requested.method,
        map_version: requested.mapVersion,
        results: offered.length,
        video_ids: offered.map((v) => v.video_id),
      });
      recordVideoRecommendation(recommended);
      res.json({ ok: true });
    }),
  );
  return a;
}

function timingLine(): RouteTimingLine {
  const lines = logged.info.filter(
    (args) => args[0] === "PERF" && args[1] === "route_timing",
  );
  expect(lines).toHaveLength(1);
  return lines[0]![3] as RouteTimingLine;
}

beforeEach(() => {
  db.rpcArgs.length = 0;
  db.rows = ROWS;
  logged.info.length = 0;
  config.value = MAP;
});

describe("video_retrieval on the route_timing line", () => {
  it("a Desmos request: method, version, count, the offered ids and the recommendation", async () => {
    const message =
      "is there a Desmos video for this? my teacher Ms Rivera said so";
    await request(app(message, 1)).post("/turn").send({});
    await new Promise((r) => setImmediate(r));
    expect(db.rpcArgs).toEqual([
      {
        p_skill_codes: ["Equivalent Expressions"],
        p_limit: 3,
        p_method: "desmos",
      },
    ]);
    const line = timingLine();
    expect(line.video_retrieval).toEqual({
      method: "desmos",
      map_version: 1,
      results: 2,
      video_ids: ["a1QNaRnn6cE", "jCT0jTVzKy0"],
      recommended_index: 1,
    });
    expect(line.steps.map((s) => s.step)).toContain("video_retrieval");
    // Never the message, nor any word of it.
    const serialised = JSON.stringify(line);
    for (const word of ["teacher", "Rivera", "Desmos video", "is there"]) {
      expect(serialised).not.toContain(word);
    }
  });

  it("no method in the message: method null, p_method null, no recommendation", async () => {
    await request(app("can you explain this one", null)).post("/turn").send({});
    await new Promise((r) => setImmediate(r));
    expect(db.rpcArgs).toEqual([
      { p_skill_codes: ["Equivalent Expressions"], p_limit: 3, p_method: null },
    ]);
    expect(timingLine().video_retrieval).toMatchObject({
      method: null,
      results: 2,
      recommended_index: null,
    });
  });

  it("an out-of-range recommendation is recorded as none", async () => {
    await request(app("show me on desmos", 7)).post("/turn").send({});
    await new Promise((r) => setImmediate(r));
    expect(timingLine().video_retrieval?.recommended_index).toBeNull();
  });
});
