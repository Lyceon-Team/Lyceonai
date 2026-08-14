import { describe, expect, it } from "vitest";
import { detectsSelfDeprecatingLanguage } from "../../server/services/tutor-context";

describe("tutor context self-deprecation detection", () => {
  it.each(["I can't do this", "I cant do this"])(
    "detects can/can't self-deprecation in %j",
    (message) => {
      expect(detectsSelfDeprecatingLanguage(message)).toBe(true);
    },
  );
});
