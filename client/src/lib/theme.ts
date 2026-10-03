/**
 * Student UI theme preference: system, light or dark, stored per device.
 *
 * @spec [student-UI register UI-47; DESIGN.md §1, §2 (timed exam module light only); dark mode
 *        ruling 2026-09-30; Settings → Appearance (DESIGN.md §4)] | @implemented [2026-10-02]
 *
 * plain English: the preference lives in localStorage under THEME_STORAGE_KEY. The resolved
 * theme ("light" or "dark") is written to <html data-theme>, which student-tokens.css reads.
 * The same rule runs twice: here for changes made in Settings, and as the inline script in
 * client/index.html before first paint, so a hard reload never flashes the wrong theme. A test
 * runs that inline script and this module over the same inputs and requires the same answer.
 *
 * edge cases: storage can be unavailable (private mode, blocked site data) and reads or writes can
 * throw. Reads then fall back to "system"; a failed write keeps the theme applied for this page
 * and reports it to the caller, which can say the choice was not saved.
 */
export const THEME_STORAGE_KEY = "lyceon-theme";

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = "light" | "dark";

export function isThemePreference(value: unknown): value is ThemePreference {
  return (
    typeof value === "string" &&
    (THEME_PREFERENCES as readonly string[]).includes(value)
  );
}

/** Pure: the theme to render for a preference and the device's colour-scheme preference. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

export function readThemePreference(
  storage: ThemeStorage | null,
): ThemePreference {
  if (storage === null) return "system";
  let raw: string | null;
  try {
    raw = storage.getItem(THEME_STORAGE_KEY);
  } catch (err: unknown) {
    // Storage is unreadable on this device: the preference is unknowable, and "system" is the
    // documented default. Nothing to log on the client (no console in production code).
    void err;
    return "system";
  }
  return isThemePreference(raw) ? raw : "system";
}

export type SaveResult =
  | { saved: true }
  | { saved: false; reason: "storage_unavailable" };

export function saveThemePreference(
  storage: ThemeStorage | null,
  preference: ThemePreference,
): SaveResult {
  if (storage === null) return { saved: false, reason: "storage_unavailable" };
  try {
    storage.setItem(THEME_STORAGE_KEY, preference);
    return { saved: true };
  } catch (err: unknown) {
    void err;
    return { saved: false, reason: "storage_unavailable" };
  }
}

export function applyResolvedTheme(
  root: HTMLElement,
  theme: ResolvedTheme,
): void {
  root.setAttribute("data-theme", theme);
}

export function systemPrefersDark(
  win: Pick<Window, "matchMedia"> | null,
): boolean {
  if (win === null || typeof win.matchMedia !== "function") return false;
  return win.matchMedia("(prefers-color-scheme: dark)").matches;
}
