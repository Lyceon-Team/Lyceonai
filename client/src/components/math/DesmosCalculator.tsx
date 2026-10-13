/**
 * @spec [Doc-02B_v4, §28 Math Tooling: Desmos and Formula Sheet] | @implemented [2026-07-26]
 * Desmos calculator with graphing/scientific mode toggle and Bluebook-parity resizable panel.
 * Opens on Scientific; both calculators start in degrees (owner brief 2026-10-11). Each tab's
 * calculator is created once and kept across mode switches (one host per tab, the hidden one
 * `display: none`); a pending save is flushed synchronously before switching. The session payload persisted through
 * onStateChange is the full { graphing, scientific } map so both modes survive
 * reload. Legacy sessions that stored a single graphing-shaped blob are
 * recognized and loaded as graphing-only (backward compatible).
 *
 * fillHeight mode: when true, the calculator fills its container vertically
 * (for use inside a resizable side panel). A ResizeObserver on the host element
 * throttles resize() calls to rAF during divider drag.
 */
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  useSyncExternalStore,
} from "react";
import { readPaintedThemeAt, subscribePaintedTheme } from "@/lib/theme";

declare global {
  interface DesmosCalculatorInstance {
    setState: (state: unknown) => void;
    getState: () => unknown;
    resize: () => void;
    destroy: () => void;
    observeEvent: (event: string, cb: () => void) => void;
    unobserveEvent: (event: string, cb: () => void) => void;
    updateSettings: (settings: Record<string, unknown>) => void;
  }

  interface Window {
    Desmos?: {
      GraphingCalculator: new (
        element: HTMLElement,
        options?: Record<string, unknown>,
      ) => DesmosCalculatorInstance;
      ScientificCalculator: new (
        element: HTMLElement,
        options?: Record<string, unknown>,
      ) => DesmosCalculatorInstance;
    };
  }
}

/**
 * @spec [F-24 / Brief 7: type-only fix, behaviour unchanged] | @implemented [2026-09-30] | plain
 * English: the "change" handler registered on each Desmos instance, so it can be unobserved before
 * the instance is destroyed. It used to be stored as an expando property on the instance
 * (`__lyceonChangeHandler`), which needed casts the compiler rejected; a WeakMap keyed by the
 * instance holds the same association with no cast and lets a destroyed instance be collected.
 */
const changeHandlers = new WeakMap<DesmosCalculatorInstance, () => void>();

let desmosScriptPromise: Promise<void> | null = null;
let desmosScriptLoaded = false;

function loadDesmosScriptOnce(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (window.Desmos?.GraphingCalculator) {
    desmosScriptLoaded = true;
    return Promise.resolve();
  }

  if (desmosScriptLoaded) {
    return Promise.resolve();
  }

  if (desmosScriptPromise) {
    return desmosScriptPromise;
  }

  const rawApiKey = import.meta.env.VITE_DESMOS_API_KEY;
  const apiKey = typeof rawApiKey === "string" ? rawApiKey.trim() : "";
  if (!apiKey) {
    return Promise.reject(
      new Error("Desmos calculator unavailable: missing VITE_DESMOS_API_KEY"),
    );
  }

  desmosScriptPromise = new Promise<void>((resolve, reject) => {
    const fail = () => {
      desmosScriptPromise = null;
      reject(new Error("Failed to load Desmos script"));
    };

    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-desmos="graphing-calculator"]',
    );
    if (existing) {
      if (existing.dataset.loaded === "true") {
        desmosScriptLoaded = true;
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", fail, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = `https://www.desmos.com/api/v1.11/calculator.js?apiKey=${encodeURIComponent(apiKey)}`;
    script.async = true;
    script.defer = true;
    script.dataset.desmos = "graphing-calculator";
    script.onload = () => {
      script.dataset.loaded = "true";
      desmosScriptLoaded = true;
      resolve();
    };
    script.onerror = fail;
    document.head.appendChild(script);
  });

  return desmosScriptPromise;
}

