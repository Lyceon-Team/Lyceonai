/**
 * U8 and U9 — review must be reachable from normal navigation.
 *
 * @spec [brief R4 §2.4 ("a feature that isn't reachable from the UI doesn't exist"),
 *        U8/U9; `return-path.ts:23` ("Every entry is a route in App.tsx")]
 * @implemented [2026-09-22]
 *
 * Plants, per brief R4 §3:
 *   U8 — remove the nav entry (`{ href: "/review", … }` from `layout/app-shell.tsx`'s
 *        `navItems`, or the dashboard tile) and the matching assertion goes red.
 *   U9 — remove `"/review"` from `RETURN_PATH_ALLOWLIST` and both halves go red: the
 *        allowlist membership, and `sanitizeReturnPath("/review")`.
 *
 * WHY THESE READ SOURCE TEXT. A nav entry and a route registration are facts about
 * FILES, not about a rendered tree: `navItems` (`layout/app-shell.tsx:56-62`) feeds both
 * the desktop nav and the mobile drawer from one array, and `App.tsx` mounts routes
 * inside a `<Switch>` that needs the whole router to render. Asserting on the source is
 * the honest, non-brittle way to pin "the entry exists" — and it is the only way to pin
 * R1's own carry-over rule, that every allowlist entry is a route in `App.tsx`.
 * Behavioural coverage of the allowlist lives in `sanitizeReturnPath` below.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RETURN_PATH_ALLOWLIST,
  RETURN_PATH_ROUTE_ROLES,
  sanitizeReturnPath,
} from "@lyceon/shared/return-path";

const REPO_ROOT = join(__dirname, "..", "..");

function read(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), "utf8");
}

describe("U8 — review is reachable from normal navigation", () => {
  it("the LIVE global nav carries a Review entry (desktop and mobile share it)", () => {
    const shell = read("client/src/components/layout/app-shell.tsx");
    expect(shell).toContain('href: "/review"');
    expect(shell).toContain('label: "Review"');

    // One array, two renderers — so the single entry covers the mobile drawer too.
    expect(shell).toContain("const navItems");
    const navItemsBlock = shell.slice(
      shell.indexOf("const navItems"),
      shell.indexOf("];", shell.indexOf("const navItems")),
    );
    expect(navItemsBlock).toContain("/review");
    expect(navItemsBlock).toContain("/practice");
  });

  it("the dashboard carries a Review tile pointing at /review", () => {
    const dashboard = read("client/src/pages/lyceon-dashboard.tsx");
    // The claim is "a tile links to /review", not "the tag is spelled this way on one
    // line". #829 moved the className onto the same tag, which broke the literal without
    // touching reachability.
    expect(dashboard).toMatch(/<Link\b[^>]*?href="\/review"/);
    expect(dashboard).toContain("Review Queue");
  });

  it("practice's landing carries the secondary action back to /review", () => {
    const practice = read("client/src/pages/practice.tsx");
    const actionsBlock = practice.slice(
      practice.indexOf("const secondaryActions"),
      practice.indexOf("];", practice.indexOf("const secondaryActions")),
    );
    expect(actionsBlock).toContain('href: "/review"');
  });

  /**
   * @spec [brief R4 §2.4; register UI-06] | @implemented [2026-09-29] | plain English:
   * the brief's rule is about EVERY nav component, not just the live one. This used to
   * name three orphan navs (`NavBar`, `navigation`, `progress-sidebar`); UI-06 deleted
   * them, so the rule is now enforced by discovery: any component whose file name says
   * it is navigation (nav / navigation / sidebar / shell / menu, outside the `ui/`
   * primitives) and that carries a Practice nav entry must carry a Review entry too.
   * A nav added or revived later is caught without editing this list. Trade-off: a nav
   * named outside that vocabulary escapes, which is why the live nav is also pinned by
   * name above.
   */
  it("every nav component that links to Practice also links to Review", () => {
    const componentsDir = join(REPO_ROOT, "client/src/components");
    const navFiles = (
      readdirSync(componentsDir, {
        recursive: true,
        encoding: "utf8",
      }) as string[]
    )
      .map((relative) => relative.split("\\").join("/"))
      .filter((relative) => relative.endsWith(".tsx"))
      .filter((relative) => !relative.startsWith("ui/"))
      .filter((relative) => !/\.test\.tsx$/.test(relative))
      .filter((relative) =>
        /(nav|navigation|sidebar|shell|menu)[^/]*\.tsx$/i.test(relative),
      )
      .map((relative) => `client/src/components/${relative}`);

    // Presence before absence: the discovery must find the live nav, or an empty
    // list would pass this test for the wrong reason.
    expect(navFiles).toContain("client/src/components/layout/app-shell.tsx");

    const practiceEntry = /href(?:=|:\s*)["']\/practice["']/;
    const reviewEntry = /href(?:=|:\s*)["']\/review["']/;
    const linkingPractice = navFiles.filter((file) =>
      practiceEntry.test(read(file)),
    );
    expect(linkingPractice).toContain(
      "client/src/components/layout/app-shell.tsx",
    );

    for (const file of linkingPractice) {
      expect(read(file), `${file} links /practice but not /review`).toMatch(
        reviewEntry,
      );
    }
  });
});

