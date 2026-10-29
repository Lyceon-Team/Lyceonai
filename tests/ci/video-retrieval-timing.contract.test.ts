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
 *
 * @spec [owner brief "Phase C: retrieval switch-over", Karl 2026-10-29 (build 2 and 3; the
 *       tests "an EE.5-tagged question gets a rational-expressions segment first, starting at
 *       its segment time", "an EE.2-tagged question gets an expand-and-multiply segment", "no
 *       approved matching segment returns nothing, and the miss is logged", "an untagged
 *       question returns exactly what it does today"); SCL-260/261] | @implemented [2026-10-29]
 *  - An untagged item: exactly today's RPC and arguments, the rows unchanged, path `skill`.
 *  - A tagged item: `video_segments_for_question` with the shared format priority; the row's
 *    start is the segment's; the line records path, matched sub-skills, shared clusters,
 *    segment id, miss. The rows are what the SQL returns for the production library's
 *    Desmos Lesson #10 (segments 159–257 and 257–398 are EE.5; 0–159 is EE.3); the ranking
 *    itself is proven in scripts/ci/video-segment-retrieval-gates.sql.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  rpcArgs: [] as unknown[],
  rpcNames: [] as string[],
  rows: [] as unknown[],
  segmentRows: [] as unknown[],
  subSkills: [] as Array<{ sub_skill_id: string }>,
}));
const logged = vi.hoisted(() => ({ info: [] as unknown[][] }));
const config = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => ({
      select: () => ({
        eq: () =>
          table === "question_sub_skills"
            ? Promise.resolve({ data: db.subSkills, error: null })
            : {
                maybeSingle: () =>
                  Promise.resolve({
                    data: { skill_codes: ["Equivalent Expressions"] },
                    error: null,
                  }),
              },
      }),
    }),
    rpc: (fn: string, args: unknown) => {
      db.rpcNames.push(fn);
      db.rpcArgs.push(args);
      return Promise.resolve({
        data: fn === "video_segments_for_question" ? db.segmentRows : db.rows,
        error: null,
      });
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
  retrievalTiming,
  retrieveOfferedVideos,
} from "../../server/services/tutor-video-library";
import { VIDEO_FORMAT_PRIORITY } from "../../packages/shared/src/video-methods";

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
      const retrieval = await timedStep("video_retrieval", () =>
        retrieveOfferedVideos("q-1", "review", "c-1", requested.method),
      );
      recordVideoRetrieval({
        method: requested.method,
        map_version: requested.mapVersion,
        ...retrievalTiming(retrieval),
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

// What video_segments_for_question returns (the shape of the SQL's rows).
const LESSON_10 = {
  video_id: "a1QNaRnn6cE",
  title: "Digital SAT Math - Desmos Lesson #10 Equivalent Expressions",
  channel_name: "Tutorllini Test Prep",
  duration_seconds: 398,
  methods: ["desmos"],
  format: "lesson",
};
const EE5_ROWS = [
  {
    ...LESSON_10,
    start_seconds: 159,
    segment_id: "5e9a0000-0000-4000-8000-000000000159",
    matched_sub_skills: ["EE.5"],
    shared_clusters: 2,
  },
];
const EE2_ROWS = [
  {
    video_id: "Expand00001",
    title: "Expanding and multiplying polynomials",
    channel_name: "c",
    duration_seconds: 240,
    start_seconds: 0,
    methods: ["algebraic"],
    format: "worked_example",
    segment_id: "5e9a0000-0000-4000-8000-000000000002",
    matched_sub_skills: ["EE.2"],
    shared_clusters: 1,
  },
];

beforeEach(() => {
  db.rpcArgs.length = 0;
  db.rpcNames.length = 0;
  db.rows = ROWS;
  db.segmentRows = [];
  db.subSkills = [];
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
      path: "skill",
      matched_sub_skill_ids: [],
      shared_clusters: null,
      segment_id: null,
      miss: false,
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

describe("Phase C: the switch point and the segment path", () => {
  it("an untagged item: today's function, today's arguments, today's rows (snapshot)", async () => {
    const retrieval = await retrieveOfferedVideos("q-1", "review", "c-1", null);
    expect(db.rpcNames).toEqual(["video_resources_for_skills"]);
    expect(db.rpcArgs).toEqual([
      { p_skill_codes: ["Equivalent Expressions"], p_limit: 3, p_method: null },
    ]);
    // Snapshot of today's output for these rows: unchanged, in order.
    expect(retrieval.videos).toEqual(ROWS);
    expect(retrieval).toMatchObject({ path: "skill", miss: false });
  });

  it("an EE.5-tagged item: the rational-expressions segment first, opening at 2:39", async () => {
    db.subSkills = [{ sub_skill_id: "EE.5" }];
    db.segmentRows = EE5_ROWS;
    const message = "can you explain this one";
    await request(app(message, 1)).post("/turn").send({});
    await new Promise((r) => setImmediate(r));
    expect(db.rpcNames).toEqual(["video_segments_for_question"]);
    expect(db.rpcArgs).toEqual([
      {
        p_question_id: "q-1",
        p_skill_codes: ["Equivalent Expressions"],
        p_limit: 3,
        p_method: null,
        p_method_required: false,
        p_format_priority: [...VIDEO_FORMAT_PRIORITY],
      },
    ]);
    expect(timingLine().video_retrieval).toEqual({
      method: null,
      map_version: 1,
      results: 1,
      video_ids: ["a1QNaRnn6cE"],
      recommended_index: 1,
      path: "segment",
      matched_sub_skill_ids: ["EE.5"],
      shared_clusters: 2,
      segment_id: "5e9a0000-0000-4000-8000-000000000159",
      miss: false,
    });
  });

  it("the served row is the library row with the segment's start; the segment fields stay server-side", async () => {
    db.subSkills = [{ sub_skill_id: "EE.5" }];
    db.segmentRows = EE5_ROWS;
    const r = await retrieveOfferedVideos("q-1", "review", "c-1", null);
    expect(r.videos).toEqual([{ ...LESSON_10, start_seconds: 159 }]);
    expect(Object.keys(r.videos[0]!).sort()).toEqual(
      [
        "channel_name",
        "duration_seconds",
        "format",
        "methods",
        "start_seconds",
        "title",
        "video_id",
      ].sort(),
    );
  });

  it("an EE.2-tagged item: the expand-and-multiply segment", async () => {
    db.subSkills = [{ sub_skill_id: "EE.2" }];
    db.segmentRows = EE2_ROWS;
    const r = await retrieveOfferedVideos("q-1", "review", "c-1", null);
    expect(r.videos.map((v) => [v.video_id, v.start_seconds])).toEqual([
      ["Expand00001", 0],
    ]);
    expect(r).toMatchObject({
      path: "segment",
      matchedSubSkillIds: ["EE.2"],
    });
  });

  it("a tagged item with no approved matching segment: nothing, no skill-only fallback, the miss logged as ids", async () => {
    db.subSkills = [{ sub_skill_id: "EE.9" }, { sub_skill_id: "EE.1" }];
    db.segmentRows = [];
    await request(app("show me on desmos", null)).post("/turn").send({});
    await new Promise((r) => setImmediate(r));
    expect(db.rpcNames).toEqual(["video_segments_for_question"]);
    const miss = logged.info.filter((a) => a[1] === "video_segment_miss");
    expect(miss).toHaveLength(1);
    expect(miss[0]![3]).toEqual({
      conversationId: "c-1",
      questionRowId: "q-1",
      subSkillIds: ["EE.1", "EE.9"],
      method: "desmos",
      methodRequired: false,
    });
    expect(timingLine().video_retrieval).toEqual({
      method: "desmos",
      map_version: 1,
      results: 0,
      video_ids: [],
      recommended_index: null,
      path: "segment",
      matched_sub_skill_ids: [],
      shared_clusters: null,
      segment_id: null,
      miss: true,
    });
  });

  it("the line keeps ids only: a value that is not a tag id or a UUID is dropped", async () => {
    const a = express();
    a.post(
      "/turn",
      timedRoute("tutor.message", async (_req, res) => {
        recordVideoRetrieval({
          method: null,
          map_version: null,
          results: 1,
          video_ids: ["a1QNaRnn6cE"],
          path: "segment",
          matched_sub_skill_ids: ["EE.5", "my answer is x+3 over 2"],
          shared_clusters: -1,
          segment_id: "not-a-uuid",
          miss: false,
        });
        res.json({ ok: true });
      }),
    );
    await request(a).post("/turn").send({});
    await new Promise((r) => setImmediate(r));
    expect(timingLine().video_retrieval).toMatchObject({
      matched_sub_skill_ids: ["EE.5"],
      shared_clusters: null,
      segment_id: null,
    });
  });
});
