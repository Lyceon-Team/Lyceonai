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
 *  - UI-12: web fonts are self-hosted (SEO vertical, 2026-10-03; until then one
 *    Google Fonts `<link>`): index.css declares only the families the app
 *    renders with, each face `font-display: swap` from a file in
 *    client/public/fonts/ with its OFL licence beside it; index.html preloads
 *    exactly the two above-the-fold faces and names no Google font host; nothing
 *    is pulled in by a CSS `@import`. index.html has no synchronous
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
import { existsSync, readFileSync } from "node:fs";
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

type FontFace = {
  family: string;
  style: string;
  weight: string;
  src: string;
  display: string;
};

/** Every @font-face in a stylesheet, with the properties the gate reads. */
function fontFaces(css: string): FontFace[] {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
    const body = m[1] ?? "";
    const prop = (name: string): string =>
      (body.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1] ?? "").trim();
    return {
      family: prop("font-family").replace(/["']/g, ""),
      style: prop("font-style"),
      weight: prop("font-weight"),
      src: (prop("src").match(/url\("?([^")]+)"?\)/)?.[1] ?? "").trim(),
      display: prop("font-display"),
    };
  });
}

/** Every `<link rel="preload" as="font">` tag in index.html. */
function fontPreloads(html: string): string[] {
  return [...html.matchAll(/<link\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => /rel="preload"/.test(tag) && /as="font"/.test(tag));
}

const WEB_FACES = fontFaces(INDEX_CSS).filter((f) =>
  USED_WEB_FONT_FAMILIES.includes(f.family),
);

describe("UI-12 fonts are self-hosted, only the used families and faces", () => {
  it("R1.0 the used families are the ones the app's font stacks name", () => {
    // Presence first: if the stacks stop naming these, the family list below is stale.
    expect(INDEX_CSS).toMatch(/--font-sans:\s*'Poppins',\s*'Inter'/);
    expect(CALENDAR_CSS).toMatch(/font-family:\s*Inter\b/);
  });

  it("R1.1 index.css declares exactly the used families, every face swap, from a committed file", () => {
    const families = [
      ...new Set(fontFaces(INDEX_CSS).map((f) => f.family)),
    ].sort();
    expect(families).toEqual(USED_WEB_FONT_FAMILIES);
    // Poppins 400-800 roman plus italic 400 and 500; Inter one variable roman file.
    expect(
      WEB_FACES.map((f) => `${f.family} ${f.style} ${f.weight}`).sort(),
    ).toEqual([
      "Inter normal 400 700",
      "Poppins italic 400",
      "Poppins italic 500",
      "Poppins normal 400",
      "Poppins normal 500",
      "Poppins normal 600",
      "Poppins normal 700",
      "Poppins normal 800",
    ]);
    for (const face of WEB_FACES) {
      expect(face.display, `${face.src} swaps`).toBe("swap");
      expect(face.src, "a same-origin /fonts/ path").toMatch(
        /^\/fonts\/[\w.-]+\.woff2$/,
      );
      expect(
        existsSync(resolve(REPO, "client/public", `.${face.src}`)),
        `${face.src} is committed`,
      ).toBe(true);
    }
    for (const licence of ["OFL-Poppins.md", "OFL-Inter.md"]) {
      const text = read(`client/public/fonts/${licence}`);
      expect(text, `${licence} is the OFL`).toContain(
        "SIL Open Font License, Version 1.1",
      );
    }
  });

  it("R1.2 index.html preloads exactly the two above-the-fold web-font faces, each matching its @font-face src", () => {
    const preloads = fontPreloads(INDEX_HTML);
    const hrefOf = (tag: string): string =>
      tag.match(/href="([^"]+)"/)?.[1] ?? "";
    const all = preloads.map(hrefOf).sort();
    // Poppins/Inter: only the homepage's above-the-fold faces (body 400, h1 700).
    const webFont = all.filter((href) =>
      /\/fonts\/(poppins|inter)-/.test(href),
    );
    expect(webFont).toEqual([
      "/fonts/poppins-latin-400-normal.woff2",
      "/fonts/poppins-latin-700-normal.woff2",
    ]);
    // Nothing else is preloaded: the student UI's Source Sans/Serif load from their @font-face in
    // student-tokens.css when the student shell renders, never on a public page (2026-10-05).
    expect(all.filter((href) => !webFont.includes(href))).toEqual([]);
    expect(INDEX_HTML).not.toMatch(/source-(sans|serif)-[^"]*\.woff2/);
    for (const tag of preloads) {
      // Without crossorigin the browser cannot reuse a font preload and fetches it twice.
      expect(tag).toMatch(/\scrossorigin\b/);
      expect(tag).toMatch(/type="font\/woff2"/);
    }
    const srcs = WEB_FACES.map((f) => f.src);
    for (const href of webFont) expect(srcs).toContain(href);
  });

  it("R1.3 no Google font host, and no font loaded by a CSS @import", () => {
    // Presence first: the head still carries its preloads, so this file is the one served.
    expect(fontPreloads(INDEX_HTML).length).toBeGreaterThan(0);
    for (const host of ["fonts.googleapis.com", "fonts.gstatic.com"]) {
      expect(INDEX_HTML).not.toContain(host);
      expect(INDEX_CSS).not.toContain(host);
    }
    expect(INDEX_HTML).not.toMatch(/@import/);
    expect(INDEX_CSS).not.toMatch(/@import/);
  });
});

describe("UI-12 no synchronous third-party script in index.html", () => {
  it("R2.1 the Replit dev-banner script is gone", () => {
    expect(INDEX_HTML).not.toMatch(/replit/i);
  });

  it("R2.2 every external script is a module, async or deferred", () => {
    const scripts = [...INDEX_HTML.matchAll(/<script\b[^>]*>/gi)].map(
      (m) => m[0],
    );
    const external = scripts.filter((tag) => /\bsrc\s*=/i.test(tag));
    expect(external.length).toBeGreaterThan(0);
    for (const tag of external) {
      expect(tag).toMatch(/type\s*=\s*["']module["']|\basync\b|\bdefer\b/i);
    }
  });

  // UI-47 (theme before first paint) needs one synchronous INLINE script: it makes no request,
  // so it is not a render-blocking resource, and deferring it would paint the wrong theme first.
  // It is the only inline script allowed (amended 2026-10-02, Brief 13 Step 1).
  it("R2.3 the only inline script is the theme boot", () => {
    const inline = [...INDEX_HTML.matchAll(/<script\b[^>]*>/gi)]
      .map((m) => m[0])
      .filter((tag) => !/\bsrc\s*=/i.test(tag));
    expect(inline).toEqual(['<script id="lyceon-theme-boot">']);
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
