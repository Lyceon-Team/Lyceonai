/**
 * @spec [Doc-01A §3 config doctrine (infra/* registries are checked-in
 *        config); Coding Standards §16 (no dependency changes without
 *        approval)]
 * @implemented [2026-09-22]
 *
 * plain English: just enough YAML to read the `infra/*.yaml` registries this
 * repo checks in — scalars, and lists of flat key/value mappings under a
 * top-level key. Nothing else.
 *
 * WHY A HAND-ROLLED PARSER AND NOT A LIBRARY. Neither `yaml` nor `js-yaml` is
 * a dependency of this monorepo, and adding one needs owner approval
 * (CLAUDE.md, Tooling). `scripts/ci/secret-class-inventory-check.ts` already
 * solved this in 2026-09-03 with a parser "tailored to this manifest's
 * structure". This module is that parser's generic half, lifted out so the
 * second registry gate consumes it instead of forking a third copy —
 * divergence and duplication are defects even when no two edits touch the
 * same line.
 *
 * expected outcome: `parseYamlScalar` and `parseFlatMappingList` behave
 * identically to the inline versions they replace, on the files this repo
 * actually has.
 *
 * trade-offs / WHAT THIS DELIBERATELY DOES NOT SUPPORT. Nested mappings,
 * block scalars (`|`, `>`, `>-`), anchors, multi-document streams, flow
 * collections (`{a: 1}`, `[1, 2]`), and multi-line strings. A registry that
 * needs any of those should get a real parser and the approval to add one;
 * until then the registries are written within this subset, which is why
 * `infra/retention-policy-registry.yaml` keeps every value on one line.
 *
 * edge cases:
 *  - An unsupported construct is not silently mis-parsed: a block-scalar
 *    indicator throws, because a parser that quietly returns ">-" as a value
 *    would let a registry claim something its consumers never read.
 *  - Inline `#` comments are stripped from unquoted scalars only. A `#`
 *    inside quotes is part of the value.
 */

/**
 * Parse one YAML scalar. Returns null for an empty value, `null` or `~`;
 * booleans for `true`/`false`; a number for an integer or decimal literal;
 * otherwise the string with any inline comment removed.
 */
export function parseYamlScalar(
  raw: string,
): string | boolean | number | null {
  const v = raw.trim();

  // Quoted first: a `#` inside quotes is part of the value, not a comment.
  if (v.startsWith('"')) {
    const end = v.indexOf('"', 1);
    return end > 0 ? v.slice(1, end) : v.slice(1);
  }
  if (v.startsWith("'")) {
    const end = v.lastIndexOf("'");
    return end > 0 ? v.slice(1, end) : v.slice(1);
  }

  // THEN strip the inline comment, and only then classify.
  //
  // The version this was lifted from tested `null`/`true`/`false` BEFORE
  // stripping, so `purge_alert_id: null  # see prerequisites` came back as the
  // STRING "null" while a bare `null` came back as null. Two spellings of the
  // same value parsing to different types is the kind of defect that makes a
  // gate pass on data it should reject — a registry row claiming an alert id
  // of "null" is not the same as one claiming it has none. Comment first,
  // classify second.
  const commentIdx = v.indexOf(" #");
  const clean = commentIdx >= 0 ? v.slice(0, commentIdx).trim() : v;

  if (clean === "" || clean === "null" || clean === "~") return null;
  if (clean === "true") return true;
  if (clean === "false") return false;
  if (/^-?\d+$/.test(clean)) return parseInt(clean, 10);
  if (/^-?\d+\.\d+$/.test(clean)) return parseFloat(clean);
  return clean;
}

export type FlatMapping = Record<string, string | boolean | number | null>;

/**
 * Read `topKey:` at indent 0 and return the list of flat mappings under it.
 *
 * Accepts exactly this shape:
 *
 *   topKey:
 *     - first_field: value
 *       second_field: value
 *     - first_field: value
 *
 * Blank lines and whole-line `#` comments are skipped anywhere. The list ends
 * at the next non-blank, non-comment line at indent 0.
 *
 * Throws when the key is absent, when a field appears before the first `-`,
 * or when a value uses a block-scalar indicator this parser cannot read.
 */
export function parseFlatMappingList(
  content: string,
  topKey: string,
): FlatMapping[] {
  const lines = content.split("\n");
  const start = lines.findIndex((l) => l === `${topKey}:`);
  if (start === -1) {
    throw new Error(`minimal-yaml: top-level key "${topKey}:" not found`);
  }

  const out: FlatMapping[] = [];
  let current: FlatMapping | null = null;

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;
    if (indent === 0) break; // next top-level key ends the list

    const isItemStart = trimmed.startsWith("- ");
    const body = isItemStart ? trimmed.slice(2).trim() : trimmed;

    if (isItemStart) {
      if (current) out.push(current);
      current = {};
    }
    if (!current) {
      throw new Error(
        `minimal-yaml: field before the first list item under "${topKey}": ${trimmed}`,
      );
    }

    const colon = body.indexOf(":");
    if (colon === -1) {
      throw new Error(`minimal-yaml: expected "key: value", got: ${trimmed}`);
    }
    const key = body.slice(0, colon).trim();
    const rawValue = body.slice(colon + 1);
    if (/^\s*[|>]/.test(rawValue)) {
      throw new Error(
        `minimal-yaml: block scalars are not supported (${topKey}.${key}). ` +
          `Keep the value on one line, or add a real YAML parser with approval.`,
      );
    }
    current[key] = parseYamlScalar(rawValue);
  }

  if (current) out.push(current);
  return out;
}
