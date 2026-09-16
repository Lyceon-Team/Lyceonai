/**
 * @spec [LYCEON consent capture §2; incident 2026-09-16 — /api/profile 500;
 *        Coding Standards §14]
 * @implemented 2026-09-16
 *
 * plain English: the four claims the availability fix rests on, each written so
 * the obvious way to break it turns this file red. Every one proved by a plant.
 *
 *   A1  the server resolves every published slug with NO filesystem available
 *   A2  the generated module's versions and hashes are meta.yml's own
 *   A3  a resolution failure yields an EMPTY outstanding set, not a throw
 *   A4  sign-in's consent capture cannot take the sign-in down with it
 *
 * WHY A1 SIMULATES AN ABSENT TREE RATHER THAN TRUSTING THE BUNDLE. The defect
 * was invisible in dev precisely because `legal/` is on disk there. Pointing
 * `process.cwd()` at an empty directory reproduces `/var/task` exactly: the tree
 * cannot be found, and the only way to answer is the bundled table. A test that
 * ran with the repository present would pass against the broken code.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  resolveLegalVersion,
  __resetLegalRegistryForTests,
} from "../../server/lib/legal-registry";
import { GENERATED_LEGAL_REGISTRY } from "../../server/lib/legal-registry.generated";

const REPO_ROOT = path.resolve(__dirname, "../..");
const LEGAL = path.join(REPO_ROOT, "legal");

function publishedSlugs(): string[] {
  return fs
    .readdirSync(LEGAL)
    .filter((slug) => fs.existsSync(path.join(LEGAL, slug, "manifest.json")))
    .filter((slug) => {
      const m = JSON.parse(
        fs.readFileSync(path.join(LEGAL, slug, "manifest.json"), "utf-8"),
      ) as { current: string | null };
      if (m.current === null) return false;
      const meta = fs.readFileSync(
        path.join(LEGAL, slug, m.current, "meta.yml"),
        "utf-8",
      );
      return meta.includes("published: true");
    })
    .sort();
}

function metaOf(slug: string): Record<string, string> {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(LEGAL, slug, "manifest.json"), "utf-8"),
  ) as { current: string };
  const out: Record<string, string> = {};
  for (const line of fs
    .readFileSync(path.join(LEGAL, slug, manifest.current, "meta.yml"), "utf-8")
    .split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (m) out[m[1]!] = m[2]!.trim().replace(/^"(.*)"$/, "$1");
  }
  return out;
}

// ── A1 ──────────────────────────────────────────────────────────────────

describe("A1 — the server resolves every slug with no filesystem tree", () => {
  let empty = "";

  beforeEach(() => {
    // An empty directory IS `/var/task`: no `legal/`, no `dist/public/legal`.
    empty = fs.mkdtempSync(path.join(os.tmpdir(), "no-legal-"));
    vi.spyOn(process, "cwd").mockReturnValue(empty);
    __resetLegalRegistryForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetLegalRegistryForTests();
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it("finds no tree at all, reproducing the production condition", () => {
    expect(fs.existsSync(path.join(empty, "legal"))).toBe(false);
    expect(fs.existsSync(path.join(empty, "dist", "public", "legal"))).toBe(
      false,
    );
  });

  it.each(publishedSlugs())("resolves %s from the bundled table", (slug) => {
    // Before the fix this threw:
    //   legal/ not found. Looked in: legal, dist/public/legal relative to /var/task
    const resolved = resolveLegalVersion(slug);
    expect(resolved.slug).toBe(slug);
    expect(resolved.version.length).toBeGreaterThan(0);
    expect(resolved.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(resolved.title.length).toBeGreaterThan(0);
    expect(resolved.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("still refuses a slug that does not exist, rather than inventing one", () => {
    expect(() => resolveLegalVersion("no-such-document")).toThrow();
  });
});

// ── A2 ──────────────────────────────────────────────────────────────────

describe("A2 — the generated module carries meta.yml's own values", () => {
  it("covers exactly the published slugs, no more and no fewer", () => {
    expect(Object.keys(GENERATED_LEGAL_REGISTRY).sort()).toEqual(
      publishedSlugs(),
    );
  });

  it.each(publishedSlugs())("%s matches meta.yml exactly", (slug) => {
    // A generated file is only as good as its derivation. If these ever
    // disagree, the module has become a second editable copy of version and
    // hash data — the fork the whole structure exists to prevent.
    const meta = metaOf(slug);
    const entry = GENERATED_LEGAL_REGISTRY[slug]!;
    expect(entry.version).toBe(meta.version);
    expect(entry.contentHash).toBe(meta.content_hash);
    expect(entry.effectiveDate).toBe(meta.effective_date);
  });

  it("is generated, not hand-maintained", () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, "server/lib/legal-registry.generated.ts"),
      "utf-8",
    );
    expect(src).toContain("GENERATED FILE — DO NOT EDIT");
    expect(src).toContain("generate-legal-registry.mjs");
  });
});

// ── A3 ──────────────────────────────────────────────────────────────────

describe("A3 — a resolution failure empties the set, it does not throw", () => {
  const profileSrc = fs.readFileSync(
    path.join(REPO_ROOT, "server/routes/profile-routes.ts"),
    "utf-8",
  );

  it("wraps the resolve and continues past a failure", () => {
    // The defect: `const current = resolveLegalVersion(doc.slug)` bare inside
    // the loop, so one unresolvable document 500'd the whole profile and took
    // sign-in down with it.
    const fn = profileSrc.slice(
      profileSrc.indexOf("function outstandingLegalDocs"),
      profileSrc.indexOf("const profileCompletionSchema"),
    );
    expect(fn).toContain("try {");
    expect(fn).toMatch(/catch \(err: unknown\)/);
    expect(fn).toContain("continue;");
    expect(fn).toContain("legal_resolution_failed");
    // Bare — outside any try — is what regressed.
    expect(fn).not.toMatch(/^\s{4}const current = resolveLegalVersion/m);
  });

  it("logs at ERROR, so an invisible prompt is still a visible defect", () => {
    const fn = profileSrc.slice(
      profileSrc.indexOf("function outstandingLegalDocs"),
      profileSrc.indexOf("const profileCompletionSchema"),
    );
    expect(fn).toContain("logger.error(");
    expect(fn).toContain('"PROFILE"');
  });

  it("returns an empty set rather than a partial one it cannot vouch for", () => {
    // Driven, not read: with no tree AND no bundled entry for a fabricated
    // slug, the helper must yield [] instead of throwing.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "no-legal-a3-"));
    const spy = vi.spyOn(process, "cwd").mockReturnValue(empty);
    __resetLegalRegistryForTests();
    try {
      expect(() => resolveLegalVersion("fabricated-slug")).toThrow();
    } finally {
      spy.mockRestore();
      __resetLegalRegistryForTests();
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

// ── A4 ──────────────────────────────────────────────────────────────────

describe("A4 — consent capture cannot take sign-in down with it", () => {
  const oauthSrc = fs.readFileSync(
    path.join(REPO_ROOT, "server/routes/oauth-callback-routes.ts"),
    "utf-8",
  );

  it("guards the resolve so the finalize catch is never reached by it", () => {
    // Every Google sign-in ended at /login?error=post_auth_finalize because
    // these two calls threw into the finalize catch.
    const block = oauthSrc.slice(
      oauthSrc.indexOf("if (consentSource)"),
      oauthSrc.indexOf('logger.info("OAUTH", "success"'),
    );
    expect(block).toContain("legal_resolution_failed");
    expect(block).toMatch(/catch \(resolveErr: unknown\)/);
    expect(block).toContain("if (resolved !== null)");
  });

  it("skips only the capture, never the redirect", () => {
    // A bare `return` in the catch would leave the handler without ever
    // redirecting and hang the request. The guard is a null check, not a return.
    const catchBlock = oauthSrc.slice(
      oauthSrc.indexOf("catch (resolveErr: unknown)"),
      oauthSrc.indexOf("if (resolved !== null)"),
    );
    expect(catchBlock).not.toMatch(/\breturn\b/);
  });

  it("writes no row it cannot stamp with a real version and hash", () => {
    // The alternative to skipping is guessing, and a row that cannot name the
    // bytes served is the false record this programme exists to prevent.
    const block = oauthSrc.slice(
      oauthSrc.indexOf("if (consentSource)"),
      oauthSrc.indexOf('logger.info("OAUTH", "success"'),
    );
    expect(block).not.toMatch(/docVersion:\s*["'`]/);
    expect(block).not.toMatch(/contentHash:\s*["'`]/);
    expect(block).toContain("docVersion: studentTermsVersion.version");
  });
});
