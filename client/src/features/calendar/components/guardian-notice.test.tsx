// @vitest-environment jsdom
/**
 * "Your guardian is notified when you change your study plan." — only with an active link.
 *
 * @spec [owner brief "Guardian accountability loop" (Karl, 2026-10-13) "Transparency
 *        (student-facing)": "Wherever a student edits their schedule, clears a day or removes
 *        blocks, one line … Only shown when an active guardian link exists."; "Tests": "The
 *        transparency line appears only with an active link."] | @implemented [2026-10-13]
 *
 * Three layers, each proved on its own:
 *   1. `useHasActiveGuardianLink` answers true only when the server returned at least one active
 *      link (the same `GET /api/students/:id/links` Settings → Guardian reads), and false while
 *      loading, on an empty list and on an error;
 *   2. the day ⋯ menu (where a day is blocked out, i.e. cleared) draws the line only when told;
 *   3. the block panel (Remove, Move to…) draws it only when told, and never on a locked block.
 */
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DayMenu, type DayActions } from "./DayMenu";
import { BlockSheet, type BlockSheetActions } from "./BlockSheet";
import type { ViewBlock, ViewDay } from "../lib/view-model";
import { GUARDIAN_NOTICE_LINE } from "../copy/guardian-notice";
import { useHasActiveGuardianLink } from "@/hooks/useStudentGuardianLinks";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STUDENT = "6f1c2b8e-4d3a-4f5e-9a7b-1c2d3e4f5a6b";
const DATE = "2026-10-20";

function dayActions(guardianNotice?: boolean): DayActions {
  return {
    onBlockOut: vi.fn(),
    onUndoBlockOut: vi.fn(),
    onRegenerateDay: vi.fn(),
    onResetDay: vi.fn(),
    ...(guardianNotice === undefined ? {} : { guardianNotice }),
  };
}

function sheetActions(guardianNotice?: boolean): BlockSheetActions {
  return {
    onEditMix: vi.fn(),
    onEditReviewCount: vi.fn(),
    onEditFullLength: vi.fn(),
    onRemove: vi.fn(),
    onLaunch: vi.fn(),
    onDoItNow: vi.fn(),
    onMove: vi.fn(),
    launchPending: false,
    ...(guardianNotice === undefined ? {} : { guardianNotice }),
  };
}

const BLOCK: ViewBlock = {
  blockId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  tone: "math",
  title: "Math · 20 questions",
  minutes: "~30 min",
  mix: [],
  target: 20,
  actual: 0,
  progress: 0,
  status: "scheduled",
  started: false,
  explanations: [],
  launchable: true,
  plan: null,
};

function viewDay(block: ViewBlock): ViewDay {
  return {
    date: DATE,
    status: "upcoming",
    isStudyDay: true,
    isOverride: false,
    blocks: [block],
    plannedCount: block.target,
    actualCount: block.actual,
    extraCount: 0,
  };
}

describe("the day menu", () => {
  it.each([
    ["an active link", true, true],
    ["no active link", false, false],
    ["no answer yet", undefined, false],
  ])("with %s the line is %s", (_label, notice, shown) => {
    render(
      <DayMenu
        date={DATE}
        blockedOut={false}
        isOverride={false}
        actions={dayActions(notice)}
      />,
    );
    fireEvent.click(screen.getByTestId(`day-menu-${DATE}`));
    // Presence first: the menu really is open, so an absent line is not a closed menu.
    expect(screen.getByTestId(`day-block-${DATE}`)).toBeInTheDocument();
    const line = screen.queryByTestId(`day-menu-guardian-notice-${DATE}`);
    if (shown) {
      expect(line).toHaveTextContent(GUARDIAN_NOTICE_LINE);
    } else {
      expect(line).toBeNull();
      expect(screen.queryByText(GUARDIAN_NOTICE_LINE)).toBeNull();
    }
  });
});

describe("the block panel", () => {
  function open(block: ViewBlock, notice: boolean | undefined): void {
    render(
      <BlockSheet
        block={block}
        day={viewDay(block)}
        today="2026-10-13"
        open
        onClose={vi.fn()}
        actions={sheetActions(notice)}
      />,
    );
  }

  it("draws the line beside Remove and Move when a guardian is linked", () => {
    open(BLOCK, true);
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(
      screen.getByTestId("calendar-block-guardian-notice"),
    ).toHaveTextContent(GUARDIAN_NOTICE_LINE);
  });

  it("draws nothing without an active link", () => {
    open(BLOCK, false);
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(screen.queryByTestId("calendar-block-guardian-notice")).toBeNull();
  });

  it("draws nothing on a block the student cannot change (started)", () => {
    open({ ...BLOCK, status: "in_progress", started: true }, true);
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.queryByTestId("calendar-block-guardian-notice")).toBeNull();
  });
});

describe("useHasActiveGuardianLink", () => {
  function Probe({ id }: { id: string | null }): JSX.Element {
    const has = useHasActiveGuardianLink(id);
    return <p data-testid="probe">{has ? "linked" : "not linked"}</p>;
  }
  function mount(id: string | null): void {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <Probe id={id} />
      </QueryClientProvider>,
    );
  }
  function serve(status: number, body: unknown): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => body,
      text: async () => JSON.stringify(body),
      clone() {
        return this;
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("is true when the server returns an active link, read from the student's own links route", async () => {
    const fetchMock = serve(200, {
      data: {
        links: [
          {
            link_id: "l1",
            guardian_display_name: "Pat",
            linked_at: "2026-10-01T00:00:00Z",
          },
        ],
      },
    });
    mount(STUDENT);
    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent("linked"),
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/api/students/${STUDENT}/links`,
    );
  });

  it("is false on an empty list, on an error, and with no student", async () => {
    const fetchMock = serve(200, { data: { links: [] } });
    mount(STUDENT);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByTestId("probe")).toHaveTextContent("not linked");
    cleanup();

    serve(500, { error: "boom" });
    mount(STUDENT);
    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent("not linked"),
    );
    cleanup();

    const none = serve(200, { data: { links: [] } });
    mount(null);
    expect(screen.getByTestId("probe")).toHaveTextContent("not linked");
    expect(none).not.toHaveBeenCalled();
  });
});
