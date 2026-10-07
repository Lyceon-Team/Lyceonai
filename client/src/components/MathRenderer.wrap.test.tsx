// @vitest-environment jsdom
/**
 * QA item 15 (owner QA list, Karl, 2026-10-07): an inline math expression never wraps mid-way.
 *
 * @spec [owner QA list item 15; MathRenderer.tsx] | @implemented [2026-10-07]
 *
 * plain English: the real renderer, real KaTeX. Each inline expression's span carries
 * `white-space: nowrap`, so the browser cannot break between KaTeX's inline blocks; the prose
 * around it is untouched, and display math (its own block) is left alone.
 */
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MathRenderer } from "./MathRenderer";

describe("MathRenderer keeps an inline expression on one line", () => {
  it("each inline expression's span is nowrap; the prose and display math are not", async () => {
    const { container } = render(
      <MathRenderer
        content={"If $3x + 11 = 47$, what is $x$? Then $$y = mx + b$$ holds."}
      />,
    );
    await waitFor(() =>
      expect(container.querySelectorAll(".katex").length).toBe(3),
    );
    const inline = Array.from(
      container.querySelectorAll<HTMLElement>("[data-math-inline]"),
    );
    // Presence: both inline expressions rendered through KaTeX.
    expect(inline).toHaveLength(2);
    for (const span of inline) {
      expect(span.style.whiteSpace).toBe("nowrap");
      expect(span.querySelector(".katex")).not.toBeNull();
    }
    const display = container.querySelector(".katex-display");
    expect(display).not.toBeNull();
    expect(display?.closest("[data-math-inline]")).toBeNull();
    // The prose wraps as it always did: no nowrap on the container.
    expect(
      container.querySelector<HTMLElement>('[data-testid="math-content"]')
        ?.style.whiteSpace,
    ).toBe("");
  });
});
