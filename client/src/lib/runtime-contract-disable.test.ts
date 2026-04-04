import { describe, expect, it } from "vitest";
import { getRuntimeContractDisabledCopy } from "./runtime-contract-disable";

describe("runtime-contract-disable copy standardization", () => {
  it("keeps one standardized disabled description across practice/full-length/review", () => {
    const practice = getRuntimeContractDisabledCopy("practice");
    const fullLength = getRuntimeContractDisabledCopy("full-length");
    const review = getRuntimeContractDisabledCopy("review");

    expect(practice.description).toBe(
      "This runtime surface is intentionally disabled by Lyceon Runtime Contract enforcement."
    );
    expect(fullLength.description).toBe(practice.description);
    expect(review.description).toBe(practice.description);
  });
});
