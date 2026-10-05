/**
 * Renders the question runner the way the router does: inside the Focus shell, whose bar the
 * runner portals its context into (FocusBarContext).
 *
 * @spec [DESIGN.md §2 Focus shell; student-UI register UI-41, UI-53] | @implemented [2026-10-03]
 *
 * plain English: a runner rendered on its own has no bar slot, so "Question N of M", the session
 * name and the Calculator / Reference buttons would not render at all. Tests render through this
 * wrapper instead (RTL's `wrapper`, so `rerender` keeps it).
 */
import type { ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { FocusShell } from "@/components/layout/FocusShell";

export function RunnerFrame({ children }: { children: ReactNode }) {
  return (
    <FocusShell section="Practice" sectionHome="/practice">
      {children}
    </FocusShell>
  );
}

export function renderRunner(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return render(ui, { wrapper: RunnerFrame, ...options });
}
