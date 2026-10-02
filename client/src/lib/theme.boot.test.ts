// @vitest-environment jsdom
/**
 * @spec [student-UI register UI-47: "an inline script in client/index.html that applies the theme
 *        before first paint (no flash)"] | @implemented [2026-10-02]
 *
 * plain English: the inline script in client/index.html and `resolveTheme` in theme.ts must give
 * the same answer for every stored preference and device setting, or a hard reload would paint
 * one theme and the app would switch to another. This runs the real script text from the real
 * file, not a copy.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY, readThemePreference, resolveTheme } from "./theme";

const html = readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");
const match = html.match(/<script id="lyceon-theme-boot">([\s\S]*?)<\/script>/);
const bootScript = match?.[1] ?? "";

function runBoot(): string | null {
  // eslint-disable-next-line no-new-func -- the point is to run the real inline script text
  new Function(bootScript)();
  return document.documentElement.getAttribute("data-theme");
}

function setSystemDark(dark: boolean): void {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q === "(prefers-color-scheme: dark)" ? dark : false,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("theme boot script agrees with resolveTheme", () => {
  it("the script is present in client/index.html, inside <head>", () => {
    expect(bootScript).toContain("lyceon-theme");
    expect(html.indexOf('id="lyceon-theme-boot"')).toBeLessThan(
      html.indexOf("</head>"),
    );
    expect(bootScript).toContain(JSON.stringify(THEME_STORAGE_KEY));
  });

  it.each([
    [null, false],
    [null, true],
    ["system", false],
    ["system", true],
    ["light", true],
    ["dark", false],
    ["garbage", true],
  ] as const)("stored %s, system dark %s", (stored, systemDark) => {
    setSystemDark(systemDark);
    if (stored !== null) window.localStorage.setItem(THEME_STORAGE_KEY, stored);
    const fromScript = runBoot();
    const fromModule = resolveTheme(
      readThemePreference(window.localStorage),
      systemDark,
    );
    expect(fromScript).toBe(fromModule);
  });

  it("falls back to the device setting when storage throws", () => {
    setSystemDark(true);
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(runBoot()).toBe("dark");
    expect(resolveTheme(readThemePreference(window.localStorage), true)).toBe(
      "dark",
    );
    spy.mockRestore();
  });
});
