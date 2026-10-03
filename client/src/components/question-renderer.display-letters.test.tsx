// @vitest-environment jsdom
/**
 * @spec [Brief 13 Step 0b ruling 1 (owner, Karl, 2026-10-02): runner choices are lettered A–D by
 *        on-screen position, display labels only; DESIGN.md §4 "Question runner"]
 *        | @implemented [2026-10-02]
 *
 * plain English: the practice/review runner letters each choice by where it sits on screen. The
 * served payload carries opaque `opt_…` ids in served order and no canonical keys, so "B" must
 * be whatever is second, and the canonical letter of an option (when one is present at all)
 * never shows.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("@/components/MathRenderer", () => ({
  default: ({ content }: { content: string }) => <span>{content}</span>,
}));

import QuestionRenderer from "./question-renderer";

afterEach(() => cleanup());

/** [visible letter, choice text] per choice, in DOM (on-screen) order. */
function lettersAndTexts(container: HTMLElement): Array<[string, string]> {
  return Array.from(
    container.querySelectorAll('[data-testid="runner-choice"]'),
  ).map((b) => {
    const letter =
      b.querySelector('[data-testid="runner-choice-letter"]')?.textContent ??
      "";
    // The text span is the one that is neither the letter, the sr-only label nor a tag.
    const text = b.children[2]?.textContent ?? "";
    return [letter, text];
  });
}

describe("question runner: display letters by position", () => {
  it("letters served-token choices A–D in served order", () => {
    const { container } = render(
      <QuestionRenderer
        question={{
          stem: "If 2x = 24, what is x?",
          options: [
            { id: "opt_a1", text: "6" },
            { id: "opt_c3", text: "12" },
            { id: "opt_b2", text: "9" },
            { id: "opt_d4", text: "15" },
          ],
        }}
        selectedAnswer={null}
        onSelectAnswer={() => undefined}
        showResult={false}
      />,
    );
    expect(lettersAndTexts(container)).toEqual([
      ["A", "6"],
      ["B", "12"],
      ["C", "9"],
      ["D", "15"],
    ]);
  });

  it("never shows a canonical letter: an option whose id is C, shown first, is A", () => {
    // UI-53: the renderer letters by position only; even an id that IS a letter is not shown.
    const { container } = render(
      <QuestionRenderer
        question={{
          stem: "Pick one.",
          options: [
            { id: "C", text: "twelve" },
            { id: "A", text: "six" },
            { id: "D", text: "fifteen" },
            { id: "B", text: "nine" },
          ],
        }}
        selectedAnswer={null}
        onSelectAnswer={() => undefined}
        showResult={false}
      />,
    );
    expect(lettersAndTexts(container)).toEqual([
      ["A", "twelve"],
      ["B", "six"],
      ["C", "fifteen"],
      ["D", "nine"],
    ]);
  });
});
