/**
 * @spec [CC Brief "Video Library (ships now)", Karl 2026-10-15, §6 (Step 13d, fails open),
 *       §7 (the model offers by index; the BFF attaches the video; the serializer redacts any
 *       YouTube link not in the turn's set), §11 proofs 5 and 6] | @implemented [2026-10-15]
 *
 * plain English: the video library's turn path, end to end through the real functions.
 *  - Proof 6 (no video identifier in the model's raw output): the model is never given one.
 *    Real library rows → `toWireVideos` → the request the worker builds its prompt from; the
 *    system instruction and messages carry the titles (presence) and none of the ids
 *    (absence). The wire refuses an offered video that carries an id. The worker's response
 *    for an offer carries an index only, and the serializer removes any YouTube link outside
 *    the turn's set — so even an id the model recalled from training cannot reach a student.
 *  - The worker turns `[OFFER_VIDEO n]` into `recommend_video` + index and always strips the
 *    marker; the BFF resolves the index to the offered video, or to no action.
 *  - Proof 5 at the BFF: no item, no skills, or a failing lookup → no videos, no error.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  question: { data: null as unknown, error: null as unknown },
  rpc: { data: null as unknown, error: null as unknown },
  calls: [] as string[],
}));

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      db.calls.push(`from:${table}`);
      return {
        insert: () => Promise.resolve({ error: null }),
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve(db.question),
            single: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      };
    },
    rpc: (fn: string, args: unknown) => {
      db.calls.push(`rpc:${fn}:${JSON.stringify(args)}`);
      return Promise.resolve(db.rpc);
    },
  },
}));

vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  buildConversationMessages,
  buildOrchestrateResponse,
  buildSystemInstruction,
} from "../../apps/workers/tutor-orchestrator/src/routes/orchestrate";
import {
  VIDEO_OFFER_LABEL,
  extractVideoOffer,
} from "../../apps/workers/tutor-orchestrator/src/prompts/lisa-default-v3";
import { PRACTICE_HANDOFF_MARKER } from "../../apps/workers/tutor-orchestrator/src/prompts/lisa-default-v2";
import { renderVideoBlock } from "../../apps/workers/tutor-orchestrator/src/prompts/render-state-blocks";
import {
  orchestrateRequestSchema,
  orchestrateResponseSchema,
  type OrchestrateRequest,
} from "../../shared/tutor-orchestrator-wire";
import {
  type LibraryVideo,
  resolveVideoAction,
  retrieveOfferedVideos,
  toWireVideos,
} from "../../server/services/tutor-video-library";
import {
  redactUnlistedYoutubeLinks,
  serializeTutorOutput,
} from "../../server/services/tutor-output-serializer";
import { logger } from "../../server/logger";
import { CASE_35, CASE_36 } from "./lisa-golden-set-fixtures";

type VertexResponse = Parameters<typeof buildOrchestrateResponse>[0];
function vertex(text: string): VertexResponse {
  return { text, providerModel: "test-model" } as VertexResponse;
}

// Shaped as video_resources_for_skills returns them: ids, titles and lengths from the reviewed
// library (video-tags-review.csv); the second start is a test value.
const LIBRARY: LibraryVideo[] = [
  {
    video_id: "Al-6NAp5O8I",
    title: "Slope of Line (SAT Math Formula 1/23)",
    channel_name: "Scalar Learning",
    duration_seconds: 23,
    start_seconds: null,
  },
  {
    video_id: "f9DxgfyvRKg",
    title: "Point Slope Form (SAT Math Formula 3/23)",
    channel_name: "Scalar Learning",
    duration_seconds: 26,
    start_seconds: 5,
  },
];

function withVideos(
  request: OrchestrateRequest,
  videos: readonly LibraryVideo[],
): OrchestrateRequest {
  return orchestrateRequestSchema.parse({
    ...request,
    offered_videos: toWireVideos(videos),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.question = { data: null, error: null };
  db.rpc = { data: null, error: null };
  db.calls.length = 0;
});

describe("proof 6 — the model is never given a video identifier", () => {
  const request = withVideos(CASE_35.request, LIBRARY);

  it("the prompt names the offered videos by title, and carries none of their ids", () => {
    const system = buildSystemInstruction(request);
    const messages = JSON.stringify(buildConversationMessages(request));
    // Presence first: the videos are really in the prompt.
    expect(system).toContain("[VIDEOS]");
    for (const v of LIBRARY) expect(system).toContain(v.title);
    // Absence: no id, no address, anywhere the model reads.
    for (const v of LIBRARY) {
      expect(system).not.toContain(v.video_id);
      expect(messages).not.toContain(v.video_id);
      expect(JSON.stringify(request)).not.toContain(v.video_id);
    }
    expect(system).not.toMatch(/youtu/i);
  });

  it("the wire refuses an offered video that carries an id", () => {
    const parsed = orchestrateRequestSchema.safeParse({
      ...CASE_35.request,
      offered_videos: [
        { ...toWireVideos(LIBRARY)[0], video_id: "Al-6NAp5O8I" },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("an offer comes back as an index; the marker and any id are gone", () => {
    const res = buildOrchestrateResponse(
      vertex(
        `"Point Slope Form" walks through exactly this setup.\n[OFFER_VIDEO 2]`,
      ),
      request,
      "lisa-default-v3",
    );
    expect(res.response.suggested_action).toEqual({
      type: "recommend_video",
      label: VIDEO_OFFER_LABEL,
      video_index: 2,
    });
    expect(res.response.content).toBe(
      `"Point Slope Form" walks through exactly this setup.`,
    );
    const wire = JSON.stringify(res);
    expect(wire).not.toMatch(/OFFER_VIDEO/);
    for (const v of LIBRARY) expect(wire).not.toContain(v.video_id);
    expect(orchestrateResponseSchema.safeParse(res).success).toBe(true);
  });

  it("a link the model writes anyway — to a video not offered — is removed before the student", async () => {
    const out = await serializeTutorOutput(
      "Try this one: https://www.youtube.com/watch?v=ZZZZZZZZZZZ&t=40s — it helps.",
      {
        conversationId: "00000000-0000-0000-0000-000000000001",
        studentId: "00000000-0000-0000-0000-000000000002",
        isPreSubmit: false,
        correctAnswer: null,
        correctAnswerResolutionFailed: false,
        questionCanonicalId: null,
        allowedVideoIds: LIBRARY.map((v) => v.video_id),
      },
    );
    expect(out.blocked).toBe(false);
    expect(out.scanResults.youtubeLinkRedacted).toBe(true);
    expect(out.content).not.toContain("ZZZZZZZZZZZ");
    expect(out.content).not.toMatch(/youtu/i);
    expect(out.content).toContain("it helps.");
  });
});

describe("the worker's video marker", () => {
  it("an index outside the offered list is no action, and is still stripped", () => {
    const res = buildOrchestrateResponse(
      vertex("Here is a video.\n[OFFER_VIDEO 3]"),
      withVideos(CASE_35.request, LIBRARY),
      "lisa-default-v3",
    );
    expect(res.response.suggested_action).toEqual({
      type: "none",
      label: null,
    });
    expect(res.response.content).toBe("Here is a video.");
  });

  it("a turn with no offered videos never yields recommend_video", () => {
    const res = buildOrchestrateResponse(
      vertex("Here is a video.\n[OFFER_VIDEO 1]"),
      CASE_35.request,
      "lisa-default-v3",
    );
    expect(res.response.suggested_action.type).toBe("none");
    expect(res.response.content).toBe("Here is a video.");
  });

  it("a video offer takes precedence over a practice offer; both markers are stripped", () => {
    const res = buildOrchestrateResponse(
      vertex(`Watch this first.\n${PRACTICE_HANDOFF_MARKER}\n[OFFER_VIDEO 1]`),
      withVideos(CASE_36.request, LIBRARY),
      "lisa-default-v3",
    );
    expect(res.response.suggested_action.type).toBe("recommend_video");
    expect(res.response.content).toBe("Watch this first.");
  });

  it("marker variants are all stripped; the first one's number counts", () => {
    for (const marker of [
      "[OFFER_VIDEO 1]",
      "[ offer_video 1 ]",
      "[OFFER_VIDEO]",
    ]) {
      expect(extractVideoOffer(`Sure.\n\n${marker}\n`, 2).content).toBe(
        "Sure.",
      );
    }
    expect(extractVideoOffer("[OFFER_VIDEO 2] [OFFER_VIDEO 1]", 2).index).toBe(
      2,
    );
    expect(extractVideoOffer("[OFFER_VIDEO]", 2).index).toBeNull();
    expect(extractVideoOffer("no marker", 2)).toEqual({
      content: "no marker",
      index: null,
    });
  });

  it("no offered videos → no [VIDEOS] block", () => {
    expect(renderVideoBlock(CASE_35.request)).toBeNull();
  });
});

describe("the BFF resolves the index", () => {
  it("recommend_video + a valid index → the offered video, with its start", () => {
    expect(
      resolveVideoAction(
        { type: "recommend_video", label: "Watch", video_index: 2 },
        LIBRARY,
        false,
      ),
    ).toEqual({ type: "recommend_video", label: "Watch", video: LIBRARY[1] });
  });

  it("an index naming no offered video, or none at all → no action", () => {
    expect(
      resolveVideoAction(
        { type: "recommend_video", label: "Watch", video_index: 3 },
        LIBRARY,
        false,
      ),
    ).toEqual({ type: "none", label: null });
    expect(
      resolveVideoAction(
        { type: "recommend_video", label: "Watch" },
        LIBRARY,
        false,
      ),
    ).toEqual({ type: "none", label: null });
  });

  it("a substituted reply loses its video offer", () => {
    expect(
      resolveVideoAction(
        { type: "recommend_video", label: "Watch", video_index: 1 },
        LIBRARY,
        true,
      ),
    ).toEqual({ type: "none", label: null });
  });

  it("other actions pass through unchanged", () => {
    expect(
      resolveVideoAction(
        { type: "start_practice", label: "Go" },
        LIBRARY,
        true,
      ),
    ).toEqual({ type: "start_practice", label: "Go" });
  });
});

describe("Step 13d retrieval — proof 5 and fail open", () => {
  it("returns the library's rows for the item's skills, asking for at most 3", async () => {
    db.question = { data: { skill_codes: ["Linear Functions"] }, error: null };
    db.rpc = { data: LIBRARY, error: null };
    expect(await retrieveOfferedVideos("q-1", "review", "c-1")).toEqual(
      LIBRARY,
    );
    expect(db.calls).toContain(
      `rpc:video_resources_for_skills:${JSON.stringify({ p_skill_codes: ["Linear Functions"], p_limit: 3 })}`,
    );
  });

  it("a skill with no video → no videos, no error (proof 5)", async () => {
    db.question = { data: { skill_codes: ["Boundaries"] }, error: null };
    db.rpc = { data: [], error: null };
    expect(await retrieveOfferedVideos("q-1", "review", "c-1")).toEqual([]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("no item (general mode) → no lookup at all", async () => {
    expect(await retrieveOfferedVideos(null, "dashboard", "c-1")).toEqual([]);
    expect(db.calls).toEqual([]);
  });

  it("practice (not a named surface) → no lookup at all", async () => {
    db.question = { data: { skill_codes: ["Circles"] }, error: null };
    db.rpc = { data: LIBRARY, error: null };
    expect(await retrieveOfferedVideos("q-1", "practice", "c-1")).toEqual([]);
    expect(db.calls).toEqual([]);
    expect(await retrieveOfferedVideos("q-1", "test_review", "c-1")).toEqual(
      LIBRARY,
    );
  });

  it("an item with no skills → no retrieval call", async () => {
    db.question = { data: { skill_codes: [] }, error: null };
    expect(await retrieveOfferedVideos("q-1", "review", "c-1")).toEqual([]);
    expect(db.calls.some((c) => c.startsWith("rpc:"))).toBe(false);
  });

  it("a failing query → no videos, logged at ERROR, never thrown", async () => {
    db.question = { data: { skill_codes: ["Circles"] }, error: null };
    db.rpc = { data: null, error: new Error("function does not exist") };
    expect(await retrieveOfferedVideos("q-1", "review", "c-1")).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      "TUTOR_RUNTIME",
      "video_library_retrieval_failed",
      expect.any(String),
      expect.any(Error),
      { conversationId: "c-1" },
    );
  });

  it("a malformed row (an id that is not a YouTube id) → no videos", async () => {
    db.question = { data: { skill_codes: ["Circles"] }, error: null };
    db.rpc = {
      data: [{ ...LIBRARY[0], video_id: "javascript:alert(1)" }],
      error: null,
    };
    expect(await retrieveOfferedVideos("q-1", "review", "c-1")).toEqual([]);
  });
});

describe("redactUnlistedYoutubeLinks", () => {
  const ID = "Al-6NAp5O8I";
  it("removes every YouTube link form outside the allowed set", () => {
    for (const link of [
      "https://www.youtube.com/watch?v=AAAAAAAAAAA",
      "https://youtube.com/watch?feature=share&v=AAAAAAAAAAA&t=3",
      "youtu.be/AAAAAAAAAAA?t=10",
      "https://m.youtube.com/shorts/AAAAAAAAAAA",
      "https://www.youtube-nocookie.com/embed/AAAAAAAAAAA?start=4",
      "www.youtube.com/live/AAAAAAAAAAA",
    ]) {
      expect(redactUnlistedYoutubeLinks(`see ${link} now`, [ID])).toBe(
        "see  now",
      );
    }
  });

  it("keeps a link to an offered video, and text with no link", () => {
    const text = `see https://youtu.be/${ID} now`;
    expect(redactUnlistedYoutubeLinks(text, [ID])).toBe(text);
    expect(redactUnlistedYoutubeLinks("no links here", [])).toBe(
      "no links here",
    );
  });
});
