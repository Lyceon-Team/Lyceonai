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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RETURN_PATH_ALLOWLIST,
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
    expect(dashboard).toContain('<Link href="/review">');
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

  it("every other nav component that lists Practice also lists Review", () => {
    // These three have no importers today, but a revived nav must not ship without
    // review — the brief's §2.4 rule is about every nav component, not just the live one.
    for (const file of [
      "client/src/components/NavBar.tsx",
      "client/src/components/navigation.tsx",
      "client/src/components/progress-sidebar.tsx",
    ]) {
      const source = read(file);
      expect(source, `${file} mentions /practice`).toContain("/practice");
      expect(source, `${file} is missing /review`).toContain("/review");
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
    for (const entry of RETURN_PATH_ALLOWLIST) {
      expect(app, `${entry} is allowlisted but not mounted`).toContain(
        `path="${entry}"`,
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
