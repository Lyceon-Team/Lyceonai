// @vitest-environment jsdom
/**
 * @spec [SCL-186 (strikes Doc 05 Parent §12.2 "your recency-weighted accuracy is Y%");
 *   owner ruling 6, 2026-09-29; Doc 05 AC#20] | @implemented [2026-09-29] |
 * plain English: the practice/review runner header shows no raw accuracy figure (no
 * "75%", no "3/4 correct") while the session score carries correct answers. The
 * own-activity counts stay: questions answered this session, the streak, and position.
 */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { PracticeShell } from "./PracticeShell";

afterEach(() => {
  cleanup();
});

describe("PracticeShell — no raw accuracy (SCL-186, ruling 6)", () => {
  it("shows answered count, streak and position, and no accuracy figure", () => {
    // 3 of 4 correct: an accuracy readout would print 75% or 3/4.
    const score = { correct: 3, incorrect: 1, skipped: 0, total: 4, streak: 2 };

    const { container } = render(
      <PracticeShell score={score} currentIndex={4} totalQuestions={10}>
        <div data-testid="runner-body">question</div>
      </PracticeShell>,
    );
    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    const text = header?.textContent ?? "";

    // Presence before absence: the header rendered its activity counts.
    expect(screen.getByTestId("runner-body")).toBeTruthy();
    expect(screen.getByText("4 answered")).toBeTruthy();
    expect(text).toContain("5 / 10");
    expect(text).toContain(String(score.streak));

    // Absence: no percentage and no correct-over-total fraction.
    expect(text).not.toMatch(/\d\s*%/);
    expect(text).not.toContain("75");
    // No word boundaries: in textContent adjacent spans run together ("answered3/42").
    expect(text).not.toMatch(/3\s*\/\s*4/);
  });
});
