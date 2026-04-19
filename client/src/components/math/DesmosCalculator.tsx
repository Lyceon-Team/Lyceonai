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
        options?: Record<string, unknown>
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
    return Promise.reject(new Error("Desmos calculator unavailable: missing VITE_DESMOS_API_KEY"));
  }

  desmosScriptPromise = new Promise<void>((resolve, reject) => {
    const fail = () => {
      desmosScriptPromise = null;
      reject(new Error("Failed to load Desmos script"));
    };

    const existing = document.querySelector<HTMLScriptElement>('script[data-desmos="graphing-calculator"]');
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
  const initialStateRef = useRef<unknown | null>(initialState ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const initialStateKey = useMemo(() => JSON.stringify(initialState ?? null), [initialState]);

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
        if (!mounted || !hostRef.current || !window.Desmos?.GraphingCalculator) return;
        if (calcRef.current) return;

        const calculator = new window.Desmos.GraphingCalculator(hostRef.current, {
          expressions: true,
          settingsMenu: true,
          zoomButtons: true,
          lockViewport: false,
        });

        calcRef.current = calculator;

        if (initialStateRef.current) {
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

        window.setTimeout(() => calculator.resize(), 0);

        (calculator as any).__lyceonChangeHandler = handleChange;
      })
      .catch(() => {
        if (!mounted) return;
        // Fail closed but keep question UI stable if script or env wiring is unavailable.
        setLoadError("Desmos calculator unavailable. Configure VITE_DESMOS_API_KEY.");
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
  }, [debounceMs]);

  useEffect(() => {
    const calculator = calcRef.current;
    if (!calculator) return;
    window.setTimeout(() => calculator.resize(), 0);
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
      {loadError && (
        <div className="mb-2 text-sm text-amber-700" data-testid="desmos-calculator-error">
          {loadError}
        </div>
      )}
      <div ref={hostRef} className="h-full w-full rounded-md border border-slate-200" data-testid="desmos-calculator" />
    </div>
  );
}
