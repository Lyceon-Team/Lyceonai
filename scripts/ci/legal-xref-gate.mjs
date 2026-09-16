#!/usr/bin/env node
/**
 * @spec [LYCEON legal versioning Phase 1 §6; Coding Standards §14]
 * @implemented 2026-09-15
 *
 * plain English: Every other LYCEON document a legal document names must
 * exist as a slug in legal/. A document that cites a contract we do not have
 * is a dangling promise to the reader, and this is the check that finds it.
 *
 * expected outcome: exit 0 when every document reference resolves to a slug.
 * Non-zero, naming the citing file, the line and the unresolved name,
 * otherwise.
 *
 * WHAT IT WOULD HAVE CAUGHT. LYCEON Billing Terms is cited by the Student
 * Terms, the Parent / Guardian Terms, the Refund Policy and the Auto-Renewal
 * Notice — six bolded references — while existing nowhere in the repository.
 * Nothing flagged it for weeks. It now resolves because billing-terms is a
 * slug with `current: null`: the reference is answered, and the manifest gate
 * reports honestly that no version is published yet. Those are two different
 * facts and they are now reported separately instead of both being silence.
 *
 * trade-offs:
 *  - A reference is recognised as a **bold span** ending in one of the
 *    document-type nouns below. The corpus writes every cross-reference that
 *    way (`**LYCEON Refund Policy**`, `**Student Terms of Use**`), so the
 *    pattern matches practice rather than imposing a new one. Prose mentions
 *    that are not bolded are deliberately out of scope: bolding is the signal
 *    the author meant a document rather than a common noun, and widening it
 *    would flag "our refund policy" in an ordinary sentence.
 *  - Resolution is exact-string against each manifest's `title` plus its
 *    `aliases`, so a new spelling of an existing document fails loudly and is
 *    fixed by adding the alias — a deliberate, reviewable act — rather than
 *    by a fuzzy match quietly absorbing a typo.
 *
 * edge cases:
 *  - Case and surrounding punctuation are preserved; only the bold markers
 *    are stripped. "Policy." inside the bold span would not resolve, which is
 *    correct: the citation is malformed.
 *  - A slug with no published version still resolves. Existence of the
 *    document is this gate's question; publication is the manifest gate's.
 */
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const LEGAL = path.join(REPO_ROOT, "legal");

/** The nouns a LYCEON legal document's title ends with. */
const DOC_NOUNS = ["Terms", "Terms of Use", "Policy", "Notice", "Code", "Guidelines"];
const REFERENCE = new RegExp(
  `\\*\\*([A-Z][^*\\n]{2,70}?(?:${DOC_NOUNS.join("|")}))\\*\\*`,
  "g",
);

let failed = false;

console.log("legal cross-reference gate — every cited document exists as a slug\n");

if (!fs.existsSync(LEGAL)) {
  console.error("✗ legal/ does not exist");
  process.exit(1);
}

/** name (title or alias) -> slug */
const known = new Map();
const slugs = fs
  .readdirSync(LEGAL, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

for (const slug of slugs) {
  const manifestPath = path.join(LEGAL, slug, "manifest.json");
  if (!fs.existsSync(manifestPath)) continue;
  /** @type {Record<string, unknown>} */
  let m;
  try {
    m = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch {
    // The manifest gate reports malformed JSON; this gate does not duplicate it.
    continue;
  }
  const names = [m.title, ...(Array.isArray(m.aliases) ? m.aliases : [])];
  for (const n of names) {
    if (typeof n === "string" && n.trim() !== "") known.set(n, slug);
  }
}

console.log(`  ${known.size} document names across ${slugs.length} slugs\n`);

/** @type {Array<{file: string, line: number, name: string}>} */
const unresolved = [];
let referencesChecked = 0;

for (const slug of slugs) {
  const slugDir = path.join(LEGAL, slug);
  for (const entry of fs.readdirSync(slugDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const versionDir = path.join(slugDir, entry.name);
    for (const name of fs.readdirSync(versionDir)) {
      if (!name.endsWith(".md")) continue;
      const rel = `legal/${slug}/${entry.name}/${name}`;
      const lines = fs.readFileSync(path.join(versionDir, name), "utf-8").split("\n");
      lines.forEach((line, i) => {
        for (const match of line.matchAll(REFERENCE)) {
          referencesChecked += 1;
          const cited = match[1].trim();
          if (!known.has(cited)) unresolved.push({ file: rel, line: i + 1, name: cited });
        }
      });
    }
  }
}

if (unresolved.length > 0) {
  failed = true;
  for (const u of unresolved) {
    console.error(`✗ ${u.file}:${u.line} cites "${u.name}" — no slug provides that name`);
  }
  console.error("");
  console.error("  Either the document is missing from legal/, or it exists under a");
  console.error("  different name and the manifest needs that spelling in its aliases.");
  console.error("  Known names:");
  for (const [n, s] of [...known.entries()].sort()) console.error(`    ${n}  ->  ${s}`);
} else {
  console.log(`✓ all ${referencesChecked} document references resolve to a slug`);
}

console.log("");
if (failed) {
  console.error("LEGAL CROSS-REFERENCE GATE: FAIL");
  process.exit(1);
}
console.log("LEGAL CROSS-REFERENCE GATE: PASS");
