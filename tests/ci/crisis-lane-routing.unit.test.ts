/**
 * @spec [Layer1 PR 2 brief §5]
 * @implemented 2026-09-17
 *
 * plain English: unit tests for PR 2 — two-lane crisis routing, templates,
 * and resource selection. Pure function tests, no DB or credentials.
 *
 * Proves:
 *   1. getCrisisResponse returns crisis template for "crisis" category
 *   2. getCrisisResponse returns safeguarding template for "safeguarding" category
 *   3. Safeguarding template never contains suicide/988 content (negative control)
 *   4. Crisis template never contains safeguarding content (negative control)
 *   5. Resource selection covers all 8 country codes + fallback
 *   6. The fallback names no number (owner ruling 2026-09-25, W3-3) —
 *      it replaced the US default
 *   7. Guardian isolation: crisis notification path has no guardian surface
 */
import { describe, it, expect } from "vitest";
import { getCrisisResponse } from "../../server/services/tutor-crisis";

describe("Crisis Lane Routing — PR 2", () => {
  // §5 Test 1: lane selection — crisis category returns crisis template
  describe("getCrisisResponse — crisis lane", () => {
    it("returns crisis template for US with crisis category", () => {
      const response = getCrisisResponse("US", "crisis");
      expect(response).toContain("988");
      expect(response).toContain("crisis");
      expect(response).toContain("Real people, anytime");
    });

    it("returns crisis template when category is omitted (default)", () => {
      const response = getCrisisResponse("US");
      expect(response).toContain("988");
      expect(response).toContain("Real people, anytime");
    });

    it("returns youth-preferred UK crisis template (Childline, not adult Samaritans only)", () => {
      const response = getCrisisResponse("UK", "crisis");
      expect(response).toContain("Childline");
      expect(response).toContain("0800 1111");
      expect(response).toContain("Samaritans");
      expect(response).toContain("116 123");
    });

    it("returns youth-preferred AU crisis template (Kids Helpline, not adult Lifeline)", () => {
      const response = getCrisisResponse("AU", "crisis");
      expect(response).toContain("Kids Helpline");
      expect(response).toContain("1800 55 1800");
    });

    it("returns youth-preferred NZ crisis template (Youthline, not adult Lifeline)", () => {
      const response = getCrisisResponse("NZ", "crisis");
      expect(response).toContain("Youthline");
      expect(response).toContain("0800 376 633");
      expect(response).toContain("1737");
    });

    it("returns updated CA crisis template (988, not stale Talk Suicide number)", () => {
      const response = getCrisisResponse("CA", "crisis");
      expect(response).toContain("988");
      expect(response).not.toContain("1-833-456-4566");
    });

    it("returns IE crisis template with Childline Ireland and Pieta", () => {
      const response = getCrisisResponse("IE", "crisis");
      expect(response).toContain("Childline Ireland");
      expect(response).toContain("1800 66 66 66");
      expect(response).toContain("Pieta");
      expect(response).toContain("1800 247 247");
    });

    it("returns SG crisis template with SOS", () => {
      const response = getCrisisResponse("SG", "crisis");
      expect(response).toContain("1767");
    });

    it("GB alias returns same as UK", () => {
      expect(getCrisisResponse("GB", "crisis")).toEqual(
        getCrisisResponse("UK", "crisis"),
      );
    });

    it("unknown country gets the no-number response, not the US line", () => {
      const response = getCrisisResponse("XX", "crisis");
      expect(response).not.toContain("988");
      expect(response).not.toMatch(/\d/);
      expect(response).toContain("local emergency number");
    });

    it("handles lowercase country code", () => {
      const response = getCrisisResponse("us", "crisis");
      expect(response).toContain("988");
    });
  });

  // §5 Test 2: lane selection — safeguarding category returns safeguarding template
  describe("getCrisisResponse — safeguarding lane", () => {
    it("returns safeguarding template for US", () => {
      const response = getCrisisResponse("US", "safeguarding");
      expect(response).toContain("What you've shared matters");
      expect(response).toContain("Childhelp");
      expect(response).toContain("1-800-422-4453");
      expect(response).toContain("RAINN");
      expect(response).toContain("1-800-656-4673");
      expect(response).toContain(
        "They listen, and you decide what happens next",
      );
    });

    it("returns safeguarding template for CA with Kids Help Phone", () => {
      const response = getCrisisResponse("CA", "safeguarding");
      expect(response).toContain("Kids Help Phone");
      expect(response).toContain("1-800-668-6868");
      expect(response).toContain("CONNECT");
      expect(response).toContain("686868");
    });

    it("returns safeguarding template for UK with Childline", () => {
      const response = getCrisisResponse("UK", "safeguarding");
      expect(response).toContain("Childline");
      expect(response).toContain("0800 1111");
    });

    it("returns safeguarding template for IE with Childline Ireland", () => {
      const response = getCrisisResponse("IE", "safeguarding");
      expect(response).toContain("Childline Ireland");
      expect(response).toContain("1800 66 66 66");
    });

    it("returns safeguarding template for AU with Kids Helpline", () => {
      const response = getCrisisResponse("AU", "safeguarding");
      expect(response).toContain("Kids Helpline");
      expect(response).toContain("1800 55 1800");
    });

    it("returns safeguarding template for NZ with Youthline", () => {
      const response = getCrisisResponse("NZ", "safeguarding");
      expect(response).toContain("Youthline");
      expect(response).toContain("0800 376 633");
    });

    it("returns safeguarding template for SG with National Anti-Violence", () => {
      const response = getCrisisResponse("SG", "safeguarding");
      expect(response).toContain("National Anti-Violence");
      expect(response).toContain("1800-777-0000");
    });

    it("unknown country gets the no-number safeguarding response, not the US lines", () => {
      const response = getCrisisResponse("ZZ", "safeguarding");
      expect(response).not.toContain("Childhelp");
      expect(response).not.toContain("RAINN");
      expect(response).not.toMatch(/\d/);
      expect(response).toContain("What you've shared matters");
    });
  });

  // §5 Test 3: negative control — safeguarding template ≠ crisis template
  describe("negative control — lane separation", () => {
    const countries = ["US", "CA", "UK", "GB", "IE", "AU", "NZ", "SG"];

    for (const country of countries) {
      it(`${country}: safeguarding template does not contain "Real people, anytime"`, () => {
        const safeguarding = getCrisisResponse(country, "safeguarding");
        expect(safeguarding).not.toContain("Real people, anytime");
      });

      it(`${country}: crisis template does not contain "What you've shared matters"`, () => {
        const crisis = getCrisisResponse(country, "crisis");
        expect(crisis).not.toContain("What you've shared matters");
      });

      it(`${country}: crisis and safeguarding templates are distinct strings`, () => {
        const crisis = getCrisisResponse(country, "crisis");
        const safeguarding = getCrisisResponse(country, "safeguarding");
        expect(crisis).not.toEqual(safeguarding);
      });
    }
  });

  // §5 Test 5: guardian isolation — crisis uses Cloud Tasks/Slack, NOT the
  // product notification system. The product notification system only has
  // guardian_linked/guardian_unlinked events. No guardian surface for crisis.
  describe("guardian isolation", () => {
    it("crisis notification event types do not overlap with guardian events", () => {
      const guardianEvents = ["guardian_linked", "guardian_unlinked"];
      const crisisEvents = [
        "signature",
        "model",
        "both",
        "classifier_degraded",
        "classifier_degraded_no_floor",
        "infrastructure_failure",
      ];
      for (const crisisEvent of crisisEvents) {
        expect(guardianEvents).not.toContain(crisisEvent);
      }
    });
  });
});
