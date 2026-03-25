import { describe, expect, it } from "vitest";
import { getDateKeyInTimeZone, isDateBeforeToday } from "./calendar";

describe("calendar timezone helpers", () => {
  it("computes date keys in the provided timezone", () => {
    const utcInstant = new Date("2026-03-24T01:30:00.000Z");
    expect(getDateKeyInTimeZone("America/Chicago", utcInstant)).toBe("2026-03-23");
    expect(getDateKeyInTimeZone("Asia/Tokyo", utcInstant)).toBe("2026-03-24");
  });

  it("compares day mutability against the caller-provided today key", () => {
    expect(isDateBeforeToday("2026-03-23", "2026-03-24")).toBe(true);
    expect(isDateBeforeToday("2026-03-24", "2026-03-24")).toBe(false);
  });
});
