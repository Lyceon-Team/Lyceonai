// @vitest-environment jsdom
/**
 * @spec [Lyceon_Doc_10A_V1 §6, §8.4; docs/plans/seo/seo-marketing-vertical.md F13; Public Disclosure Doctrine §0; owner
 *       decisions 2026-10-09 on the walkthrough video, items 5, 6 and 9] | @implemented [2026-10-09]
 *
 * plain English: the homepage walkthrough renders only its poster until it comes near the
 * viewport (also the prerendered HTML); then a <video> with preload="none", controls, no
 * autoplay and no mute, carrying a default English captions track. A click plays it; a media
 * error swaps in the three product screenshots. The committed media is self-hosted, the
 * captions are exactly the approved script, and they pass the public-copy guards.
 * IntersectionObserver and HTMLMediaElement.play are driven by hand (jsdom has neither).
 */
import React from "react";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BANNED,
  firstUnapprovedOutcome,
} from "../../../../shared/seo/banned-phrases";
import {
  NEAR_VIEWPORT,
  WALKTHROUGH_MEDIA,
  WalkthroughVideo,
} from "./WalkthroughVideo";

const PUBLIC_DIR = resolve(__dirname, "../../../public");

/** Karl's approved narration (claim inventory V1–V9), in order. */
const APPROVED_SCRIPT = [
  "SAT prep that adapts to you.",
  "Start with a free diagnostic. See where you stand across every SAT section.",
  "Practice every day for free, with a worked explanation after every question.",
  "Review the ones you missed, so they stick.",
  "Stuck? Ask LISA, your AI tutor, for step-by-step help.",
  "A study plan that adapts and focuses on your weak areas.",
  "Take full-length practice tests with a score report after each one.",
  "Parents can follow along with a read-only progress view.",
  "Lyceon. Study Smarter, Score Higher. Start free at lyceon.ai.",
];

type Callback = (entries: { isIntersecting: boolean }[]) => void;
let observed: {
  cb: Callback;
  options: IntersectionObserverInit | undefined;
}[] = [];
const play = vi.fn<() => Promise<void>>();

