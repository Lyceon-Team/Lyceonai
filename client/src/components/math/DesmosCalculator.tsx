/**
 * @spec [Doc-02B_v4, §28 Math Tooling: Desmos and Formula Sheet] | @implemented [2026-07-26]
 * Desmos calculator with graphing/scientific mode toggle and Bluebook-parity resizable panel.
 * Per-mode state is retained across mode switches via a mode-keyed map flushed
 * synchronously before switching. The session payload persisted through
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
} from "react";

declare global {
  interface DesmosCalculatorInstance {
    setState: (state: unknown) => void;
    getState: () => unknown;
    resize: () => void;
    destroy: () => void;
    observeEvent: (event: string, cb: () => void) => void;
    unobserveEvent: (event: string, cb: () => void) => void;
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
const MODE_TAB_ON = "bg-lyc-sheet text-lyc-ink-strong shadow-sm";
const MODE_TAB_OFF = "bg-transparent text-lyc-ink hover:bg-lyc-hover";

export default function DesmosCalculator({
  className,
  expanded,
  initialState = null,
  onStateChange,
  debounceMs = 600,
  fillHeight = false,
}: DesmosCalculatorProps): React.ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const calcRef = useRef<DesmosCalculatorInstance | null>(null);
  const stateDebounceRef = useRef<number | null>(null);
  const onStateChangeRef = useRef(onStateChange);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<CalculatorMode>("graphing");
  const modeStateRef = useRef<PerModeState>(parseInitialState(initialState));
  const activeModeRef = useRef<CalculatorMode>("graphing");

  const initialStateKey = useMemo(
    () => JSON.stringify(initialState ?? null),
    [initialState],
  );

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  useEffect(() => {
    if (initialState != null) {
      const parsed = parseInitialState(initialState);
      modeStateRef.current.graphing = parsed.graphing;
      modeStateRef.current.scientific = parsed.scientific;
    }
  }, [initialStateKey, initialState]);

  const emitPerModeState = useCallback((): void => {
    if (!onStateChangeRef.current) return;
    onStateChangeRef.current({
      graphing: modeStateRef.current.graphing,
      scientific: modeStateRef.current.scientific,
    });
  }, []);

  const flushActiveState = useCallback((): void => {
    const calculator = calcRef.current;
    if (!calculator) return;
    if (stateDebounceRef.current !== null) {
      window.clearTimeout(stateDebounceRef.current);
      stateDebounceRef.current = null;
    }
    const currentState = calculator.getState();
    modeStateRef.current[activeModeRef.current] = currentState;
    emitPerModeState();
  }, [emitPerModeState]);

  const handleModeSwitch = useCallback(
    (nextMode: CalculatorMode): void => {
      if (nextMode === activeModeRef.current) return;
      flushActiveState();
      activeModeRef.current = nextMode;
      setMode(nextMode);
    },
    [flushActiveState],
  );

  useEffect(() => {
    let mounted = true;
    setLoadError(null);

    void loadDesmosScriptOnce()
      .then(() => {
        if (!mounted || !hostRef.current || !window.Desmos) return;

        if (calcRef.current) {
          const handler = changeHandlers.get(calcRef.current);
          if (handler) {
            calcRef.current.unobserveEvent("change", handler);
          }
          calcRef.current.destroy();
          calcRef.current = null;
        }

        const Constructor =
          mode === "scientific"
            ? window.Desmos.ScientificCalculator
            : window.Desmos.GraphingCalculator;

        if (!Constructor) return;

        const calculator = new Constructor(hostRef.current, {
          autosize: true,
          expressions: true,
          settingsMenu: true,
          zoomButtons: true,
          lockViewport: false,
        });

        calcRef.current = calculator;

        const savedState = modeStateRef.current[mode];
        if (savedState) {
          calculator.setState(savedState);
        }

        const handleChange = () => {
          if (stateDebounceRef.current !== null) {
            window.clearTimeout(stateDebounceRef.current);
          }
          stateDebounceRef.current = window.setTimeout(() => {
            stateDebounceRef.current = null;
            if (!calcRef.current) return;
            const state = calcRef.current.getState();
            modeStateRef.current[mode] = state;
            emitPerModeState();
          }, debounceMs);
        };

        calculator.observeEvent("change", handleChange);
        changeHandlers.set(calculator, handleChange);

        window.setTimeout(() => calculator.resize(), 0);
      })
      .catch(() => {
        if (!mounted) return;
        setLoadError(
          "Desmos calculator unavailable. Configure VITE_DESMOS_API_KEY.",
        );
      });

    return () => {
      mounted = false;

      if (stateDebounceRef.current !== null) {
        window.clearTimeout(stateDebounceRef.current);
        stateDebounceRef.current = null;
      }

      const calculator = calcRef.current;
      if (calculator) {
        const handler = changeHandlers.get(calculator);
        if (handler) {
          calculator.unobserveEvent("change", handler);
        }
        calculator.destroy();
      }
      calcRef.current = null;
    };
  }, [debounceMs, emitPerModeState, mode]);

  useEffect(() => {
    const calculator = calcRef.current;
    if (!calculator) return;
    window.setTimeout(() => calculator.resize(), 0);
  }, [expanded]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !expanded) return;
    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        calcRef.current?.resize();
      });
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [expanded]);

  useEffect(() => {
    const calculator = calcRef.current;
    if (!calculator || !initialState || mode !== "graphing") return;
    const parsed = parseInitialState(initialState);
    if (parsed.graphing) {
      calculator.setState(parsed.graphing);
      modeStateRef.current.graphing = parsed.graphing;
    }
    if (parsed.scientific) {
      modeStateRef.current.scientific = parsed.scientific;
    }
  }, [initialStateKey, initialState, mode]);

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
          ref={hostRef}
          className="h-full w-full rounded-md border border-lyc-rule"
          data-testid="desmos-calculator"
        />
      </div>
    </div>
  );
}