describe("U9 — /review is in the allowlist and in App.tsx", () => {
  it("RETURN_PATH_ALLOWLIST contains /review", () => {
    expect(RETURN_PATH_ALLOWLIST).toContain("/review");
  });

  it("sanitizeReturnPath honours /review and its sub-paths", () => {
    expect(sanitizeReturnPath("/review")).toBe("/review");
    expect(sanitizeReturnPath("/review/session/abc-123")).toBe(
      "/review/session/abc-123",
    );
  });

  it("still refuses the pre-R1 route and anything off-origin", () => {
    // `/review-errors` does not start with `/review/` and is not `/review`, so the
    // prefix rule rejects it — the dead route cannot be revived through the allowlist.
    expect(sanitizeReturnPath("/review-errors")).toBeNull();
    expect(sanitizeReturnPath("https://evil.example/review")).toBeNull();
    expect(sanitizeReturnPath("//evil.example/review")).toBeNull();
  });

  it("App.tsx mounts both review routes behind the same role gate as practice", () => {
    const app = read("client/src/App.tsx");
    expect(app).toContain('path="/review"');
    expect(app).toContain('path="/review/session/:sessionId"');
    expect(app).toContain('import("@/pages/review")');
    expect(app).toContain('import("@/pages/resume-review")');

    const reviewRouteBlock = app.slice(
      app.indexOf('path="/review"'),
      app.indexOf('path="/review/session/:sessionId"'),
    );
    expect(reviewRouteBlock).toContain('allow={["student", "admin"]}');
  });

  it("every allowlist entry is a route in App.tsx (the file's own rule)", () => {
    const app = read("client/src/App.tsx");
    // G4-01: the guardian routes are mounted in App.tsx from one table, GUARDIAN_ROUTES.
    expect(app).toContain("GUARDIAN_ROUTES");
    const guardianRoutes = read("client/src/features/guardian/routes.tsx");
    for (const entry of RETURN_PATH_ALLOWLIST) {
      const mounted =
        app.includes(`path="${entry}"`) ||
        guardianRoutes.includes(`path: "${entry}"`);
      expect(mounted, `${entry} is allowlisted but not mounted`).toBe(true);
    }
  });

  /**
   * @spec [AS-5; register UI-03] | @implemented [2026-09-29] — the return path is role-aware
   * (`RETURN_PATH_ROUTE_ROLES`), so its role lists must be the ones App.tsx's RequireRole
   * actually enforces on each route. Read from source for the same reason as above: the route
   * table is a fact about the file. Plant: change any role list in return-path.ts, or any
   * allowlisted route's `allow={[…]}` in App.tsx, and this goes red.
   */
  it("every allowlist entry's role list is the RequireRole gate App.tsx mounts it behind", () => {
    const app = read("client/src/App.tsx");
    const allowOf = (from: number): string[] => {
      const match = /allow=\{\[([^\]]*)\]\}/.exec(app.slice(from));
      expect(match, `no allow={[…]} after offset ${from}`).not.toBeNull();
      return [...(match?.[1] ?? "").matchAll(/"([a-z]+)"/g)]
        .map((m) => m[1] ?? "")
        .sort();
    };
    // G4-01: guardian routes are mounted from one table, GUARDIAN_ROUTES, behind one
    // RequireRole in App.tsx's `GUARDIAN_ROUTES.map(…)`; that mount is their gate.
    const guardianRoutes = read("client/src/features/guardian/routes.tsx");
    const guardianMount = app.indexOf("GUARDIAN_ROUTES.map(");
    for (const entry of RETURN_PATH_ALLOWLIST) {
      if (
        !app.includes(`path="${entry}"`) &&
        guardianRoutes.includes(`path: "${entry}"`)
      ) {
        expect(guardianMount, "GUARDIAN_ROUTES is not mounted").toBeGreaterThan(
          -1,
        );
        expect(allowOf(guardianMount), entry).toEqual(
          [...(RETURN_PATH_ROUTE_ROLES[entry] ?? [])].sort(),
        );
        continue;
      }
      const at = app.indexOf(`path="${entry}"`);
      expect(at, `${entry} is not mounted`).toBeGreaterThan(-1);
      // Either an inline `component={() => (<RequireRole allow=…>` or a named module-scope
      // wrapper (`component={TestsHomeRoute}`, whose body holds the RequireRole).
      const named = /^path="[^"]*"\s+component=\{([A-Z]\w*)\}/.exec(
        app.slice(at),
      );
      const gateAt = named ? app.indexOf(`function ${named[1] ?? ""}()`) : at;
      expect(gateAt, `${entry}: wrapper not found`).toBeGreaterThan(-1);
      expect(allowOf(gateAt), entry).toEqual(
        [...(RETURN_PATH_ROUTE_ROLES[entry] ?? [])].sort(),
      );
    }
  });
});

