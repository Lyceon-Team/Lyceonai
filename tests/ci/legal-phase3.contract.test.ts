/**
 * @spec [LYCEON legal versioning Phase 3 §5; Coding Standards §14]
 * @implemented 2026-09-15
 *
 * plain English: the three claims Phase 3 rests on, each written so that the
 * obvious way to break it turns this file red.
 *
 *   U1  no deleted PDF filename is referenced anywhere in the repository
 *   U2  no legal page renders a PDF affordance
 *   U3  every slug still renders its body, version and effective date, read
 *       from the real `legal/` tree rather than a fixture
 *
 * trade-offs: U1 and U2 are source-text assertions, which is the only way to
 * prove an absence across files that are never all loaded together. U3 runs the
 * real loader against the real repository files, because the risk this phase
 * introduces is that removing a link broke the page around it.
 *
 * edge cases:
 *  - U1 and U2 strip comments before asserting absence. `client/src/lib/legal.ts`
 *    deliberately records what was deleted and why — "View PDF", `pdfPath`, the
 *    December 2024 drift — and an absence test that read comments would force
 *    the file to delete the explanation of the defect in order to go green.
 *    (The same trap as `shared/seo/public-meta.ts` and Phase 2's T5.)
 *  - U3 expects all NINE to publish. `billing-terms` was the corpus's one
 *    `current: null` slug and was published on 2026-09-15; the branch that
 *    special-cased it is gone, which makes this assertion strictly stronger
 *    than it was. The `current: null` state itself is still exercised, in
 *    Phase 2's T4, against a fixture rather than a real document.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { loadLegalDocument } from "../../client/src/lib/legal-content";

const REPO_ROOT = path.resolve(__dirname, "../..");
const REAL_LEGAL = path.join(REPO_ROOT, "legal");

/** The six files deleted in this phase, by basename. */
const DELETED_PDFS = [
  "Lyceon-Community-Guidelines.pdf",
  "Lyceon-Honor-Code.pdf",
  "Lyceon-Parent-Guardian-Terms.pdf",
  "Lyceon-Privacy-Policy.pdf",
  "Lyceon-Student-Terms-of-Use.pdf",
  "Trust-and-Safety-at-Lyceon.pdf",
] as const;

