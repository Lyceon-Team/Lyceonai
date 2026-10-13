/**
 * The calculator harness: the real `DesmosCalculator`, wired exactly as its callers wire it.
 *
 * @spec [Doc-02B_v4 §28 (Desmos on every runtime surface's Math questions); owner brief
 *        2026-10-11 (Scientific + DEG by default; the keypad must not drop)] | @implemented [2026-10-11]
 *
 * plain English: one page, two layouts, picked by `?layout=`:
 *   - `panel`   — the exam's floating panel box (CALC_MIN_PX × CALC_COLUMN_HEIGHT_PX, `fillHeight`);
 *   - `stacked` — practice/review's stacked calculator under the question (the phone layout).
 * In both, the parent keeps the calculator's emitted state and passes it straight back as
 * `initialState` — `ExamModulePage.tsx` (`setCalculatorState` / `calculatorState`) and
 * `CanonicalPracticePage.tsx` (`onCalculatorStateChange` → `localCalculatorState`) do exactly
 * that. The app's own stylesheet is loaded, inside a `.lyc` root, so the tabs render with the
 * student tokens as they do in the app. Not part of any build: Playwright starts it with
 * `tests/e2e/desmos-harness/vite.config.ts`.
 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import DesmosCalculator from "@/components/math/DesmosCalculator";
import {
  CALC_COLUMN_HEIGHT_PX,
  CALC_MIN_PX,
} from "@/components/math/calculator-layout";

function Harness(): JSX.Element {
  const layout =
    new URLSearchParams(window.location.search).get("layout") ?? "panel";
  const [state, setState] = useState<unknown>(null);
  const [emits, setEmits] = useState(0);
  const onStateChange = (next: unknown): void => {
    setState(next);
    setEmits((n) => n + 1);
  };
  const calculator =
    layout === "stacked" ? (
      <DesmosCalculator
        expanded
        className="w-full"
        initialState={state}
        onStateChange={onStateChange}
      />
    ) : (
      <div
        style={{
          width: CALC_MIN_PX,
          height: CALC_COLUMN_HEIGHT_PX,
          padding: 8,
        }}
      >
        <DesmosCalculator
          expanded
          fillHeight
          initialState={state}
          onStateChange={onStateChange}
        />
      </div>
    );
  return (
    <div className="lyc" style={{ padding: 16 }}>
      <div data-testid="harness-emits" data-emits={emits} />
      {calculator}
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Harness />);
