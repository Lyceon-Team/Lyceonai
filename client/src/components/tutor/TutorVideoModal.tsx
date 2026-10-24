/**
 * @spec [CC Brief "Video Library (ships now)", Karl 2026-10-15, §8 (TutorVideoModal:
 *       youtube-nocookie.com embed, `start` where set); DESIGN.md §5] | @implemented [2026-10-15]
 *
 * plain English: plays a video LISA offered, inside Lyceon, from its chapter start when one is
 * set. The embed is youtube-nocookie.com (no YouTube cookies until the student presses play)
 * with `rel=0` (related videos limited to the same channel). The id is checked against
 * YouTube's 11-character format before it goes into the URL; anything else renders nothing.
 */
import { Modal } from "@/components/student-ui/Modal";
import type { TutorVideo } from "@/hooks/tutor-client";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** The embed URL, or null for an id that isn't a YouTube video id. */
export function videoEmbedUrl(video: TutorVideo): string | null {
  if (!VIDEO_ID.test(video.video_id)) return null;
  const params = new URLSearchParams({ rel: "0" });
  if (video.start_seconds !== null && video.start_seconds > 0) {
    params.set("start", String(Math.floor(video.start_seconds)));
  }
  return `https://www.youtube-nocookie.com/embed/${video.video_id}?${params.toString()}`;
}

export function TutorVideoModal({
  video,
  open,
  onOpenChange,
}: {
  video: TutorVideo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element | null {
  const src = videoEmbedUrl(video);
  if (src === null) return null;
  return (
    <Modal
      title={video.title}
      description={video.channel_name}
      open={open}
      onOpenChange={onOpenChange}
      data-testid="tutor-video-modal"
    >
      <div className="relative w-full overflow-hidden rounded-md border border-lyc-rule pt-[56.25%]">
        {open ? (
          <iframe
            src={src}
            title={video.title}
            className="absolute inset-0 h-full w-full"
            allow="encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            data-testid="tutor-video-embed"
          />
        ) : null}
      </div>
    </Modal>
  );
}
