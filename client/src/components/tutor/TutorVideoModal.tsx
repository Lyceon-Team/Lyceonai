/**
 * @spec [CC Brief "Video Library (ships now)", Karl 2026-10-15, §8 (TutorVideoModal:
 *       youtube-nocookie.com embed, `start` where set); DESIGN.md §5] | @implemented [2026-10-15]
 *
 * plain English: plays a video LISA offered, inside Lyceon, from its chapter start when one is
 * set. The embed is youtube-nocookie.com (no YouTube cookies until the student presses play)
 * with `rel=0` (related videos limited to the same channel). The id is checked against
 * YouTube's 11-character format before it goes into the URL; anything else renders nothing.
 *
 * @spec [owner brief "Video player: near-fullscreen" (Karl, 2026-10-27): "the video is too small
 *       to read the on-screen writing in Desmos lessons, and the header (a multi-line title plus
 *       the channel) is dead space"; size: most of the viewport (about 90–95% of the width and
 *       height) on desktop holding 16:9, full screen on phones; a one-line header (title with an
 *       ellipsis, the channel small, the controls; the full title on hover or long-press);
 *       shrink to a smaller floating player and expand again; closing stays one tap; the embed,
 *       the start time and the link check unchanged; Escape closes, focus moves in and returns to
 *       the opener, the shrink control is labelled] | @implemented [2026-10-27]
 *
 * plain English, the player:
 *  - EXPANDED (every open starts here): a box `PLAYER_VIEWPORT_SHARE` of the viewport on its
 *    binding side, the 16:9 frame filling its width under a one-line header, centred over the
 *    scrim. Below 768px (the app's phone breakpoint, Tailwind's `max-md`) it is the whole screen,
 *    the frame centred on black. The rest of the page is `inert` while it is expanded, so it is a
 *    modal: nothing behind it takes focus or clicks; a press on the scrim closes it.
 *  - SHRUNK: a `MINI_PLAYER_WIDTH_PX` floating player, bottom-right, above the runner's
 *    Submit/Next footer, the phone tab bar and the "Ask LISA" launcher (lib/bottom-chrome.ts).
 *    The page stays usable (non-modal: no scrim, no inert, a click on the page does not close
 *    it), so the student can work the question, in Desmos too, while the lesson plays.
 *    Bottom-RIGHT because that is LISA's side, where the video came from. In a runner with LISA
 *    docked it lies inside LISA's column, at the column's own width and edges
 *    (docked-lisa-panel.ts), never over the question, its choices or Submit/Next; it covers the
 *    bottom of LISA's thread and the composer, so typing to LISA means expanding or closing it
 *    (trade-off: the question is what the student works while watching). Chosen over
 *    "back to today's modal size": that size is the one that could not be read, and a modal of
 *    any size still blocks the question.
 *  - ONE FRAME. Expanding and shrinking restyle the same elements; the iframe is never remounted
 *    or moved (either reloads it, and the lesson would restart from its start time). That is why
 *    this is one NON-modal Radix dialog with the modal behaviour (inert page, scrim) added while
 *    expanded: Radix renders its modal and non-modal contents as different components, so
 *    switching `modal` would remount the frame. It composes the Radix primitives directly, not
 *    ui/dialog's DialogContent, whose built-in overlay and corner close button are modal-only.
 *  - Header: one line. The title truncates with an ellipsis (its full text stays in the DOM, so a
 *    screen reader reads all of it); the full title shows on hover, or on a long-press on touch.
 *    The channel in 14px (DESIGN.md's floor), then Shrink/Expand and Close, 44px each. Shrunk,
 *    the channel is visually hidden (still the dialog's description), so the title has room.
 *  - Keyboard: Escape closes (shrunk: only while focus is in the player, so Esc on the page keeps
 *    its own meaning, e.g. minimising LISA). Focus moves into the player on open, stays on the
 *    toggle across shrink/expand, and returns to `returnFocusTo` (the Watch button) on close.
 *
 * edge cases: the player is rendered inside the card, so it closes with it: LISA's Close (which
 * unmounts the panel) or moving to another question's thread closes the video; LISA's Minimize
 * keeps the panel mounted, so a shrunk video keeps playing.
 *
 * @spec [owner brief "Phase C follow-up: show the segment, not the whole video", Karl
 *       2026-11-04: "the student saw the whole 6:38 video" because the action carried only the
 *       start, `start` went in only above 0, and nothing set an end] | @implemented [2026-11-04]
 *
 * plain English, a served segment (the action carries `end_seconds`):
 *  - The embed gets `start` at the segment start, 0 included, and YouTube's `end` at the segment
 *    end, so playback stops there. A whole video (the skill path, `end_seconds` null) gets
 *    exactly the URL it always did.
 *  - Under the header, one line: "Showing 0:00–2:39 of 6:38" and a "Watch full video" control.
 *    It is the student's choice, never automatic. Pressing it reloads the same frame (the same
 *    iframe element, never remounted) with no `end`, from where the student is, and playing;
 *    `onWatchFull` records the press (the segment id only). Shrink and expand still never
 *    reload it: they do not touch the source.
 *  - "Where the student is" is read from the player itself: a segment embed has
 *    `enablejsapi=1`, and the frame's own `infoDelivery` messages (accepted only from the
 *    youtube-nocookie.com origin and this frame's window) carry `currentTime`. With no reading
 *    yet, it resumes at the segment start, which never skips anything.
 *  - A segment that spans the whole video shows no line: there is nothing more to watch.
 */
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Maximize2, Minimize2, X } from "lucide-react";
import { useActiveThemeLock } from "@/components/layout/theme-lock";
import { LYC_FOCUS } from "@/components/ui/button";
import type { TutorVideo } from "@/hooks/tutor-client";
import { DockedLisaPanelContext } from "@/components/tutor/docked-lisa-panel";
import {
  useBottomChromeHeight,
  type BottomChromeLayer,
} from "@/lib/bottom-chrome";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** The expanded player's share of the viewport on its binding side (brief: about 90–95%). */
export const PLAYER_VIEWPORT_SHARE = 0.94;
/** The header's height: one line. */
export const PLAYER_HEADER_PX = 48;
/** The segment line's height (one line, its control 44px), under the header when shown. */
export const SEGMENT_LINE_PX = 44;
/** The shrunk player's width (at most the screen less its margins). */
export const MINI_PLAYER_WIDTH_PX = 360;
/** The shrunk player's distance from the screen edge and from the bottom chrome. */
export const MINI_PLAYER_EDGE_PX = 16;
/** How long a touch on the title must last to show the full title. */
export const LONG_PRESS_MS = 500;

