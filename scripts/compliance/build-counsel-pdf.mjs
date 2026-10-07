/**
 * Builds the counsel package PDF: the cover note and the 12 launch legal drafts, in reading order.
 *
 * @spec [docs/compliance/legal-drafts/COUNSEL_PACKAGE.md §6; owner brief 2026-10-07 ("a single PDF
 *       of all 12 drafts plus the cover note, built with the repo's tooling … no new dependencies")]
 *       | @implemented [2026-10-07]
 *
 * plain English: reads COUNSEL_PACKAGE.md and the drafts it lists, renders each from Markdown to
 * HTML with the repo's own react-markdown + remark-gfm (tables included), joins them with a page
 * break between documents, and prints the result to A4/Letter PDF through Playwright's Chromium
 * (the browser CI already installs). Every page footer carries the source commit, so a reader can
 * tell which version of the drafts the PDF shows.
 *
 * Legal text is rendered as written: nothing here edits, filters or reorders a draft's content.
 *
 * Usage: pnpm run build:counsel-pdf   (optionally CHROMIUM_PATH=/path/to/chrome)
 * Output: docs/compliance/legal-drafts/out/lyceon-counsel-package.pdf
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DRAFTS = join(ROOT, "docs/compliance/legal-drafts");
const OUT = join(DRAFTS, "out/lyceon-counsel-package.pdf");

/**
 * Reading order: the same order as COUNSEL_PACKAGE.md §2. Paths are from the repo root.
 *
 * The Privacy Policy is the single published-track policy, `legal/privacy-policy/v5/en.md`
 * (#1128, with the SEO items folded in). The earlier draft `privacy-policy-v5.md` is retired and is
 * never rendered (owner ruling, 2026-10-07).
 */
const PRIVACY_POLICY = "legal/privacy-policy/v5/en.md";
const READING_ORDER = [
  PRIVACY_POLICY,
  "childrens-privacy-notice.md",
  "parental-consent-mechanism.md",
  "cookie-policy.md",
  "cookie-banner-text.md",
  "ca-notice-at-collection.md",
  "ca-do-not-sell-share-gpc.md",
  "ai-content-disclosure.md",
  "marketing-communications-consent.md",
  "billing-terms-v3.md",
  "school-data-privacy-addendum.md",
  "sub-processor-list.md",
].map((f) => (f.includes("/") ? f : `docs/compliance/legal-drafts/${f}`));

function assertReadingOrderMatchesPackage(packageText) {
  for (const path of READING_ORDER) {
    const file = path.startsWith("docs/compliance/legal-drafts/")
      ? path.slice("docs/compliance/legal-drafts/".length)
      : path;
    if (!packageText.includes(`\`${file}\``)) {
      throw new Error(`COUNSEL_PACKAGE.md §2 does not list ${file}`);
    }
  }
}

function render(markdown) {
  return renderToStaticMarkup(
    createElement(Markdown, { remarkPlugins: [remarkGfm] }, markdown),
  );
}

function sourceCommit() {
  return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
}

const STYLE = `
  body { font-family: "Times New Roman", Georgia, serif; font-size: 11pt; line-height: 1.45; color: #111; }
  h1 { font-size: 18pt; margin: 0 0 8pt; }
  h2 { font-size: 14pt; margin: 16pt 0 6pt; }
  h3 { font-size: 12pt; margin: 12pt 0 4pt; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 9.5pt; }
  th, td { border: 1px solid #999; padding: 3pt 5pt; vertical-align: top; text-align: left; }
  th { background: #eee; }
  blockquote { border-left: 3px solid #999; margin: 8pt 0; padding: 2pt 10pt; color: #333; }
  code { font-family: "Courier New", monospace; font-size: 9.5pt; }
  hr { border: 0; border-top: 1px solid #ccc; margin: 12pt 0; }
  section.doc { page-break-before: always; }
  section.doc:first-of-type { page-break-before: auto; }
`;

async function main() {
  const packageText = readFileSync(join(DRAFTS, "COUNSEL_PACKAGE.md"), "utf8");
  assertReadingOrderMatchesPackage(packageText);

  const sections = [
    packageText,
    ...READING_ORDER.map((f) => {
      if (!existsSync(join(ROOT, f))) {
        throw new Error(
          `${f} is missing: the Privacy Policy is #1128's v5, so build from a checkout that has it`,
        );
      }
      return readFileSync(join(ROOT, f), "utf8");
    }),
  ]
    .map((md) => `<section class="doc">${render(md)}</section>`)
    .join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>LYCEON counsel package</title><style>${STYLE}</style></head><body>${sections}</body></html>`;

  const commit = sourceCommit();
  mkdirSync(dirname(OUT), { recursive: true });
  // CHROMIUM_PATH: an already-installed Chromium, for machines whose browser cache does not match
  // the pinned Playwright version. Unset, Playwright's own browser is used.
  const executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(
    executablePath ? { executablePath } : {},
  );
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({
      path: OUT,
      format: "Letter",
      margin: { top: "0.8in", bottom: "0.8in", left: "0.9in", right: "0.9in" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="font-size:8pt;width:100%;padding:0 0.9in;display:flex;justify-content:space-between;color:#555;"><span>LYCEON counsel package · DRAFT — NOT PUBLISHED · source ${commit}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    });
  } finally {
    await browser.close();
  }
  process.stdout.write(`wrote ${OUT} (source ${commit})\n`);
}

await main();
