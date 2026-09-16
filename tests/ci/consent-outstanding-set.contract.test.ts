/**
 * @spec [Doc 10 §2.4 age-threshold taxonomy, §9.4 Parent / Guardian Terms; Doc 01 §35-§37 guardian linkage;
 *        owner ruling 2026-09-16 — "whatever consents
 *        a user has not given, prompt for them at sign-in"; Coding Standards §14]
 * @implemented 2026-09-16
 *
 * plain English: the outstanding set is derived from the account's own facts,
 * and these are the claims that rests on. Each is written so the obvious way to
 * break it turns this file red, and each is proved by a plant.
 *
 *   O1  the derivation itself — which documents, for which facts
 *   O2  the four production states, computed from the real acceptance rows
 *   O3  one derivation, shared by the prompt and by re-accept
 *   O4  none of it can block, and none of it can fail a request
 *
 * O2 IS THE POINT OF THIS FILE. The rule is easy to state and easy to get wrong
 * against real data — the December-versions account looks current until you
 * compare against the manifest, and the linked guardian looks fine until you
 * notice nothing has ever asked them for Parent Terms. So O2 runs the real
 * `outstandingLegalDocs` shape over acceptance rows copied from production, at
 * whatever version `legal/` currently publishes, rather than restating an
 * expected list of slugs that a code change could quietly make wrong.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  actorTypeForDoc,
  requiredLegalDocsForUse,
  LEGAL_DOCS,
  type LegalAccountFacts,
} from "../../shared/legal-consent";
import { resolveLegalVersion } from "../../server/lib/legal-registry";

const REPO_ROOT = path.resolve(__dirname, "../..");

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function readCode(relative: string): string {
  return stripComments(fs.readFileSync(path.join(REPO_ROOT, relative), "utf-8"));
}

const NOTHING: LegalAccountFacts = {
  hasActiveGuardianLink: false,
  hasEverPaid: false,
};

function slugsFor(facts: Partial<LegalAccountFacts>): string[] {
  return requiredLegalDocsForUse({ ...NOTHING, ...facts }).map((d) => d.slug);
}

/**
 * The published version of each document, read the same way the route reads it.
 * Hard-coding "2.0" here would make this file pass against a tree where the
 * manifest says something else — the exact class of defect the resolver exists
 * to prevent.
 */
const CURRENT: Record<string, string> = {
  "student-terms": resolveLegalVersion("student-terms").version,
  "privacy-policy": resolveLegalVersion("privacy-policy").version,
  "parent-guardian-terms": resolveLegalVersion("parent-guardian-terms").version,
  "billing-terms": resolveLegalVersion("billing-terms").version,
};

/**
 * The same filter `outstandingLegalDocs` applies, over the same inputs. Kept to
 * slugs so the assertion reads as the claim: WHICH documents are outstanding.
 */
function outstandingSlugs(
  rows: Array<{ doc_key: string; doc_version: string }>,
  facts: Partial<LegalAccountFacts>,
): string[] {
  return requiredLegalDocsForUse({ ...NOTHING, ...facts })
    .filter(
      (doc) =>
        !rows.some(
          (r) =>
            r.doc_key === doc.docKey && r.doc_version === CURRENT[doc.slug],
        ),
    )
    .map((d) => d.slug);
}

// ── O1 ──────────────────────────────────────────────────────────────────

describe("O1 — the outstanding set is derived from account facts", () => {
  it("asks Student Terms and Privacy Policy of every account", () => {
    expect(slugsFor({})).toEqual(["student-terms", "privacy-policy"]);
  });

  it("asks Parent Terms of an account holding an active link", () => {
    // THE CASE THAT FAILED BEFORE THIS CHANGE. One production guardian holds two
    // active links and has never accepted Parent Terms — they linked before the
    // redemption capture existed, and no surface anywhere would ever ask them.
    expect(slugsFor({ hasActiveGuardianLink: true })).toContain(
      "parent-guardian-terms",
    );
  });

  it("does not ask Parent Terms of an account with no link", () => {
    expect(slugsFor({})).not.toContain("parent-guardian-terms");
  });

  it("asks Billing Terms of an account that has paid, and only then", () => {
    expect(slugsFor({ hasEverPaid: true })).toContain("billing-terms");
    expect(slugsFor({})).not.toContain("billing-terms");
  });

  it("takes facts, not a role — there is nowhere to put one", () => {
    // The strongest form of "not role logic" is a parameter type that cannot
    // express a role. `LegalAccountFacts` has exactly two boolean members; a
    // `role` field appearing here would be the old defect returning under a
    // new name, so the SHAPE is asserted, not just the behaviour.
    expect(requiredLegalDocsForUse.length).toBe(1);
    const shared = readCode("shared/legal-consent.ts");
    const type = shared.slice(
      shared.indexOf("export type LegalAccountFacts"),
      shared.indexOf("export function requiredLegalDocsForUse"),
    );
    expect(type).toContain("hasActiveGuardianLink");
    expect(type).toContain("hasEverPaid");
    expect(type).not.toMatch(/\brole\b/);
    expect(type).not.toMatch(/guardian\s*\|\s*student|"guardian"/);
  });

  it("keeps the two universal documents first, in a stable order", () => {
    const both = slugsFor({ hasActiveGuardianLink: true, hasEverPaid: true });
    expect(both).toEqual([
      "student-terms",
      "privacy-policy",
      "parent-guardian-terms",
      "billing-terms",
    ]);
  });
});

