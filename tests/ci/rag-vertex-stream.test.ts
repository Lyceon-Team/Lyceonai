/**
 * @spec [LISA_Video_RAG_Plan.md Step D §D.2 (Gemini over REST)] | @implemented [2026-10-23]
 *
 * plain English: foldSse in scripts/rag/vertex.ts turns a streamGenerateContent (alt=sse) body
 * back into the one-response shape generateJson parses. The fixture is a real Vertex stream
 * (gemini-3.5-flash, captured 2026-10-23): six events, the JSON text split across five, the
 * finishReason and full usage only on the last; the earlier events carry a usageMetadata of
 * {trafficType} alone, which must not win.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { foldSse } from "../../scripts/rag/vertex";

const BODY = readFileSync(
  resolve(__dirname, "fixtures/vertex-stream-generate.sse"),
  "utf8",
);

describe("foldSse", () => {
  it("joins the text of every event, in order, into one JSON answer", () => {
    expect(BODY.split("\n").filter((l) => l.startsWith("data:")).length).toBe(6);
    const folded = foldSse(BODY) as {
      candidates: { content: { parts: { text: string }[] }; finishReason?: string }[];
    };
    expect(folded.candidates).toHaveLength(1);
    const answer = JSON.parse(folded.candidates[0]?.content.parts[0]?.text ?? "") as {
      colors: string[];
    };
    expect(answer.colors.length).toBeGreaterThan(20);
    expect(answer.colors[0]).toBe("Red");
    expect(folded.candidates[0]?.finishReason).toBe("STOP");
  });

  it("keeps the final event's usage, not an earlier partial one", () => {
    const folded = foldSse(BODY) as { usageMetadata?: Record<string, unknown> };
    expect(folded.usageMetadata?.promptTokenCount).toBe(69);
    expect(folded.usageMetadata?.candidatesTokenCount).toBe(95);
    expect(folded.usageMetadata?.thoughtsTokenCount).toBe(317);
  });

  it("throws on a body with no events, so a non-SSE 200 is retried", () => {
    expect(() => foldSse("upstream request failed")).toThrow(/no SSE events/);
  });

  it("throws on an event cut off mid-JSON", () => {
    const cut = BODY.slice(0, BODY.indexOf("data:", 10) + 40);
    expect(() => foldSse(cut)).toThrow();
  });

  it("gives no candidate when the stream carried no text and no finish", () => {
    expect(foldSse('data: {"usageMetadata": {"trafficType": "ON_DEMAND"}}\n')).toEqual({
      candidates: [],
      usageMetadata: { trafficType: "ON_DEMAND" },
    });
  });
});
