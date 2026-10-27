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

/** The embed URL, or null for an id that isn't a YouTube video id. */
export function videoEmbedUrl(video: TutorVideo): string | null {
  if (!VIDEO_ID.test(video.video_id)) return null;
  const params = new URLSearchParams({ rel: "0" });
  if (video.start_seconds !== null && video.start_seconds > 0) {
    params.set("start", String(Math.floor(video.start_seconds)));
  }
  return `https://www.youtube-nocookie.com/embed/${video.video_id}?${params.toString()}`;
}

const SHARE = String(Math.round(PLAYER_VIEWPORT_SHARE * 100));
/** Expanded, 768px and up: the binding side at SHARE% of the viewport, the frame 16:9. */
const EXPANDED_WIDTH = `min(${SHARE}vw, calc((${SHARE}dvh - ${PLAYER_HEADER_PX}px) * 16 / 9))`;

export function TutorVideoModal({
  video,
  open,
  onOpenChange,
  returnFocusTo,
}: {
  video: TutorVideo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Focused again when the player closes: the control that opened it. */
  returnFocusTo?: RefObject<HTMLElement>;
}): JSX.Element | null {
  const src = videoEmbedUrl(video);
  if (src === null) return null;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      {open ? (
        <VideoPlayer
          video={video}
          src={src}
          onClose={() => onOpenChange(false)}
          returnFocusTo={returnFocusTo}
        />
      ) : null}
    </DialogPrimitive.Root>
  );
}

/** Mounted per open, so every open starts expanded. */
function VideoPlayer({
  video,
  src,
  onClose,
  returnFocusTo,
}: {
  video: TutorVideo;
  src: string;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLElement> | undefined;
}): JSX.Element {
  const [size, setSize] = useState<PlayerSize>("expanded");
  const expanded = size === "expanded";
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
            expanded ? { width: EXPANDED_WIDTH } : shrunkStyle(lift, column)
          }
        >
          <PlayerHeader
            title={video.title}
            channel={video.channel_name}
            expanded={expanded}
            onToggleSize={() => setSize(expanded ? "shrunk" : "expanded")}
            onClose={onClose}
          />
          <div className="flex min-h-0 flex-1 items-center bg-black">
            <div
              className="relative aspect-video w-full"
              data-testid="tutor-video-frame"
            >
              <iframe
                src={src}
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
