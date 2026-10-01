// @vitest-environment jsdom
/**
 * @spec [Coding Standards §12, §16; student UI vertical UI-10] | @implemented [2026-09-29]
 * plain English: the app-wide ErrorBoundary shows fixed copy, never the thrown error's raw
 * message, and App.tsx carries no console call in code.
 */
import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./App";

const RAW = "vertex-ai: model-armor template lyceon-prod internal detail";

function Boom(): never {
  throw new Error(RAW);
}

describe("App ErrorBoundary (UI-10)", () => {
  it("renders the fallback with fixed copy and never the raw error message", () => {
    // React reports the caught render error through console.error itself; silence it so the
    // assertion below is about what the USER sees, not React's dev logging.
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { container } = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    spy.mockRestore();
    // Presence before absence: the fallback really rendered.
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload Page" })).toBeTruthy();
    expect(container.textContent ?? "").not.toContain(RAW);
  });

  it("App.tsx has no console call in code (comments excluded)", () => {
    const src = fs.readFileSync(path.join(__dirname, "App.tsx"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).toContain("class ErrorBoundary");
    expect(code).not.toMatch(/\bconsole\./);
  });
});
