/**
 * @spec [owner ruling 2026-09-16 — "Consent never blocks. Remove the gate, keep
 *        the capture."; Coding Standards §14]
 * @implemented 2026-09-16
 *
 * plain English: the claims the no-gate ruling rests on, each written so the
 * obvious way to break it turns this file red. Every one proved by a plant.
 *
 *   N1  no route, gate or redirect withholds access for an outstanding document
 *   N2  every consent read on a request path is guarded — none can fail a request
 *   N3  signup and guardian link redemption fail OPEN
 *   N4  the under-13 screen is a screen, not a wall
 *
 * N1 IS A REPO-WIDE SWEEP, ON PURPOSE. The gate was removed from `RequireRole`
 * once already, and a second copy in `login.tsx` kept the behaviour alive for
 * exactly the people it was meant to free. A test naming one file would have
 * gone green while the product still blocked. So this walks every client source
 * file and asserts no consent state reaches a redirect or an early return.
 *
 * WHAT COUNTS AS "CONSENT STATE" HERE: the outstanding-document set and the
 * removed `requiredConsentsComplete` flag. `guardianConsentRequired` does NOT
 * count — it is the under-13 condition from the Terms, not a consent gate, and
 * N4 covers the screen it routes to.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { requiredLegalDocsForUse } from "../../shared/legal-consent";

const REPO_ROOT = path.resolve(__dirname, "../..");

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

/** Every client source file, so a new gate cannot hide in a file nobody named. */
function clientSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      out.push(path.relative(REPO_ROOT, full));
    }
  };
  walk(path.join(REPO_ROOT, "client/src"));
  return out.sort();
}

// ── N1 ──────────────────────────────────────────────────────────────────

