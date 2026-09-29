/**
 * UI-11 / UI-12 — what the first paint of every page waits on.
 *
 * @spec [Coding Standards §11 (frontend), §14 (tests); student-ui register
 *        `docs/plans/student-ui/student-ui-vertical.md` rows UI-11 and UI-12]
 * @implemented 2026-09-29
 *
 * plain English: static gates over the files that decide the initial load.
 *  - UI-11: the KaTeX stylesheet is not imported by the app entry (MathRenderer
 *    imports it, so it rides in the lazy chunk that renders math), and only the
 *    landing pages (`/`, `/login`, the 404) are eager in the router.
 *  - UI-12: web fonts load from one `<link>` in index.html with preconnect and
 *    `display=swap`, carry only the families the app renders with, and are not
 *    also pulled in by a CSS `@import`. index.html has no synchronous
 *    third-party script (the Replit dev banner is gone). The calendar
 *    stylesheet no longer names "Bricolage Grotesque", a family nothing loads.
 *
 * trade-offs: these read source text, so each absence check is paired with a
 * presence check on the same file (the font link exists, MathRenderer still
 * imports the KaTeX CSS, the lazy declarations exist) so a moved or renamed
 * file cannot make a gate pass for the wrong reason. Comments are stripped
 * before any absence check so prose explaining a removal cannot trip or blind it.
 *
 * edge cases: the Lighthouse "render-blocking resources" proof for UI-12 is a
 * production measurement and is not asserted here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "./lib/strip-comments";

const REPO = resolve(__dirname, "../..");
const read = (rel: string): string => readFileSync(resolve(REPO, rel), "utf-8");
const stripHtmlComments = (src: string): string =>
  src.replace(/<!--[\s\S]*?-->/g, " ");
const stripCssComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ");

const INDEX_HTML = stripHtmlComments(read("client/index.html"));
const INDEX_CSS = stripCssComments(read("client/src/index.css"));
const MAIN_TSX = stripComments(read("client/src/main.tsx"));
const APP_TSX = stripComments(read("client/src/App.tsx"));
const MATH_RENDERER = stripComments(
  read("client/src/components/MathRenderer.tsx"),
);
const CALENDAR_CSS = stripCssComments(
  read("client/src/features/calendar/calendar.css"),
);
const CALENDAR_STATES = stripComments(
  read("client/src/features/calendar/components/CalendarStates.tsx"),
);

/** The families the app's own font stacks name first (Poppins, then Inter). */
const USED_WEB_FONT_FAMILIES = ["Inter", "Poppins"];

function googleFontLinks(html: string): string[] {
  return [...html.matchAll(/<link\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes("fonts.googleapis.com/css"));
}

function familiesIn(href: string): string[] {
  return [...href.matchAll(/family=([^:&"]+)/g)]
    .map((m) => decodeURIComponent((m[1] ?? "").replace(/\+/g, " ")))
    .sort();
}

describe("UI-12 fonts load from one link, only the used families", () => {
  it("R1.0 the used families are the ones the app's font stacks name", () => {
    // Presence first: if the stacks stop naming these, the family list below is stale.
    expect(INDEX_CSS).toMatch(/--font-sans:\s*'Poppins',\s*'Inter'/);
    expect(CALENDAR_CSS).toMatch(/font-family:\s*Inter\b/);
  });

  it("R1.1 index.html has exactly one Google Fonts stylesheet link, with display=swap and preconnect", () => {
    const links = googleFontLinks(INDEX_HTML);
    expect(links).toHaveLength(1);
    const link = links[0] ?? "";
    expect(link).toMatch(/rel="stylesheet"/);
    expect(link).toMatch(/display=swap/);
    expect(INDEX_HTML).toMatch(
      /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">/,
    );
    expect(INDEX_HTML).toMatch(
      /<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>/,
    );
  });

  it("R1.2 the link requests only the families the app renders with", () => {
    const link = googleFontLinks(INDEX_HTML)[0] ?? "";
    expect(familiesIn(link)).toEqual(USED_WEB_FONT_FAMILIES);
  });

  it("R1.3 no font is loaded by a CSS @import (index.html or index.css)", () => {
    expect(INDEX_HTML).not.toMatch(/@import/);
    expect(INDEX_CSS).not.toMatch(/@import/);
    expect(INDEX_CSS).not.toMatch(/fonts\.googleapis\.com/);
  });
});

describe("UI-12 no synchronous third-party script in index.html", () => {
  it("R2.1 the Replit dev-banner script is gone", () => {
    expect(INDEX_HTML).not.toMatch(/replit/i);
  });

  it("R2.2 every script is a module, async or deferred", () => {
    const scripts = [...INDEX_HTML.matchAll(/<script\b[^>]*>/g)].map(
      (m) => m[0],
    );
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) {
      expect(tag).toMatch(/type="module"|\basync\b|\bdefer\b/);
    }
  });
});

describe("UI-12 calendar names no unloaded font", () => {
  it("R3.1 calendar.css and CalendarStates.tsx do not reference Bricolage Grotesque", () => {
    expect(CALENDAR_CSS).toMatch(/font-family/);
    expect(CALENDAR_CSS).not.toMatch(/Bricolage/i);
    expect(CALENDAR_STATES).not.toMatch(/Bricolage/i);
  });
});

describe("UI-11 initial bundle carries no route-specific code or CSS", () => {
  it("R4.1 main.tsx does not import the KaTeX stylesheet; MathRenderer does", () => {
    expect(MATH_RENDERER).toMatch(
      /import\s+['"]katex\/dist\/katex\.min\.css['"]/,
    );
    expect(MAIN_TSX).toMatch(/import\s+["']\.\/index\.css["']/);
    expect(MAIN_TSX).not.toMatch(/katex/);
  });

  it("R4.2 UpdatePassword and NotificationsPage are lazy", () => {
    expect(APP_TSX).toMatch(
      /const UpdatePassword = lazy\(\(\) => import\("@\/pages\/update-password"\)\)/,
    );
    expect(APP_TSX).toMatch(
      /const NotificationsPage = lazy\(\(\) => import\("@\/pages\/notifications"\)\)/,
    );
  });

  it("R4.3 only the landing pages are eager page imports", () => {
    const eagerPages = [
      ...APP_TSX.matchAll(/^import\s+\w+\s+from\s+"@\/pages\/([^"]+)";/gm),
    ]
      .map((m) => m[1] ?? "")
      .sort();
    expect(eagerPages).toEqual(["home", "login", "not-found"]);
  });
});
