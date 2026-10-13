// @vitest-environment jsdom
/**
 * QMH — the question header's edge cases (owner brief, Karl, 2026-10-13 §1).
 *
 * @spec [owner brief "Question metadata header" (Karl, 2026-10-13) §1; DESIGN.md §5]
 *       | @implemented [2026-10-13]
 *
 * plain English: the runner test drives the header through the real page on all three
 * surfaces; this file covers what a served item may lack. A missing part is left out with its
 * dot, a difficulty the bank does not define is not shown (never a guessed word), and with
 * nothing to show the header renders nothing. The 1/2/3 → Easy/Medium/Hard mapping is the
 * shared `questionDifficultyLabel`.
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { questionDifficultyLabel } from "@lyceon/shared/question-difficulty";
import { QuestionMetaHeader } from "./QuestionMetaHeader";

afterEach(() => cleanup());

describe("QMH: the question header's edge cases", () => {
  it("maps the bank's 1, 2, 3 to Easy, Medium, Hard, and nothing else to a word", () => {
    expect([1, 2, 3].map(questionDifficultyLabel)).toEqual([
      "Easy",
      "Medium",
      "Hard",
    ]);
    expect(["2", " hard "].map(questionDifficultyLabel)).toEqual([
      "Medium",
      "Hard",
    ]);
    for (const other of [0, 4, 2.5, "", "very hard", null, undefined]) {
      expect(questionDifficultyLabel(other), String(other)).toBeNull();
    }
  });

  it("without a skill: domain · difficulty on every width, and no dot before a missing skill", () => {
    render(<QuestionMetaHeader domain="Algebra" skill={null} difficulty={3} />);
    const meta = screen.getByTestId("question-meta");
    // Presence first.
    expect(screen.getByTestId("question-meta-domain").textContent).toBe(
      "Algebra",
    );
    expect(screen.getByTestId("question-meta-difficulty").textContent).toBe(
      "Difficulty: Hard",
    );
    expect(screen.queryByTestId("question-meta-skill")).toBeNull();
    // One dot only (domain · difficulty), shown at both widths.
    const dots = Array.from(meta.querySelectorAll('[aria-hidden="true"]'));
    expect(dots).toHaveLength(1);
    expect(dots[0]!.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["inline", "lg:inline"]),
    );
  });

  it("with a difficulty the bank does not define: no difficulty and no dot before it", () => {
    render(
      <QuestionMetaHeader
        domain="Craft and Structure"
        skill="Words in Context"
        difficulty={7}
      />,
    );
    expect(screen.getByTestId("question-meta-skill").textContent).toBe(
      "Words in Context",
    );
    expect(screen.queryByTestId("question-meta-difficulty")).toBeNull();
    expect(screen.queryByTestId("question-meta-dot-difficulty")).toBeNull();
  });

  it("with nothing to show, renders nothing", () => {
    const { container } = render(
      <QuestionMetaHeader domain="  " skill={null} difficulty={null} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
