/**
 * Where the LISA chat dock can appear: Home, Review and the review runner, and nowhere else.
 *
 * @spec [owner brief "LISA chat dock" (Karl, 2026-10-22): "Where it appears: practice and review
 *        runners ... Home and Review pages ... Never: the live full-length test, any guardian
 *        surface, signed-out pages"; "The same bubble component is used on runners, Home and
 *        Review"; "Today's availability rules are unchanged"] | @implemented [2026-10-22]
 *
 * plain English: an import-graph check over client/src, so it covers every route at once,
 * including ones no browser test visits. The dock is a module (`ChatDock.tsx`) that renders only
 * where it is imported and drawn, so:
 *   1. exactly three production modules import it, and each draws `<ChatDock`: Home
 *      (`pages/lyceon-dashboard.tsx`), Review (`pages/review.tsx`) and the question runner
 *      (`components/practice/CanonicalPracticePage.tsx`) — one component, three hosts;
 *   2. the runner draws it for review throughout (`features.tutor`) and, since owner ruling 2 on
 *      #1300 (2026-10-23), for practice once the current question is submitted
 *      (`features.tutorAfterSubmit`); never in the diagnostic, never on a phone;
 *   3. from the app root's static imports (the shells, providers, the cookie banner) it is not
 *      reachable, so it is never global;
 *   4. from every full-length exam page, every guardian route, the LISA page itself and the
 *      signed-out public pages, following static AND lazy imports, it is not reachable;
 *   5. Home, Review and the review runner's routes are student-only (`RequireRole` student or
 *      admin), so a signed-out visitor never mounts them.
 * The browser spec (tests/e2e/lisa-dock.spec.ts) checks the same on the rendered pages.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRACTICE_ENGINE_CONFIG,
  REVIEW_ENGINE_CONFIG,
} from "@/lib/engine-config";

const SRC = path.resolve(__dirname, "../..");
const DOCK = path.join(SRC, "components/tutor/ChatDock.tsx");

const EXTS = [".tsx", ".ts", "/index.tsx", "/index.ts"];

function resolveSpecifier(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../"))
    base = path.resolve(path.dirname(from), spec);
  else return null; // a package, or the shared packages: never the dock
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const ext of EXTS) {
    const candidate = base + ext;
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const STATIC_IMPORT =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/g;
/**
 * A lazily RENDERED module: `lazy(() => import("..."))` (React.lazy too). A bare `void
 * import("...")` only warms a chunk (the calendar's launch prefetch, features/calendar/api/
 * launch.ts) and renders nothing, so it is not followed.
 */
const DYNAMIC_IMPORT = /lazy\(\s*\(\)\s*=>\s*import\(\s*["']([^"']+)["']\s*\)/g;

function importsOf(file: string, followLazy: boolean): string[] {
  const text = fs.readFileSync(file, "utf8");
  const specs: string[] = [];
  for (const m of text.matchAll(STATIC_IMPORT)) {
    // `import type` never reaches the bundle.
    if (/^\s*(?:import|export)\s+type\s/.test(m[0].replace(/^\n/, "")))
      continue;
    if (m[1]) specs.push(m[1]);
  }
  if (followLazy)
    for (const m of text.matchAll(DYNAMIC_IMPORT)) if (m[1]) specs.push(m[1]);
  return specs
    .map((s) => resolveSpecifier(file, s))
    .filter((f): f is string => f !== null && !/\.test\.tsx?$/.test(f));
}

function reaches(
  entry: string,
  target: string,
  followLazy: boolean,
  stopAt: ReadonlySet<string> = new Set(),
): boolean {
  const seen = new Set<string>();
  const stack = [path.join(SRC, entry)];
  while (stack.length > 0) {
    const file = stack.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    if (file === target) return true;
    if (stopAt.has(file)) continue;
    stack.push(...importsOf(file, followLazy));
  }
  return false;
}

const RUNNER = path.join(SRC, "components/practice/CanonicalPracticePage.tsx");
/** The one page that mounts the runner with the review engine, so the one runner with a dock. */
const REVIEW_RUNNER_PAGE = path.join(SRC, "pages/resume-review.tsx");

/**
 * Whether `entry` can render the dock: it reaches ChatDock other than through the runner (Home,
 * Review), or it reaches the review runner's page. The runner itself is a gated host (the dock
 * only for `features.tutor`, test 2), and it is imported for other reasons (the practice runner,
 * the calendar's chunk prefetch), so reaching it is not reaching the dock.
 */
function canRenderDock(entry: string): boolean {
  return (
    reaches(entry, DOCK, true, new Set([RUNNER])) ||
    reaches(entry, REVIEW_RUNNER_PAGE, true, new Set([RUNNER]))
  );
}

function productionFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...productionFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
      out.push(full);
  }
  return out;
}

const HOSTS = [
  "components/practice/CanonicalPracticePage.tsx",
  "pages/lyceon-dashboard.tsx",
  "pages/review.tsx",
];

