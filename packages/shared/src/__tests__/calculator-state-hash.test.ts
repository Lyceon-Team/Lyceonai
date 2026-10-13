/**
 * @spec [register G-NEW-14; owner brief 2026-10-12] | @implemented [2026-10-12]
 * plain English: the one calculator-state fingerprint ignores key order (jsonb reorders keys)
 * and tells different states apart.
 */
import { describe, expect, it } from "vitest";
import { calculatorStateHash } from "../calculator-state-hash";

describe("calculatorStateHash", () => {
  it("equal states hash equal whatever the key order, at every depth", () => {
    const a = {
      graphing: {
        version: 11,
        expressions: { list: [{ id: "1", latex: "y=x" }] },
      },
      scientific: null,
    };
    const b = {
      scientific: null,
      graphing: {
        expressions: { list: [{ latex: "y=x", id: "1" }] },
        version: 11,
      },
    };
    expect(calculatorStateHash(a)).toBe(calculatorStateHash(b));
  });

  it("different states hash differently", () => {
    expect(calculatorStateHash({ latex: "y=x" })).not.toBe(
      calculatorStateHash({ latex: "y=x^2" }),
    );
    expect(calculatorStateHash([1, 2])).not.toBe(calculatorStateHash([2, 1]));
    expect(calculatorStateHash(null)).not.toBe(calculatorStateHash({}));
  });

  it("null and undefined are the same empty state", () => {
    expect(calculatorStateHash(undefined)).toBe(calculatorStateHash(null));
  });
});
