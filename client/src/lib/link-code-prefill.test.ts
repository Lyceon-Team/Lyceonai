import { describe, expect, it } from "vitest";
import { linkCodeFromSearch } from "./link-code-prefill";

/**
 * @spec [SCL-080; owner brief 2026-09-15 Part B1] | @implemented [2026-09-15]
 * The deep link's `?code=` prefill: normalised like manual entry, empty when absent, bounded.
 */
describe("linkCodeFromSearch", () => {
  it("reads and normalises the code (trim, inner whitespace, upper-case)", () => {
    expect(linkCodeFromSearch("?code=abc234")).toBe("ABC234");
    expect(linkCodeFromSearch("?code=%20ab%20c2%2034%20")).toBe("ABC234");
    expect(linkCodeFromSearch("?x=1&code=ABC234&y=2")).toBe("ABC234");
  });

  it("is empty when the parameter is absent or blank", () => {
    expect(linkCodeFromSearch("")).toBe("");
    expect(linkCodeFromSearch("?other=1")).toBe("");
    expect(linkCodeFromSearch("?code=")).toBe("");
  });

  it("is bounded so a hostile query string cannot stuff the input", () => {
    expect(linkCodeFromSearch(`?code=${"a".repeat(500)}`)).toHaveLength(12);
  });
});
