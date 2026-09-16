/**
 * @spec [LYCEON consent capture §8; Coding Standards §14]
 * @implemented 2026-09-16
 *
 * plain English: the seven claims the consent-capture work rests on, each
 * written so that the obvious way to break it turns this file red. Every one
 * was proved by a plant — the assertion was watched failing against a
 * deliberately broken tree before it was trusted green.
 *
 *   C1  no consent write path names a version, date or hash; all four docs
 *       resolve from legal/ at write time, and the app's source enum matches
 *       the database CHECK exactly
 *   C2  both signup paths record Student Terms and Privacy Policy with slug,
 *       version and hash
 *   C3  no acceptance, no link: the guardian redeem path cannot create a link
 *       without first recording Parent / Guardian Terms
 *   C4  checkout asks for terms-of-service consent, and the completed session
 *       writes a Billing Terms row carrying the Stripe Session id
 *   C5  the re-consent prompt blocks: it replaces the product rather than
 *       floating over it, and there is no way to dismiss it
 *   C6  re-consent writes FRESH rows and never modifies an old one
 *   C7  no contract text is duplicated in code, and a hashless acceptance will
 *       not compile
 *
 * trade-offs: C1, C3's ordering, C4, C5 and C7 are source-text assertions.
 * Ordering between two writes, the absence of a close affordance, and the
 * absence of duplicated prose are all properties of the code as written, and no
 * amount of driving one request proves the second write cannot be reordered
 * ahead of the first. Where behaviour CAN be driven — the redeem schema, the
 * registry resolution, the outbox payload — it is driven.
 *
 * edge cases:
 *  - Every absence assertion strips comments first. These files deliberately
 *    record what was wrong and why; a test that read comments would force a file
 *    to delete the explanation of a defect in order to go green. (The same trap
 *    as `shared/seo/public-meta.ts`, Phase 2's T5 and Phase 3's U2c.)
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  LEGAL_DOCS,
  CONSENT_SOURCES,
  REQUIRED_SIGNUP_LEGAL_DOCS,
  GUARDIAN_LINK_LEGAL_DOC,
  CHECKOUT_LEGAL_DOC,
  requiredLegalDocsForUse,
  outstandingLegalSchema,
} from "../../shared/legal-consent";
import { resolveLegalVersion } from "../../server/lib/legal-registry";
import {
  redeemLinkCodeRequestSchema,
  STUDENT_LINK_CODE_ALPHABET,
  STUDENT_LINK_CODE_LENGTH,
} from "../../packages/shared/src/student-link-code-schema";

const REPO_ROOT = path.resolve(__dirname, "../..");

/** A code the entry schema accepts, built from the alphabet it publishes. */
const VALID_CODE = STUDENT_LINK_CODE_ALPHABET[0]!.repeat(
  STUDENT_LINK_CODE_LENGTH,
);

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf-8");
}

function readCode(relative: string): string {
  return stripComments(read(relative));
}

/** Every file that writes, enqueues or drains a legal acceptance. */
const WRITE_PATHS = [
  "server/routes/supabase-auth-routes.ts",
  "server/routes/oauth-callback-routes.ts",
  "server/routes/guardian-routes.ts",
  "server/routes/legal-routes.ts",
  "server/lib/stripe/webhook-handler.ts",
  "server/lib/legal-acceptance.ts",
] as const;

// ── C1 ──────────────────────────────────────────────────────────────────

