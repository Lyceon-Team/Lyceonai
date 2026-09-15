/**
 * @spec [LYCEON legal versioning Phase 2 §6; Coding Standards §14]
 * @implemented 2026-09-15
 *
 * plain English: the five claims Phase 2 rests on, each written so that the
 * obvious way to break it turns this file red.
 *
 *   T1  the rendered version and date come from meta.yml, not from the body
 *   T2  changing `current` in a manifest changes what renders, with no code change
 *   T3  a consent record stores slug, version and hash, and the hash is the
 *       SHA-256 of the file that was served
 *   T4  `current: null` is an unpublished state, not an error
 *   T5  no document body remains in client/src/lib/legal.ts
 *
 * trade-offs: T1, T2 and T4 exercise the loader against a temporary legal/
 * tree rather than the real one, so a case like `current: null` can be set up
 * without editing a published version — which the immutability gate would
 * rightly refuse. T3 runs against the REAL repository files, because the point
 * of it is that the hash on the row matches the bytes that actually ship.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  parseSections,
  loadLegalDocument,
} from "../../client/src/lib/legal-content";
import {
  resolveLegalVersion,
  __resetLegalRegistryForTests,
} from "../../server/lib/legal-registry";
import { recordLegalAcceptances } from "../../server/lib/legal-acceptance";

const REPO_ROOT = path.resolve(__dirname, "../..");
const REAL_LEGAL = path.join(REPO_ROOT, "legal");

// ── A temporary legal/ tree served through a stubbed fetch ──────────────

let tmpRoot = "";

function writeDoc(
  slug: string,
  opts: {
    current: string | null;
    version?: string;
    date?: string;
    body?: string;
  },
): void {
  const dir = path.join(tmpRoot, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify(
      {
        slug,
        title: `LYCEON ${slug}`,
        current: opts.current,
        locales: ["en"],
        aliases: [],
      },
      null,
      2,
    ),
  );
  if (opts.current === null) return;

  const vDir = path.join(dir, opts.current);
  fs.mkdirSync(vDir, { recursive: true });
  const body = opts.body ?? "## **One**\n\nBody text.\n";
  fs.writeFileSync(path.join(vDir, "en.md"), body);
  const hash = createHash("sha256")
    .update(fs.readFileSync(path.join(vDir, "en.md")))
    .digest("hex");
  fs.writeFileSync(
    path.join(vDir, "meta.yml"),
    `version: "${opts.version ?? "2.0"}"\n` +
      `effective_date: ${opts.date ?? "2026-09-11"}\n` +
      `supersedes: null\npublished: true\n` +
      `content_hash: sha256:${hash}\n`,
  );
}

/** Serves the temporary tree at /legal/... exactly as the deploy does. */
function stubFetchFromTmp(): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input);
    const rel = url.replace(/^\/legal\//, "");
    const abs = path.join(tmpRoot, rel);
    if (!fs.existsSync(abs)) {
      return new Response("not found", { status: 404 });
    }
    return new Response(fs.readFileSync(abs, "utf-8"), { status: 200 });
  });
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "legal-phase2-"));
  stubFetchFromTmp();
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  __resetLegalRegistryForTests();
});

// ── T1 ──────────────────────────────────────────────────────────────────

describe("T1 — version and date come from meta.yml, never the body", () => {
  it("reports meta.yml's version and effective date", async () => {
    writeDoc("privacy-policy", {
      current: "v2",
      version: "2.0",
      date: "2026-09-11",
    });

    const doc = await loadLegalDocument("privacy-policy");
    expect(doc.state).toBe("published");
    if (doc.state !== "published") return;
    expect(doc.version).toBe("2.0");
    expect(doc.effectiveDate).toBe("2026-09-11");
  });

  it("takes them from meta.yml even when the body claims something else", async () => {
    // A body that lies. meta.yml is the authority; the body is not read for
    // this, which is the whole reason the body is not allowed to carry one.
    writeDoc("privacy-policy", {
      current: "v2",
      version: "2.0",
      date: "2026-09-11",
      body: "## **One**\n\nVersion 9.9 · Effective 1 January 1999\n",
    });

    const doc = await loadLegalDocument("privacy-policy");
    if (doc.state !== "published") throw new Error("expected published");
    expect(doc.version).toBe("2.0");
    expect(doc.effectiveDate).toBe("2026-09-11");
    expect(doc.version).not.toBe("9.9");
  });
});

// ── T2 ──────────────────────────────────────────────────────────────────

