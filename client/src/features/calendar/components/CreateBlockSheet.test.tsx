// @vitest-environment jsdom
/**
 * §17.2 — Add opens a form. It does not write.
 *
 * @spec [Doc 05F §17.2, §12.4; Brief 11 Step 2; SCL-137] | @implemented [2026-09-24]
 *
 * The first test is the one that matters. "+ Add block" used to POST a day edit on the
 * click, carrying a block nobody chose — practice, section M, the first two Math domains,
 * five questions each. That unprompted write is what the production 500s were, so the
 * assertion here is about ABSENCE: after clicking Add and filling nothing in, no draft has
 * been emitted at all.
 */
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newBlockSchema, type CalendarBlockType } from "@lyceon/shared/calendar";
import { membersWithNewBlock, type NewBlockDraft } from "../lib/members";
import { CreateBlockSheet } from "./CreateBlockSheet";

afterEach(cleanup);

/** Production's own list on 2026-09-24 — full-length has not shipped. */
const ENABLED: readonly CalendarBlockType[] = ["practice", "review"];

function open(
  over: Partial<React.ComponentProps<typeof CreateBlockSheet>> = {},
): { created: NewBlockDraft[]; closed: () => number } {
  const created: NewBlockDraft[] = [];
  const onClose = vi.fn();
  render(
    <CreateBlockSheet
      open
      date="2026-09-25"
      enabledBlockTypes={ENABLED}
      pending={false}
      onClose={onClose}
      onCreate={(draft) => created.push(draft)}
      {...over}
    />,
  );
  return { created, closed: () => onClose.mock.calls.length };
}

describe("opening writes nothing", () => {
  it("emits no draft merely by being open", () => {
    const { created } = open();
    expect(created).toHaveLength(0);
  });

  it("emits no draft when an engine is chosen but not confirmed", () => {
    const { created } = open();
    fireEvent.click(screen.getByTestId("calendar-create-engine-practice"));
    expect(created).toHaveLength(0);
  });

  it("cannot confirm before an engine is chosen", () => {
    const { created } = open();
    const confirm = screen.getByTestId(
      "calendar-create-confirm",
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(created).toHaveLength(0);
  });

  it("Cancel closes and emits nothing", () => {
    const { created, closed } = open();
    fireEvent.click(screen.getByTestId("calendar-create-engine-review"));
    fireEvent.click(screen.getByTestId("calendar-create-cancel"));
    expect(closed()).toBe(1);
    expect(created).toHaveLength(0);
  });
});

describe("confirming writes exactly one block", () => {
  it("a practice draft carries the section and the mix the student saw", () => {
    const { created } = open();
    fireEvent.click(screen.getByTestId("calendar-create-engine-practice"));
    fireEvent.click(screen.getByTestId("calendar-create-confirm"));

    expect(created).toHaveLength(1);
    const draft = created[0]!;
    expect(draft.block_type).toBe("practice");
    if (draft.block_type !== "practice") return;
    expect(draft.section).toBe("M");
    expect(draft.mix.length).toBeGreaterThan(0);
  });

  it("a review draft carries the chosen item count", () => {
    const { created } = open();
    fireEvent.click(screen.getByTestId("calendar-create-engine-review"));
    fireEvent.change(screen.getByTestId("calendar-create-review-count"), {
      target: { value: "25" },
    });
    fireEvent.click(screen.getByTestId("calendar-create-confirm"));

    const draft = created[0]!;
    expect(draft.block_type).toBe("review");
    if (draft.block_type !== "review") return;
    expect(draft.count).toBe(25);
  });

  it("switching section replaces the domains rather than keeping the other section's", () => {
    const { created } = open();
    fireEvent.click(screen.getByTestId("calendar-create-engine-practice"));
    fireEvent.click(screen.getByTestId("calendar-create-section-RW"));
    fireEvent.click(screen.getByTestId("calendar-create-confirm"));

    const draft = created[0]!;
    if (draft.block_type !== "practice") return;
    expect(draft.section).toBe("RW");
    // A Math domain on a Reading & Writing block is a scope the database refuses, so the
    // rows must not survive the switch.
    const RW_DOMAINS = [
      "Information and Ideas",
      "Craft and Structure",
      "Expression of Ideas",
      "Standard English Conventions",
    ];
    for (const entry of draft.mix) expect(RW_DOMAINS).toContain(entry.domain);
  });
});

describe("only enabled engines are offered", () => {
  it("full-length is absent while it is not in enabled_block_types", () => {
    open();
    expect(screen.queryByTestId("calendar-create-engine-full_length")).toBeNull();
    expect(screen.getByTestId("calendar-create-engine-practice")).toBeTruthy();
    expect(screen.getByTestId("calendar-create-engine-review")).toBeTruthy();
  });

  it("and appears the day the flag does — no second copy to update", () => {
    open({ enabledBlockTypes: ["practice", "review", "full_length"] });
    expect(screen.getByTestId("calendar-create-engine-full_length")).toBeTruthy();
  });

  it("offers nothing at all rather than inventing one when the list is empty", () => {
    const { created } = open({ enabledBlockTypes: [] });
    expect(screen.getByTestId("calendar-create-engines").querySelectorAll("button")).toHaveLength(0);
    expect(
      (screen.getByTestId("calendar-create-confirm") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(created).toHaveLength(0);
  });
});

describe("the created block's scope validates", () => {
  const DAY = {
    date: "2026-09-25",
    status: "planned" as const,
    isStudyDay: true,
    isOverride: false,
    blocks: [],
    plannedCount: 0,
    actualCount: 0,
    extraCount: 0,
  };

  const DRAFTS: NewBlockDraft[] = [
    {
      block_type: "practice",
      section: "M",
      mix: [{ domain: "Algebra", count: 5 }],
    },
    { block_type: "review", count: 10 },
    { block_type: "full_length" },
  ];

  for (const draft of DRAFTS) {
    it(`a ${draft.block_type} block parses against newBlockSchema`, () => {
      const members = membersWithNewBlock(DAY, draft);
      const created = members.find((member) => member.kind === "created");
      expect(created).toBeDefined();
      if (created === undefined || created.kind !== "created") return;
      // `newBlockSchema` is the shape `calendar_write_version` reads field by field, and
      // it mirrors `calendar_scope_is_valid`. A draft that fails here is a V-06 rejection
      // waiting to happen — which is exactly what this step exists to stop producing.
      const parsed = newBlockSchema.safeParse(created.block);
      expect(parsed.success).toBe(true);
    });
  }

  it("carries every existing block forward, so the day is not replaced by the new one", () => {
    const withBlocks = {
      ...DAY,
      blocks: [
        { blockId: "b1" },
        { blockId: "b2" },
      ] as unknown as (typeof DAY)["blocks"],
    };
    const members = membersWithNewBlock(withBlocks, DRAFTS[1]!);
    // §12.4 takes the FULL desired member list: anything omitted is dropped from the day.
    expect(members.filter((m) => m.kind === "carried")).toHaveLength(2);
    expect(members.filter((m) => m.kind === "created")).toHaveLength(1);
  });
});
