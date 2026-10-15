/**
 * @spec [Doc-03D_V1.2 §6.3 — pre-submit state is derived server-side, never caller-supplied]
 *       | @implemented [2026-10-13]
 *
 * plain English: `RetrievalRequest` carries no caller-supplied pre-submit flag. A request that
 * sends one parses, but the flag is stripped, so nothing a caller sends can reach a gate
 * decision. Video RAG plan Step B.
 */
import { describe, expect, it } from "vitest";
import { retrievalRequestSchema } from "../../packages/shared/tutor-rag-types";

const VALID_REQUEST = {
  active_skill_codes: ["Linear Equations in One Variable"],
  active_question_canonical_id: null,
  student_id: "00000000-0000-4000-8000-000000000001",
  surface: "practice",
} as const;

describe("retrievalRequestSchema (Doc 03D §6.3)", () => {
  it("parses a well-formed request", () => {
    const parsed = retrievalRequestSchema.safeParse(VALID_REQUEST);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.active_skill_codes).toEqual([
      "Linear Equations in One Variable",
    ]);
  });

  it("declares no is_pre_submit field", () => {
    expect(Object.keys(retrievalRequestSchema.shape)).not.toContain(
      "is_pre_submit",
    );
  });

  it("strips a caller-supplied is_pre_submit", () => {
    const parsed = retrievalRequestSchema.safeParse({
      ...VALID_REQUEST,
      is_pre_submit: false,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && "is_pre_submit" in parsed.data).toBe(false);
  });
});
