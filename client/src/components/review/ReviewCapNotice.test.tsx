// @vitest-environment jsdom
/**
 * @spec [owner brief "first-run activation fixes" (Karl, 2026-10-13) P0 item 4 ('Fix the
 *        "Continue your open session" button overflow'); DESIGN.md §5 ("A label never pushes the
 *        layout")] | @implemented [2026-10-13]
 *
 * plain English: the review cap's two actions may break onto a second line and are never wider
 * than the notice, so "Continue your open session" stays inside Home's 360px panel and a phone's
 * width. jsdom lays nothing out, so the proof is the classes that decide it on the real elements
 * (the shared Button never wraps unless told to); the 390 and 1440 screenshots in the PR show the
 * rendered result. Presence first: both actions are drawn.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ReviewOpenSession } from "@/hooks/useReview";
import { ReviewCapNotice } from "./ReviewCapNotice";

afterEach(cleanup);

const OPEN: ReviewOpenSession = {
  id: "00000000-0000-4000-8000-0000000000a1",
  mode: "queue",
  status: "active",
  created_at: "2026-10-13T12:00:00.000Z",
  target_question_count: 10,
  total_items: 10,
  answered_items: 2,
  section: null,
  criteria: { sections: [], domains: [], skills: [], difficulties: [] },
};

describe("P0-4: the review cap's actions fit their notice", () => {
  it("both actions wrap and are capped at the notice's width", () => {
    const { hook } = memoryLocation({ path: "/dashboard" });
    render(
      <Router hook={hook}>
        <div className="lyc" style={{ width: 300 }}>
          <ReviewCapNotice
            message="You already have 5 open review sessions."
            sessions={[OPEN]}
          />
        </div>
      </Router>,
    );
    const cont = screen.getByRole("button", {
      name: "Continue your open session",
    });
    const end = screen.getByRole("button", { name: "End a session" });
    for (const button of [cont, end]) {
      const classes = button.className.split(/\s+/);
      expect(classes).toContain("whitespace-normal");
      expect(classes).not.toContain("whitespace-nowrap");
      expect(classes).toContain("max-w-full");
      // Height grows with a second line; the 44px target stays as the minimum.
      expect(classes).toContain("h-auto");
      expect(classes).toContain("min-h-11");
      expect(classes).not.toContain("h-11");
    }
  });
});
