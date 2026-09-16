/**
 * @spec [LYCEON legal versioning — hub completeness §Tests; Coding Standards §14]
 * @implemented 2026-09-15
 *
 * plain English: the four claims hub completeness rests on, each written so
 * that the obvious way to break it turns this file red.
 *
 *   H1  the hub lists every published slug
 *   H2  a tenth manifest appears with no code change
 *   H3  every hub link resolves to a rendering page
 *   H4  a slug at `current: null` does not appear
 *
 * trade-offs: these exercise the loader against a temporary `legal/` tree
 * served through a stubbed fetch, because H2 and H4 need slugs the real corpus
 * does not have — and inventing them in `legal/` would mean publishing a
 * document to test a list. H1 additionally runs against the REAL directory,
 * since the defect being fixed was a hardcoded list disagreeing with what is
 * on disk, and only the real disk can catch that recurring.
 *
 * edge cases:
 *  - The index is GENERATED, not committed, so these build it the same way the
 *    Vite plugin does: every directory with a manifest.json. A test that read a
 *    committed index would prove the index agrees with itself.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadLegalIndex,
  loadLegalSlugs,
  loadLegalDocument,
} from "../../client/src/lib/legal-content";

const REPO_ROOT = path.resolve(__dirname, "../..");
const REAL_LEGAL = path.join(REPO_ROOT, "legal");

/** What the Vite plugin writes: every directory carrying a manifest.json. */
function slugsOnDisk(root: string): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => fs.existsSync(path.join(root, n, "manifest.json")))
    .sort();
}

/** Serves `root` at /legal/..., synthesizing index.json as the plugin does. */
function serve(root: string): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input);
    const rel = url.replace(/^\/legal\//, "");
    if (rel === "index.json") {
      return new Response(JSON.stringify({ slugs: slugsOnDisk(root) }), {
        status: 200,
      });
    }
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return new Response("not found", { status: 404 });
    return new Response(fs.readFileSync(abs, "utf-8"), { status: 200 });
  });
}

function writeDoc(
  root: string,
  slug: string,
  opts: { current: string | null; order?: number; description?: string },
): void {
  const dir = path.join(root, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify(
      {
        slug,
        title: `LYCEON ${slug}`,
        description: opts.description ?? `About ${slug}.`,
        order: opts.order ?? 500,
        current: opts.current,
        locales: ["en"],
        aliases: [],
      },
      null,
      2,
    ),
  );
  if (opts.current === null) return;
  const v = path.join(dir, opts.current);
  fs.mkdirSync(v, { recursive: true });
  fs.writeFileSync(path.join(v, "en.md"), "## **One**\n\nBody text.\n");
  const hash = createHash("sha256")
    .update(fs.readFileSync(path.join(v, "en.md")))
    .digest("hex");
  fs.writeFileSync(
    path.join(v, "meta.yml"),
    `version: "1.0"\neffective_date: 2026-09-11\nsupersedes: null\npublished: true\ncontent_hash: sha256:${hash}\n`,
  );
}

// ── H1 ──────────────────────────────────────────────────────────────────

