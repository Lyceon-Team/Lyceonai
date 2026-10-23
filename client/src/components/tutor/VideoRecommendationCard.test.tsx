// @vitest-environment jsdom
/**
 * @spec [CC Brief "Video Library (ships now)", Karl 2026-10-15, §8 (VideoRecommendationCard,
 *       TutorVideoModal: youtube-nocookie embed, start), §11 proof 4 (the video plays)]
 * @implemented [2026-10-15]
 *
 * plain English: through the real components. The card shows the server's title, channel and
 * length; nothing plays until Watch is pressed; Watch opens the modal with a
 * youtube-nocookie.com embed of that video from its start; an id that is not a YouTube id
 * renders no card, and never reaches an iframe.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TutorVideo } from "@/hooks/tutor-client";
import { SuggestedActionLink } from "./TutorThreadParts";
import {
  VideoRecommendationCard,
  formatDuration,
} from "./VideoRecommendationCard";
import { videoEmbedUrl } from "./TutorVideoModal";

afterEach(() => {
  cleanup();
});

const VIDEO: TutorVideo = {
  video_id: "f9DxgfyvRKg",
  title: "Point Slope Form (SAT Math Formula 3/23)",
  channel_name: "Scalar Learning",
  duration_seconds: 26,
  start_seconds: 5,
};

describe("VideoRecommendationCard", () => {
  it("shows the library's facts; nothing is embedded until Watch is pressed", () => {
    render(
      <VideoRecommendationCard video={VIDEO} label="Watch a short video" />,
    );
    expect(screen.getByTestId("tutor-video-card")).toBeTruthy();
    expect(screen.getByTestId("tutor-video-title").textContent).toBe(
      VIDEO.title,
    );
    expect(screen.getByText("Scalar Learning · 0:26")).toBeTruthy();
    expect(screen.queryByTestId("tutor-video-embed")).toBeNull();
  });

  it("Watch opens the modal with the nocookie embed, from the start (proof 4)", () => {
    render(
      <VideoRecommendationCard video={VIDEO} label="Watch a short video" />,
    );
    fireEvent.click(screen.getByTestId("tutor-video-watch"));
    expect(screen.getByTestId("tutor-video-modal")).toBeTruthy();
    const frame = screen.getByTestId("tutor-video-embed");
    expect(frame.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/f9DxgfyvRKg?rel=0&start=5",
    );
    expect(frame.getAttribute("title")).toBe(VIDEO.title);
  });

  it("an id that is not a YouTube id renders no card and no embed", () => {
    const { container } = render(
      <VideoRecommendationCard
        video={{ ...VIDEO, video_id: 'x"><script>' }}
        label="Watch"
      />,
    );
    expect(container.innerHTML).toBe("");
    expect(videoEmbedUrl({ ...VIDEO, video_id: "../../evil" })).toBeNull();
  });

  it("no start → plays from the beginning", () => {
    expect(videoEmbedUrl({ ...VIDEO, start_seconds: null })).toBe(
      "https://www.youtube-nocookie.com/embed/f9DxgfyvRKg?rel=0",
    );
  });

  it("formats lengths as M:SS and H:MM:SS", () => {
    expect(formatDuration(26)).toBe("0:26");
    expect(formatDuration(1838)).toBe("30:38");
    expect(formatDuration(15081)).toBe("4:11:21");
  });
});

describe("SuggestedActionLink", () => {
  it("renders the card for recommend_video", () => {
    render(
      <SuggestedActionLink
        action={{
          type: "recommend_video",
          label: "Watch a short video",
          video: VIDEO,
        }}
      />,
    );
    expect(screen.getByTestId("tutor-video-card")).toBeTruthy();
  });
});