describe("T2 — the manifest's `current` decides what renders", () => {
  it("renders v3 after `current` moves, with no code change", async () => {
    writeDoc("privacy-policy", {
      current: "v2",
      version: "2.0",
      body: "## **Old**\n\nThe superseded text.\n",
    });
    // Publish v3 alongside v2 — adding a directory, never editing one.
    const v3 = path.join(tmpRoot, "privacy-policy", "v3");
    fs.mkdirSync(v3, { recursive: true });
    fs.writeFileSync(
      path.join(v3, "en.md"),
      "## **New**\n\nThe current text.\n",
    );
    const hash = createHash("sha256")
      .update(fs.readFileSync(path.join(v3, "en.md")))
      .digest("hex");
    fs.writeFileSync(
      path.join(v3, "meta.yml"),
      `version: "3.0"\neffective_date: 2027-01-01\nsupersedes: "2.0"\npublished: true\ncontent_hash: sha256:${hash}\n`,
    );

    const before = await loadLegalDocument("privacy-policy");
    if (before.state !== "published") throw new Error("expected published");
    expect(before.version).toBe("2.0");
    expect(before.sections.some((s) => s.title === "Old")).toBe(true);

    // The only change: one line in the manifest.
    const manifestPath = path.join(tmpRoot, "privacy-policy", "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    manifest.current = "v3";
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const after = await loadLegalDocument("privacy-policy");
    if (after.state !== "published") throw new Error("expected published");
    expect(after.version).toBe("3.0");
    expect(after.effectiveDate).toBe("2027-01-01");
    expect(after.sections.some((s) => s.title === "New")).toBe(true);
    expect(after.sections.some((s) => s.title === "Old")).toBe(false);
  });
});

// ── T3 ──────────────────────────────────────────────────────────────────

describe("T3 — a consent record carries slug, version and a hash that matches the served file", () => {
  it("stamps the row with the SHA-256 of the real en.md", async () => {
    // Deliberately against the REAL repository files: the claim is that the
    // hash on the row identifies the bytes that actually ship.
    const resolved = resolveLegalVersion("privacy-policy");
    const served = fs.readFileSync(
      path.join(
        REAL_LEGAL,
        "privacy-policy",
        resolved.version === "2.0" ? "v2" : "v2",
        "en.md",
      ),
    );
    const expected = `sha256:${createHash("sha256").update(served).digest("hex")}`;

    expect(resolved.contentHash).toBe(expected);

    const rows: Array<Record<string, unknown>> = [];
    const fakeSupabase = {
      from: () => ({
        upsert: async (payload: Array<Record<string, unknown>>) => {
          rows.push(...payload);
          return { error: null };
        },
      }),
    } as unknown as Parameters<typeof recordLegalAcceptances>[0];

    await recordLegalAcceptances(fakeSupabase, {
      userId: "00000000-0000-0000-0000-000000000001",
      consentSource: "email_signup_form",
      userAgent: null,
      ipAddress: null,
      acceptances: [
        {
          docKey: "privacy_policy",
          docSlug: resolved.slug,
          docVersion: resolved.version,
          contentHash: resolved.contentHash,
          actorType: "student",
          minor: false,
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].doc_slug).toBe("privacy-policy");
    expect(rows[0].doc_version).toBe(resolved.version);
    expect(rows[0].content_hash).toBe(expected);
    // The defect this replaces: a date in place of a version.
    expect(rows[0].doc_version).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── T4 ──────────────────────────────────────────────────────────────────

describe("T4 — `current: null` is an unpublished state, not an error", () => {
  it("returns unpublished for a slug with no published version", async () => {
    writeDoc("billing-terms", { current: null });
    const doc = await loadLegalDocument("billing-terms");
    expect(doc.state).toBe("unpublished");
    if (doc.state !== "unpublished") return;
    expect(doc.title).toContain("billing-terms");
  });

  it("is distinct from the state a missing manifest produces", async () => {
    // Phase 3 split this. A slug with no manifest used to collapse into
    // `error` alongside a manifest that exists but will not parse, and the
    // page rendered an error card for both — so three real documents that
    // simply were not in the six-entry hub registry showed as broken rather
    // than as 404s. The claim this test was written for is unchanged (an
    // unpublished document is not a failure); what it names is now exact.
    const doc = await loadLegalDocument("does-not-exist");
    expect(doc.state).toBe("not-found");
    expect(doc.state).not.toBe("unpublished");
  });

  it("still separates a routing miss from a document that will not parse", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("{ not json", { status: 200 }),
    );
    const broken = await loadLegalDocument("billing-terms");
    expect(broken.state).toBe("error");
  });

  it("refuses to resolve a consent version for an unpublished slug", () => {
    // Nothing can be consented to before it is published, so there is no
    // version to record — and guessing one would be a false record.
    //
    // This used to point at `billing-terms`, the corpus's one `current: null`
    // slug. It was published on 2026-09-15, so every one of the nine is now
    // published and the guarantee has no live example left. It still has to
    // hold for the NEXT document added at `current: null`, so the fixture is
    // built here rather than borrowed from the corpus — which is what let the
    // test rot in the first place.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "legal-registry-"));
    const legalDir = path.join(root, "legal");
    // legalRoot() probes for privacy-policy/manifest.json to find the tree.
    for (const [slug, current] of [
      ["privacy-policy", "v2"],
      ["not-yet-written", null],
    ] as const) {
      const dir = path.join(legalDir, slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "manifest.json"),
        JSON.stringify({
          slug,
          title: slug,
          current,
          locales: ["en"],
          aliases: [],
        }),
      );
    }

    // `legalRoot()` resolves CANDIDATE_ROOTS against process.cwd(), so the
    // seam is cwd — not chdir, which vitest workers do not support.
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(root);
    try {
      __resetLegalRegistryForTests();
      expect(() => resolveLegalVersion("not-yet-written")).toThrow(
        /no published version/,
      );
    } finally {
      cwdSpy.mockRestore();
      __resetLegalRegistryForTests();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves a consent version for every slug that IS published", () => {
    // The other half of the same guarantee, and the one with live examples:
    // all nine now resolve to a version and a hash.
    const slugs = fs
      .readdirSync(REAL_LEGAL, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(slugs).toHaveLength(9);
    for (const slug of slugs) {
      const resolved = resolveLegalVersion(slug);
      expect(resolved.version, `${slug} version`).toMatch(/^\d+\.\d+$/);
      expect(resolved.contentHash, `${slug} hash`).toMatch(
        /^sha256:[0-9a-f]{64}$/,
      );
    }
  });
});

// ── T5 ──────────────────────────────────────────────────────────────────

describe("T5 — no document body remains in client/src/lib/legal.ts", () => {
  const raw = fs.readFileSync(
    path.join(REPO_ROOT, "client/src/lib/legal.ts"),
    "utf-8",
  );

  /**
   * Comments are stripped before asserting a name is ABSENT. The file's header
   * deliberately records what was deleted and why — `lastUpdated: '2024-12-22'`,
   * 151 `Lyceon`s, the missing version field. An absence test that read comments
   * would force the file to delete the explanation of the defect in order to go
   * green, trading the record for a passing grep. (Learned the same way on
   * shared/seo/public-meta.ts.)
   */
  const legalTs = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("carries no `sections` array", () => {
    expect(legalTs).not.toMatch(/\bsections\s*:/);
  });

  it("carries no `lastUpdated` field", () => {
    expect(legalTs).not.toMatch(/lastUpdated\s*:/);
  });

  it("is a registry, not a document store", () => {
    // 1,037 lines before; the registry is a small fraction of that. The bound
    // is deliberately loose — it fails on a body coming back, not on a comment.
    expect(legalTs.split("\n").length).toBeLessThan(260);
  });

  it("contains none of the distinctive sentences it used to serve", () => {
    for (const sentence of [
      "We collect information you provide directly",
      "By using Lyceon, you agree",
      "This Privacy Policy explains how we collect",
    ]) {
      expect(legalTs).not.toContain(sentence);
    }
  });
});

// ── Section parsing, which T1/T2 depend on ──────────────────────────────

describe("section parsing keeps the table of contents working", () => {
  it("splits on `##` and leaves `###` inside the section", () => {
    const sections = parseSections(
      "# **Title**\n\nLead.\n\n## **1. One**\n\nalpha\n\n### **1.1**\n\nbeta\n\n## **2. Two**\n\ngamma\n",
    );
    const titled = sections.filter((s) => s.title.length > 0);
    expect(titled.map((s) => s.title)).toEqual(["1. One", "2. Two"]);
    expect(titled[0].markdown).toContain("### **1.1**");
    expect(titled[0].markdown).toContain("beta");
  });

  it("keeps the lead paragraph rather than dropping it", () => {
    const sections = parseSections(
      "# **Title**\n\nLead.\n\n## **One**\n\nbody\n",
    );
    expect(sections[0].markdown).toContain("Lead.");
  });
});