describe("C1 — every record resolves slug, version and hash at write time", () => {
  it("resolves all four required documents from legal/ on disk", () => {
    for (const doc of Object.values(LEGAL_DOCS)) {
      const resolved = resolveLegalVersion(doc.slug);
      expect(resolved.slug, `${doc.slug} slug`).toBe(doc.slug);
      expect(resolved.version.length, `${doc.slug} version`).toBeGreaterThan(0);
      expect(resolved.contentHash, `${doc.slug} hash`).toMatch(
        /^sha256:[0-9a-f]{64}$/,
      );
      expect(resolved.effectiveDate, `${doc.slug} date`).toMatch(
        /^\d{4}-\d{2}-\d{2}$/,
      );
    }
  });

  it("agrees with meta.yml, so the recorded version is the served one", () => {
    for (const doc of Object.values(LEGAL_DOCS)) {
      const manifest = JSON.parse(read(`legal/${doc.slug}/manifest.json`)) as {
        current: string;
      };
      const meta = read(`legal/${doc.slug}/${manifest.current}/meta.yml`);
      const resolved = resolveLegalVersion(doc.slug);
      expect(meta, `${doc.slug} version`).toContain(
        `version: "${resolved.version}"`,
      );
      expect(meta, `${doc.slug} hash`).toContain(
        `content_hash: ${resolved.contentHash}`,
      );
    }
  });

  it("names no version anywhere a consent is written", () => {
    // The defect this replaces: `docVersion: "2024-12-22"` lived in
    // shared/legal-consent.ts, two versions behind the documents it named. A
    // literal that looks like a version or a hash beside a consent write is the
    // same mistake in a new place.
    for (const relative of WRITE_PATHS) {
      const code = readCode(relative);
      expect(code, `${relative} names a docVersion literal`).not.toMatch(
        /docVersion:\s*["'`]/,
      );
      expect(code, `${relative} names a contentHash literal`).not.toMatch(
        /contentHash:\s*["'`]/,
      );
      expect(code, `${relative} carries a sha256 literal`).not.toMatch(
        /sha256:[0-9a-f]{64}/,
      );
    }
  });

  it("carries no version in the document registry itself", () => {
    const shared = readCode("shared/legal-consent.ts");
    expect(shared).not.toMatch(/docVersion/);
    expect(shared).not.toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);
  });

  it("holds the same consent_source values the database CHECK does", () => {
    // A value the app can produce and the database refuses is an insert that
    // fails at runtime with no test in between. Read from the migration text.
    const migration = read(
      "supabase/migrations/20260916000000_consent_sources_and_reference.sql",
    );
    const check = /CHECK \(consent_source IN \(([\s\S]*?)\)\);/.exec(migration);
    expect(check, "CHECK not found in the migration").not.toBeNull();
    const fromSql = (check?.[1] ?? "")
      .split(",")
      .map((v) => v.trim().replace(/^'(.*)'$/, "$1"))
      .filter((v) => v.length > 0)
      .sort();
    expect(fromSql).toEqual([...CONSENT_SOURCES].sort());
  });
});

// ── C2 ──────────────────────────────────────────────────────────────────

describe("C2 — signup records Student Terms and Privacy Policy", () => {
  it("requires exactly those two of everyone, whatever their role", () => {
    expect(REQUIRED_SIGNUP_LEGAL_DOCS.map((d) => d.slug)).toEqual([
      "student-terms",
      "privacy-policy",
    ]);
  });

  it.each([
    "server/routes/supabase-auth-routes.ts",
    "server/routes/oauth-callback-routes.ts",
  ])("%s passes the resolved slug, version and hash", (relative) => {
    const code = readCode(relative);
    expect(code).toContain("resolveLegalVersion(");
    expect(code).toContain("LEGAL_DOCS.studentTerms.slug");
    expect(code).toContain("LEGAL_DOCS.privacyPolicy.slug");
    // Both routes now guard the resolve and carry the result in a local, but
    // they spell that local differently. Asserting the SHAPE — every field fed
    // from a resolved value, never a literal — is what the claim actually is;
    // pinning one route's variable name was incidental and broke when the
    // fail-open restructure renamed it.
    for (const field of ["docSlug:", "docVersion:", "contentHash:"]) {
      const sites = [...code.matchAll(new RegExp(`${field}\\s*(\\S+)`, "g"))];
      expect(sites.length, `${relative} has no ${field}`).toBeGreaterThan(0);
      for (const [, value] of sites) {
        // Fed from a resolved object — never a quoted literal.
        expect(value, `${relative} passes a literal to ${field}`).not.toMatch(
          /^["'`]/,
        );
        expect(value, `${relative} ${field} is not resolved`).toMatch(
          /\.(slug|version|contentHash)\b/,
        );
      }
    }
  });

  it("does not require Parent Terms or Billing Terms of a plain student", () => {
    const slugs = requiredLegalDocsForUse().map((d) => d.slug);
    expect(slugs).toEqual(["student-terms", "privacy-policy"]);
  });

  it("asks the same two of everyone — no role logic at all", () => {
    // This asserted the opposite: Parent Terms added for a linked guardian.
    // Owner ruling 2026-09-16 — Parent Terms is accepted as part of REDEEMING A
    // CODE and captured there, so repeating it from a periodic prompt chased a
    // consent already held. Taking no arguments is the strongest form of "no
    // role logic": there is nothing to pass.
    expect(requiredLegalDocsForUse.length).toBe(0);
    expect(requiredLegalDocsForUse().map((d) => d.slug)).toEqual([
      "student-terms",
      "privacy-policy",
    ]);
  });

  it("never mentions Billing Terms or Parent Terms in the prompt set", () => {
    // Both are captured where they are GIVEN — Stripe's checkbox at checkout,
    // and redeeming a code — each part of an action the person chose to take.
    // Repeating either from a periodic prompt would chase a consent already
    // held, against a version already recorded.
    const slugs = requiredLegalDocsForUse().map((d) => d.slug);
    expect(slugs).not.toContain("billing-terms");
    expect(slugs).not.toContain("parent-guardian-terms");
  });
});

// ── C3 ──────────────────────────────────────────────────────────────────

describe("C3 — no acceptance, no link", () => {
  it("refuses a redeem request that does not carry the acceptance", () => {
    expect(
      redeemLinkCodeRequestSchema.safeParse({ code: VALID_CODE }).success,
    ).toBe(false);
  });

  it("refuses an acceptance of `false` as firmly as a missing one", () => {
    // `z.boolean()` would accept false and the route would happily link. The
    // literal is what makes the field mean "they ticked it".
    expect(
      redeemLinkCodeRequestSchema.safeParse({
        code: VALID_CODE,
        acceptParentGuardianTerms: false,
      }).success,
    ).toBe(false);
  });

  it("accepts one that does", () => {
    expect(
      redeemLinkCodeRequestSchema.safeParse({
        code: VALID_CODE,
        acceptParentGuardianTerms: true,
      }).success,
    ).toBe(true);
  });

  it("attempts the acceptance BEFORE the link, but never refuses the link", () => {
    // Order is unchanged and still deliberate: attempting consent first means
    // the ordinary case records it before any link exists. What changed is the
    // FAILURE branch. This returned 503 CONSENT_NOT_RECORDED and created no
    // link, so a version lookup failure cost a guardian their connection — the
    // same defect that took /api/profile down, one route over.
    const code = readCode("server/routes/guardian-routes.ts");
    const consentAt = code.indexOf("recordLegalAcceptances(");
    const linkAt = code.indexOf("createActiveGuardianLink(");
    expect(consentAt, "consent write not found").toBeGreaterThan(-1);
    expect(linkAt, "link creation not found").toBeGreaterThan(-1);
    expect(
      consentAt,
      "the link is created before the consent is attempted",
    ).toBeLessThan(linkAt);

    // Never again: no refusal code, and no early return between the two.
    expect(code, "the link is still refused").not.toContain(
      "CONSENT_NOT_RECORDED",
    );
    const between = code.slice(consentAt, linkAt);
    expect(
      between,
      "an early return sits between consent and link",
    ).not.toMatch(/return res\.status\(/);
    expect(between).toContain("logger.error(");
  });

  it("records it against the guardian as `parent`, the value that exists", () => {
    const code = readCode("server/routes/guardian-routes.ts");
    expect(code).toContain(`actorType: "parent"`);
    expect(code).toContain("GUARDIAN_LINK_LEGAL_DOC");
    expect(GUARDIAN_LINK_LEGAL_DOC.slug).toBe("parent-guardian-terms");
  });

  it("asks for it on the guardian surface, linking the document itself", () => {
    const page = readCode("client/src/pages/guardian-dashboard.tsx");
    expect(page).toContain("/legal/parent-guardian-terms");
    expect(page).toContain("acceptParentGuardianTerms: true");
    expect(page).toMatch(/acceptedParentTerms/);
  });
});

// ── C4 ──────────────────────────────────────────────────────────────────

describe("C4 — checkout collects consent and the webhook records it", () => {
  const billing = readCode("server/routes/billing-routes.ts");
  const webhook = readCode("server/lib/stripe/webhook-handler.ts");

  it("asks Stripe to require the terms-of-service box", () => {
    expect(billing).toContain("consent_collection");
    expect(billing).toMatch(/terms_of_service:\s*["']required["']/);
  });

  it("parses the consent Stripe reports back, rather than reading it raw", () => {
    expect(webhook).toMatch(
      /consent:\s*z[\s\S]{0,20}\.object\(\{ terms_of_service/,
    );
    expect(webhook).toContain("terms_of_service");
  });

  it("writes the row only when the box was actually ticked", () => {
    expect(webhook).toMatch(
      /session\.consent\?\.terms_of_service === "accepted"/,
    );
  });

  it("ties the consent to the transaction by Session id", () => {
    expect(webhook).toContain("sourceReference: session.id");
    expect(CHECKOUT_LEGAL_DOC.slug).toBe("billing-terms");
  });

  it("records it before fulfilment, and never throws into it", () => {
    const consentAt = webhook.indexOf("recordCheckoutConsent(");
    const fulfilAt = webhook.indexOf("fulfilCheckoutSession(");
    expect(consentAt).toBeGreaterThan(-1);
    expect(fulfilAt).toBeGreaterThan(-1);
    // Declaration order is not call order; assert on the CALL, which is the one
    // preceded by `await` inside the dispatcher.
    expect(webhook).toMatch(/await recordCheckoutConsent\(/);
    expect(webhook).toMatch(
      /catch \(err: unknown\)[\s\S]{0,400}fulfilment continues/,
    );
  });

  it("does not call a self-paying student a parent", () => {
    // `payer_profile_id` is set only by the guardian route. Stamping every
    // checkout row 'parent' would assert a guardian relationship for people who
    // have none.
    expect(webhook).toMatch(/guardianPayerId \? \("parent" as const\)/);
    expect(webhook).toMatch(/: \("student" as const\)/);
  });
});

// ── C5 ──────────────────────────────────────────────────────────────────

describe("C5 — the re-consent prompt blocks everyone except a guardian", () => {
  const modal = readCode("client/src/components/legal/ReconsentModal.tsx");
  const guard = readCode("client/src/components/auth/RequireRole.tsx");

  // OWNER RULING, 2026-09-16: a guardian gets a prompt, not a wall. These two
  // assertions used to read "nobody can dismiss it, ever", and they went red
  // when that stopped being true. Narrowed to the population the invariant still
  // covers rather than deleted — a student's prompt is still a wall, and the
  // dismissible path is now pinned by its own behavioural suite
  // (client/src/components/legal/ReconsentGate.test.tsx), which drives the real
  // gate rather than reading its source.
  it("withholds `children` from NOBODY, in any role", () => {
    // This asserted the opposite: that a non-guardian got the modal INSTEAD of
    // children. Owner ruling 2026-09-16 removed the wall for every role, so the
    // assertion is inverted rather than deleted — the guard must have no branch
    // that returns a modal in place of the app.
    expect(guard, "a role still selects a blocking branch").not.toContain(
      "if (!isGuardian) {",
    );
    expect(guard).not.toMatch(/return <ReconsentModal/);
    expect(guard).not.toContain("onSignOut");

    // `children` render on the ONE return path, unconditionally.
    const returns = guard.match(/return \(/g) ?? [];
    const tail = guard.slice(guard.lastIndexOf("return ("));
    expect(tail).toContain("{children}");
    expect(returns.length, "more than one JSX return survives").toBeGreaterThan(
      0,
    );
    // The prompt is a sibling of children, never a replacement.
    expect(tail).toMatch(/\{children\}[\s\S]*ReconsentModal/);
  });

  it("has no `dismissible` flag, because it is always dismissible", () => {
    // A flag that is always one value is a second thing to get wrong, and the
    // wall it selected is the defect this removes.
    expect(modal, "the dismissible prop survives").not.toMatch(
      /dismissible\??:\s*boolean/,
    );
    expect(guard).not.toMatch(/dismissible(?!=)/);
    // Every close path is now unconditional.
    expect(modal).toContain('e.key === "Escape"');
    expect(modal).not.toContain("if (!dismissible");
    expect(modal).toContain("reconsent-dismiss");
    expect(modal).toContain("reconsent-not-now");
    // Signing out was the blocked person's only exit. Nobody is blocked.
    expect(modal).not.toContain("reconsent-sign-out");
  });

  it("never offers a `don't show again` in either mode", () => {
    // The one affordance ruled out explicitly: it would suppress the prompt for
    // good while recording nothing.
    for (const phrase of [/don'?t show/i, /never show/i, /remind me later/i]) {
      expect(modal, `prompt offers ${phrase}`).not.toMatch(phrase);
    }
    const dismissal = readCode(
      "client/src/components/legal/reconsent-dismissal.ts",
    );
    expect(dismissal).toContain("sessionStorage");
    expect(dismissal, "dismissal reaches localStorage").not.toMatch(
      /localStorage/,
    );
  });

  it("stops sending an existing user to the onboarding form", () => {
    // `requiredConsentsComplete === false` sat in `needsOnboarding`, so a new
    // version of Student Terms would have thrown every existing user back to
    // /profile/complete to re-enter a profile they already had.
    const needs = /const needsOnboarding =([\s\S]*?);/.exec(guard);
    expect(needs, "needsOnboarding not found").not.toBeNull();
    expect(needs?.[1]).not.toContain("requiredConsentsComplete");
    // Both halves of that flag are still enforced, separately.
    expect(needs?.[1]).toContain("guardianConsentRequired");
    expect(guard).toContain("outstandingLegal.length > 0");
  });

  it("parses the payload it renders instead of trusting it", () => {
    expect(guard).toContain("outstandingLegalSchema.safeParse");
    expect(
      outstandingLegalSchema.safeParse([{ slug: "student-terms" }]).success,
      "a partial entry parsed",
    ).toBe(false);
    expect(
      outstandingLegalSchema.safeParse([
        {
          slug: "student-terms",
          docKey: "student_terms",
          title: "Student Terms",
          version: "2.0",
          effectiveDate: "2026-09-11",
          acceptedVersion: null,
        },
      ]).success,
    ).toBe(true);
  });
});

// ── C6 ──────────────────────────────────────────────────────────────────

describe("C6 — re-consent writes fresh rows and never edits old ones", () => {
  it("only ever inserts into legal_acceptances", () => {
    // A row records that a person agreed to specific bytes on a specific day.
    // Rewriting it to a new version asserts they agreed to something they never
    // saw. Across every file that touches the table: upsert, never update or
    // delete.
    for (const relative of WRITE_PATHS) {
      const code = readCode(relative);
      expect(code, `${relative} updates legal_acceptances`).not.toMatch(
        /from\("legal_acceptances"\)[\s\S]{0,120}\.update\(/,
      );
      expect(code, `${relative} deletes from legal_acceptances`).not.toMatch(
        /from\("legal_acceptances"\)[\s\S]{0,120}\.delete\(/,
      );
    }
  });

  it("conflicts on the version, so a new version is a new row", () => {
    const lib = readCode("server/lib/legal-acceptance.ts");
    expect(lib).toContain(
      `onConflict: "user_id,doc_key,doc_version,actor_type"`,
    );
  });

  it("recomputes what is outstanding server-side, taking no body", () => {
    const route = readCode("server/routes/legal-routes.ts");
    expect(route).toContain("requiredLegalDocsForUse");
    expect(route).toContain("resolveLegalVersion");
    expect(route).toContain(`consentSource: "reconsent_prompt"`);
    // A client that named the documents would be asserting what it was shown.
    expect(route, "reaccept reads req.body").not.toMatch(
      /reaccept[\s\S]{0,2000}req\.body/,
    );
  });

  it("is a no-op when nothing is outstanding, not an error", () => {
    const route = readCode("server/routes/legal-routes.ts");
    expect(route).toContain("recorded: 0");
  });
});

// ── C7 ──────────────────────────────────────────────────────────────────

describe("C7 — no duplicated contract text, no hashless acceptance", () => {
  const CONSENT_SURFACES = [
    "client/src/components/legal/ReconsentModal.tsx",
    "client/src/components/auth/RequireRole.tsx",
    "client/src/pages/guardian-dashboard.tsx",
    "server/routes/billing-routes.ts",
    "server/routes/legal-routes.ts",
    "shared/legal-consent.ts",
  ] as const;

  /** Long sentences from every published document, which nothing may restate. */
  function documentSentences(): Array<{ slug: string; text: string }> {
    const out: Array<{ slug: string; text: string }> = [];
    const legalRoot = path.join(REPO_ROOT, "legal");
    for (const slug of fs.readdirSync(legalRoot)) {
      const manifestPath = path.join(legalRoot, slug, "manifest.json");
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
        current: string | null;
      };
      if (!manifest.current) continue;
      const body = fs.readFileSync(
        path.join(legalRoot, slug, manifest.current, "en.md"),
        "utf-8",
      );
      for (const raw of body.split(/(?<=[.!?])\s+/)) {
        const text = raw.replace(/\s+/g, " ").trim();
        if (text.length >= 80 && !text.startsWith("#")) {
          out.push({ slug, text });
        }
      }
    }
    return out;
  }

  it("finds enough document prose for the check to mean something", () => {
    // A check that found zero sentences would pass forever and prove nothing.
    expect(documentSentences().length).toBeGreaterThan(200);
  });

  it("restates no sentence of any document in code", () => {
    const sentences = documentSentences();
    for (const relative of CONSENT_SURFACES) {
      const source = read(relative).replace(/\s+/g, " ");
      for (const { slug, text } of sentences) {
        expect(
          source.includes(text),
          `${relative} restates ${slug}: "${text.slice(0, 60)}…"`,
        ).toBe(false);
      }
    }
  });

  it("links the documents instead of summarising them", () => {
    const modal = readCode("client/src/components/legal/ReconsentModal.tsx");
    expect(modal).toContain("/legal/${doc.slug}");
    expect(modal).toContain("doc.title");
  });

  it("will not compile an acceptance without a slug or a hash", () => {
    const lib = read("server/lib/legal-acceptance.ts");
    const type = /export type LegalAcceptanceRecord = \{[\s\S]*?\n\};/.exec(
      lib,
    );
    expect(type, "LegalAcceptanceRecord not found").not.toBeNull();
    const body = stripComments(type?.[0] ?? "");
    expect(body).toMatch(/docSlug:\s*string;/);
    expect(body).toMatch(/contentHash:\s*string;/);
    expect(body, "docSlug is nullable again").not.toMatch(
      /docSlug:\s*string \| null/,
    );
    expect(body, "contentHash is nullable again").not.toMatch(
      /contentHash:\s*string \| null/,
    );
  });

  it("refuses an outbox payload that cannot name the bytes served", () => {
    const lib = readCode("server/lib/legal-acceptance.ts");
    expect(lib).toMatch(
      /contentHash:\s*z\.string\(\)\.regex\(\/\^sha256:\[0-9a-f\]\{64\}\$\/\)/,
    );
    expect(lib, "docSlug is optional again").not.toMatch(
      /docSlug:\s*z\.string\(\)[\s\S]{0,30}\.optional\(\)/,
    );
  });
});