describe("N1 — nothing withholds access for an outstanding document", () => {
  it("has no `requiredConsentsComplete` left in any source file", () => {
    // The flag existed only to gate. Its last consumer is gone, so the flag is
    // gone: the server no longer emits it and no client reads it.
    const offenders: string[] = [];
    for (const rel of [...clientSources(), "server/routes/profile-routes.ts"]) {
      if (readCode(rel).includes("requiredConsentsComplete"))
        offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("lets no outstanding-document state reach a redirect, anywhere in client/", () => {
    // The sweep that a single-file test would have missed. `login.tsx` carried a
    // second copy of the gate and outlived the first removal.
    const offenders: string[] = [];
    for (const rel of clientSources()) {
      const code = readCode(rel);
      if (!/outstandingLegal|requiredConsentsComplete/.test(code)) continue;

      // Any line that mentions consent state AND routing is a gate.
      for (const line of code.split("\n")) {
        const mentionsConsent =
          /outstandingLegal|requiredConsentsComplete/.test(line);
        const routes = /Redirect|navigate\(|destination\s*=|setLocation\(/.test(
          line,
        );
        if (mentionsConsent && routes) offenders.push(`${rel}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("renders `children` unconditionally in RequireRole", () => {
    const guard = readCode("client/src/components/auth/RequireRole.tsx");

    // The blocking branch returned the modal INSTEAD of children. Gone.
    expect(guard).not.toContain("if (!isGuardian) {");
    expect(guard).not.toMatch(/return <ReconsentModal/);

    // Exactly one JSX return survives after the consent read, and it carries
    // children, with the prompt as a SIBLING rather than a replacement.
    //
    // Anchored on the CALL, not the identifier: `outstandingLegalSchema` also
    // appears in the import at the top of the file, so anchoring on the bare
    // name sliced from line 8 and swept in the loading spinner's return.
    const afterConsent = guard.slice(
      guard.indexOf("outstandingLegalSchema.safeParse"),
    );
    expect(afterConsent).toContain("{children}");
    expect(afterConsent).toMatch(/\{children\}[\s\S]*ReconsentModal/);
    expect(
      afterConsent.match(/return\s*\(/g)?.length ?? 0,
      "more than one return path after the consent read",
    ).toBe(1);
  });

  it("asks the same two documents of every role", () => {
    // REWRITTEN, NOT DELETED. This asserted `requiredLegalDocsForUse.length === 0`
    // — that the function took no arguments at all — which was the 2026-09-16
    // form of "no role logic". The set is fact-derived now (owner ruling, same
    // day, later): a linked guardian owes Parent Terms because of the LINK.
    //
    // The claim this test defends is unchanged and still worth defending: no
    // ROLE may decide the set. So it asserts the thing that actually matters —
    // identical facts produce an identical set whatever the account calls
    // itself, and the parameter type cannot carry a role.
    const facts = { hasActiveGuardianLink: false, hasEverPaid: false } as const;
    expect(requiredLegalDocsForUse(facts).map((d) => d.slug)).toEqual([
      "student-terms",
      "privacy-policy",
    ]);
    const shared = readCode("shared/legal-consent.ts");
    const type = shared.slice(
      shared.indexOf("export type LegalAccountFacts"),
      shared.indexOf("export function requiredLegalDocsForUse"),
    );
    expect(type).not.toMatch(/\brole\b/);
  });

  it("keeps no `dismissible` flag — the prompt is always dismissible", () => {
    const modal = readCode("client/src/components/legal/ReconsentModal.tsx");
    expect(modal).not.toMatch(/dismissible\??:\s*boolean/);
    expect(modal).not.toContain("if (!dismissible");
    expect(modal).not.toContain("reconsent-sign-out");
  });
});

// ── N2 ──────────────────────────────────────────────────────────────────

describe("N2 — no consent read can fail a request", () => {
  /** Every server file that resolves legal metadata on a request path. */
  const READERS = [
    "server/routes/profile-routes.ts",
    "server/routes/legal-routes.ts",
    "server/routes/oauth-callback-routes.ts",
    "server/routes/supabase-auth-routes.ts",
    "server/routes/guardian-routes.ts",
    "server/lib/stripe/webhook-handler.ts",
  ] as const;

  it.each(READERS)("%s guards every resolveLegalVersion call", (relative) => {
    const code = readCode(relative);
    const sites = [...code.matchAll(/resolveLegalVersion\(/g)];
    expect(sites.length, `${relative} resolves nothing`).toBeGreaterThan(0);

    for (const site of sites) {
      // Walk back to the nearest enclosing `try {`, and forward to its `catch`.
      // A call with no `try` above it inside the same function is unguarded —
      // exactly the shape that 500'd /api/profile on every request.
      const before = code.slice(0, site.index);
      const lastTry = before.lastIndexOf("try {");
      const lastCatch = before.lastIndexOf("} catch");
      expect(
        lastTry,
        `${relative}: a resolveLegalVersion call sits outside any try`,
      ).toBeGreaterThan(-1);
      expect(
        lastTry,
        `${relative}: a resolveLegalVersion call sits after its try closed`,
      ).toBeGreaterThan(lastCatch);
    }
  });

  it("the profile route omits an unresolvable document instead of throwing", () => {
    const fn = readCode("server/routes/profile-routes.ts");
    const helper = fn.slice(
      fn.indexOf("function outstandingLegalDocs"),
      fn.indexOf("const profileCompletionSchema"),
    );
    expect(helper).toContain("continue;");
    expect(helper).toContain("legal_resolution_failed");
    expect(helper).toContain("logger.error(");
  });

  it("re-accept resolves once and skips what it cannot resolve", () => {
    const route = readCode("server/routes/legal-routes.ts");
    const reaccept = route.slice(route.indexOf('legalRouter.post("/reaccept"'));
    // A second bare call lived in the acceptances map — one more throw site on
    // the same request, surviving only because the registry caches.
    expect(
      (reaccept.match(/resolveLegalVersion\(/g) ?? []).length,
      "more than one resolve site in reaccept",
    ).toBe(1);
    expect(reaccept).toContain("legal_resolution_failed");
  });
});

// ── N3 ──────────────────────────────────────────────────────────────────

describe("N3 — the write paths fail open", () => {
  it("signup keeps the account when consent cannot be captured", () => {
    const code = readCode("server/routes/supabase-auth-routes.ts");
    const branch = code.slice(code.indexOf("if (!capture.durable)"));
    const body = branch.slice(0, branch.indexOf("\n      }") + 8);

    // WAS: signOut + 503 under AS1-OUTBOX-DROP-001. An outbox outage cost the
    // account. Now it logs and carries on.
    expect(body).toContain("logger.error(");
    expect(body, "signup still tears down the session").not.toContain(
      "signOut",
    );
    expect(body, "signup still returns an error status").not.toMatch(
      /res\.status\(5\d\d\)/,
    );
  });

  it("guardian link redemption creates the link even when consent fails", () => {
    const code = readCode("server/routes/guardian-routes.ts");
    expect(code, "the refusal code survives").not.toContain(
      "CONSENT_NOT_RECORDED",
    );

    const consentAt = code.indexOf("recordLegalAcceptances(");
    const linkAt = code.indexOf("createActiveGuardianLink(");
    expect(consentAt).toBeGreaterThan(-1);
    expect(linkAt).toBeGreaterThan(consentAt);
    // Nothing between the consent attempt and the link may return a response.
    expect(code.slice(consentAt, linkAt)).not.toMatch(/return res\.status\(/);
  });

  it("neither path writes a row it cannot stamp with a real version and hash", () => {
    // Failing open must not become "record a guess". A false record is worse
    // than a missing one we know how to collect.
    for (const rel of [
      "server/routes/supabase-auth-routes.ts",
      "server/routes/guardian-routes.ts",
      "server/routes/oauth-callback-routes.ts",
    ]) {
      const code = readCode(rel);
      expect(code, `${rel} hardcodes a version`).not.toMatch(
        /docVersion:\s*["'`]/,
      );
      expect(code, `${rel} hardcodes a hash`).not.toMatch(
        /contentHash:\s*["'`]/,
      );
      expect(code, `${rel} carries a sha256 literal`).not.toMatch(
        /sha256:[0-9a-f]{64}/,
      );
    }
  });
});

// ── N4 ──────────────────────────────────────────────────────────────────

describe("N4 — the under-13 screen hands over the means", () => {
  const screen = readCode(
    "client/src/components/auth/GuardianConnectRequired.tsx",
  );

  it("shows the code, a copy control and a guardian email field", () => {
    // A wall states a rule and stops. A screen hands over every means of
    // satisfying it.
    // EXACT ATTRIBUTES, not substrings. An earlier draft asserted
    // `toContain("student-link-code")`, which is ALSO satisfied by
    // `student-link-code-missing` — so renaming the code element away left the
    // test green, and the plant caught it. A marker that a neighbouring marker
    // can satisfy is not an assertion.
    for (const marker of [
      "student-link-code",
      "copy-link-code",
      "input-guardian-email",
      "send-guardian-invite",
    ]) {
      expect(screen, `the screen has no ${marker}`).toContain(
        `data-testid="${marker}"`,
      );
    }
  });

  it("says where to find both again, for whoever closes the tab", () => {
    const text = read("client/src/components/auth/GuardianConnectRequired.tsx");
    expect(text).toMatch(/Settings\s*→\s*Guardian/);
  });

  it("links the Terms rather than restating the rule", () => {
    expect(screen).toContain("/legal/student-terms");
  });

  it("degrades usefully when there is no code yet", () => {
    expect(screen).toContain('data-testid="student-link-code-missing"');
  });

  it("is reached by the under-13 condition, never by a consent state", () => {
    const guard = readCode("client/src/components/auth/RequireRole.tsx");
    const needs = /const needsOnboarding =([\s\S]*?);/.exec(guard);
    expect(needs, "needsOnboarding not found").not.toBeNull();
    expect(needs?.[1]).toContain("guardianConsentRequired");
    // No legal document may ever appear in this list again.
    expect(needs?.[1]).not.toContain("outstandingLegal");
    expect(needs?.[1]).not.toContain("requiredConsentsComplete");
  });
});