const TAB_BAR: readonly BottomChromeLayer[] = ["tab-bar"];
const RUNNER_FOOTER: readonly BottomChromeLayer[] = ["runner-footer"];
const DOCK_BUBBLE: readonly BottomChromeLayer[] = ["dock-bubble"];

export type PlayerSize = "expanded" | "shrunk";

/** The embed's origin: the only origin whose player messages are read. */
export const EMBED_ORIGIN = "https://www.youtube-nocookie.com";

/** "m:ss", or "h:mm:ss" past an hour. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/** A served segment: the action carries its end. The skill path (a whole video) has none. */
export function isSegment(video: TutorVideo): boolean {
  return video.end_seconds !== null;
}

/** The segment's window, or null for a whole video or a segment that spans all of it. */
export function segmentLabel(video: TutorVideo): string | null {
  if (video.end_seconds === null) return null;
  const start = video.start_seconds ?? 0;
  if (start <= 0 && video.end_seconds >= video.duration_seconds) return null;
  return `Showing ${formatDuration(start)}–${formatDuration(video.end_seconds)} of ${formatDuration(video.duration_seconds)}`;
}

/**
 * The embed URL, or null for an id that isn't a YouTube video id.
 *  - Whole video: `start` only when above 0, as before.
 *  - Segment: `start` always (0 included) and `end`, plus `enablejsapi` so the frame reports
 *    its position.
 *  - Segment widened (`full`): no `end`, from `resumeAt` (where the student was), playing.
 */
export function videoEmbedUrl(
  video: TutorVideo,
  opts: { full?: boolean; resumeAt?: number | null } = {},
): string | null {
  if (!VIDEO_ID.test(video.video_id)) return null;
  const params = new URLSearchParams({ rel: "0" });
  if (video.end_seconds === null) {
    if (video.start_seconds !== null && video.start_seconds > 0) {
      params.set("start", String(Math.floor(video.start_seconds)));
    }
  } else if (opts.full === true) {
    const at = opts.resumeAt ?? video.start_seconds ?? 0;
    params.set("start", String(Math.max(0, Math.floor(at))));
    params.set("autoplay", "1");
    params.set("enablejsapi", "1");
  } else {
    params.set("start", String(Math.floor(video.start_seconds ?? 0)));
    params.set("end", String(Math.ceil(video.end_seconds)));
    params.set("enablejsapi", "1");
  }
  return `${EMBED_ORIGIN}/embed/${video.video_id}?${params.toString()}`;
}

