import { describe, it, expect } from "vitest";
import { tokens, FIXTURES } from "./notation-tokens.js";

describe("notation-token extractor", () => {
  for (const fixture of FIXTURES) {
    describe(fixture.token, () => {
      for (const input of fixture.positive) {
        it(`detects in: ${input}`, () => {
          expect(tokens(input).has(fixture.token)).toBe(true);
        });
      }

      for (const input of fixture.negative) {
        it(`does not detect in: ${input}`, () => {
          expect(tokens(input).has(fixture.token)).toBe(false);
        });
      }
    });
  }
});
