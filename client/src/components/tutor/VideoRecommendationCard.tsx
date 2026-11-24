/**
 * @spec [CC Brief "Video Library (ships now)", Karl 2026-10-15, §8 (VideoRecommendationCard:
 *       title, channel, duration and a watch control; review panel and standalone chat);
 *       DESIGN.md §5 (tokens only; nothing below 14px; long labels clamp to two lines; one
 *       filled primary action per screen, so this control is outline)] | @implemented [2026-10-15]
 *
 * plain English: the card LISA's video offer renders as. Every field on it came from the
 * server's video library, never from the model's text. "Watch" opens TutorVideoModal. A video
 * whose id is not a YouTube id renders no card at all (nothing to play, so nothing to offer).
 *
 * @spec [owner brief "Phase C follow-up: show the segment, not the whole video", Karl
 *       2026-11-04, build 4] | @implemented [2026-11-04]
 * A "Watch full video" press in the player is reported here (useVideoFullWatchReport): the
 * segment id only, fire and forget.
 */
import { useRef, useState } from "react";
import { PlayCircle } from "lucide-react";
import { ClampedLabel } from "@/components/student-ui/ClampedLabel";
import { LYC_FOCUS } from "@/components/ui/button";
import { useVideoFullWatchReport, type TutorVideo } from "@/hooks/tutor-client";
import {
  formatDuration,
  TutorVideoModal,
  videoEmbedUrl,
} from "./TutorVideoModal";

export { formatDuration };

export function VideoRecommendationCard({
  video,
  label,
}: {
  video: TutorVideo;
  label: string | null;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  // Focus returns here when the player closes (owner brief 2026-10-27).
  const watchRef = useRef<HTMLButtonElement>(null);
  const fullWatch = useVideoFullWatchReport();
  if (videoEmbedUrl(video) === null) return null;
  return (
    <div
      className="flex max-w-md flex-col gap-2 rounded-md border border-lyc-rule bg-lyc-sheet p-4"
      data-testid="tutor-video-card"
    >
      <ClampedLabel
        text={video.title}
        className="text-lyc-body font-semibold text-lyc-ink-strong"
        data-testid="tutor-video-title"
      />
      <span className="text-lyc-body text-lyc-ink">
        {video.channel_name} · {formatDuration(video.duration_seconds)}
      </span>
      <div>
        <button
          ref={watchRef}
          type="button"
          onClick={() => setOpen(true)}
          className={`${LYC_FOCUS} inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-lyc-ink-strong bg-transparent px-4 py-2 text-lyc-body font-semibold text-lyc-ink-strong hover:bg-lyc-hover`}
          data-testid="tutor-video-watch"
        >
          <PlayCircle aria-hidden="true" className="h-4 w-4" />
          {label ?? "Watch a short video"}
        </button>
      </div>
      <TutorVideoModal
        video={video}
        open={open}
        onOpenChange={setOpen}
        returnFocusTo={watchRef}
        onWatchFull={(segmentId) => fullWatch.mutate({ segment_id: segmentId })}
      />
    </div>
  );
}