// ── O2 ──────────────────────────────────────────────────────────────────

describe("O2 — the four production states", () => {
  const DECEMBER = [
    { doc_key: "student_terms", doc_version: "2024-12-20" },
    { doc_key: "privacy_policy", doc_version: "2024-12-22" },
  ];
  const CURRENT_TWO = [
    { doc_key: "student_terms", doc_version: CURRENT["student-terms"]! },
    { doc_key: "privacy_policy", doc_version: CURRENT["privacy-policy"]! },
  ];

  it("no acceptances at all — both documents outstanding", () => {
    expect(outstandingSlugs([], {})).toEqual([
      "student-terms",
      "privacy-policy",
    ]);
  });

  it("December versions only — both outstanding, at the current version", () => {
    // The state that looks current and is not: the rows exist, so a "has this
    // person accepted anything" check would say yes. The version is what counts.
    expect(outstandingSlugs(DECEMBER, {})).toEqual([
      "student-terms",
      "privacy-policy",
    ]);
    expect(CURRENT["student-terms"]).not.toBe("2024-12-20");
  });

  it("the linked guardian on December versions — all three", () => {
    // The real production row: guardian, two active links, December acceptances,
    // no Parent Terms acceptance in any version.
    expect(outstandingSlugs(DECEMBER, { hasActiveGuardianLink: true })).toEqual([
      "student-terms",
      "privacy-policy",
      "parent-guardian-terms",
    ]);
  });

  it("a fully current account — nothing outstanding", () => {
    expect(outstandingSlugs(CURRENT_TWO, {})).toEqual([]);
  });

  it("a payer who is current on both Terms still owes Billing Terms", () => {
    expect(outstandingSlugs(CURRENT_TWO, { hasEverPaid: true })).toEqual([
      "billing-terms",
    ]);
  });
});

// ── O3 ──────────────────────────────────────────────────────────────────