const DELIVERY = /"event"\s*:\s*"(?:info|initial)Delivery"/;
const CURRENT_TIME = /"currentTime"\s*:\s*(\d+(?:\.\d+)?)/;

/**
 * The position a player message reports, or null. Read by pattern, not JSON.parse, so a string
 * that is not a player message is simply not one: nothing to catch.
 */
export function playerTime(data: unknown): number | null {
  if (typeof data !== "string" || !DELIVERY.test(data)) return null;
  const m = CURRENT_TIME.exec(data);
  return m?.[1] === undefined ? null : Number(m[1]);
}

/** The frame's position, from its own `infoDelivery` messages; null until the first one. */
function usePlayerPosition(
  frame: RefObject<HTMLIFrameElement>,
  active: boolean,
): RefObject<number | null> {
  const position = useRef<number | null>(null);
  useEffect(() => {
    if (!active) return undefined;
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== EMBED_ORIGIN) return;
      if (event.source !== frame.current?.contentWindow) return;
      const time = playerTime(event.data);
      if (time !== null) position.current = time;
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame, active]);
  return position;
}

const SHARE = String(Math.round(PLAYER_VIEWPORT_SHARE * 100));
/**
 * Expanded, 768px and up: the binding side at SHARE% of the viewport, the frame 16:9 under
 * `chromePx` of header (and segment line, when one shows).
 */
function expandedWidth(chromePx: number): string {
  return `min(${SHARE}vw, calc((${SHARE}dvh - ${chromePx}px) * 16 / 9))`;
}

export function TutorVideoModal({
  video,
  open,
  onOpenChange,
  returnFocusTo,
  onWatchFull,
}: {
  video: TutorVideo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Focused again when the player closes: the control that opened it. */
  returnFocusTo?: RefObject<HTMLElement>;
  /** "Watch full video" was pressed on a served segment (its id). */
  onWatchFull?: (segmentId: string) => void;
}): JSX.Element | null {
  const src = videoEmbedUrl(video);
  if (src === null) return null;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      {open ? (
        <VideoPlayer
          video={video}
          onClose={() => onOpenChange(false)}
          returnFocusTo={returnFocusTo}
          onWatchFull={onWatchFull}
        />
      ) : null}
    </DialogPrimitive.Root>
  );
}

/** Mounted per open, so every open starts expanded, and a segment starts as the segment. */
function VideoPlayer({
  video,
  onClose,
  returnFocusTo,
  onWatchFull,
}: {
  video: TutorVideo;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLElement> | undefined;
  onWatchFull: ((segmentId: string) => void) | undefined;
}): JSX.Element {
  const [size, setSize] = useState<PlayerSize>("expanded");
  const expanded = size === "expanded";
  // Null while the segment plays; the resume point once the student widens it.
  const [widenedAt, setWidenedAt] = useState<number | null>(null);
  const full = widenedAt !== null;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const segment = isSegment(video);
  const position = usePlayerPosition(frameRef, segment);
  const src =
    videoEmbedUrl(video, full ? { full: true, resumeAt: widenedAt } : {}) ?? "";
  const label = full ? null : segmentLabel(video);
  const watchFull = (): void => {
    setWidenedAt(position.current ?? video.start_seconds ?? 0);
    if (video.segment_id !== null) onWatchFull?.(video.segment_id);
  };
  // The portal's wrapper, once Radix has mounted it on <body>.
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const themeLock = useActiveThemeLock();
  const tabBar = useBottomChromeHeight(TAB_BAR);
  const footer = useBottomChromeHeight(RUNNER_FOOTER);
  const launcher = useBottomChromeHeight(DOCK_BUBBLE);
  // The launcher sits one edge above the footer (ChatDock); shrunk, the player sits above it.
  const lift =
    Math.max(tabBar, footer) +
    (launcher > 0 ? launcher + MINI_PLAYER_EDGE_PX : 0);
  const column = useDockedPanelBox(
    useContext(DockedLisaPanelContext),
    !expanded,
  );
  useInertOutside(host, expanded);

  const focusIsInside = (): boolean =>
    contentRef.current?.contains(document.activeElement) ?? false;

  return (
    <DialogPrimitive.Portal>
      <div
        ref={setHost}
        className="lyc contents"
        data-theme-lock={themeLock ?? undefined}
      >
        {expanded ? (
          // Outside the content: a press here is an outside press, which closes (Radix).
          <div
            aria-hidden="true"
            className="fixed inset-0 z-50 bg-lyc-scrim"
            data-testid="tutor-video-scrim"
          />
        ) : null}
        <DialogPrimitive.Content
          ref={contentRef}
          aria-modal={expanded}
          data-testid="tutor-video-modal"
          data-size={size}
          onEscapeKeyDown={(event) => {
            if (!expanded && !focusIsInside()) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            // Shrunk, the page is the student's: working on it never closes the player.
            if (!expanded) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const opener = returnFocusTo?.current;
            if (opener?.isConnected === true) opener.focus();
          }}
          className={
            expanded
              ? "fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-lyc-rule bg-lyc-paper text-lyc-ink max-md:inset-0 max-md:h-[100dvh] max-md:!w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:border-0 max-md:bg-black"
              : "fixed z-50 flex flex-col overflow-hidden rounded-lg border border-lyc-rule-strong bg-lyc-paper text-lyc-ink"
          }
          style={
            expanded
              ? {
                  width: expandedWidth(
                    PLAYER_HEADER_PX + (label !== null ? SEGMENT_LINE_PX : 0),
                  ),
                }
              : shrunkStyle(lift, column)
          }
        >
          <PlayerHeader
            title={video.title}
            channel={video.channel_name}
            expanded={expanded}
            onToggleSize={() => setSize(expanded ? "shrunk" : "expanded")}
            onClose={onClose}
          />
          {label !== null ? (
            <SegmentLine label={label} onWatchFull={watchFull} />
          ) : null}
          <div className="flex min-h-0 flex-1 items-center bg-black">
            <div
              className="relative aspect-video w-full"
              data-testid="tutor-video-frame"
            >
              <iframe
                ref={frameRef}
                src={src}
                onLoad={() => {
                  // Ask a segment's player to report its position (YouTube's widget protocol).
                  if (!segment) return;
                  frameRef.current?.contentWindow?.postMessage(
                    JSON.stringify({
                      event: "listening",
                      id: 1,
                      channel: "widget",
                    }),
                    EMBED_ORIGIN,
                  );
                }}
                title={video.title}
                className="absolute inset-0 h-full w-full"
                allow="encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                data-testid="tutor-video-embed"
              />
            </div>
          </div>
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  );
}

