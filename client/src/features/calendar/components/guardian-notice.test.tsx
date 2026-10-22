// @vitest-environment jsdom
/**
 * The guardian notice, after SCL-238: no static line anywhere; the server's `guardian_notified`.
 *
 * @spec [owner brief "student cleanups" (Karl, 2026-10-21) Part A: "Remove the static 'Your
 *        guardian is notified…' lines; the dialog replaces them." and "'Active guardian link AND
 *        active entitlement' must come from the server"; SCL-238] | @implemented [2026-10-13;
 *        rewritten 2026-10-21]
 *
 * Two layers, each proved on its own (the dialog itself is the page's:
 * client/src/pages/calendar.guardian-confirm.test.tsx):
 *   1. the day ⋯ menu and the block panel draw NO guardian line (presence first: the menu is
 *      open, the panel shows Remove);
 *   2. `useGuardianNotified` answers true only when the server says `guardian_notified: true` —
 *      a listed link with `guardian_notified: false` (the entitlement half failing) is false, as
 *      are loading, an error and no student.
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
import { useGuardianNotified } from "@/hooks/useStudentGuardianLinks";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STUDENT = "6f1c2b8e-4d3a-4f5e-9a7b-1c2d3e4f5a6b";
const DATE = "2026-10-20";
const OLD_LINE = "Your guardian is notified when you change your study plan.";

function dayActions(): DayActions {
  return {
    onBlockOut: vi.fn(),
    onUndoBlockOut: vi.fn(),
    onRegenerateDay: vi.fn(),
    onResetDay: vi.fn(),
  };
}

function sheetActions(): BlockSheetActions {
  return {
    onEditMix: vi.fn(),
    onEditReviewCount: vi.fn(),
    onEditFullLength: vi.fn(),
    onRemove: vi.fn(),
    onLaunch: vi.fn(),
    onDoItNow: vi.fn(),
    onMove: vi.fn(),
    launchPending: false,
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

describe("no static guardian line (SCL-238)", () => {
  it("the day menu is open and draws no guardian line", () => {
    render(
      <DayMenu
        date={DATE}
        blockedOut={false}
        isOverride={false}
        actions={dayActions()}
      />,
    );
    fireEvent.click(screen.getByTestId(`day-menu-${DATE}`));
    expect(screen.getByTestId(`day-block-${DATE}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`day-menu-guardian-notice-${DATE}`)).toBeNull();
    expect(screen.queryByText(OLD_LINE)).toBeNull();
  });

  it("the block panel shows Remove and draws no guardian line", () => {
    render(
      <BlockSheet
        block={BLOCK}
        day={viewDay(BLOCK)}
        today="2026-10-13"
        open
        onClose={vi.fn()}
        actions={sheetActions()}
      />,
    );
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(screen.queryByTestId("calendar-block-guardian-notice")).toBeNull();
    expect(screen.queryByText(OLD_LINE)).toBeNull();
  });
});

describe("useGuardianNotified", () => {
  function Probe({ id }: { id: string | null }): JSX.Element {
    const told = useGuardianNotified(id);
    return <p data-testid="probe">{told ? "told" : "not told"}</p>;
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
  const LINK = {
    link_id: "l1",
    guardian_display_name: "Pat",
    linked_at: "2026-10-01T00:00:00Z",
  };

  it("is true when the server says guardian_notified, read from the student's own links route", async () => {
    const fetchMock = serve(200, {
      data: { links: [LINK], guardian_notified: true },
    });
    mount(STUDENT);
    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent(/^told$/),
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/api/students/${STUDENT}/links`,
    );
  });

  it("is false with an active link the server does not notify (the entitlement half), on an error, and with no student", async () => {
    const fetchMock = serve(200, {
      data: { links: [LINK], guardian_notified: false },
    });
    mount(STUDENT);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent("not told"),
    );
    cleanup();

    serve(500, { error: "boom" });
    mount(STUDENT);
    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent("not told"),
    );
    cleanup();

    const none = serve(200, { data: { links: [], guardian_notified: false } });
    mount(null);
    expect(screen.getByTestId("probe")).toHaveTextContent("not told");
    expect(none).not.toHaveBeenCalled();
  });
});