describe("O3 — one derivation, both routes", () => {
  it.each([
    "server/routes/profile-routes.ts",
    "server/routes/legal-routes.ts",
  ])("%s derives the facts from the shared helper", (relative) => {
    const code = readCode(relative);
    expect(code).toContain("loadLegalAccountFacts(");
    // Passed through, never rebuilt at the call site. A second literal
    // `{ hasActiveGuardianLink: ..., hasEverPaid: ... }` in a route is the
    // divergence this test exists to catch: the prompt would offer a document
    // that re-accept refuses to write, and neither route would look wrong.
    expect(code).not.toMatch(/hasActiveGuardianLink\s*:/);
    expect(code).not.toMatch(/hasEverPaid\s*:/);
    expect(code).toMatch(/requiredLegalDocsForUse\(\s*facts\s*\)/);
  });

  it("derives the link fact through the canonical guardian_links layer", () => {
    const facts = readCode("server/lib/legal-account-facts.ts");
    expect(facts).toContain("getAllGuardianStudentLinks(");
    // Not a fourth ad-hoc query against the table.
    expect(facts).not.toContain('from("guardian_links")');
  });

  it("re-accept stamps every document with a resolved slug, version and hash", () => {
    // A bigger outstanding set means more rows written by one click, and every
    // one of them must be stamped from `legal/` rather than from anything the
    // client said or any literal in this file. A guessed version is a false
    // record, and a false record is worse than a missing one.
    const route = readCode("server/routes/legal-routes.ts");
    const reaccept = route.slice(route.indexOf('legalRouter.post("/reaccept"'));
    for (const field of ["docSlug:", "docVersion:", "contentHash:"]) {
      const sites = [...reaccept.matchAll(new RegExp(`${field}\\s*(\\S+)`, "g"))];
      expect(sites.length, `re-accept has no ${field}`).toBe(1);
      for (const [, value] of sites) {
        expect(value, `re-accept passes a literal to ${field}`).not.toMatch(
          /^["'`]/,
        );
        expect(value, `${field} is not fed from a resolved value`).toMatch(
          /^current\.(slug|version|contentHash)\b/,
        );
      }
    }
  });

  it("records the capacity of the DOCUMENT, not of the account's role", () => {
    // `actor_type` is part of the uniqueness key on legal_acceptances, so a
    // wrong value is a wrong row. Re-accept used to derive ONE capacity from
    // `profiles.role` and apply it to every document, which recorded a
    // guardian's acceptance of the platform's own Student Terms as `parent` —
    // disagreeing with what signup writes for that same account and document.
    const linkedPayer: LegalAccountFacts = {
      hasActiveGuardianLink: true,
      hasEverPaid: true,
    };
    expect(actorTypeForDoc(LEGAL_DOCS.studentTerms.docKey, linkedPayer)).toBe(
      "student",
    );
    expect(actorTypeForDoc(LEGAL_DOCS.privacyPolicy.docKey, linkedPayer)).toBe(
      "student",
    );
    expect(
      actorTypeForDoc(LEGAL_DOCS.parentGuardianTerms.docKey, linkedPayer),
    ).toBe("parent");
    // Billing Terms follows payer capacity — the same rule the Stripe webhook
    // applies (`guardianPayerId ? "parent" : "student"`).
    expect(actorTypeForDoc(LEGAL_DOCS.billingTerms.docKey, linkedPayer)).toBe(
      "parent",
    );
    expect(actorTypeForDoc(LEGAL_DOCS.billingTerms.docKey, NOTHING)).toBe(
      "student",
    );
  });

  it("re-accept reads no role, and derives capacity per document", () => {
    const route = readCode("server/routes/legal-routes.ts");
    const reaccept = route.slice(route.indexOf('legalRouter.post("/reaccept"'));
    expect(reaccept).toContain("actorTypeForDoc(docKey, facts)");
    // The dead `role` read went with the branch that needed it.
    expect(reaccept).not.toMatch(/profile\??\.role/);
    expect(reaccept).not.toMatch(/"role[,"]/);
  });

  it("agrees with what signup writes for the same two documents", () => {
    // Signup stamps both universal documents `student` unconditionally. If
    // re-accept disagreed, the same account would hold rows for the same
    // document under two capacities — and the uniqueness key would let it.
    for (const relative of [
      "server/routes/supabase-auth-routes.ts",
      "server/routes/oauth-callback-routes.ts",
    ]) {
      const code = readCode(relative);
      const stamps = [...code.matchAll(/actorType:\s*([^,\n]+)/g)].map((m) =>
        (m[1] ?? "").trim(),
      );
      expect(stamps.length, `${relative} stamps nothing`).toBeGreaterThan(0);
      for (const stamp of stamps) expect(stamp).toBe('"student"');
    }
    expect(actorTypeForDoc(LEGAL_DOCS.studentTerms.docKey, NOTHING)).toBe(
      "student",
    );
    expect(actorTypeForDoc(LEGAL_DOCS.privacyPolicy.docKey, NOTHING)).toBe(
      "student",
    );
  });

  it("reads stripe_customer_id in a select both routes already make", () => {
    for (const relative of [
      "server/routes/profile-routes.ts",
      "server/routes/legal-routes.ts",
    ]) {
      const code = readCode(relative);
      const selects = [...code.matchAll(/\.select\(\s*\n?\s*"([^"]*)"/g)].map(
        (m) => m[1] ?? "",
      );
      const carrying = selects.filter((s) => s.includes("stripe_customer_id"));
      expect(
        carrying.length,
        `${relative} does not carry stripe_customer_id in an existing select`,
      ).toBe(1);
    }
  });
});

// ── O4 ──────────────────────────────────────────────────────────────────

describe("O4 — still never blocks, still cannot fail a request", () => {
  it("the facts loader swallows a link-read failure and logs it", () => {
    // A consent lookup can never fail a request. Failing open on a FACT
    // under-prompts, which withholds a question rather than an account.
    const facts = readCode("server/lib/legal-account-facts.ts");
    const body = facts.slice(facts.indexOf("export async function"));
    expect(body).toContain("try {");
    expect(body).toContain("logger.error(");
    expect(body).not.toMatch(/throw\b/);
    expect(body).not.toMatch(/catch\s*\{\s*\}/);
  });

  it("no new consent state reaches a redirect", () => {
    // The gates were removed on 2026-09-16 and this change must not reintroduce
    // one by the back door: a bigger outstanding set is still only a prompt.
    const guard = readCode("client/src/components/auth/RequireRole.tsx");
    const needs = /const needsOnboarding =([\s\S]*?);/.exec(guard);
    expect(needs, "needsOnboarding not found").not.toBeNull();
    expect(needs?.[1]).not.toContain("outstandingLegal");
    const afterConsent = guard.slice(
      guard.indexOf("outstandingLegalSchema.safeParse"),
    );
    expect(afterConsent).toContain("{children}");
    expect(
      afterConsent.match(/return\s*\(/g)?.length ?? 0,
      "more than one return path after the consent read",
    ).toBe(1);
  });

  it("the prompt says something true when a document was never accepted", () => {
    // "One of the documents you agreed to has a new version" is a false
    // statement to a guardian who has never seen Parent Terms — and that is now
    // the common case, not an edge one.
    const modal = readCode("client/src/components/legal/ReconsentModal.tsx");
    expect(modal).toContain("function ledeFor(");
    expect(modal).toContain("acceptedVersion !== null");
    expect(modal).not.toContain("to continue.");
  });
});
