// @vitest-environment jsdom
/**
 * The calendar's full-length controls name the sitting "full-length test".
 *
 * @spec [Doc_05F §17.2 day editor; owner ruling OQ-62 (b), Karl, 2026-10-05: "'full-length
 *        test' wording, with grep proof."] | @implemented [2026-10-05]
 *
 * plain English: renders the Add sheet with full-length enabled (its engine blurb) and the
 * full-length fields with a stored form the server no longer offers (all three option/label
 * lines), and asserts each says "full-length test" and none says a bare "test" or "practice
 * test". The forms list is seeded into the query cache, so no request is made.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DndContext } from "@dnd-kit/core";
import { examKeys } from "../../exam/api/keys";
import type { ViewBlock, ViewDay } from "../lib/view-model";
import { CreateBlockSheet } from "./CreateBlockSheet";
import { FullLengthFields } from "./FullLengthFields";
import { MonthGrid } from "./MonthGrid";

afterEach(cleanup);

const GONE_FORM = "7d1f6a52-3c1e-4c55-9a4f-0f2b8e6d9c10";

function withForms(ui: React.ReactElement): React.ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(examKeys.forms(), { forms: [] });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

/** Every whole-token "test(s)" in `text` is the tail of "full-length test(s)". */
function onlyFullLengthTests(text: string): void {
  expect(text).not.toMatch(/\bpractice tests?\b/i);
  expect(text.match(/\btests?\b/gi)?.length ?? 0).toBe(
    text.match(/\bfull-length tests?\b/gi)?.length ?? 0,
  );
}

describe("OQ-62 (b): the calendar's full-length controls", () => {
  it("the form picker's label and both fallback options say 'full-length test'", () => {
    render(
      withForms(
        <FullLengthFields
          scope={{ form_id: GONE_FORM, exam_mode: "strict" }}
          disabled={false}
          onChange={vi.fn()}
          idPrefix="t"
        />,
      ),
    );
    // Presence first: the label and both options are drawn.
    expect(screen.getByLabelText("Which full-length test?")).toBeTruthy();
    const options = Array.from(
      document.querySelectorAll<HTMLOptionElement>("#t-fl-form-select option"),
    ).map((o) => o.textContent);
    expect(options).toEqual([
      "Next unused full-length test",
      "A full-length test that is no longer offered",
    ]);
    onlyFullLengthTests(screen.getByTestId("t-fl-form").textContent ?? "");
  });

  it("the month view's chip for a full-length block says 'Full-length test'", () => {
    const block: ViewBlock = {
      blockId: "b-exam",
      tone: "exam",
      title: "Full-length test",
      minutes: null,
      mix: [],
      target: 1,
      actual: 0,
      progress: 0,
      status: "planned",
      started: false,
      explanations: [],
      launchable: true,
      plan: null,
    };
    const day: ViewDay = {
      date: "2026-10-17",
      status: "planned",
      isStudyDay: true,
      isOverride: false,
      blocks: [block],
      plannedCount: 1,
      actualCount: 0,
      extraCount: 0,
    };
    render(
      <DndContext>
        <MonthGrid
          dates={["2026-10-17"]}
          cursor="2026-10-01"
          dayFor={(d) => (d === day.date ? day : null)}
          today="2026-10-05"
          visible={() => true}
          canDrag={() => false}
          onOpen={vi.fn()}
        />
      </DndContext>,
    );
    const chip = screen.getByTestId("calendar-month-chip-b-exam");
    expect(chip.textContent).toBe("Full-length test");
    onlyFullLengthTests(chip.textContent ?? "");
  });

  it("the Add sheet's full-length engine says 'A timed full-length test'", () => {
    render(
      <CreateBlockSheet
        open
        date="2026-09-25"
        enabledBlockTypes={["practice", "review", "full_length"]}
        pending={false}
        onClose={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    const engine = screen.getByTestId("calendar-create-engine-full_length");
    expect(engine.textContent).toContain(
      "A timed full-length test, start to finish.",
    );
    onlyFullLengthTests(engine.textContent ?? "");
  });
});