beforeEach(() => {
  observed = [];
  play.mockReset();
  play.mockResolvedValue(undefined);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: Callback, options?: IntersectionObserverInit) {
        observed.push({ cb, options });
      }
      observe(): void {}
      disconnect(): void {}
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function near(): void {
  act(() => observed[0]?.cb([{ isIntersecting: true }]));
}

function videoEl(container: HTMLElement): HTMLVideoElement {
  const v = container.querySelector("video");
  if (!v) throw new Error("no <video> rendered");
  return v;
}

describe("WalkthroughVideo", () => {
  it("prerenders the poster only: no <video>, nothing of the film requested", () => {
    const html = renderToStaticMarkup(<WalkthroughVideo />);
    expect(html).toContain(`src="${WALKTHROUGH_MEDIA.poster}"`);
    expect(html).toContain('loading="lazy"');
    expect(html).not.toContain("<video");
    expect(html).not.toContain(WALKTHROUGH_MEDIA.video);
    expect(html).not.toContain(WALKTHROUGH_MEDIA.videoWebm);
  });

  it("shows the poster until near the viewport, then a preload=none video", () => {
    const { container } = render(<WalkthroughVideo />);
    expect(container.querySelector("video")).toBeNull();
    expect(observed).toHaveLength(1);
    expect(observed[0]?.options?.rootMargin).toBe(NEAR_VIEWPORT);
    act(() => observed[0]?.cb([{ isIntersecting: false }]));
    expect(container.querySelector("video")).toBeNull();

    near();
    const v = videoEl(container);
    // MP4 first (hardware H.264 nearly everywhere), then WebM for browsers without H.264.
    const sources = Array.from(v.querySelectorAll("source")).map((x) => [
      x.getAttribute("src"),
      x.getAttribute("type"),
    ]);
    expect(sources).toEqual([
      [WALKTHROUGH_MEDIA.video, "video/mp4"],
      [WALKTHROUGH_MEDIA.videoWebm, "video/webm"],
    ]);
    expect(v.getAttribute("poster")).toBe(WALKTHROUGH_MEDIA.poster);
    expect(v.getAttribute("preload")).toBe("none");
    expect(v.hasAttribute("controls")).toBe(true);
    expect(play).not.toHaveBeenCalled();
  });

  it("never autoplays and is never muted", () => {
    const { container } = render(<WalkthroughVideo />);
    near();
    const v = videoEl(container);
    expect(v.hasAttribute("autoplay")).toBe(false);
    expect(v.autoplay).toBe(false);
    expect(v.hasAttribute("muted")).toBe(false);
    expect(v.muted).toBe(false);
    expect(play).not.toHaveBeenCalled();
  });

  it("plays inline, so iPhones play it in place instead of forcing full screen", () => {
    const { container } = render(<WalkthroughVideo />);
    near();
    expect(videoEl(container).hasAttribute("playsinline")).toBe(true);
  });

  it("carries a default English captions track", () => {
    const { container } = render(<WalkthroughVideo />);
    near();
    const tracks = videoEl(container).querySelectorAll("track");
    expect(tracks).toHaveLength(1);
    const t = tracks[0];
    expect(t?.getAttribute("kind")).toBe("captions");
    expect(t?.getAttribute("srclang")).toBe("en");
    expect(t?.getAttribute("src")).toBe(WALKTHROUGH_MEDIA.captions);
    expect(t?.hasAttribute("default")).toBe(true);
  });

  it("plays on a click, and the button goes once playing", () => {
    const { container } = render(<WalkthroughVideo />);
    near();
    fireEvent.click(
      screen.getByRole("button", { name: /watch the walkthrough/i }),
    );
    expect(play).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll("video")).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: /watch the walkthrough/i }),
    ).toBeNull();
  });

  it("a click on the poster before it is near mounts the video and plays it", () => {
    const { container } = render(<WalkthroughVideo />);
    expect(container.querySelector("video")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /watch the walkthrough/i }),
    );
    expect(videoEl(container).getAttribute("preload")).toBe("none");
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("offers the button again when the browser refuses play()", async () => {
    const refused = new Error("refused");
    refused.name = "NotAllowedError";
    play.mockRejectedValueOnce(refused);
    render(<WalkthroughVideo />);
    near();
    fireEvent.click(
      screen.getByRole("button", { name: /watch the walkthrough/i }),
    );
    expect(
      await screen.findByRole("button", { name: /watch the walkthrough/i }),
    ).toBeTruthy();
  });

  it("falls back to the screenshots when the browser cannot decode the film", async () => {
    const unsupported = new Error("no decoder");
    unsupported.name = "NotSupportedError";
    play.mockRejectedValueOnce(unsupported);
    const { container } = render(<WalkthroughVideo />);
    near();
    fireEvent.click(
      screen.getByRole("button", { name: /watch the walkthrough/i }),
    );
    expect(
      await screen.findByRole("button", { name: "Parent view" }),
    ).toBeTruthy();
    expect(container.querySelector("video")).toBeNull();
  });

  it("stays on the screenshots once failed, whatever settles later", async () => {
    let reject: (e: Error) => void = () => undefined;
    play.mockImplementationOnce(
      () =>
        new Promise<void>((_, r) => {
          reject = r;
        }),
    );
    const { container } = render(<WalkthroughVideo />);
    near();
    fireEvent.click(
      screen.getByRole("button", { name: /watch the walkthrough/i }),
    );
    fireEvent.error(videoEl(container));
    expect(container.querySelector("video")).toBeNull();
    const refused = new Error("refused");
    refused.name = "NotAllowedError";
    await act(async () => {
      reject(refused);
      await Promise.resolve();
    });
    expect(container.querySelector("video")).toBeNull();
    expect(screen.getByRole("button", { name: "Parent view" })).toBeTruthy();
  });

  it("a failed first source hands over to the next one, without falling back", () => {
    const { container } = render(<WalkthroughVideo />);
    near();
    const first = videoEl(container).querySelector('source[type="video/mp4"]');
    if (!first) throw new Error("no mp4 <source>");
    fireEvent.error(first);
    expect(videoEl(container)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Parent view" })).toBeNull();
  });

  it("falls back to the screenshots when the last source fails (neither could be used)", () => {
    const { container } = render(<WalkthroughVideo />);
    near();
    const last = videoEl(container).querySelector('source[type="video/webm"]');
    if (!last) throw new Error("no webm <source>");
    fireEvent.error(last);
    expect(container.querySelector("video")).toBeNull();
    expect(screen.getByRole("button", { name: "Parent view" })).toBeTruthy();
  });

  it("falls back to the product screenshots when the video fails", () => {
    const { container } = render(<WalkthroughVideo />);
    near();
    fireEvent.error(videoEl(container));
    expect(container.querySelector("video")).toBeNull();
    const imgs = Array.from(container.querySelectorAll("img")).map((i) =>
      i.getAttribute("src"),
    );
    expect(imgs).toEqual(["/images/home/product-practice.jpg"]);
    expect(screen.getByRole("button", { name: "Parent view" })).toBeTruthy();
  });
});

