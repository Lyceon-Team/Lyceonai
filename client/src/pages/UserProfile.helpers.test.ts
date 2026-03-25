import { describe, expect, it } from "vitest";
import { formatMemberSince } from "./UserProfile";

describe("formatMemberSince", () => {
  it("returns Unavailable when createdAt is missing", () => {
    expect(formatMemberSince()).toBe("Unavailable");
  });

  it("returns Unavailable when createdAt is invalid", () => {
    expect(formatMemberSince("not-a-date")).toBe("Unavailable");
  });

  it("formats valid createdAt values", () => {
    expect(formatMemberSince("2026-03-24T10:00:00.000Z")).not.toBe("Unavailable");
  });
});
