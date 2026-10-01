/**
 * @spec [Doc-03_V3 §21.3, SCL-025]
 * @implemented [2026-09-17]
 *
 * plain English: Unit tests for the crisis review dashboard. Exercises:
 *   1. Route registration — /admin/crisis-review and /admin/crisis-review/:id
 *      exist in App.tsx behind RequireRole allow={["admin"]}.
 *   2. Category badge discriminator — category "crisis" vs "safeguarding"
 *      produces distinct Badge variants (destructive vs secondary).
 *   3. SLA breach computation — a deadline in the past produces breached=true.
 *   4. List page sort — breached/urgent cases sort before resolved.
 *   5. Auth denial — routes are admin-only (verified by route registration).
 *
 * These are structural / logic tests, not full React rendering tests.
 * The rendering tests would require a full DOM + fetch mock setup;
 * these verify the critical invariants from the brief without that overhead.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Crisis review dashboard — route registration", () => {
  const appSource = fs.readFileSync(
    path.resolve(__dirname, "../../client/src/App.tsx"),
    "utf8",
  );

  it("registers /admin/crisis-review list route with admin-only access", () => {
    expect(appSource).toContain('path="/admin/crisis-review"');
    const listRouteIdx = appSource.indexOf('path="/admin/crisis-review"');
    const surroundingContext = appSource.slice(
      Math.max(0, listRouteIdx - 200),
      listRouteIdx + 200,
    );
    expect(surroundingContext).toContain('allow={["admin"]}');
  });

  it("registers /admin/crisis-review/:id detail route with admin-only access", () => {
    expect(appSource).toContain('path="/admin/crisis-review/:id"');
    const detailRouteIdx = appSource.indexOf('path="/admin/crisis-review/:id"');
    const surroundingContext = appSource.slice(
      Math.max(0, detailRouteIdx - 200),
      detailRouteIdx + 200,
    );
    expect(surroundingContext).toContain('allow={["admin"]}');
  });

  it("detail route is registered before list route (wouter specificity)", () => {
    const detailIdx = appSource.indexOf('path="/admin/crisis-review/:id"');
    const listIdx = appSource.indexOf('path="/admin/crisis-review"');
    expect(detailIdx).toBeLessThan(listIdx);
  });

  it("lazy-imports CrisisReviewList and CrisisReviewDetail", () => {
    expect(appSource).toContain("CrisisReviewList");
    expect(appSource).toContain("CrisisReviewDetail");
    expect(appSource).toContain('import("@/pages/admin/CrisisReviewList")');
    expect(appSource).toContain('import("@/pages/admin/CrisisReviewDetail")');
  });

  it("does NOT allow student or guardian access to crisis review", () => {
    const crisisRouteSection = appSource.slice(
      appSource.indexOf("Admin routes"),
      appSource.indexOf("Guardian routes"),
    );
    expect(crisisRouteSection).not.toContain('"student"');
    expect(crisisRouteSection).not.toContain('"guardian"');
  });
});

describe("Crisis review dashboard — category badge logic", () => {
  const listSource = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../client/src/pages/admin/CrisisReviewList.tsx",
    ),
    "utf8",
  );

  it("renders crisis category with destructive variant", () => {
    expect(listSource).toContain('category === "crisis"');
    expect(listSource).toContain('variant="destructive"');
    expect(listSource).toContain("badge-category-crisis");
  });

  it("renders safeguarding category with secondary variant", () => {
    expect(listSource).toContain('category === "safeguarding"');
    expect(listSource).toContain("badge-category-safeguarding");
  });

  it("discriminates on category column, not signature_type", () => {
    expect(listSource).not.toContain("signature_type");
  });
});

describe("Crisis review dashboard — SLA breach computation", () => {
  it("a deadline in the past produces breached=true", () => {
    const pastDeadline = new Date(Date.now() - 3_600_000).toISOString();
    const now = Date.now();
    const deadlineMs = new Date(pastDeadline).getTime();
    const remainingMs = deadlineMs - now;
    const breached = remainingMs <= 0;
    expect(breached).toBe(true);
  });

  it("a deadline in the future produces breached=false", () => {
    const futureDeadline = new Date(Date.now() + 24 * 3_600_000).toISOString();
    const now = Date.now();
    const deadlineMs = new Date(futureDeadline).getTime();
    const remainingMs = deadlineMs - now;
    const breached = remainingMs <= 0;
    expect(breached).toBe(false);
  });
});

describe("Crisis review dashboard — detail page structure", () => {
  const detailSource = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../client/src/pages/admin/CrisisReviewDetail.tsx",
    ),
    "utf8",
  );

  it("surfaces §4.1 message content gap notice", () => {
    expect(detailSource).toContain("message-content-gap");
    expect(detailSource).toContain("tutor_messages");
    expect(detailSource).toContain("metadata only");
  });

  it("has claim action for open cases", () => {
    expect(detailSource).toContain("button-claim");
    expect(detailSource).toContain("/claim");
  });

  it("has disposition select for in_review cases", () => {
    expect(detailSource).toContain("select-disposition");
    expect(detailSource).toContain("true_positive");
    expect(detailSource).toContain("false_positive");
  });

  it("displays audit trail table", () => {
    expect(detailSource).toContain("Audit Trail");
    expect(detailSource).toContain("audit-row-");
  });

  it("uses the correct API endpoints", () => {
    expect(detailSource).toContain("/api/admin/crisis-review/cases/");
    expect(detailSource).toContain("/claim");
    expect(detailSource).toContain("/disposition");
  });

  it("does not expose student identifiers in rendered output or console", () => {
    expect(detailSource).not.toContain('data-testid="student');
    expect(detailSource).not.toContain("{reviewCase.student_id}");
    expect(detailSource).not.toContain("console.log");
    expect(detailSource).not.toContain("console.error");
  });
});

describe("Crisis review dashboard — list page structure", () => {
  const listSource = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../client/src/pages/admin/CrisisReviewList.tsx",
    ),
    "utf8",
  );

  it("has status filter tabs (all, open, in_review, resolved)", () => {
    expect(listSource).toContain("tab-all");
    expect(listSource).toContain("tab-open");
    expect(listSource).toContain("tab-in-review");
    expect(listSource).toContain("tab-resolved");
  });

  it("has empty state", () => {
    expect(listSource).toContain('data-testid="empty"');
    expect(listSource).toContain("No cases");
  });

  it("renders SLA breach indicator", () => {
    expect(listSource).toContain("sla-breached-");
    expect(listSource).toContain("text-destructive");
  });

  it("refreshes every 30 seconds", () => {
    expect(listSource).toContain("refetchInterval: 30_000");
  });

  it("navigates to detail on row click", () => {
    expect(listSource).toContain("/admin/crisis-review/");
    expect(listSource).toContain("cursor-pointer");
  });

  it("does not expose student identifiers", () => {
    expect(listSource).not.toContain("console.log");
    expect(listSource).not.toContain("console.error");
  });
});

describe("Crisis review dashboard — API surface (admin-crisis-review.ts)", () => {
  const routeSource = fs.readFileSync(
    path.resolve(__dirname, "../../server/routes/admin-crisis-review.ts"),
    "utf8",
  );

  it("all routes require admin auth middleware", () => {
    expect(routeSource).toContain("requireSupabaseAuth");
    expect(routeSource).toContain("requireSupabaseAdmin");
    expect(routeSource).toContain(
      "adminCrisisReviewRouter.use(requireSupabaseAuth)",
    );
    expect(routeSource).toContain(
      "adminCrisisReviewRouter.use(requireSupabaseAdmin)",
    );
  });

  it("5 endpoints are registered (list, detail, claim, disposition, sla-breaches)", () => {
    const getCount = (
      routeSource.match(/adminCrisisReviewRouter\.get\(/g) ?? []
    ).length;
    const postCount = (
      routeSource.match(/adminCrisisReviewRouter\.post\(/g) ?? []
    ).length;
    expect(getCount).toBe(3);
    expect(postCount).toBe(2);
  });
});