/** Strip block and line comments, so absence means absence in the CODE. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

function readSource(relative: string): string {
  return stripComments(
    fs.readFileSync(path.join(REPO_ROOT, relative), "utf-8"),
  );
}

// ── U1 ──────────────────────────────────────────────────────────────────

describe("U1 — no deleted PDF filename is referenced anywhere", () => {
  it("has removed all six files from the working tree", () => {
    for (const name of DELETED_PDFS) {
      expect(
        fs.existsSync(path.join(REPO_ROOT, "client/public/legal", name)),
      ).toBe(false);
    }
  });

  it("leaves no reference to any of them in tracked source", () => {
    // A dangling link to a deleted PDF is the same defect class as a citation
    // to a document that does not exist — which is what the cross-reference
    // gate exists to catch for markdown. This is its counterpart for binaries.
    const searched = [
      "client/src/lib/legal.ts",
      "client/src/pages/legal.tsx",
      "client/src/pages/legal-doc.tsx",
      "client/src/index.css",
      "shared/seo/public-meta.ts",
      "vite-plugin-legal-content.ts",
      "vite.config.ts",
    ];

    for (const relative of searched) {
      const source = readSource(relative);
      for (const name of DELETED_PDFS) {
        expect(
          source.includes(name),
          `${relative} still references ${name}`,
        ).toBe(false);
      }
    }
  });
});

// ── U2 ──────────────────────────────────────────────────────────────────

describe("U2 — no legal page renders a PDF affordance", () => {
  const hub = readSource("client/src/pages/legal.tsx");
  const docPage = readSource("client/src/pages/legal-doc.tsx");
  const registry = readSource("client/src/lib/legal.ts");

  it("carries no `pdfPath` in the registry — not the field, not a value", () => {
    expect(registry).not.toMatch(/pdfPath/);
  });

  it("renders no PDF link or download button on either page", () => {
    for (const [name, source] of [
      ["legal.tsx", hub],
      ["legal-doc.tsx", docPage],
    ] as const) {
      expect(source, `${name} references pdfPath`).not.toMatch(/pdfPath/);
      expect(source, `${name} links a .pdf`).not.toMatch(/\.pdf/i);
      expect(source, `${name} offers "View PDF"`).not.toMatch(/View PDF/i);
      expect(source, `${name} offers a download`).not.toMatch(/\bdownload\b/i);
    }
  });

  it("still links every document to its own page", () => {
    // Removing an affordance must not remove the route to the document. The
    // hub keeps a wouter Link per slug; that is the surviving way in.
    expect(hub).toMatch(/\/legal\/\$\{doc\.slug\}/);
    // `legalDocs.length === 6` stood here. The six-entry array is gone: the
    // hub enumerates legal/ now, so the count it must show is "all published",
    // which tests/ci/legal-hub.contract.test.ts asserts against the directory.
  });
});

// ── U3 ──────────────────────────────────────────────────────────────────

describe("U3 — every slug still renders from the real legal/ tree", () => {
  beforeEach(() => {
    // Serve the REAL legal/ directory at /legal/..., exactly as the deploy does.
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      const abs = path.join(REAL_LEGAL, url.replace(/^\/legal\//, ""));
      if (!fs.existsSync(abs)) {
        return new Response("not found", { status: 404 });
      }
      return new Response(fs.readFileSync(abs, "utf-8"), { status: 200 });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const slugs = fs
    .readdirSync(REAL_LEGAL, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  it("finds the nine slugs Phase 1 migrated", () => {
    expect(slugs).toHaveLength(9);
  });

  it.each(slugs)("%s renders its body, version and date", async (slug) => {
    const doc = await loadLegalDocument(slug);

    expect(doc.state, `${slug} did not publish`).toBe("published");
    if (doc.state !== "published") return;

    // Provenance, not shape. An earlier draft asserted /^\d+\.\d+$/, which a
    // hardcoded "9.9" satisfies — the plant caught it. What the page shows has
    // to be what meta.yml says, read here independently of the loader.
    const manifest = JSON.parse(
      fs.readFileSync(path.join(REAL_LEGAL, slug, "manifest.json"), "utf-8"),
    );
    const meta = Object.fromEntries(
      fs
        .readFileSync(
          path.join(REAL_LEGAL, slug, manifest.current, "meta.yml"),
          "utf-8",
        )
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => {
          const at = line.indexOf(":");
          return [
            line.slice(0, at).trim(),
            line
              .slice(at + 1)
              .trim()
              .replace(/^"(.*)"$/, "$1"),
          ];
        }),
    );

    expect(doc.version, `${slug} version`).toBe(meta.version);
    expect(doc.effectiveDate, `${slug} date`).toBe(meta.effective_date);
    expect(doc.contentHash, `${slug} hash`).toBe(meta.content_hash);
    expect(doc.title, `${slug} title`).toBe(manifest.title);
    // A body, with real sections — not an empty shell that "renders".
    expect(doc.sections.length).toBeGreaterThan(1);
    expect(
      doc.sections.reduce((n, s) => n + s.markdown.length, 0),
    ).toBeGreaterThan(500);
  });
});

// ── U4 ──────────────────────────────────────────────────────────────────

describe("U4 — every document in legal/ is reachable, not just the six on the hub", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      const abs = path.join(REAL_LEGAL, url.replace(/^\/legal\//, ""));
      if (!fs.existsSync(abs)) {
        return new Response("not found", { status: 404 });
      }
      return new Response(fs.readFileSync(abs, "utf-8"), { status: 200 });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not gate the document page on the hub registry", () => {
    // The page used to 404 any slug missing from the six-entry registry
    // list, which meant refund-policy, subscription-auto-renewal-notice and
    // billing-terms all 404'd in a browser while every loader-level test
    // passed — the gate sat ABOVE the loader the tests called. Publication is
    // a property of legal/, so legal/ decides.
    const page = readSource("client/src/pages/legal-doc.tsx");
    expect(page).not.toMatch(/getLegalDocBySlug/);
    expect(page).not.toMatch(/registryEntry/);
  });

  it.each(["refund-policy", "subscription-auto-renewal-notice"])(
    "%s publishes and is reachable",
    async (slug) => {
      // These two, and billing-terms, were unreachable from the hub until it
      // stopped reading a six-entry array. They publish; the hub test proves
      // they are now listed.
      const doc = await loadLegalDocument(slug);
      expect(doc.state).toBe("published");
    },
  );

  it("tells a routing miss apart from a document that will not parse", async () => {
    // Both used to collapse into one error card. A slug nobody routed is a
    // 404; a manifest that exists and is broken is an error worth showing.
    const missing = await loadLegalDocument("no-such-document-at-all");
    expect(missing.state).toBe("not-found");

    vi.stubGlobal(
      "fetch",
      async () => new Response("{ not json", { status: 200 }),
    );
    const broken = await loadLegalDocument("privacy-policy");
    expect(broken.state).toBe("error");
  });
});

// ── The print path the deletion depends on ──────────────────────────────

describe("the markdown page prints, which is why the PDFs could go", () => {
  const css = fs.readFileSync(
    path.join(REPO_ROOT, "client/src/index.css"),
    "utf-8",
  );

  it("ships a print stylesheet scoped to the legal document page", () => {
    expect(css).toMatch(/@media print/);
    expect(css).toMatch(/\.legal-document/);
  });

  it("hides the site chrome that would otherwise print", () => {
    const printBlock = css.slice(css.indexOf("@media print"));
    for (const selector of [
      ".legal-document > header",
      ".legal-document aside",
      ".legal-document footer",
    ]) {
      expect(printBlock, `print block does not hide ${selector}`).toContain(
        selector,
      );
    }
  });

  it("marks the page root so the stylesheet can find it", () => {
    expect(readSource("client/src/pages/legal-doc.tsx")).toContain(
      "legal-document",
    );
  });
});
