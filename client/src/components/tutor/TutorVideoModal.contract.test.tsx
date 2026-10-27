// @vitest-environment jsdom
/**
 * @spec [owner brief "Video player: near-fullscreen" (Karl, 2026-10-27): one-line header (title,
 *       channel, controls; the full title on hover or long-press); shrink to a floating player and
 *       expand again; closing stays one tap; the embed and the start time unchanged; Escape
 *       closes, focus moves into the dialog and returns to the button that opened it, the shrink
 *       control has a label] | @implemented [2026-10-27]
 *
 * plain English: through the real card (VideoRecommendationCard → TutorVideoModal), opened with
 * its real Watch button. Sizes are the browser spec's (tests/e2e/tutor-video-player.spec.ts):
 * jsdom has no layout. Here:
 *  - Expanded on open: a labelled modal dialog, focus inside it, the page behind `inert`.
 *  - Shrink and expand restyle the SAME iframe node (a remount would reload the lesson), the
 *    toggle's label follows, and shrunk the page is no longer inert and the dialog not modal.
 *  - Shrunk, a press or Escape on the page leaves it playing; Escape inside closes it; Close is
 *    one press in both sizes; focus returns to Watch every way it closes.
 *  - A touch held on the title shows the full title; the next touch puts it away.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { TutorVideo } from "@/hooks/tutor-client";
import { VideoRecommendationCard } from "./VideoRecommendationCard";
import { LONG_PRESS_MS } from "./TutorVideoModal";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The library's Desmos Lesson #10 (docs/plans/lisa-video-library/video-tags-review.csv). */
const VIDEO: TutorVideo = {
  video_id: "a1QNaRnn6cE",
  title:
    "Digital SAT Math - Desmos Lesson #10 Equivalent Expressions: Guess & Check by Graphing",
  channel_name: "Tutorllini Test Prep",
  duration_seconds: 398,
  start_seconds: null,
};

/**
 * One macrotask: Radix arms the outside-press listener a tick after the dialog mounts, and
 * returns focus a tick after it unmounts (FocusScope's `setTimeout(0)`).
 */
async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function openPlayer(): Promise<{
  page: HTMLElement;
  watch: HTMLElement;
}> {
  const { container } = render(
    <main>
      <button type="button" data-testid="page-control">
        A control on the page
      </button>
      <VideoRecommendationCard video={VIDEO} label="Watch a short video" />
    </main>,
  );
  const watch = screen.getByTestId("tutor-video-watch");
  watch.focus();
  fireEvent.click(watch);
  await tick();
  return { page: container, watch };
}

const player = (): HTMLElement => screen.getByTestId("tutor-video-modal");
const sizeToggle = (): HTMLElement => screen.getByTestId("tutor-video-size");