describe("walkthrough media (client/public/media)", () => {
  it("is self-hosted: every URL is root-relative and the file is committed", () => {
    for (const url of Object.values(WALKTHROUGH_MEDIA)) {
      expect(url).toMatch(/^\/media\/[a-z0-9.-]+$/);
      expect(existsSync(resolve(PUBLIC_DIR, `.${url}`))).toBe(true);
    }
  });

  it("keeps the film and poster small enough for the homepage", () => {
    for (const film of [WALKTHROUGH_MEDIA.video, WALKTHROUGH_MEDIA.videoWebm]) {
      const size = statSync(resolve(PUBLIC_DIR, `.${film}`)).size;
      expect(size, film).toBeGreaterThan(1_000_000); // a real film, not a stub
      expect(size, film).toBeLessThan(10_000_000);
    }
    const jpg = statSync(resolve(PUBLIC_DIR, `.${WALKTHROUGH_MEDIA.poster}`));
    expect(jpg.size).toBeLessThan(100_000);
  });

  it("captions are exactly the approved script, in order, and pass the public-copy guards", () => {
    const vtt = readFileSync(
      resolve(PUBLIC_DIR, `.${WALKTHROUGH_MEDIA.captions}`),
      "utf8",
    );
    expect(vtt.startsWith("WEBVTT\n")).toBe(true);
    const cues = vtt
      .split(/\n\n+/)
      .slice(1)
      .map((block) => block.trim().split("\n"))
      .filter((lines) => lines.length >= 3);
    // Presence before content: nine cues, each with a timing line.
    expect(cues).toHaveLength(APPROVED_SCRIPT.length);
    const timing =
      /^(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}):(\d{2}):(\d{2})\.(\d{3})$/;
    let previousEnd = 0;
    cues.forEach((lines, i) => {
      const m = timing.exec(lines[1] ?? "");
      expect(m, `cue ${i + 1} timing`).not.toBeNull();
      const secs = (h: string, mi: string, s: string, ms: string): number =>
        Number(h) * 3600 + Number(mi) * 60 + Number(s) + Number(ms) / 1000;
      const start = secs(
        m?.[1] ?? "",
        m?.[2] ?? "",
        m?.[3] ?? "",
        m?.[4] ?? "",
      );
      const end = secs(m?.[5] ?? "", m?.[6] ?? "", m?.[7] ?? "", m?.[8] ?? "");
      expect(start).toBeGreaterThanOrEqual(previousEnd);
      expect(end).toBeGreaterThan(start);
      expect(end).toBeLessThanOrEqual(60);
      previousEnd = end;
      expect(lines.slice(2).join(" ")).toBe(APPROVED_SCRIPT[i]);
    });
    for (const { pattern } of BANNED) expect(vtt).not.toMatch(pattern);
    expect(firstUnapprovedOutcome(vtt)).toBeNull();
  });

  it("every other copy of the words agrees: both cuts' captions, the burned-in text, the share copy", () => {
    const REPO = resolve(PUBLIC_DIR, "../..");
    const RUNS = [
      "brag-output-2026-10-09-035211",
      "brag-output-2026-10-09-041834",
    ];
    const homepageVtt = readFileSync(
      resolve(PUBLIC_DIR, `.${WALKTHROUGH_MEDIA.captions}`),
      "utf8",
    );
    for (const run of RUNS) {
      // Each cut's own captions file is the homepage's, byte for byte.
      expect(
        readFileSync(resolve(REPO, run, "walkthrough.en.vtt"), "utf8"),
      ).toBe(homepageVtt);
      // The share copy is public text too: same guards as the page.
      const share = readFileSync(resolve(REPO, run, "share-copy.txt"), "utf8");
      expect(share.length).toBeGreaterThan(100);
      for (const { pattern } of BANNED) expect(share, run).not.toMatch(pattern);
      expect(firstUnapprovedOutcome(share), run).toBeNull();
    }
    // The 9:16 cut burns the captions in: one box per line, exactly the script.
    const vertical = readFileSync(
      resolve(REPO, RUNS[1] ?? "", "composition/index.html"),
      "utf8",
    );
    const burned = [...vertical.matchAll(/class="cap-box">([^<]*)</g)].map(
      (m) => m[1],
    );
    expect(burned).toEqual(APPROVED_SCRIPT);
    // The 16:9 homepage cut burns in nothing (owner decision 5).
    const landscape = readFileSync(
      resolve(REPO, RUNS[0] ?? "", "composition/index.html"),
      "utf8",
    );
    expect(landscape).not.toContain("cap-box");
  });
});
