/**
 * @spec [owner brief "Per-turn attribution: tokens, thinking, cache and prompt version" (Karl,
 *        2026-10-27) item 1, item 5 (privacy) and rulings 1–5; SCL-246; Doc 03C V3
 *        `orchestration_meta`; Doc 03D §8.1] | @implemented [2026-10-27]
 *
 * plain English: the worker side of per-turn attribution, through the REAL Vertex client and the
 * REAL `/turn` handler with only the Google SDK replaced.
 *  - Usage parsing: a Vertex `generateContent` response (fixture in the SDK's own
 *    GenerateContentResponse shape; this environment has no Vertex credentials to record a live
 *    one) gives prompt/candidates/thoughts/cached counts; no `usageMetadata` gives null, never 0.
 *  - Summing (owner ruling 2026-10-27): a failed attempt that threw (a 503) adds nothing; a
 *    billed response rejected as safety-blocked or truncated is counted, and its usage and prompt
 *    version travel on the 422 body.
 *  - The `turn_usage` log line carries numbers, the prompt version and the outcome code only:
 *    no prompt, student message or reply text (presence asserted first).
 */
import fs from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateContent = vi.hoisted(() => vi.fn());
vi.mock("@google/genai", async () => {
  const actual =
    await vi.importActual<typeof import("@google/genai")>("@google/genai");
  return {
    ...actual,
    GoogleGenAI: class {
      models = { generateContent };
    },
  };
});

import { ApiError, type GenerateContentResponse } from "@google/genai";
import {
  readUsageMetadata,
  THINKING_BUDGET,
} from "../../apps/workers/tutor-orchestrator/src/lib/vertex-client";
import { orchestrateRouter } from "../../apps/workers/tutor-orchestrator/src/routes/orchestrate";
import {
  orchestrateErrorResponseSchema,
  orchestrateResponseSchema,
} from "../../shared/tutor-orchestrator-wire";
import { CASE_36 } from "./lisa-golden-set-fixtures";

const FIXTURE = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../fixtures/vertex/generate-content-response.json",
    ),
    "utf8",
  ),
) as GenerateContentResponse;
const REPLY = "Which side of the equation would you undo first?";

/** The fixture as the SDK hands it back: `text` is a getter on the real class. */
function vertexResponse(
  overrides: Partial<GenerateContentResponse> = {},
): GenerateContentResponse {
  return { ...FIXTURE, text: REPLY, ...overrides } as GenerateContentResponse;
}

function app(): express.Express {
  const a = express();
  a.use(express.json());
  a.use("/orchestrate", orchestrateRouter);
  return a;
}

beforeEach(() => {
  generateContent.mockReset();
  process.env.VERTEX_PROJECT_ID = "test-project";
  process.env.VERTEX_LOCATION = "global";
});

describe("readUsageMetadata", () => {
  it("reads the fixture's counts", () => {
    expect(readUsageMetadata(FIXTURE.usageMetadata)).toEqual({
      input_tokens: 1843,
      output_tokens: 27,
      thinking_tokens: 612,
      cached_tokens: 1024,
    });
  });

  it("no usageMetadata is null for every count, never 0", () => {
    expect(readUsageMetadata(undefined)).toEqual({
      input_tokens: null,
      output_tokens: null,
      thinking_tokens: null,
      cached_tokens: null,
    });
  });

  it("a count the response omits is null; the others stand", () => {
    expect(
      readUsageMetadata({ promptTokenCount: 900, candidatesTokenCount: 12 }),
    ).toEqual({
      input_tokens: 900,
      output_tokens: 12,
      thinking_tokens: null,
      cached_tokens: null,
    });
  });
});