describe("expanded on open", () => {
  it("is a modal dialog named by the title and described by the channel, focus inside, the page inert", async () => {
    const { page } = await openPlayer();
    const dialog = screen.getByRole("dialog", { name: VIDEO.title });
    expect(dialog).toBe(player());
    expect(dialog.getAttribute("data-size")).toBe("expanded");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(
      document.getElementById(dialog.getAttribute("aria-describedby") ?? "")
        ?.textContent,
    ).toBe(VIDEO.channel_name);
    expect(dialog.contains(document.activeElement)).toBe(true);
    // The page under it: present, and inert while the player is expanded.
    expect(page.isConnected).toBe(true);
    expect(page.inert).toBe(true);
    expect(screen.getByTestId("tutor-video-scrim")).toBeTruthy();
  });

  it("one header line: the whole title (truncated by CSS), the channel, then the controls", async () => {
    await openPlayer();
    const header = screen.getByTestId("tutor-video-header");
    const title = screen.getByTestId("tutor-video-modal-title");
    expect(title.textContent).toBe(VIDEO.title);
    expect(title.className).toContain("truncate");
    expect(screen.getByTestId("tutor-video-modal-channel").textContent).toBe(
      VIDEO.channel_name,
    );
    // Order: title, channel, Shrink, Close.
    const order = [
      title,
      screen.getByTestId("tutor-video-modal-channel"),
      sizeToggle(),
      screen.getByTestId("tutor-video-close"),
    ];
    for (const el of order) expect(header.contains(el)).toBe(true);
    for (let i = 1; i < order.length; i += 1) {
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(sizeToggle().getAttribute("aria-label")).toBe("Shrink video");
    expect(
      screen.getByTestId("tutor-video-close").getAttribute("aria-label"),
    ).toBe("Close video");
  });

  it("the embed is unchanged: nocookie, rel=0, no start for a video without one", async () => {
    await openPlayer();
    expect(screen.getByTestId("tutor-video-embed").getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/a1QNaRnn6cE?rel=0",
    );
  });

  it("Escape closes and focus returns to Watch", async () => {
    const { watch } = await openPlayer();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(screen.queryByTestId("tutor-video-modal")).toBeNull();
    await tick();
    expect(document.activeElement).toBe(watch);
  });

  it("Close is one press; focus returns to Watch; the page is no longer inert", async () => {
    const { page, watch } = await openPlayer();
    fireEvent.click(screen.getByTestId("tutor-video-close"));
    expect(screen.queryByTestId("tutor-video-modal")).toBeNull();
    await tick();
    expect(document.activeElement).toBe(watch);
    expect(page.inert).toBe(false);
  });

  it("a press on the scrim closes it", async () => {
    const { watch } = await openPlayer();
    fireEvent.pointerDown(screen.getByTestId("tutor-video-scrim"));
    expect(screen.queryByTestId("tutor-video-modal")).toBeNull();
    await tick();
    expect(document.activeElement).toBe(watch);
  });
});

describe("shrink and expand", () => {
  it("restyle the same frame, never remount it; the label and modality follow", async () => {
    const { page } = await openPlayer();
    const frame = screen.getByTestId("tutor-video-embed");

    fireEvent.click(sizeToggle());
    expect(player().getAttribute("data-size")).toBe("shrunk");
    expect(player().getAttribute("aria-modal")).toBe("false");
    expect(sizeToggle().getAttribute("aria-label")).toBe("Expand video");
    expect(document.activeElement).toBe(sizeToggle());
    expect(page.inert).toBe(false);
    expect(screen.queryByTestId("tutor-video-scrim")).toBeNull();
    // The channel gives the title its room, and is still the dialog's description.
    const channel = screen.getByTestId("tutor-video-modal-channel");
    expect(channel.className).toBe("sr-only");
    expect(player().getAttribute("aria-describedby")).toBe(channel.id);
    expect(screen.getByTestId("tutor-video-embed")).toBe(frame);

    fireEvent.click(sizeToggle());
    expect(player().getAttribute("data-size")).toBe("expanded");
    expect(player().getAttribute("aria-modal")).toBe("true");
    expect(sizeToggle().getAttribute("aria-label")).toBe("Shrink video");
    expect(page.inert).toBe(true);
    expect(screen.getByTestId("tutor-video-embed")).toBe(frame);
  });

  it("shrunk, the page is the student's: a press and Escape there leave it playing", async () => {
    await openPlayer();
    const frame = screen.getByTestId("tutor-video-embed");
    fireEvent.click(sizeToggle());
    const control = screen.getByTestId("page-control");
    fireEvent.pointerDown(control);
    control.focus();
    fireEvent.focusIn(control);
    fireEvent.keyDown(control, { key: "Escape" });
    expect(player().getAttribute("data-size")).toBe("shrunk");
    expect(screen.getByTestId("tutor-video-embed")).toBe(frame);
    expect(document.activeElement).toBe(control);
  });

  it("shrunk, Escape inside the player closes it, and focus returns to Watch", async () => {
    const { watch } = await openPlayer();
    fireEvent.click(sizeToggle());
    fireEvent.keyDown(sizeToggle(), { key: "Escape" });
    expect(screen.queryByTestId("tutor-video-modal")).toBeNull();
    await tick();
    expect(document.activeElement).toBe(watch);
  });

  it("shrunk, Close is one press", async () => {
    const { watch } = await openPlayer();
    fireEvent.click(sizeToggle());
    fireEvent.click(screen.getByTestId("tutor-video-close"));
    expect(screen.queryByTestId("tutor-video-modal")).toBeNull();
    await tick();
    expect(document.activeElement).toBe(watch);
  });

  it("every open starts expanded", async () => {
    await openPlayer();
    fireEvent.click(sizeToggle());
    fireEvent.click(screen.getByTestId("tutor-video-close"));
    fireEvent.click(screen.getByTestId("tutor-video-watch"));
    expect(player().getAttribute("data-size")).toBe("expanded");
  });
});

describe("the full title", () => {
  it("a held touch shows it; a short tap does not; the next touch puts it away", async () => {
    await openPlayer();
    vi.useFakeTimers();
    const title = screen.getByTestId("tutor-video-modal-title");
    const full = screen.getByTestId("tutor-video-full-title");
    expect(full.textContent).toBe(VIDEO.title);
    expect(full.getAttribute("data-shown")).toBe("false");

    fireEvent.pointerDown(title, { pointerType: "touch" });
    fireEvent.pointerUp(title, { pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    });
    expect(full.getAttribute("data-shown")).toBe("false");

    fireEvent.pointerDown(title, { pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(full.getAttribute("data-shown")).toBe("true");
    fireEvent.pointerUp(title, { pointerType: "touch" });
    expect(full.getAttribute("data-shown")).toBe("true");

    fireEvent.pointerDown(screen.getByTestId("tutor-video-header"), {
      pointerType: "touch",
    });
    expect(full.getAttribute("data-shown")).toBe("false");
  });

  it("a mouse press never holds it open (hover shows it, by CSS)", async () => {
    await openPlayer();
    vi.useFakeTimers();
    const title = screen.getByTestId("tutor-video-modal-title");
    fireEvent.pointerDown(title, { pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    });
    const full = screen.getByTestId("tutor-video-full-title");
    expect(full.getAttribute("data-shown")).toBe("false");
    expect(full.className).toContain("group-hover:block");
  });
});
