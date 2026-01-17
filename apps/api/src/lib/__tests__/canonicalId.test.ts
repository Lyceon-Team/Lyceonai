import { describe, it, expect } from "vitest";
import { 
  generateUniqueToken, 
  generateCanonicalId, 
  isValidCanonicalId, 
  parseCanonicalId,
  mapSectionToCode 
} from "../canonicalId";

describe("canonicalId", () => {
  describe("generateUniqueToken", () => {
    it("generates a 6-character token by default", () => {
      const token = generateUniqueToken();
      expect(token).toHaveLength(6);
    });

    it("generates uppercase alphanumeric only", () => {
      const token = generateUniqueToken();
      expect(token).toMatch(/^[A-Z0-9]+$/);
    });

    it("generates different tokens each time", () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tokens.add(generateUniqueToken());
      }
      expect(tokens.size).toBeGreaterThan(90);
    });
  });

  describe("generateCanonicalId", () => {
    it("generates valid format: {TEST}{SECTION}{SOURCE}{UNIQUE}", () => {
      const id = generateCanonicalId("SAT", "M", "1");
      expect(id).toMatch(/^SATM1[A-Z0-9]{6}$/);
    });

    it("works with different test codes", () => {
      expect(generateCanonicalId("ACT", "S", "2")).toMatch(/^ACTS2[A-Z0-9]{6}$/);
      expect(generateCanonicalId("MCAT", "R", "1")).toMatch(/^MCATR1[A-Z0-9]{6}$/);
    });

    it("generates unique IDs", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateCanonicalId("SAT", "M", "2"));
      }
      expect(ids.size).toBeGreaterThan(90);
    });
  });

  describe("isValidCanonicalId", () => {
    it("validates correct SAT IDs", () => {
      expect(isValidCanonicalId("SATM1ABC123")).toBe(true);
      expect(isValidCanonicalId("SATR2XYZ789")).toBe(true);
      expect(isValidCanonicalId("SATW1QWERTY")).toBe(true);
    });

    it("validates correct ACT IDs", () => {
      expect(isValidCanonicalId("ACTS1ABCD12")).toBe(true);
    });

    it("validates correct MCAT/LSAT IDs", () => {
      expect(isValidCanonicalId("MCATM1ABCD12")).toBe(true);
      expect(isValidCanonicalId("LSATR2ZYXWVU")).toBe(true);
    });

    it("rejects invalid formats", () => {
      expect(isValidCanonicalId("sat-m-1-abc123")).toBe(false);
      expect(isValidCanonicalId("syn_rw_v1_001")).toBe(false);
      expect(isValidCanonicalId("v4:uuid-here")).toBe(false);
      expect(isValidCanonicalId("")).toBe(false);
      expect(isValidCanonicalId("SAT")).toBe(false);
      expect(isValidCanonicalId("SATM1AB")).toBe(false);
    });

    it("rejects lowercase", () => {
      expect(isValidCanonicalId("satm1abc123")).toBe(false);
    });
  });

  describe("parseCanonicalId", () => {
    it("parses valid SAT IDs", () => {
      const parsed = parseCanonicalId("SATM1ABC123");
      expect(parsed).toEqual({
        test: "SAT",
        section: "M",
        source: "1",
        unique: "ABC123",
      });
    });

    it("parses longer test codes", () => {
      const parsed = parseCanonicalId("MCATR2XYZ789");
      expect(parsed).toEqual({
        test: "MCAT",
        section: "R",
        source: "2",
        unique: "XYZ789",
      });
    });

    it("returns null for invalid IDs", () => {
      expect(parseCanonicalId("invalid")).toBeNull();
      expect(parseCanonicalId("syn_rw_v1_001")).toBeNull();
    });
  });

  describe("mapSectionToCode", () => {
    it("maps math to M", () => {
      expect(mapSectionToCode("math")).toBe("M");
      expect(mapSectionToCode("Math")).toBe("M");
      expect(mapSectionToCode("MATH")).toBe("M");
    });

    it("maps reading to R", () => {
      expect(mapSectionToCode("reading")).toBe("R");
      expect(mapSectionToCode("Reading")).toBe("R");
    });

    it("maps writing to W", () => {
      expect(mapSectionToCode("writing")).toBe("W");
      expect(mapSectionToCode("Writing")).toBe("W");
    });

    it("maps science to S", () => {
      expect(mapSectionToCode("science")).toBe("S");
    });

    it("defaults to R for unknown", () => {
      expect(mapSectionToCode("unknown")).toBe("R");
      expect(mapSectionToCode("")).toBe("R");
    });
  });
});
