/**
 * @spec [CodingStandards_v1, §9 Practice Engine Contracts] | @implemented [2026-07-24]
 * Desmos calculator with graphing/scientific mode toggle and Bluebook-comparable sizing.
 * State persistence is preserved across mode switches via initialState/onStateChange.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";

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

type DesmosCalculatorProps = {
  className?: string;
  expanded: boolean;
  initialState?: unknown | null;
  onStateChange?: (state: unknown) => void;
  debounceMs?: number;
};

const EXPANDED_HEIGHT_GRAPHING = 520;
const EXPANDED_HEIGHT_SCIENTIFIC = 400;

export default function DesmosCalculator({
  className,
  expanded,
  initialState = null,
  onStateChange,
  debounceMs = 600,
}: DesmosCalculatorProps): React.ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const calcRef = useRef<DesmosCalculatorInstance | null>(null);
  const stateDebounceRef = useRef<number | null>(null);
  const onStateChangeRef = useRef(onStateChange);
  const initialStateRef = useRef<unknown | null>(initialState ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<CalculatorMode>("graphing");
  const initialStateKey = useMemo(
    () => JSON.stringify(initialState ?? null),
    [initialState],
  );

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  useEffect(() => {
    initialStateRef.current = initialState ?? null;
  }, [initialStateKey, initialState]);

  useEffect(() => {
    let mounted = true;
    setLoadError(null);

    void loadDesmosScriptOnce()
      .then(() => {
        if (!mounted || !hostRef.current || !window.Desmos) return;

        if (calcRef.current) {
          const prev = calcRef.current as Record<string, unknown>;
          const handler = prev.__lyceonChangeHandler;
          if (typeof handler === "function") {
            calcRef.current.unobserveEvent("change", handler as () => void);
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
          expressions: true,
          settingsMenu: true,
          zoomButtons: true,
          lockViewport: false,
        });

        calcRef.current = calculator;

        if (mode === "graphing" && initialStateRef.current) {
          calculator.setState(initialStateRef.current);
        }

        const handleChange = () => {
          if (!onStateChangeRef.current) return;
          if (stateDebounceRef.current !== null) {
            window.clearTimeout(stateDebounceRef.current);
          }
          stateDebounceRef.current = window.setTimeout(() => {
            stateDebounceRef.current = null;
            if (!calcRef.current || !onStateChangeRef.current) return;
            onStateChangeRef.current(calcRef.current.getState());
          }, debounceMs);
        };

        calculator.observeEvent("change", handleChange);
        (calculator as Record<string, unknown>).__lyceonChangeHandler =
          handleChange;

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

      const calculator = calcRef.current as Record<string, unknown> | null;
      if (calculator) {
        const handler = calculator.__lyceonChangeHandler;
        if (typeof handler === "function") {
          (calcRef.current as DesmosCalculatorInstance).unobserveEvent(
            "change",
            handler as () => void,
          );
        }
        (calcRef.current as DesmosCalculatorInstance).destroy();
      }
      calcRef.current = null;
    };
  }, [debounceMs, mode]);

  useEffect(() => {
    const calculator = calcRef.current;
    if (!calculator) return;
    window.setTimeout(() => calculator.resize(), 0);
  }, [expanded]);

  useEffect(() => {
    const calculator = calcRef.current;
    if (!calculator || !initialState || mode !== "graphing") return;
    calculator.setState(initialState);
  }, [initialStateKey, initialState, mode]);

  const expandedHeight =
    mode === "scientific"
      ? EXPANDED_HEIGHT_SCIENTIFIC
      : EXPANDED_HEIGHT_GRAPHING;

  return (
    <div className={className}>
      {expanded && (
        <div
          className="mb-2 flex items-center gap-1 rounded-md bg-secondary/60 p-0.5"
          role="radiogroup"
          aria-label="Calculator mode"
        >
          <button
            type="button"
            role="radio"
            aria-checked={mode === "graphing"}
            onClick={() => setMode("graphing")}
            className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === "graphing"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid="desmos-mode-graphing"
          >
            Graphing
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "scientific"}
            onClick={() => setMode("scientific")}
            className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === "scientific"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid="desmos-mode-scientific"
          >
            Scientific
          </button>
        </div>
      )}
      <div
        style={{
          height: expanded ? expandedHeight : 0,
          overflow: "hidden",
          transition: "height 180ms ease",
        }}
        aria-hidden={!expanded}
        data-testid="desmos-calculator-shell"
      >
        {loadError && (
          <div
            className="mb-2 text-sm text-amber-700"
            data-testid="desmos-calculator-error"
          >
            {loadError}
          </div>
        )}
        <div
          ref={hostRef}
          className="h-full w-full rounded-md border border-slate-200"
          data-testid="desmos-calculator"
        />
      </div>
    </div>
  );
}
