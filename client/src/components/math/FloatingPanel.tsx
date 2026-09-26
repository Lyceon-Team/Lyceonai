/**
 * A floating, draggable tool panel (the exam's calculator, E10b).
 *
 * @spec [Doc-02B_v4 §28 (Desmos on Math, collapsible); E10b brief (floating, movable,
 *        Expand + close in the header, stays inside the viewport, never covers the timer,
 *        keyboard-closable with focus returned)] | @implemented [2026-09-26]
 *
 * plain English: a fixed-position panel with a header bar the student drags it by, an
 * Expand toggle and a close button. It is ALWAYS mounted by its owner and hidden when
 * closed (`open={false}` -> display: none), so whatever it holds — a calculator — is
 * collapsed, not destroyed; its position lives here, so it persists for as long as the
 * owner is mounted (the exam: one module).
 *
 * WHY IT LIVES IN components/math: practice and review have no floating wrapper (they dock
 * the calculator in a resizable split), and a second drag implementation per surface is
 * the divergence E10b exists to avoid. It sits beside DesmosCalculator and
 * calculator-layout so any surface can reach it; today only the exam uses it.
 *
 * Bounds: the panel never crosses `topBoundRef`'s bottom edge (the exam header, which holds
 * the timer) and never leaves the viewport. A viewport too short for the panel shrinks the
 * panel to what is available, never lets it overlap the bound.
 *
 * Pointer safety: the drag bar calls preventDefault on pointerdown/mousedown, so starting
 * a drag never moves focus (a half-typed grid-in answer keeps focus), and pointer capture
 * keeps every move/up on the bar, so nothing underneath receives them.
 *
 * Keyboard: opening focuses the panel; Escape inside it, or its close button, closes it
 * and returns focus to `returnFocusRef` (the button that opened it). The drag bar is
 * mouse/touch only, which the brief accepts; closing never needs a pointer.
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

type Point = { x: number; y: number };
type Size = { width: number; height: number };

/** Gap kept from the viewport edges and from the top bound when placing by default. */
const EDGE_GAP_PX = 16;

type FloatingPanelProps = {
  id: string;
  title: string;
  open: boolean;
  onClose: () => void;
  /** Focus goes here whenever the panel closes itself (close button, Escape). */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  /** The panel never crosses this element's bottom edge (e.g. a header holding a timer). */
  topBoundRef: React.RefObject<HTMLElement | null>;
  /** Collapsed size. */
  width: number;
  height: number;
  /** Expanded width as a percentage of the viewport; never less than `width`. */
  expandedWidthPct: number;
  children: React.ReactNode;
};

function useViewport(): Size {
  const read = (): Size => ({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [viewport, setViewport] = useState<Size>(read);
  useEffect(() => {
    const onResize = (): void => setViewport(read());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return viewport;
}

/** Pure: the panel's box inside the viewport, below the top bound. Exported for tests. */
export function clampPanel(
  wanted: Point,
  size: Size,
  viewport: Size,
  topBound: number,
): Point & Size {
  const width = Math.min(size.width, viewport.width);
  const height = Math.min(size.height, Math.max(0, viewport.height - topBound));
  const x = Math.min(
    Math.max(wanted.x, 0),
    Math.max(0, viewport.width - width),
  );
  const y = Math.min(
    Math.max(wanted.y, topBound),
    Math.max(topBound, viewport.height - height),
  );
  return { x, y, width, height };
}

export function FloatingPanel({
  id,
  title,
  open,
  onClose,
  returnFocusRef,
  topBoundRef,
  width,
  height,
  expandedWidthPct,
  children,
}: FloatingPanelProps): React.ReactElement {
  const viewport = useViewport();
  const [topBound, setTopBound] = useState(0);
  const [wanted, setWanted] = useState<Point | null>(null);
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ pointerId: number; dx: number; dy: number } | null>(
    null,
  );

  // The bound is measured, not assumed: the header can wrap on a narrow screen.
  useLayoutEffect(() => {
    if (!open) return;
    const el = topBoundRef.current;
    setTopBound(el === null ? 0 : el.getBoundingClientRect().bottom);
  }, [open, viewport, topBoundRef]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const size: Size = expanded
    ? {
        width: Math.max(
          width,
          Math.round((viewport.width * expandedWidthPct) / 100),
        ),
        height: viewport.height - topBound - EDGE_GAP_PX,
      }
    : { width, height };
  const box = clampPanel(
    wanted ?? { x: EDGE_GAP_PX, y: topBound + EDGE_GAP_PX },
    size,
    viewport,
    topBound,
  );

  const close = useCallback((): void => {
    onClose();
    returnFocusRef.current?.focus();
  }, [onClose, returnFocusRef]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest("button") !== null)
      return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      pointerId: e.pointerId,
      dx: e.clientX - box.x,
      dy: e.clientY - box.y,
    };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d === null || d.pointerId !== e.pointerId) return;
    // Stored already clamped, so a later resize starts from where the panel really is.
    const next = clampPanel(
      { x: e.clientX - d.dx, y: e.clientY - d.dy },
      size,
      viewport,
      topBound,
    );
    setWanted({ x: next.x, y: next.y });
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      id={id}
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
      style={{
        position: "fixed",
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        display: open ? "flex" : "none",
      }}
      className="z-40 flex-col overflow-hidden rounded-xl border border-[var(--exam-line)] bg-[var(--exam-surface)] shadow-2xl outline-none"
      data-testid="floating-panel"
      data-expanded={String(expanded)}
    >
      <div
        onPointerDown={onPointerDown}
        onMouseDown={(e) => {
          if (
            e.target instanceof Element &&
            e.target.closest("button") !== null
          )
            return;
          e.preventDefault();
        }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ touchAction: "none" }}
        className="flex h-12 shrink-0 cursor-grab select-none items-center justify-between gap-2 border-b border-[var(--exam-line)] bg-[var(--exam-bg,var(--exam-surface))] px-4 active:cursor-grabbing"
        data-testid="floating-panel-drag-bar"
      >
        <span id={`${id}-title`} className="text-[13px] font-semibold">
          {title}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-pressed={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="min-h-[44px] rounded-lg px-3 text-[13px] font-medium text-[var(--exam-muted)]"
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
          <button
            type="button"
            aria-label={`Close ${title.toLowerCase()}`}
            onClick={close}
            className="min-h-[44px] min-w-[44px] text-lg text-[var(--exam-muted)]"
          >
            ×
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
