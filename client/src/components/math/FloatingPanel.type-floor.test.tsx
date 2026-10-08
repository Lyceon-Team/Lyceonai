// @vitest-environment jsdom
/**
 * UI-62: the timed module's floating calculator panel has nothing below 14px.
 *
 * @spec [student-UI register UI-62 (the invariant sweep: nothing below 14px); DESIGN.md §1]
 *       | @implemented [2026-10-08]
 *
 * plain English: renders the real FloatingPanel open (its owner, the exam module, always mounts
 * it), then reads every class inside it. Presence first: the header's title and its Expand
 * button are found by what they say, so an empty panel cannot pass the sweep.
 */
import React, { useRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FloatingPanel } from "./FloatingPanel";

afterEach(cleanup);

const BELOW_14 =
  /^(?:[^\s:]+:)*text-(?:xs|sm|\[(?:\d|1[0-3])(?:\.\d+)?(?:px)?\]|\[0?\.\d+rem\])$/;

function Harness(): React.ReactElement {
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const topBoundRef = useRef<HTMLDivElement | null>(null);
  return (
    <>
      <div ref={topBoundRef}>timer</div>
      <button ref={returnFocusRef} type="button">
        Calculator
      </button>
      <FloatingPanel
        id="calc"
        title="Calculator"
        open
        onClose={() => undefined}
        returnFocusRef={returnFocusRef}
        topBoundRef={topBoundRef}
        width={420}
        height={520}
        expandedWidthPct={60}
      >
        <p>Desmos</p>
      </FloatingPanel>
    </>
  );
}

describe("UI-62: FloatingPanel type floor", () => {
  it("draws its title and Expand at 14px, and no class below 14px", () => {
    render(<Harness />);
    const bar = screen.getByTestId("floating-panel-drag-bar");
    const title = bar.querySelector("#calc-title");
    expect(title?.textContent).toBe("Calculator");
    const expand = screen.getByRole("button", { name: "Expand" });
    expect(title?.getAttribute("class")).toContain("text-[14px]");
    expect(expand.getAttribute("class")).toContain("text-[14px]");

    const panel = bar.parentElement ?? bar;
    const small = [panel, ...Array.from(panel.querySelectorAll("*"))]
      .flatMap((el) => (el.getAttribute("class") ?? "").split(/\s+/))
      .filter((c) => BELOW_14.test(c));
    expect(small).toEqual([]);
  });
});
