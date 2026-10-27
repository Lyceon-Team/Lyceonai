/**
 * The LISA launcher: the chat dock's collapsed state, a speech-bubble-shaped "Ask LISA" button.
 *
 * @spec [owner brief "LISA launcher redesign + placement" (Karl, 2026-10-23; option D): "a
 *        speech-bubble launcher with a sparkle icon"; "rounded corners with the bottom-right
 *        corner tighter (14px / 4px)", label "Ask LISA", "Lyceon accent fill with its on-accent
 *        text (tokens only)", "one line, ~40px tall"; accessible name "Ask LISA"; visible focus
 *        ring; free students: "same shape with a lock icon in place of the sparkle"]
 *       [owner ruling (Karl, 2026-10-23): the icon is lucide-react's `Sparkles` (already
 *        installed; "the brief's 'Tabler sparkles' meant the sparkle concept, not the package"),
 *        kept in ONE component (`LisaSparkle`); the free variant reuses the rail's lucide `Lock`]
 *       [DESIGN.md §1 (tokens only, 14px floor, focus ring), §3 Chat dock]
 * @implemented [2026-10-23]
 *
 * plain English:
 *   - One line, 40px tall and a fixed 132px wide (fixed so the runners can keep exactly its
 *     footprint clear: DOCK_CLEARANCE_PX in ChatDock). 14px corners, the bottom-right one 4px: the
 *     corner a speech bubble's tail sits in, pointing at the screen's corner it grows from.
 *   - Filled with the Lyceon accent (`--primary-bg`) and its on-accent ink (`--primary-ink`), in
 *     both themes. The fill is the APPROVED exception to DESIGN.md §5's one-filled-button rule:
 *     persistent floating chrome, not a page action (Karl, ruling of 2026-10-24, on the option D
 *     he chose on 2026-10-23); recorded in DESIGN.md §3 and §5.
 *   - Locked: the same shape and fill, the lock in the sparkle's place; the accessible name adds
 *     the rail's lock suffix ("Ask LISA, included with a paid plan").
 */
import { forwardRef } from "react";
import { Lock, Sparkles } from "lucide-react";
import { LYC_FOCUS } from "@/components/ui/button";

/** The launcher's accessible name and visible label (owner brief). */
export const LISA_LAUNCHER_LABEL = "Ask LISA";

/** The launcher's fixed size, in px: one 40px line, wide enough for the icon and the label. */
export const LISA_LAUNCHER_WIDTH_PX = 132;
const LISA_LAUNCHER_HEIGHT_PX = 40;

/**
 * LISA's sparkle: the ONE icon component for it (owner ruling, Karl, 2026-10-23), drawn by the
 * launcher and by the dock panel's header.
 */
export function LisaSparkle({
  className = "h-[18px] w-[18px]",
}: {
  className?: string;
}): JSX.Element {
  return (
    <Sparkles
      aria-hidden="true"
      data-testid="lisa-sparkle"
      className={className}
      strokeWidth={2}
    />
  );
}

type LisaLauncherProps = {
  /** The accessible name: "Ask LISA", plus the lock suffix when locked. */
  label: string;
  locked: boolean;
  onClick: () => void;
};

export const LisaLauncher = forwardRef<HTMLButtonElement, LisaLauncherProps>(
  function LisaLauncher({ label, locked, onClick }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-haspopup={locked ? "dialog" : undefined}
        aria-expanded={locked ? undefined : false}
        data-testid="chat-dock-bubble"
        data-locked={locked ? "true" : undefined}
        className={`${LYC_FOCUS} pointer-events-auto inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[14px] rounded-br-[4px] border-0 bg-lyc-primary-bg px-3 font-lyc-sans text-lyc-body font-semibold leading-none text-lyc-primary-ink hover:brightness-110`}
        style={{
          width: LISA_LAUNCHER_WIDTH_PX,
          height: LISA_LAUNCHER_HEIGHT_PX,
        }}
        onClick={onClick}
      >
        {locked ? (
          <Lock
            aria-hidden="true"
            data-testid="chat-dock-lock"
            className="h-[18px] w-[18px]"
            strokeWidth={2.25}
          />
        ) : (
          <LisaSparkle />
        )}
        <span aria-hidden="true">{LISA_LAUNCHER_LABEL}</span>
      </button>
    );
  },
);
