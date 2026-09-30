// @vitest-environment jsdom
/**
 * The student calendar header renders IDENTICALLY across the G4-03 extraction.
 *
 * @spec [Guardian_Closure_Plan G4-03; owner approval 2026-09-30 ("Student pages must render
 *       identically: add a snapshot or RTL check on the student calendar and mastery pages
 *       before and after")] | @implemented [2026-09-30]
 *
 * plain English: the snapshot was written against `TopBar` BEFORE its fact slots moved into
 * the shared fact components, and it is unchanged by the move. It covers both the populated
 * and the all-absent header, for both viewers, so any markup the extraction altered — a
 * class, a test id, an element, a word — fails here.
 */
import React from "react";
import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { SectionProjectionDto } from "@lyceon/shared";
import { TopBar } from "./Chrome";

afterEach(cleanup);

const ROWS: SectionProjectionDto[] = [
  {
    section: "M",
    projectedScoreLow: 380,
    projectedScoreMid: 470,
    projectedScoreHigh: 560,
    relevantQuestionCount: 40,
    computedAt: "2026-09-24T00:00:00Z",
  },
  {
    section: "RW",
    projectedScoreLow: 300,
    projectedScoreMid: 390,
    projectedScoreHigh: 500,
    relevantQuestionCount: 40,
    computedAt: "2026-09-24T00:00:00Z",
  },
];

function html(viewer: "student" | "guardian", populated: boolean): string {
  const noop = (): void => undefined;
  const { container } = render(
    <Router hook={memoryLocation({ path: "/calendar" }).hook}>
      <TopBar
        backHref={viewer === "student" ? "/dashboard" : "/guardian"}
        viewer={viewer}
        rangeLabelText="Sep 28 – Oct 4"
        view="week"
        onView={noop}
        onStep={noop}
        onToday={noop}
        streak={
          populated
            ? { current: 12, longest: 19, history_complete: true }
            : { current: null, longest: null, history_complete: false }
        }
        daysToTest={populated ? 69 : null}
        targetScore={populated ? 1350 : null}
        projection={populated ? ROWS : undefined}
        {...(viewer === "student"
          ? { onRefresh: noop, onEditSchedule: noop, refreshPending: false }
          : {})}
      />
    </Router>,
  );
  return container.innerHTML;
}

describe("the calendar header renders identically across the extraction", () => {
  it("student, populated", () => {
    expect(html("student", true)).toMatchSnapshot();
  });
  it("student, all absent", () => {
    expect(html("student", false)).toMatchSnapshot();
  });
  it("guardian, populated", () => {
    expect(html("guardian", true)).toMatchSnapshot();
  });
  it("guardian, all absent", () => {
    expect(html("guardian", false)).toMatchSnapshot();
  });
});