describe("sweep — no pre-R1 review route survives outside the historical record", () => {
  it("robots.txt names /review, not the deleted /review-errors", () => {
    const robots = read("client/public/robots.txt");
    expect(robots).toContain("Disallow: /review\n");
    expect(robots).not.toContain("/review-errors");
  });

  /**
   * R1 deleted `/api/review-errors*` and R3 replaced it with `/api/review/*`, but the
   * name survived in four docs, a public trust page and a Postman collection that
   * would 404 for anyone who ran it. A one-time grep fixes that once; this keeps it
   * fixed.
   *
   * EXCLUDED, on purpose: `docs/Spec/` is canonical and READ-ONLY, and
   * `docs/SpecAudit/` plus `docs/plans/` are the historical record — an audit that
   * described the pre-R1 world was accurate when it was written and rewriting it would
   * be falsifying a record, not fixing a defect. `docs/contracts/` is allowed to name
   * the route precisely because it documents its REMOVAL. Build output and logs are
   * regenerated, not authored.
   */
  it("no live source, config or tooling still names the deleted route", () => {
    const tracked = execFileSync("git", ["ls-files", "-z"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    })
      .split("\0")
      .filter((f) => f.length > 0);

    const EXCLUDED = [
      "docs/Spec/",
      "docs/SpecAudit/",
      "docs/plans/",
      "docs/contracts/",
      "dist/",
      "audit-out/",
      "output/",
      "audit_output.json",
      // This file names the string in order to forbid it.
      "client/src/review-entry-points.test.ts",
    ];

    const offenders: string[] = [];
    for (const file of tracked) {
      if (EXCLUDED.some((prefix) => file.startsWith(prefix))) continue;
      if (!/\.(ts|tsx|js|jsx|json|yaml|yml|md|txt|sql|sh|mjs)$/.test(file))
        continue;

      let body: string;
      try {
        body = readFileSync(join(REPO_ROOT, file), "utf8");
      } catch {
        continue; // a path git tracks but this checkout cannot read is not a finding
      }
      if (!/review-errors/.test(body)) continue;

      // A doc may name the route to record that it is GONE. Naming it any other way
      // is a live reference.
      const live = body
        .split("\n")
        .filter((line) => line.includes("review-errors"))
        .filter(
          (line) =>
            !/\b(deleted|DELETED|removed|gone|legacy|no longer|gone:|gone\.)/i.test(
              line,
            ),
        );
      if (live.length > 0) offenders.push(`${file}: ${live[0]?.trim()}`);
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