describe("/turn returns the turn's attribution", () => {
  it("a reply after a 503: the 503 adds nothing, the reply's usage, budget and prompt version are on the wire", async () => {
    generateContent
      .mockRejectedValueOnce(
        new ApiError({ message: "unavailable", status: 503 }),
      )
      .mockResolvedValueOnce(vertexResponse());
    const res = await request(app())
      .post("/orchestrate/turn")
      .send(CASE_36.request);
    expect(res.status).toBe(200);
    expect(generateContent).toHaveBeenCalledTimes(2);
    const meta = orchestrateResponseSchema.parse(res.body).orchestration_meta;
    expect(meta).toMatchObject({
      input_tokens: 1843,
      output_tokens: 27,
      thinking_tokens: 612,
      cached_tokens: 1024,
      thinking_budget: THINKING_BUDGET,
    });
    expect(THINKING_BUDGET).toBe(1024);
    expect(meta.prompt_version.length).toBeGreaterThan(0);
  });

  it("a safety-blocked response is billed: its usage and prompt version travel on the 422 body", async () => {
    generateContent.mockResolvedValueOnce(
      vertexResponse({
        candidates: [{ finishReason: "SAFETY" as never, index: 0 }],
        usageMetadata: { promptTokenCount: 1500, thoughtsTokenCount: 300 },
      }),
    );
    const res = await request(app())
      .post("/orchestrate/turn")
      .send(CASE_36.request);
    expect(res.status).toBe(422);
    const body = orchestrateErrorResponseSchema.parse(res.body);
    expect(body).toMatchObject({
      input_tokens: 1500,
      output_tokens: null,
      thinking_tokens: 300,
      cached_tokens: null,
      thinking_budget: 1024,
    });
    expect(body.prompt_version).toBeTruthy();
  });

  it("a truncated response is billed and counted the same way", async () => {
    generateContent.mockResolvedValueOnce(
      vertexResponse({
        candidates: [
          {
            finishReason: "MAX_TOKENS" as never,
            index: 0,
            content: { role: "model", parts: [{ text: "cut off mid" }] },
          },
        ],
        usageMetadata: {
          promptTokenCount: 1700,
          candidatesTokenCount: 40,
          thoughtsTokenCount: 1024,
        },
      }),
    );
    const res = await request(app())
      .post("/orchestrate/turn")
      .send(CASE_36.request);
    expect(res.status).toBe(422);
    expect(orchestrateErrorResponseSchema.parse(res.body)).toMatchObject({
      input_tokens: 1700,
      output_tokens: 40,
      thinking_tokens: 1024,
    });
  });

  it("no Vertex response at all (every attempt a 429): every count is null", async () => {
    generateContent.mockRejectedValue(
      new ApiError({ message: "quota", status: 429 }),
    );
    const res = await request(app())
      .post("/orchestrate/turn")
      .send(CASE_36.request);
    expect(res.status).toBe(503);
    expect(orchestrateErrorResponseSchema.parse(res.body)).toMatchObject({
      input_tokens: null,
      output_tokens: null,
      thinking_tokens: null,
      cached_tokens: null,
    });
  });
});

describe("turn_usage log line: numbers and a version only", () => {
  it("carries the counts and nothing from the prompt, the student or the reply", async () => {
    const lines: string[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((line: unknown) => {
        lines.push(String(line));
      });
    generateContent.mockResolvedValueOnce(vertexResponse());
    try {
      await request(app()).post("/orchestrate/turn").send(CASE_36.request);
    } finally {
      spy.mockRestore();
    }
    const usage = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((r) => r.event === "turn_usage");
    expect(usage).toHaveLength(1);
    const record = usage[0]!;
    // Presence: the line carries the turn's real numbers.
    expect(record.inputTokens).toBe(1843);
    expect(Object.keys(record).sort()).toEqual(
      [
        "cachedTokens",
        "component",
        "conversationId",
        "event",
        "inputTokens",
        "message",
        "outcome",
        "outputTokens",
        "promptVersion",
        "severity",
        "thinkingBudget",
        "thinkingTokens",
        "timestamp",
      ].sort(),
    );
    const serialised = JSON.stringify(record);
    const studentTexts = CASE_36.request.recent_messages.map((m) => m.message);
    expect(studentTexts.length).toBeGreaterThan(0);
    for (const text of [...studentTexts, REPLY]) {
      expect(serialised).not.toContain(text);
    }
  });
});