describe("H1 — the hub lists every published slug", () => {
  beforeEach(() => serve(REAL_LEGAL));
  afterEach(() => vi.unstubAllGlobals());

  it("enumerates all nine from the index, not a subset", async () => {
    // The defect: /legal listed six while nine were published, because the
    // page mapped over a hardcoded array. Six of nine is the number to guard.
    const slugs = await loadLegalSlugs();
    expect(slugs.sort()).toEqual(slugsOnDisk(REAL_LEGAL));
    expect(slugs).toHaveLength(9);
  });

  it("includes the three that were never listed before", async () => {
    const slugs = await loadLegalSlugs();
    for (const slug of [
      "billing-terms",
      "refund-policy",
      "subscription-auto-renewal-notice",
    ]) {
      expect(slugs, `${slug} missing from the index`).toContain(slug);
    }
  });

  it("gives every listed document a title, description and order", async () => {
    const entries = await loadLegalIndex(await loadLegalSlugs());
    expect(entries).toHaveLength(9);
    for (const e of entries) {
      expect(e.state, `${e.slug} did not publish`).toBe("published");
      if (e.state !== "published") continue;
      expect(e.title.length, `${e.slug} title`).toBeGreaterThan(0);
      expect(e.description.length, `${e.slug} description`).toBeGreaterThan(10);
      expect(Number.isInteger(e.order), `${e.slug} order`).toBe(true);
    }
  });

  it("orders deliberately, not alphabetically", async () => {
    const entries = await loadLegalIndex(await loadLegalSlugs());
    const ordered = entries
      .filter((e) => e.state === "published")
      .sort(
        (a, b) =>
          (a as { order: number }).order - (b as { order: number }).order,
      )
      .map((e) => e.slug);

    // Agreements, then privacy, then the billing three in the order a
    // subscription is experienced, then conduct.
    expect(ordered).toEqual([
      "student-terms",
      "parent-guardian-terms",
      "privacy-policy",
      "billing-terms",
      "subscription-auto-renewal-notice",
      "refund-policy",
      "honor-code",
      "community-guidelines",
      "trust-and-safety",
    ]);
    expect(ordered).not.toEqual([...ordered].sort());
  });

  it("takes descriptions from the manifests, not from client code", () => {
    // They lived in client/src/lib/legal.ts as `shortDescription` beside a
    // hardcoded slug list. A description that does not travel with its
    // document is how three documents ended up with none at all.
    for (const slug of slugsOnDisk(REAL_LEGAL)) {
      const m = JSON.parse(
        fs.readFileSync(path.join(REAL_LEGAL, slug, "manifest.json"), "utf-8"),
      );
      expect(typeof m.description, `${slug}`).toBe("string");
      expect(m.description.trim().length).toBeGreaterThan(10);
      expect(Number.isInteger(m.order), `${slug} order`).toBe(true);
    }
    const hub = fs.readFileSync(
      path.join(REPO_ROOT, "client/src/pages/legal.tsx"),
      "utf-8",
    );
    expect(hub).not.toMatch(/shortDescription/);
    expect(hub).not.toMatch(/\blegalDocs\b/);
  });
});

// ── H2 ──────────────────────────────────────────────────────────────────

describe("H2 — a tenth manifest appears with no code change", () => {
  let tmp = "";
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "legal-hub-"));
    fs.cpSync(REAL_LEGAL, tmp, { recursive: true });
    serve(tmp);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("lists a newly published tenth document without touching client code", async () => {
    expect(await loadLegalSlugs()).toHaveLength(9);

    writeDoc(tmp, "data-processing-terms", { current: "v1", order: 35 });

    const slugs = await loadLegalSlugs();
    expect(slugs).toHaveLength(10);
    expect(slugs).toContain("data-processing-terms");

    const entries = await loadLegalIndex(slugs);
    const added = entries.find((e) => e.slug === "data-processing-terms");
    expect(added?.state).toBe("published");
    if (added?.state !== "published") return;
    expect(added.order).toBe(35);
    expect(added.title).toContain("data-processing-terms");
  });
});

// ── H3 ──────────────────────────────────────────────────────────────────

describe("H3 — every hub link resolves to a rendering page", () => {
  beforeEach(() => serve(REAL_LEGAL));
  afterEach(() => vi.unstubAllGlobals());

  it("loads a real document for every slug the hub would link", async () => {
    // A hub entry whose link 404s is worse than an absent entry: it looks like
    // the document exists. Every listed slug is opened here.
    for (const slug of await loadLegalSlugs()) {
      const doc = await loadLegalDocument(slug);
      expect(doc.state, `/legal/${slug} did not render`).toBe("published");
      if (doc.state !== "published") continue;
      expect(
        doc.sections.length,
        `/legal/${slug} has no sections`,
      ).toBeGreaterThan(1);
    }
  });
});

// ── H4 ──────────────────────────────────────────────────────────────────

describe("H4 — a slug at `current: null` does not appear", () => {
  let tmp = "";
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "legal-hub-null-"));
    fs.cpSync(REAL_LEGAL, tmp, { recursive: true });
    serve(tmp);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("is in the index but is not a published entry", async () => {
    writeDoc(tmp, "not-yet-written", { current: null });

    // It IS in the index — the slug exists, and citations to it resolve.
    const slugs = await loadLegalSlugs();
    expect(slugs).toContain("not-yet-written");

    // But it is not published, which is what the hub filters on.
    const entries = await loadLegalIndex(slugs);
    const entry = entries.find((e) => e.slug === "not-yet-written");
    expect(entry?.state).toBe("unpublished");

    const listed = entries.filter((e) => e.state === "published");
    expect(listed.map((e) => e.slug)).not.toContain("not-yet-written");
    expect(listed).toHaveLength(9);
  });

  it("the hub filters on published, not on index membership", () => {
    const hub = fs.readFileSync(
      path.join(REPO_ROOT, "client/src/pages/legal.tsx"),
      "utf-8",
    );
    expect(hub).toMatch(/state === "published"/);
  });
});
