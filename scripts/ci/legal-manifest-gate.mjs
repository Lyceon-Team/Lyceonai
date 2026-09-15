#!/usr/bin/env node
/**
 * @spec [LYCEON legal versioning Phase 1 §2, §6; Coding Standards §14]
 * @implemented 2026-09-15
 *
 * plain English: Every legal slug must resolve. A manifest naming a version
 * directory that does not exist fails; every meta.yml must parse and carry
 * every required field; every locale a manifest claims must have a body file.
 *
 * expected outcome: exit 0 when all nine slugs resolve cleanly. Non-zero,
 * naming the slug and the field, otherwise.
 *
 * trade-offs:
 *  - meta.yml is parsed by a strict flat reader rather than a YAML library.
 *    The format is deliberately five scalar lines; anything richer is a
 *    smell, and rejecting it here keeps the file readable by any tool
 *    (including the plain `grep` an auditor will reach for). A line that is
 *    not `key: value` is an error, not something to be lenient about.
 *  - `current: null` is a legitimate state, not a failure: a slug can exist
 *    so that citations of it resolve before its first version is published.
 *    That is exactly the LYCEON Billing Terms case — cited by four documents
 *    while existing nowhere, which is the defect this structure exists to
 *    surface rather than hide.
 *
 * edge cases:
 *  - A version directory present on disk but not named by `current` is fine;
 *    that is what superseded versions look like. It still must be well formed.
 *  - `effective_date` is checked for shape (YYYY-MM-DD), not plausibility.
 */
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../..",
);
const LEGAL = path.join(REPO_ROOT, "legal");

const REQUIRED_META = [
  "version",
  "effective_date",
  "supersedes",
  "published",
  "content_hash",
];
const REQUIRED_MANIFEST = ["slug", "title", "current", "locales", "aliases"];

let failed = false;
const fail = (msg, ...detail) => {
  failed = true;
  console.error(`✗ ${msg}`);
  for (const d of detail) console.error(`    ${d}`);
};

/**
 * Strict flat YAML: every non-empty, non-comment line must be `key: value`.
 * @returns {Record<string, string>}
 */
function parseFlatYaml(text, where) {
  /** @type {Record<string, string>} */
  const out = {};
  text.split("\n").forEach((line, i) => {
    if (line.trim() === "" || line.trimStart().startsWith("#")) return;
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!m) {
      fail(
        `${where}:${i + 1} is not a flat \`key: value\` line`,
        `got: ${line}`,
      );
      return;
    }
    out[m[1]] = m[2].trim();
  });
  return out;
}

console.log("legal manifest gate — every slug and version resolves\n");

if (!fs.existsSync(LEGAL)) {
  console.error("✗ legal/ does not exist");
  process.exit(1);
}

const slugs = fs
  .readdirSync(LEGAL, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

if (slugs.length === 0) fail("legal/ contains no slug directories");

for (const slug of slugs) {
  const slugDir = path.join(LEGAL, slug);
  const manifestPath = path.join(slugDir, "manifest.json");
  const rel = `legal/${slug}`;

  if (!fs.existsSync(manifestPath)) {
    fail(`${rel} has no manifest.json`);
    continue;
  }

  /** @type {unknown} */
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch (err) {
    fail(`${rel}/manifest.json is not valid JSON`, String(err));
    continue;
  }
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    Array.isArray(manifest)
  ) {
    fail(`${rel}/manifest.json is not a JSON object`);
    continue;
  }
  const m = /** @type {Record<string, unknown>} */ (manifest);

  for (const field of REQUIRED_MANIFEST) {
    if (!(field in m)) fail(`${rel}/manifest.json lacks "${field}"`);
  }
  if (m.slug !== slug) {
    fail(
      `${rel}/manifest.json slug "${String(m.slug)}" does not match its directory`,
    );
  }
  if (typeof m.title !== "string" || m.title.trim() === "") {
    fail(`${rel}/manifest.json title must be a non-empty string`);
  }
  if (!Array.isArray(m.locales) || m.locales.length === 0) {
    fail(`${rel}/manifest.json locales must be a non-empty array`);
  }
  if (!Array.isArray(m.aliases)) {
    fail(`${rel}/manifest.json aliases must be an array (use [] for none)`);
  }

  // Every version directory on disk must be well formed, whether current or not.
  const versionDirs = fs
    .readdirSync(slugDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const v of versionDirs) {
    // Locale bodies are checked FIRST, before any early exit.
    //
    // This block used to sit at the end of the loop, after `continue` on a
    // missing meta.yml — so a version directory with no meta.yml reported
    // only that, and its missing body went unmentioned. `billing-terms/v2`
    // landed with its body named `Lyceon billing terms` and nothing said so:
    // the manifest gate stopped at the meta.yml, and the body-purity gate
    // resolves `<dir>/en.md` and silently skips when it is absent. Two gates,
    // one blind spot, and 147 lines carrying an inline version and date sat
    // in the tree unchecked. The checks are independent, so they run
    // independently.
    if (Array.isArray(m.locales)) {
      for (const locale of m.locales) {
        const body = path.join(slugDir, v, `${String(locale)}.md`);
        if (!fs.existsSync(body)) {
          const present = fs
            .readdirSync(path.join(slugDir, v))
            .filter((f) => f !== "meta.yml");
          fail(
            `${rel}/${v} declares locale "${String(locale)}" but ${String(locale)}.md is missing`,
            present.length
              ? `files present besides meta.yml: ${present.join(", ")}`
              : "the version directory has no body at all",
          );
        }
      }
    }

    const metaPath = path.join(slugDir, v, "meta.yml");
    if (!fs.existsSync(metaPath)) {
      fail(`${rel}/${v} has no meta.yml`);
      continue;
    }
    const meta = parseFlatYaml(
      fs.readFileSync(metaPath, "utf-8"),
      `${rel}/${v}/meta.yml`,
    );
    for (const field of REQUIRED_META) {
      if (!(field in meta)) fail(`${rel}/${v}/meta.yml lacks "${field}"`);
    }
    if (
      meta.effective_date &&
      !/^\d{4}-\d{2}-\d{2}$/.test(meta.effective_date)
    ) {
      fail(
        `${rel}/${v}/meta.yml effective_date is not YYYY-MM-DD`,
        `got: ${meta.effective_date}`,
      );
    }
    if (meta.published && !["true", "false"].includes(meta.published)) {
      fail(
        `${rel}/${v}/meta.yml published must be true or false`,
        `got: ${meta.published}`,
      );
    }
    if (meta.content_hash && !/^sha256:[0-9a-f]{64}$/.test(meta.content_hash)) {
      fail(
        `${rel}/${v}/meta.yml content_hash must be sha256:<64 lowercase hex>`,
        `got: ${meta.content_hash}`,
      );
    }
  }

  // The resolution rule itself.
  if (m.current === null) {
    console.log(
      `✓ ${slug} — no published version yet (current: null), citations resolve`,
    );
    continue;
  }
  if (typeof m.current !== "string" || m.current.trim() === "") {
    fail(`${rel}/manifest.json current must be a version string or null`);
    continue;
  }
  if (!versionDirs.includes(m.current)) {
    fail(
      `${rel}/manifest.json points current at "${m.current}", which does not exist`,
      `version directories present: ${versionDirs.length ? versionDirs.join(", ") : "(none)"}`,
    );
    continue;
  }
  console.log(`✓ ${slug} — current: ${m.current}`);
}

console.log("");
if (failed) {
  console.error("LEGAL MANIFEST GATE: FAIL");
  process.exit(1);
}
console.log(`LEGAL MANIFEST GATE: PASS (${slugs.length} slugs)`);
