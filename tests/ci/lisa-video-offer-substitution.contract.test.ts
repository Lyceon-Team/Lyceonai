/**
 * @spec [CC Brief "Video Library (ships now)", Karl 2026-10-15, §7; INV-03-04 (BFF anti-leak
 *       chokepoint)] | @implemented 2026-10-15
 *
 * plain English: a round trip — the real worker response builder through the real BFF client.
 * When the BFF's anti-leak scan replaces a reply's text, a video offer made by that text is
 * dropped with it; an untouched reply keeps its offer. (Spec-auditor finding, 2026-10-15:
 * the spread kept suggested_action through a substitution.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/services/tutor-config", () => ({
  TutorConfig: { get: vi.fn().mockReturnValue(30) },
}));

import { buildOrchestrateResponse } from "../../apps/workers/tutor-orchestrator/src/routes/orchestrate";
import { orchestrateTurn } from "../../server/lib/tutor-orchestrator-client";
import { orchestrateRequestSchema } from "../../shared/tutor-orchestrator-wire";
import { CASE_36 } from "./lisa-golden-set-fixtures";

const savedEnv = { ...process.env };
const request = orchestrateRequestSchema.parse({
  ...CASE_36.request,
  offered_videos: [
    {
      index: 1,
      title: "Slope of Line",
      channel_name: "Scalar Learning",
      duration_seconds: 23,
    },
  ],
});

function workerReplies(text: string): void {
  const body = buildOrchestrateResponse(
    { text, providerModel: "test-model" } as Parameters<
      typeof buildOrchestrateResponse
    >[0],
    request,
    "lisa-default-v3",
  );
  expect(body.response.suggested_action.type).toBe("recommend_video");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
}

beforeEach(() => {
  process.env = {
    ...savedEnv,
    TUTOR_ORCHESTRATOR_WORKER_URL: "http://localhost:9",
  };
});
afterEach(() => {
  process.env = { ...savedEnv };
  vi.unstubAllGlobals();
});

describe("a video offer and the BFF anti-leak substitution", () => {
  it("substituted text → the offer is dropped", async () => {
    workerReplies(
      "The correct answer is B. This video shows why.\n[OFFER_VIDEO 1]",
    );
    const res = await orchestrateTurn(request, true, "B");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.response.content).not.toContain("answer is B");
    expect(res.value.response.suggested_action).toEqual({
      type: "none",
      label: null,
    });
  });

  it("untouched text → the offer stands", async () => {
    workerReplies("This video walks through slope.\n[OFFER_VIDEO 1]");
    const res = await orchestrateTurn(request, true, "B");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.response.content).toBe("This video walks through slope.");
    expect(res.value.response.suggested_action).toMatchObject({
      type: "recommend_video",
      video_index: 1,
    });
  });
});