/** The docked LISA panel's box, in px from the viewport's right and bottom edges. */
type PanelBox = { right: number; bottom: number; width: number };

/** Shrunk: inside LISA's docked column when there is one, else the screen's bottom-right. */
function shrunkStyle(lift: number, column: PanelBox | null): CSSProperties {
  if (column !== null) {
    return {
      width: column.width,
      right: column.right,
      bottom: Math.max(lift, column.bottom) + MINI_PLAYER_EDGE_PX,
    };
  }
  return {
    width: `min(${MINI_PLAYER_WIDTH_PX}px, calc(100vw - ${MINI_PLAYER_EDGE_PX * 2}px))`,
    right: `calc(${MINI_PLAYER_EDGE_PX}px + env(safe-area-inset-right, 0px))`,
    bottom: `calc(${lift + MINI_PLAYER_EDGE_PX}px + env(safe-area-inset-bottom, 0px))`,
  };
}

/**
 * While `active`, the box of `panel` (the runner's docked LISA panel), kept current on resize.
 * Null with no panel, or while it is hidden (LISA minimised): the player then takes the corner.
 */
function useDockedPanelBox(
  panel: RefObject<HTMLElement> | null,
  active: boolean,
): PanelBox | null {
  const [box, setBox] = useState<PanelBox | null>(null);
  // Before paint, so the first shrunk frame is already in the column.
  useLayoutEffect(() => {
    const el = panel?.current ?? null;
    if (!active || el === null) {
      setBox(null);
      return undefined;
    }
    const measure = (): void => {
      const r = el.getBoundingClientRect();
      const next =
        r.width > 0
          ? {
              right: Math.max(0, window.innerWidth - r.right),
              bottom: Math.max(0, window.innerHeight - r.bottom),
              width: r.width,
            }
          : null;
      setBox((prev) =>
        prev !== null &&
        next !== null &&
        prev.right === next.right &&
        prev.bottom === next.bottom &&
        prev.width === next.width
          ? prev
          : next,
      );
    };
    measure();
    window.addEventListener("resize", measure);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [panel, active]);
  return box;
}

/** Under the header: the segment's window, and the student's choice to watch the rest. */
function SegmentLine({
  label,
  onWatchFull,
}: {
  label: string;
  onWatchFull: () => void;
}): JSX.Element {
  return (
    <div
      className="flex shrink-0 items-center justify-between gap-3 border-b border-lyc-rule bg-lyc-paper pl-4 pr-2"
      style={{ height: SEGMENT_LINE_PX }}
      data-testid="tutor-video-segment"
    >
      <span
        className="min-w-0 truncate text-lyc-meta text-lyc-muted"
        data-testid="tutor-video-segment-label"
      >
        {label}
      </span>
      <button
        type="button"
        onClick={onWatchFull}
        className={`${LYC_FOCUS} h-11 shrink-0 whitespace-nowrap rounded-md px-2 text-lyc-meta font-semibold text-lyc-ink-strong underline hover:bg-lyc-hover`}
        data-testid="tutor-video-watch-full"
      >
        Watch full video
      </button>
    </div>
  );
}

const CONTROL_CLASS = `${LYC_FOCUS} flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-lyc-ink-strong hover:bg-lyc-hover [&_svg]:h-5 [&_svg]:w-5`;

function PlayerHeader({
  title,
  channel,
  expanded,
  onToggleSize,
  onClose,
}: {
  title: string;
  channel: string;
  expanded: boolean;
  onToggleSize: () => void;
  onClose: () => void;
}): JSX.Element {
  const [pressed, setPressed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPress = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancelPress, []);

  return (
    <div
      className="relative flex shrink-0 items-center gap-3 border-b border-lyc-rule bg-lyc-paper pl-4 pr-1"
      style={{ height: PLAYER_HEADER_PX }}
      data-testid="tutor-video-header"
      // The next touch anywhere in the header puts a long-pressed title away.
      onPointerDownCapture={() => {
        if (pressed) setPressed(false);
      }}
    >
      <div className="group min-w-0 flex-1">
        <DialogPrimitive.Title
          className="m-0 truncate text-lyc-body font-semibold text-lyc-ink-strong"
          data-testid="tutor-video-modal-title"
          onPointerDown={(event) => {
            if (event.pointerType !== "touch") return;
            cancelPress();
            timer.current = setTimeout(() => {
              timer.current = null;
              setPressed(true);
            }, LONG_PRESS_MS);
          }}
          onPointerUp={cancelPress}
          onPointerLeave={cancelPress}
          onPointerCancel={cancelPress}
          // A long-press would otherwise open the browser's own menu over the title.
          onContextMenu={(event) => event.preventDefault()}
        >
          {title}
        </DialogPrimitive.Title>
        <FullTitle shown={pressed}>{title}</FullTitle>
      </div>
      {/* Shrunk, the channel gives its room to the title; it stays the dialog's description. */}
      <DialogPrimitive.Description
        className={
          expanded
            ? "m-0 max-w-[40%] shrink-0 truncate text-lyc-meta text-lyc-muted"
            : "sr-only"
        }
        data-testid="tutor-video-modal-channel"
      >
        {channel}
      </DialogPrimitive.Description>
      <div className="flex shrink-0 items-center">
        <button
          type="button"
          className={CONTROL_CLASS}
          aria-label={expanded ? "Shrink video" : "Expand video"}
          onClick={onToggleSize}
          data-testid="tutor-video-size"
        >
          {expanded ? (
            <Minimize2 aria-hidden="true" />
          ) : (
            <Maximize2 aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className={CONTROL_CLASS}
          aria-label="Close video"
          onClick={onClose}
          data-testid="tutor-video-close"
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** The full title, under the header: on hover (CSS), or while `shown` (a long-press). */
function FullTitle({
  shown,
  children,
}: {
  shown: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <p
      aria-hidden="true"
      className={`pointer-events-none absolute left-2 right-2 top-full z-10 m-0 mt-1 rounded-md border border-lyc-rule-strong bg-lyc-paper px-3 py-2 text-lyc-body text-lyc-ink-strong ${shown ? "block" : "hidden group-hover:block"}`}
      data-testid="tutor-video-full-title"
      data-shown={shown ? "true" : "false"}
    >
      {children}
    </p>
  );
}

/**
 * While `active`, every other child of <body> is `inert` (no focus, no clicks, hidden from
 * assistive tech): the expanded player is a modal. `host` is the player's portal wrapper; the
 * <body> child holding it is left alone. Restores exactly what it set, so an element that was
 * already inert stays inert.
 */
function useInertOutside(host: HTMLElement | null, active: boolean): void {
  useEffect(() => {
    if (!active || host === null) return undefined;
    let own: Element | null = host;
    while (own !== null && own.parentElement !== document.body) {
      own = own.parentElement;
    }
    const set: HTMLElement[] = [];
    for (const child of Array.from(document.body.children)) {
      if (child === own || !(child instanceof HTMLElement) || child.inert) {
        continue;
      }
      child.inert = true;
      set.push(child);
    }
    return () => {
      for (const el of set) el.inert = false;
    };
  }, [host, active]);
}