type CalculatorMode = "graphing" | "scientific";

type PerModeState = {
  graphing: unknown | null;
  scientific: unknown | null;
};

function isPerModePayload(v: unknown): v is PerModeState {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return (
    Object.prototype.hasOwnProperty.call(obj, "graphing") &&
    Object.prototype.hasOwnProperty.call(obj, "scientific")
  );
}

function parseInitialState(raw: unknown | null): PerModeState {
  if (!raw) return { graphing: null, scientific: null };
  if (isPerModePayload(raw)) {
    return {
      graphing: raw.graphing ?? null,
      scientific: raw.scientific ?? null,
    };
  }
  return { graphing: raw, scientific: null };
}

type DesmosCalculatorProps = {
  className?: string;
  expanded: boolean;
  initialState?: unknown | null;
  onStateChange?: (state: unknown) => void;
  debounceMs?: number;
  fillHeight?: boolean;
  /**
   * Filled with a function that emits any change still inside the debounce, now, through
   * `onStateChange` — so a caller about to save (leaving the question) sees the last keystroke.
   */
  flushRef?: React.MutableRefObject<(() => void) | null>;
  /**
   * The component's own save moments: a tab switch, the calculator closing (`expanded` going
   * false) and unmount. Called after any pending change has been emitted.
   */
  onCommit?: () => void;
};

const EXPANDED_HEIGHT_GRAPHING = 520;
const EXPANDED_HEIGHT_SCIENTIFIC = 400;

/**
 * @spec [production QA 2026-10-07 item 12 (Karl: the Desmos "Scientific" tab contrast in dark
 *       mode); DESIGN.md §1 (student tokens only, nothing below 14px)] | @implemented [2026-10-07]
 * plain English: our own mode switch above the Desmos host, drawn with the student tokens, so it
 * follows the page's theme (the practice and review runners follow the device; the timed module
 * is pinned light). It used the app-wide light tokens at 12px: in dark mode the selected tab was
 * a cream block and the other tab's label all but vanished into the panel. Desmos's own UI inside
 * the host is not styled here.
 */
const MODE_TAB =
  "flex-1 rounded px-3 py-1.5 text-lyc-meta font-semibold transition-colors";
const MODE_TAB_ON =
  "bg-lyc-sheet text-lyc-ink-strong shadow-sm ring-1 ring-inset ring-lyc-rule-strong";
const MODE_TAB_OFF = "bg-transparent text-lyc-ink hover:bg-lyc-hover";

