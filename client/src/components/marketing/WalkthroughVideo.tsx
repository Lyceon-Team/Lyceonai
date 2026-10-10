/**
 * The "See how it works" walkthrough video: self-hosted, poster first, played only on a click.
 *
 * @spec [Lyceon_Doc_10A_V1 §6 ("a short 'see how it works' product walkthrough (video when it
 *       exists, real product screens until then)"), §8.4 (faceless video, scripts approved before
 *       production); docs/plans/seo/seo-marketing-vertical.md F13; Public Disclosure Doctrine §0; owner decisions 2026-10-09 on the walkthrough video, items 5 (a WebVTT track on
 *       the 16:9 cut, no burned-in text) and 6 ("self-hosted, loaded on scroll, played on click,
 *       with the screenshots as fallback")] | @implemented [2026-10-09]
 *
 * plain English: the 60-second 16:9 cut (as MP4, then WebM for browsers without H.264), its
 * poster and its captions are served from /media/ (client/public/media/), so no third party is
 * contacted and the page's `default-src 'self'` CSP already covers them. Until the slot comes
 * within NEAR_VIEWPORT of the screen, only the poster is rendered, as a lazy image behind a play
 * button; that is also what the build-time prerender emits, because effects never run there. Once
 * near, a <video> with preload="none" replaces it, so nothing of the film downloads until someone
 * presses play. It never autoplays: playback starts from the play button or the native controls,
 * with sound, by the viewer's own action. The English captions track is on by default.
 *
 * edge cases: if the video cannot be played (both sources failing, or a browser with no decoder
 * for either, whose play() rejects with NotSupportedError), the three product screenshots
 * (ProductVisual) take its place, for good: no later event brings the video back. A click before
 * the slot is near mounts the video and plays it in one step. Without IntersectionObserver the
 * video mounts straight away, still with preload="none". If the browser refuses play(), the
 * controls stay and the play button returns, so the viewer can try again.
 */
import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { ProductVisual } from "./ProductVisual";

export const WALKTHROUGH_MEDIA = {
  /** H.264/AAC: hardware-decoded almost everywhere, so it is offered first. */
  video: "/media/walkthrough.mp4",
  /** VP9/Opus: for browsers built without an H.264 decoder (some Linux Chromium and Firefox). */
  videoWebm: "/media/walkthrough.webm",
  poster: "/media/walkthrough-poster.jpg",
  captions: "/media/walkthrough.en.vtt",
} as const;

/** Mount the video element a little before it is on screen. */
export const NEAR_VIEWPORT = "400px 0px";

type VideoState =
  | { status: "poster" }
  | { status: "ready"; playRequested: boolean }
  | { status: "playing" }
  | { status: "failed" };

export function WalkthroughVideo(): JSX.Element {
  const slot = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<VideoState>({ status: "poster" });

  useEffect(() => {
    if (state.status !== "poster") return undefined;
    const el = slot.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setState({ status: "ready", playRequested: false });
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState({ status: "ready", playRequested: false });
          observer.disconnect();
        }
      },
      { rootMargin: NEAR_VIEWPORT },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [state.status]);

  // A click on the poster before the video existed: play it as soon as it has mounted.
  useEffect(() => {
    if (state.status === "ready" && state.playRequested) play();
  }, [state]);

  /** "failed" is terminal: a late event or a settled play() never brings the video back. */
  function move(next: VideoState): void {
    setState((prev) => (prev.status === "failed" ? prev : next));
  }

  function play(): void {
    const el = video.current;
    if (!el) return;
    move({ status: "playing" });
    el.play().catch((err: unknown) => {
      const name =
        typeof err === "object" && err !== null && "name" in err
          ? String(err.name)
          : "unknown";
      // Interrupted by a pause: nothing to do.
      if (name === "AbortError") return;
      // This browser cannot play the file (no decoder for it): show the screenshots instead.
      if (name === "NotSupportedError" || Boolean(el.error)) {
        move({ status: "failed" });
        return;
      }
      // Refused (e.g. a browser policy): leave the controls and offer the button again.
      move({ status: "ready", playRequested: false });
    });
  }

  if (state.status === "failed") return <ProductVisual />;

  const showButton = state.status !== "playing";
  return (
    <figure className="mx-auto flex w-full max-w-[960px] flex-col gap-3">
      <div
        ref={slot}
        data-testid="walkthrough-slot"
        className="relative aspect-video w-full overflow-hidden rounded-[20px] border border-border bg-card"
      >
        {state.status === "poster" ? (
          <img
            src={WALKTHROUGH_MEDIA.poster}
            alt="A frame from the Lyceon walkthrough: a practice question with its worked explanation."
            width={1280}
            height={720}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <video
            ref={video}
            poster={WALKTHROUGH_MEDIA.poster}
            preload="none"
            controls
            playsInline
            width={1280}
            height={720}
            aria-label="Lyceon walkthrough video"
            className="h-full w-full bg-card object-cover"
            onPlay={() => move({ status: "playing" })}
            onError={(e) => {
              // React bubbles a <source>'s error up to here; only the video's own error (a
              // decode or network failure on the chosen source) means it cannot play. A failed
              // first source just hands over to the next one.
              if (e.target === e.currentTarget) move({ status: "failed" });
            }}
          >
            <source src={WALKTHROUGH_MEDIA.video} type="video/mp4" />
            {/* The last source failing means none could be used: an error on a <source> fires
                there, not on the <video>, so this one carries the fallback. */}
            <source
              src={WALKTHROUGH_MEDIA.videoWebm}
              type="video/webm"
              onError={() => move({ status: "failed" })}
            />
            <track
              kind="captions"
              src={WALKTHROUGH_MEDIA.captions}
              srcLang="en"
              label="English"
              default
            />
          </video>
        )}
        {showButton ? (
          <button
            type="button"
            onClick={() =>
              state.status === "poster"
                ? setState({ status: "ready", playRequested: true })
                : play()
            }
            className="absolute left-1/2 top-1/2 flex min-h-11 -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-foreground px-5 py-3 text-base font-semibold text-background shadow-lg"
          >
            <Play className="h-5 w-5" fill="currentColor" aria-hidden="true" />
            Watch the walkthrough (1 min)
          </button>
        ) : null}
      </div>
      <figcaption className="text-center text-[13px] text-[var(--home-caption)]">
        Screens from the product, with example data.
      </figcaption>
    </figure>
  );
}
