/**
 * @spec [SCL-080] | @implemented [2026-09-01]
 *
 * plain English: pins what the guardian dashboard actually sends, and what it no longer
 * sends. Expected outcome: a future edit cannot quietly restore the email invitation, and
 * cannot leave the UI promising an acceptance step that no longer exists.
 *
 * WHY SOURCE-TEXT ASSERTIONS RATHER THAN A RENDER. The claims here are about which ENDPOINT
 * the surface calls and which promises its copy makes — both are properties of the file, and
 * a render test would pass just as happily with the old endpoint behind a mock. The
 * behavioural half (redeem semantics, the race, single use) is proved for real against
 * Postgres in `guardian-link-code.pg.ci.test.ts`; this covers the wiring that test cannot see.
 *
 * This file mocks nothing and touches no database, so the guardian schema-truth gate's RULE A
 * does not apply: there is no query layer here to substitute.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../..",
);
const read = (rel: string): string =>
  fs.readFileSync(path.join(root, rel), "utf8");

const DASHBOARD = "client/src/pages/guardian-dashboard.tsx";

describe("guardian link-code wiring (SCL-080)", () => {
  it("redeems a code at the code endpoint", () => {
    const src = read(DASHBOARD);
    expect(src).toContain('"/api/guardian/link/redeem"');
    // The submitted value travels as `code`, in the same call — two separate substring
    // checks would pass with the field sitting in a dead variable elsewhere.
    expect(src).toMatch(/link\/redeem[^;]*JSON\.stringify\(\{ code \}\)/s);
  });

  /**
   * The deletion, asserted so it cannot come back by accident. `POST /api/guardian/link`
   * with an email body was removed server-side; a client still calling it would 404 with no
   * type error to warn anyone.
   */
  it("no longer posts an email invitation to the deleted endpoint", () => {
    const src = read(DASHBOARD);
    expect(src).not.toMatch(/csrfFetch\(\s*"\/api\/guardian\/link"/);
    expect(src).not.toContain("linkEmail");
  });

  /**
   * SCL-080 removed the acceptance step. Copy that still tells a guardian to wait for one
   * describes a flow the server cannot perform — the failure the owner hit in production,
   * in a different form.
   */
  it("promises no acceptance step anywhere in the surface", () => {
    const src = read(DASHBOARD);
    expect(src).not.toMatch(/accept the pending/i);
    expect(src).not.toMatch(/Send Request/);
    expect(src).not.toMatch(/pending_student_accept'|"pending_student_accept"/);
  });

  /** The student's half names the same endpoints, from the shared helpers. */
  it("the student panel uses the shared URL helpers, not a hand-built path", () => {
    const src = read("client/src/components/student/StudentLinkCodePanel.tsx");
    expect(src).toContain("studentLinkCodeUrl");
    expect(src).toContain("studentLinkCodeRegenerateUrl");
    expect(src).not.toMatch(/`\/api\/students\/\$\{/);
  });

  /**
   * A client component importing the shared BARREL pulls `env.ts` — and the string
   * `CSRF_SECRET` — into the browser bundle, which fails the built-output secret scan. That
   * happened once on 2026-09-01; this stops it recurring silently.
   */
  it("the student panel does not import the shared barrel", () => {
    const src = read("client/src/components/student/StudentLinkCodePanel.tsx");
    expect(src).not.toMatch(/from ["']@lyceon\/shared["']/);
  });
});
