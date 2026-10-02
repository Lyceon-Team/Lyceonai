/**
 * @spec [Brief 13 Step 0b ruling 3 (owner, Karl, 2026-10-02): the leak scan catches positional
 *        phrasing; INV-03-04; Doc 03 §17] | @implemented [2026-10-02]
 *
 * plain English: choices are lettered by on-screen position, so naming the position names the
 * letter. With the correct display letter B, "it's the second choice" and "option 2 is correct"
 * are leaks; with D, "the last one is right" is too. A bare mention is not, and neither is a
 * position the student already named (the echo exemption), and neither is a different position.
 */
import { describe, expect, it } from "vitest";
import { hasAnswerLeak } from "../../shared/tutor-safety-constants";

describe("hasAnswerLeak: positional phrasing", () => {
  it.each([
    ["Honestly, it's the second choice.", "B"],
    ["The answer is the second option.", "B"],
    ["Option 2 is correct.", "B"],
    ["You should go with choice #2.", "B"],
    ["The correct answer is the 2nd one.", "B"],
    ["Answer: the first choice", "A"],
    ["The last one is right.", "D"],
    ["Definitely the fourth option.", "D"],
    ["Pick option 3.", "C"],
  ])("%s (correct %s) is a leak", (text, letter) => {
    expect(hasAnswerLeak(text, letter)).toBe(true);
  });

  it.each([
    ["Look at the second choice and tell me what you notice.", "B"],
    ["It's the first choice that people often pick.", "B"],
    ["The last one is right.", "C"],
    ["Option 12 is not a thing here.", "A"],
  ])("%s (correct %s) is not a leak", (text, letter) => {
    expect(hasAnswerLeak(text, letter)).toBe(false);
  });

  it("is exempt when the student already named the same position", () => {
    expect(
      hasAnswerLeak("Yes, it's the second choice.", "B", [
        "I think it's the second one?",
      ]),
    ).toBe(false);
    expect(
      hasAnswerLeak("Yes, it's the second choice.", "B", [
        "I think it's the first one?",
      ]),
    ).toBe(true);
  });
});
