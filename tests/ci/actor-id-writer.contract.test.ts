/**
 * `actor_id` is never derived from an identity — source contract.
 *
 * @spec [Doc 05E §3 Rule 4, §6 INV-05E-06 / INV-05E-07; SCL-151 (PROPOSED);
 *        owner brief 2026-09-25 R2] | @implemented [2026-09-25]
 *
 * plain English: two route handlers set `actor_id` to the profile's primary key —
 * `diagnostic-routes.ts` unconditionally, `review-canonical.ts` as a `?? studentId` fallback.
 * The grouping identifier became the identity key, so anonymization had nothing to sever.
 *
 * WHY THIS TEST IS SOURCE-LEVEL, SAID PLAINLY RATHER THAN HIDDEN. The database-side guards —
 * `public.actor_id_integrity_violations()` (gate A.7 in genesis-fresh-apply) and the cascade's
 * sentinel — are writer-agnostic and catch ANY producer of a bad value. But they only see rows,
 * and no test drives the diagnostic route's session-create path, so on a fresh CI database
 * there are no rows to catch. A regression in the writer would therefore reach production
 * again. This file closes that specific hole: it forbids the two SHAPES at the source.
 *
 * It strips comments first, via the canonical `stripComments`. A guard that greps raw source is
 * satisfied by prose about the thing it forbids — including the explanatory comments in the
 * very files it checks, which name these patterns to explain why they are wrong. That hazard
 * has bitten this repo before (M54, and the retention-sweep absence assertions).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/strip-comments";

const ROUTE_DIR = path.join(process.cwd(), "server", "routes");

/** The identity-shaped names an actor_id must never be assigned from. */
const IDENTITY_NAMES = [
  "userId",
  "studentId",
  "profileId",
  "user.id",
  "user?.id",
];

/**
 * Comment-stripped source with every whitespace run collapsed to one space, so the shapes below
 * can be matched with plain string containment.
 *
 * WHY NOT A REGEX BUILT FROM `IDENTITY_NAMES`. The first version of this file did exactly that,
 * escaping the names with `.replace(/[.?]/g, "\\$&")` — an INCOMPLETE escape (it misses the
 * backslash itself, and `*+^${}()|[]`). CodeQL flagged it as two high-severity
 * "Incomplete string escaping or encoding" alerts, correctly. Completing the character class
 * would have silenced the alert; not building a pattern out of data removes the whole class of
 * mistake, and reads better besides. `user?.id` and `user.id` need no escaping at all under
 * plain containment.
 */
function normalizedSource(file: string): string {
  return stripComments(fs.readFileSync(file, "utf8")).replace(/\s+/g, " ");
}

function routeFiles(): string[] {
  return fs
    .readdirSync(ROUTE_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => path.join(ROUTE_DIR, f));
}

describe("actor_id writer contract — the grouping identifier is never the identity", () => {
  it("D1.1 the diagnostic route resolves actor_id from the profile, not from the identity", () => {
    const src = normalizedSource(path.join(ROUTE_DIR, "diagnostic-routes.ts"));
    // it must read the profile's actor_id…
    expect(src).toContain("user?.actor_id");
    // …and must not assign an identity to it, in any of the shapes that caused this
    for (const name of IDENTITY_NAMES) {
      expect(src).not.toContain(`const actorId = ${name}`);
      expect(src).not.toContain(`actor_id: ${name}`);
    }
  });

  it("D1.2 no route file falls back from actor_id to an identity", () => {
    const offenders: string[] = [];
    for (const file of routeFiles()) {
      const src = normalizedSource(file);
      for (const name of IDENTITY_NAMES) {
        // `user?.actor_id ?? studentId` — the review-canonical shape
        if (src.includes(`actor_id ?? ${name}`)) {
          offenders.push(`${path.basename(file)}: actor_id ?? ${name}`);
        }
        // `const actorId = userId;` — the diagnostic-routes shape
        if (src.includes(`const actorId = ${name};`)) {
          offenders.push(`${path.basename(file)}: const actorId = ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("D1.3 the guard is not vacuous — it sees both planted shapes, and comments do not count", () => {
    const norm = (src: string): string =>
      stripComments(src).replace(/\s+/g, " ");

    // both production shapes, with deliberately awkward spacing, must be detected
    expect(norm("const   actorId\n  =  userId ;")).toContain(
      "const actorId = userId ;",
    );
    expect(norm("const actorId = userId;")).toContain(
      "const actorId = userId;",
    );
    expect(norm("const a = user?.actor_id   ??   studentId;")).toContain(
      "actor_id ?? studentId",
    );

    // …and a comment naming the forbidden shape must NOT count, which is the reason this file
    // strips comments before matching at all
    const commentOnly = norm(
      "// never write const actorId = userId, and never actor_id ?? studentId\nconst ok = 1;",
    );
    expect(commentOnly).not.toContain("const actorId = userId");
    expect(commentOnly).not.toContain("actor_id ?? studentId");
  });

  it("D1.4 every route file was actually read", () => {
    const files = routeFiles();
    expect(files.length).toBeGreaterThan(5);
    expect(files.map((f) => path.basename(f))).toContain(
      "diagnostic-routes.ts",
    );
    expect(files.map((f) => path.basename(f))).toContain("review-canonical.ts");
  });
});
