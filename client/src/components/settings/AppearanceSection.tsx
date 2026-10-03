/**
 * Settings → Appearance: Match device, Light or Dark, saved on this device.
 *
 * @spec [DESIGN.md §4 Settings "Appearance" ("Match device, Light or Dark, stored per device. The
 *        timed exam module is always light"), §1 (dark is textbook ink); student-UI register
 *        UI-47 (`localStorage["lyceon-theme"]`, applied before first paint by the boot script in
 *        client/index.html), dark mode ruling 2026-09-30; prototype Settings.dc.html]
 *        | @implemented [2026-10-03]
 *
 * plain English: the existing theme mechanism, given its first control. Choosing writes the
 * preference with `saveThemePreference` (the same key the boot script reads on the next load)
 * and applies the resolved theme to <html data-theme> at once with `applyResolvedTheme`, so the
 * page changes without a reload. Nothing goes to the server: the choice is per device by ruling.
 * The timed exam module stays light whatever is chosen, because its shell pins the light set
 * (`route-shells.ts`, `/tests/:sessionId/:section/:module`); this control cannot reach it.
 *
 * edge cases: storage can be unavailable (private mode, blocked site data). Reading then shows
 * "Match device"; a failed write still applies the theme for this page, and the next load
 * follows the device again. "Match device" resolves from the colour-scheme media query now; a
 * later change to the device setting applies on the next load (the boot script's rule).
 */
import { useId, useState } from "react";
import {
  applyResolvedTheme,
  readThemePreference,
  resolveTheme,
  saveThemePreference,
  systemPrefersDark,
  type ThemePreference,
  type ThemeStorage,
} from "@/lib/theme";
import { cn } from "@/lib/utils";
import { LYC_FOCUS } from "@/components/ui/button";
import { SectionHeading } from "./settings-ui";

const OPTIONS: readonly { id: ThemePreference; label: string }[] = [
  { id: "system", label: "Match device" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

/** `window.localStorage` itself can throw when site data is blocked. */
function deviceStorage(): ThemeStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch (err: unknown) {
    // No storage on this device: the documented fallback is "system" (lib/theme.ts).
    void err;
    return null;
  }
}

/**
 * A swatch half drawn with one token set whatever the page's theme (`data-theme-preview`,
 * student-tokens.css).
 */
function Swatch({ theme }: { theme: "light" | "dark" }): JSX.Element {
  return (
    <span className="lyc flex h-full min-w-0 flex-1" data-theme-preview={theme}>
      <span className="w-[22%] bg-lyc-rail" />
      <span className="flex flex-1 flex-col gap-1.5 bg-lyc-paper p-2.5">
        <span className="h-2 w-3/5 rounded bg-lyc-ink-strong" />
        <span className="h-1.5 w-4/5 rounded bg-lyc-ink-strong opacity-50" />
      </span>
    </span>
  );
}

export function AppearanceSection(): JSX.Element {
  const headingId = useId();
  const [choice, setChoice] = useState<ThemePreference>(() =>
    readThemePreference(deviceStorage()),
  );

  function choose(next: ThemePreference): void {
    setChoice(next);
    saveThemePreference(deviceStorage(), next);
    applyResolvedTheme(
      document.documentElement,
      resolveTheme(next, systemPrefersDark(window)),
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-6"
      data-testid="settings-appearance"
    >
      <SectionHeading id={headingId}>Appearance</SectionHeading>
      <p className="m-0 text-[17px] leading-relaxed text-lyc-muted">
        Saved on this device. Timed exam modules always use the light theme,
        like test day.
      </p>
      <div
        role="radiogroup"
        aria-label="Theme"
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
      >
        {OPTIONS.map((option) => {
          const on = choice === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => choose(option.id)}
              className={cn(
                LYC_FOCUS,
                "flex flex-col gap-3 rounded-lg border-2 bg-lyc-sheet p-3.5 text-left",
                on ? "border-lyc-ink-strong" : "border-lyc-rule",
              )}
              data-testid={`theme-option-${option.id}`}
            >
              <span
                aria-hidden="true"
                className="flex h-[72px] overflow-hidden rounded-md border border-lyc-rule"
              >
                {option.id === "system" ? (
                  <>
                    <Swatch theme="light" />
                    <Swatch theme="dark" />
                  </>
                ) : (
                  <Swatch theme={option.id} />
                )}
              </span>
              <span className="text-[17px] font-semibold text-lyc-ink">
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
