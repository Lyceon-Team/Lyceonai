import React, { useEffect, useMemo, useRef } from "react";

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
        options?: Record<string, unknown>
      ) => DesmosCalculatorInstance;
    };
  }
}

let desmosScriptPromise: Promise<void> | null = null;

function loadDesmosScriptOnce(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (window.Desmos?.GraphingCalculator) {
    return Promise.resolve();
  }

  if (desmosScriptPromise) {
    return desmosScriptPromise;
  }

  desmosScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-desmos="graphing-calculator"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Desmos script")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://www.desmos.com/api/v1.10/calculator.js?apiKey=desmos";
    script.async = true;
    script.defer = true;
    script.dataset.desmos = "graphing-calculator";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Desmos script"));
    document.head.appendChild(script);
  });

  return desmosScriptPromise;
}

type DesmosCalculatorProps = {
  className?: string;
  expanded: boolean;
  initialState?: unknown | null;
  onStateChange?: (state: unknown) => void;
  debounceMs?: number;
};

export default function DesmosCalculator({
  className,
  expanded,
  initialState = null,
  onStateChange,
  debounceMs = 600,
}: DesmosCalculatorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const calcRef = useRef<DesmosCalculatorInstance | null>(null);
  const stateDebounceRef = useRef<number | null>(null);
  const onStateChangeRef = useRef(onStateChange);
  const initialStateKey = useMemo(() => JSON.stringify(initialState ?? null), [initialState]);

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  useEffect(() => {
    let mounted = true;

    void loadDesmosScriptOnce()
      .then(() => {
        if (!mounted || !hostRef.current || !window.Desmos?.GraphingCalculator) return;
        if (calcRef.current) return;

        const calculator = new window.Desmos.GraphingCalculator(hostRef.current, {
          expressions: true,
          settingsMenu: true,
          zoomButtons: true,
          lockViewport: false,
        });

        calcRef.current = calculator;

        if (initialState) {
          calculator.setState(initialState);
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

        if (expanded) {
          window.setTimeout(() => calculator.resize(), 0);
        }

        (calculator as any).__lyceonChangeHandler = handleChange;
      })
      .catch(() => {
        // Fail silent to keep question UI stable if third-party script fails.
      });

    return () => {
      mounted = false;

      if (stateDebounceRef.current !== null) {
        window.clearTimeout(stateDebounceRef.current);
        stateDebounceRef.current = null;
      }

      const calculator = calcRef.current as any;
      if (calculator) {
        const handler = calculator.__lyceonChangeHandler;
        if (typeof handler === "function") {
          calculator.unobserveEvent("change", handler);
        }
        calculator.destroy();
      }
      calcRef.current = null;
    };
  }, [debounceMs, expanded, initialState, initialStateKey]);

  useEffect(() => {
    const calculator = calcRef.current;
    if (!calculator) return;
    if (expanded) {
      window.setTimeout(() => calculator.resize(), 0);
    }
  }, [expanded]);

  useEffect(() => {
    const calculator = calcRef.current;
    if (!calculator || !initialState) return;
    calculator.setState(initialState);
  }, [initialStateKey, initialState]);

  return (
    <div
      className={className}
      style={{
        height: expanded ? 360 : 0,
        overflow: "hidden",
        transition: "height 180ms ease",
      }}
      aria-hidden={!expanded}
      data-testid="desmos-calculator-shell"
    >
      <div ref={hostRef} className="h-full w-full rounded-md border border-slate-200" data-testid="desmos-calculator" />
    </div>
  );
}