export default function DesmosCalculator({
  className,
  expanded,
  initialState = null,
  onStateChange,
  debounceMs = 600,
  fillHeight = false,
  flushRef,
  onCommit,
}: DesmosCalculatorProps): React.ReactElement {
  /**
   * @spec [Doc-02B_v4 §28; owner brief 2026-10-11 ("default to Scientific + DEG, and fix the
   *       keypad"; "switching tabs keeps each calculator's state, no re-creation on switch")]
   * @implemented [2026-10-11]
   * plain English: ONE Desmos calculator per tab, each in its own host inside the same bordered
   * box, created the first time its tab is shown and never again while the component is mounted.
   * Switching tabs only shows one host and hides the other (then `resize()`s the one shown), so
   * each calculator keeps its expressions, cursor and keypad. Both start in degrees
   * (`degreeMode: true`) and the component opens on Scientific.
   *
   * THE KEYPAD BUG this replaces: every caller stores the state this component emits and passes
   * it straight back as `initialState` (ExamModulePage `setCalculatorState`/`calculatorState`,
   * CanonicalPracticePage `onCalculatorStateChange`/`localCalculatorState`). The old code applied
   * every new `initialState` with `setState` on the live Graphing calculator, so ~600 ms after
   * each pause in typing the calculator was reset under the student: the expression being
   * edited lost focus, Desmos's keypad closed, and the next presses went nowhere. Now an
   * `initialState` equal to what this component last emitted is recognised as its own echo and
   * ignored; only a genuinely different state (a resume) is applied.
   */
  const hostRefs = useRef<Record<CalculatorMode, HTMLDivElement | null>>({
    graphing: null,
    scientific: null,
  });
  const calcRefs = useRef<
    Record<CalculatorMode, DesmosCalculatorInstance | null>
  >({
    graphing: null,
    scientific: null,
  });
  const boxRef = useRef<HTMLDivElement | null>(null);
  const debounceRefs = useRef<Record<CalculatorMode, number | null>>({
    graphing: null,
    scientific: null,
  });
  const onStateChangeRef = useRef(onStateChange);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [desmosReady, setDesmosReady] = useState(false);
  const [mode, setMode] = useState<CalculatorMode>("scientific");
  const modeStateRef = useRef<PerModeState>(parseInitialState(initialState));
  const activeModeRef = useRef<CalculatorMode>("scientific");
  /** The serialized payload this component last emitted: its own echo, never re-applied. */
  const lastEmittedKeyRef = useRef<string | null>(null);

  /**
   * @spec [production QA 2026-10-08 item B (Karl: "Desmos: invertedColors when the app theme is
   *       dark (Graphing and Scientific)"); DESIGN.md §1 (light and dark), §2 (the timed module
   *       is light only)] | @implemented [2026-10-08]
   * plain English: Desmos draws its own UI, white whatever the page. Its `invertedColors`
   * setting is its dark look, so it is on exactly when the host is painted dark: the theme
   * setting is dark and the host's `.lyc` root is not pinned light (readPaintedThemeAt; the
   * timed module is pinned light, so its calculator stays light). Read from the DOM through the
   * same store the cookie surface uses, so a change in Settings, or a root that (un)locks,
   * re-renders this component. Both calculators are constructed with the current value (a ref,
   * so a theme change never re-runs the construction effect), and a later change is applied
   * live with `updateSettings`, so the calculator, its expressions and its viewport survive.
   * On the first render the host is not mounted yet and reads light; React re-reads the
   * snapshot when it subscribes after mount, before Desmos (loaded asynchronously) exists.
   */
  const invertedColors =
    useSyncExternalStore(
      subscribePaintedTheme,
      () => readPaintedThemeAt(boxRef.current),
      () => "light" as const,
    ) === "dark";
  const invertedColorsRef = useRef(invertedColors);
  invertedColorsRef.current = invertedColors;

  const initialStateKey = useMemo(
    () => JSON.stringify(initialState ?? null),
    [initialState],
  );

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  const emitPerModeState = useCallback((): void => {
    const payload: PerModeState = {
      graphing: modeStateRef.current.graphing,
      scientific: modeStateRef.current.scientific,
    };
    lastEmittedKeyRef.current = JSON.stringify(payload);
    onStateChangeRef.current?.(payload);
  }, []);

  /** Save a calculator's state now (a pending debounce is cancelled and done immediately). */
  const flushState = useCallback(
    (kind: CalculatorMode): void => {
      const calculator = calcRefs.current[kind];
      const pending = debounceRefs.current[kind];
      if (pending === null || !calculator) return;
      window.clearTimeout(pending);
      debounceRefs.current[kind] = null;
      modeStateRef.current[kind] = calculator.getState();
      emitPerModeState();
    },
    [emitPerModeState],
  );

  /**
   * @spec [register G-NEW-14; owner brief 2026-10-12 ("save only on: leaving or submitting the
   *       question …; closing the calculator panel or switching its tab; the page closing or going
   *       hidden; one save after 10 s of no calculator activity"; "the 600 ms debounce stays for
   *       local UI state only")] | @implemented [2026-10-12]
   * plain English: the debounce below only keeps the caller's copy of the state current; it is
   * never a save. Saving is the caller's, at the moments it is told about: `onCommit` for the
   * ones this component sees (tab switch, close, unmount), `flushRef` for the caller's own
   * (leaving the question), so the state saved always includes the last keystroke.
   */
  const flushAll = useCallback((): void => {
    flushState("graphing");
    flushState("scientific");
  }, [flushState]);

  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = flushAll;
    return () => {
      if (flushRef.current === flushAll) flushRef.current = null;
    };
  }, [flushRef, flushAll]);

  const handleModeSwitch = useCallback(
    (nextMode: CalculatorMode): void => {
      if (nextMode === activeModeRef.current) return;
      flushState(activeModeRef.current);
      activeModeRef.current = nextMode;
      setMode(nextMode);
      onCommitRef.current?.();
    },
    [flushState],
  );

  // Closing the calculator (expanded → collapsed) is a save moment.
  const wasExpandedRef = useRef(expanded);
  useEffect(() => {
    const was = wasExpandedRef.current;
    wasExpandedRef.current = expanded;
    if (was && !expanded) {
      flushAll();
      onCommitRef.current?.();
    }
  }, [expanded, flushAll]);

  // Load the Desmos script once for this mount.
  useEffect(() => {
    let mounted = true;
    setLoadError(null);
    void loadDesmosScriptOnce()
      .then(() => {
        if (mounted && window.Desmos) setDesmosReady(true);
      })
      .catch(() => {
        if (!mounted) return;
        setLoadError(
          "Desmos calculator unavailable. Configure VITE_DESMOS_API_KEY.",
        );
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Create the shown tab's calculator the first time it is shown; never re-create it. Then size
  // it to its host, which was hidden (display: none) until now if this is a switch.
  useEffect(() => {
    if (!desmosReady || !window.Desmos) return;
    const host = hostRefs.current[mode];
    if (!host) return;
    let calculator = calcRefs.current[mode];
    if (!calculator) {
      const Constructor =
        mode === "scientific"
          ? window.Desmos.ScientificCalculator
          : window.Desmos.GraphingCalculator;
      if (!Constructor) return;
      calculator = new Constructor(host, {
        autosize: true,
        expressions: true,
        settingsMenu: true,
        zoomButtons: true,
        lockViewport: false,
        degreeMode: true,
        invertedColors: invertedColorsRef.current,
      });
      calcRefs.current[mode] = calculator;
      const savedState = modeStateRef.current[mode];
      if (savedState) calculator.setState(savedState);

      const kind = mode;
      const created = calculator;
      const handleChange = (): void => {
        const pending = debounceRefs.current[kind];
        if (pending !== null) window.clearTimeout(pending);
        debounceRefs.current[kind] = window.setTimeout(() => {
          debounceRefs.current[kind] = null;
          modeStateRef.current[kind] = created.getState();
          emitPerModeState();
        }, debounceMs);
      };
      calculator.observeEvent("change", handleChange);
      changeHandlers.set(calculator, handleChange);
    }
    const shown = calculator;
    const t = window.setTimeout(() => shown.resize(), 0);
    return () => window.clearTimeout(t);
  }, [desmosReady, mode, debounceMs, emitPerModeState]);

  // Destroy both calculators when the component unmounts (and only then), after emitting any
  // pending change and telling the caller (unmount is a save moment).
  useEffect(() => {
    const calcs = calcRefs.current;
    const debounces = debounceRefs.current;
    return () => {
      flushAll();
      onCommitRef.current?.();
      for (const kind of ["graphing", "scientific"] as const) {
        const pending = debounces[kind];
        if (pending !== null) window.clearTimeout(pending);
        debounces[kind] = null;
        const calculator = calcs[kind];
        if (!calculator) continue;
        const handler = changeHandlers.get(calculator);
        if (handler) calculator.unobserveEvent("change", handler);
        calculator.destroy();
        calcs[kind] = null;
      }
    };
    // Unmount only: `flushAll` is stable (its inputs are refs and a stable callback).
  }, []);

  useEffect(() => {
    const calculator = calcRefs.current[activeModeRef.current];
    if (!calculator) return;
    const t = window.setTimeout(() => calculator.resize(), 0);
    return () => window.clearTimeout(t);
  }, [expanded]);

  // QA2-B: a theme change after construction is applied live (see invertedColors above).
  useEffect(() => {
    calcRefs.current.graphing?.updateSettings({ invertedColors });
    calcRefs.current.scientific?.updateSettings({ invertedColors });
  }, [invertedColors]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !expanded) return;
    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        calcRefs.current[activeModeRef.current]?.resize();
      });
    });
    observer.observe(box);
    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [expanded]);

  // An initialState from outside (a resume) is applied to both calculators. The component's
  // own emitted state coming back through the parent is NOT re-applied: that was the reset
  // that closed the keypad mid-typing.
  useEffect(() => {
    if (initialState == null) return;
    if (initialStateKey === lastEmittedKeyRef.current) return;
    const parsed = parseInitialState(initialState);
    modeStateRef.current = {
      graphing: parsed.graphing,
      scientific: parsed.scientific,
    };
    for (const kind of ["graphing", "scientific"] as const) {
      const saved = parsed[kind];
      if (saved) calcRefs.current[kind]?.setState(saved);
    }
  }, [initialStateKey, initialState]);

  const expandedHeight =
    mode === "scientific"
      ? EXPANDED_HEIGHT_SCIENTIFIC
      : EXPANDED_HEIGHT_GRAPHING;

  const shellStyle: React.CSSProperties = fillHeight
    ? { height: expanded ? "100%" : 0, overflow: "hidden" }
    : {
        height: expanded ? expandedHeight : 0,
        overflow: "hidden",
        transition: "height 180ms ease",
      };

  return (
    <div
      className={`${className ?? ""} ${fillHeight ? "flex flex-col h-full" : ""}`.trim()}
    >
      {expanded && (
        <div
          className="mb-2 flex shrink-0 items-center gap-1 rounded-md border border-lyc-rule bg-lyc-margin p-0.5"
          role="radiogroup"
          aria-label="Calculator mode"
        >
          <button
            type="button"
            role="radio"
            aria-checked={mode === "graphing"}
            onClick={() => handleModeSwitch("graphing")}
            className={`${MODE_TAB} ${mode === "graphing" ? MODE_TAB_ON : MODE_TAB_OFF}`}
            data-testid="desmos-mode-graphing"
          >
            Graphing
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "scientific"}
            onClick={() => handleModeSwitch("scientific")}
            className={`${MODE_TAB} ${mode === "scientific" ? MODE_TAB_ON : MODE_TAB_OFF}`}
            data-testid="desmos-mode-scientific"
          >
            Scientific
          </button>
        </div>
      )}
      <div
        style={shellStyle}
        className={fillHeight && expanded ? "flex-1 min-h-0" : undefined}
        aria-hidden={!expanded}
        data-testid="desmos-calculator-shell"
      >
        {loadError && (
          <div
            className="mb-2 text-lyc-meta text-lyc-danger"
            data-testid="desmos-calculator-error"
          >
            {loadError}
          </div>
        )}
        <div
          ref={boxRef}
          className="h-full w-full rounded-md border border-lyc-rule"
          data-testid="desmos-calculator"
        >
          {/* One host per tab; only the shown tab's host is displayed, so the other tab's
              calculator (and its work) is kept, not destroyed. */}
          <div
            ref={(el) => {
              hostRefs.current.scientific = el;
            }}
            className="h-full w-full"
            style={mode === "scientific" ? undefined : { display: "none" }}
            data-testid="desmos-host-scientific"
          />
          <div
            ref={(el) => {
              hostRefs.current.graphing = el;
            }}
            className="h-full w-full"
            style={mode === "graphing" ? undefined : { display: "none" }}
            data-testid="desmos-host-graphing"
          />
        </div>
      </div>
    </div>
  );
}
