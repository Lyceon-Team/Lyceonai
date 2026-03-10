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
    it("generates SAT-M format", () => {
      const id = generateCanonicalId("SAT", "M", "1");
      expect(id).toMatch(/^SATM1[A-Z0-9]{6}$/);
    });

    it("generates SAT-RW format", () => {
      const id = generateCanonicalId("SAT", "RW", "2");
      expect(id).toMatch(/^SATRW2[A-Z0-9]{6}$/);
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
    it("validates SAT canonical IDs", () => {
      expect(isValidCanonicalId("SATM1ABC123")).toBe(true);
      expect(isValidCanonicalId("SATRW2XYZ789")).toBe(true);
    });

    it("rejects invalid formats", () => {
      expect(isValidCanonicalId("sat-m-1-abc123")).toBe(false);
      expect(isValidCanonicalId("SATW1ABC123")).toBe(false);
      expect(isValidCanonicalId("SATR2ABC123")).toBe(false);
      expect(isValidCanonicalId("ACTM1ABCD12")).toBe(false);
      expect(isValidCanonicalId("")).toBe(false);
      expect(isValidCanonicalId("SAT")).toBe(false);
      expect(isValidCanonicalId("SATM1AB")).toBe(false);
    });
  });

  describe("parseCanonicalId", () => {
    it("parses SAT-M IDs", () => {
      const parsed = parseCanonicalId("SATM1ABC123");
      expect(parsed).toEqual({
        test: "SAT",
        section: "M",
        source: "1",
        unique: "ABC123",
      });
    });

    it("parses SAT-RW IDs", () => {
      const parsed = parseCanonicalId("SATRW2XYZ789");
      expect(parsed).toEqual({
        test: "SAT",
        section: "RW",
        source: "2",
        unique: "XYZ789",
      });
    });

    it("returns null for invalid IDs", () => {
      expect(parseCanonicalId("invalid")).toBeNull();
      expect(parseCanonicalId("SATR2ABC123")).toBeNull();
    });
  });

  describe("mapSectionToCode", () => {
    it("maps math to M", () => {
      expect(mapSectionToCode("math")).toBe("M");
      expect(mapSectionToCode("Math")).toBe("M");
    });

    it("maps reading/writing variants to RW", () => {
      expect(mapSectionToCode("rw")).toBe("RW");
      expect(mapSectionToCode("reading")).toBe("RW");
      expect(mapSectionToCode("writing")).toBe("RW");
      expect(mapSectionToCode("reading_writing")).toBe("RW");
    });

    it("defaults unknown to RW", () => {
      expect(mapSectionToCode("unknown")).toBe("RW");
      expect(mapSectionToCode("")).toBe("RW");
    });
  });
});