describe("the chat dock's surfaces", () => {
  it("one component, three hosts: Home, Review and the question runner import and draw ChatDock, and nothing else does", () => {
    const importers = productionFiles(SRC)
      .filter((f) => f !== DOCK)
      .filter((f) =>
        /from\s+["']@\/components\/tutor\/ChatDock["']/.test(
          fs.readFileSync(f, "utf8"),
        ),
      )
      .map((f) => path.relative(SRC, f))
      .sort();
    expect(importers).toEqual([...HOSTS].sort());
    for (const host of HOSTS) {
      const text = fs.readFileSync(path.join(SRC, host), "utf8");
      expect(text).toMatch(/<ChatDock\b/);
    }
    // The hosts share the one component; none of them draws a bubble of its own.
    for (const host of HOSTS) {
      const text = fs.readFileSync(path.join(SRC, host), "utf8");
      expect(text).not.toMatch(/chat-dock-bubble|aria-label="Ask LISA"/);
    }
  });

  // Owner ruling 2 on #1300 (Karl, 2026-10-23): practice gets the dock post-submit only.
  it("the runner draws it for review throughout and for practice only after submit (never in the diagnostic, never on a phone), and only the review runner's page uses the review engine", () => {
    const runner = fs.readFileSync(path.join(SRC, HOSTS[0] ?? ""), "utf8");
    expect(runner).toMatch(
      /const dockTutor =\s*!isPhoneWidth &&\s*\(engine\.features\.tutor \|\|\s*\(engine\.features\.tutorAfterSubmit && showResult && !isDiagnostic\)\);/,
    );
    expect(runner).toMatch(/\{dockTutor \? \(\s*<ChatDock/);
    expect(REVIEW_ENGINE_CONFIG.features.tutor).toBe(true);
    expect(REVIEW_ENGINE_CONFIG.features.tutorAfterSubmit).toBe(false);
    expect(PRACTICE_ENGINE_CONFIG.features.tutor).toBe(false);
    expect(PRACTICE_ENGINE_CONFIG.features.tutorAfterSubmit).toBe(true);
    const reviewEngineUsers = productionFiles(SRC)
      .filter((f) =>
        /import\s*\{[^}]*\bREVIEW_ENGINE_CONFIG\b[^}]*\}\s*from/.test(
          fs.readFileSync(f, "utf8"),
        ),
      )
      .map((f) => path.relative(SRC, f))
      .sort();
    expect(reviewEngineUsers).toEqual(["pages/resume-review.tsx"]);
  });

  it("it is not global: the app root's static imports (shells, providers, the cookie banner) never reach it", () => {
    // Presence first: the walk does reach what the root mounts statically.
    expect(
      reaches(
        "App.tsx",
        path.join(SRC, "components/consent/CookieConsentRoot.tsx"),
        false,
      ),
    ).toBe(true);
    expect(reaches("App.tsx", DOCK, false)).toBe(false);
  });

  it("Home, Review and the review runner reach it", () => {
    for (const entry of [
      "pages/lyceon-dashboard.tsx",
      "pages/review.tsx",
      "pages/resume-review.tsx",
    ]) {
      expect(reaches(entry, DOCK, true), entry).toBe(true);
      expect(canRenderDock(entry), entry).toBe(true);
    }
  });

  it("never: the full-length exam pages, guardian routes, the LISA page itself, or the signed-out public pages", () => {
    const never = [
      "features/exam/pages/TestsHomePage.tsx",
      "features/exam/pages/ExamSessionPage.tsx",
      "features/exam/pages/ExamModulePage.tsx",
      "features/exam/pages/ExamReportPage.tsx",
      "features/guardian/routes.tsx",
      "components/layout/GuardianShell.tsx",
      "pages/guardian-required.tsx",
      "pages/guardian-student-calendar.tsx",
      "pages/chat.tsx",
      "pages/home.tsx",
      "pages/login.tsx",
      "pages/content-page.tsx",
      "pages/blog.tsx",
      "pages/blog-post.tsx",
      "pages/legal.tsx",
      "pages/legal-doc.tsx",
      "pages/trust.tsx",
      "pages/contact.tsx",
      "pages/sat-question-of-the-day.tsx",
      "pages/sat-question-of-the-day-day.tsx",
    ];
    for (const entry of never) {
      expect(fs.existsSync(path.join(SRC, entry)), entry).toBe(true);
      expect(canRenderDock(entry), entry).toBe(false);
    }
  });

  it("its host routes are student-only: a signed-out visitor never mounts them", () => {
    const app = fs.readFileSync(path.join(SRC, "App.tsx"), "utf8");
    for (const [route, page] of [
      ["/dashboard", "LyceonDashboard"],
      ["/review", "Review"],
      ["/review/session/:sessionId", "ResumeReview"],
    ] as const) {
      const block = new RegExp(
        `path="${route.replace(/[/:]/g, (c) => `\\${c}`)}"[\\s\\S]{0,240}?<RequireRole allow=\\{\\["student", "admin"\\]\\}>[\\s\\S]{0,200}?<${page} />`,
      );
      expect(app, route).toMatch(block);
    }
  });
});
