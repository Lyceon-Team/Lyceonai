/**
 * The review record's rules (Doc 10B §8.7), as pure functions.
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §4 stage 5, §8.7 ("One review record per cycle … written in
 *       order: Claude's self-audit, Codex's audit with a verdict per item (APPROVE, REVISE or
 *       REJECT, each with reasons and evidence), Claude's response to each finding, then Karl's
 *       decision"; "Codex audits, it doesn't edit"; "One revision round"); owner brief "Doc 10B
 *       Phase 1" (Karl, 2026-10-11) scope 2 ("a CI check that a batch PR can't be marked ready
 *       without the Codex section and a Claude response to every REVISE"); owner answer on Step 0,
 *       item 3 ("Codex posts its audit as a PR comment, and Claude's revise step copies it verbatim
 *       into REVIEW.md, marked as Codex's")] | @implemented [2026-10-11]
 *
 * Section 1 amended by SCL-229 (Karl's ruling, 2026-10-13: "Claude's self-audit is private"): it is
 * a structural record only, one row per item built by ./production-record.ts, ending "Passed
 * internal audit.", with no findings, reasoning or doubts. The heading text is kept so records on
 * branches that predate the ruling still parse.
 *
 * plain English: `reviewRecordProblems` reads content/batches/<cycle>/REVIEW.md (the four headings
 * of content/batches/REVIEW.template.md, in order, each with one table) against the items the
 * batch actually carries. A draft pull request needs only section 1, which must match what the
 * cycle produced cell for cell and hold nothing but its table. A pull request marked
 * READY also needs: a Codex verdict for every item, with reasons and evidence; a Claude response
 * for every REVISE and REJECT; no REJECTed item left in the batch; and an item answered "Carried"
 * or "Dropped" gone from it. `codexCommitProblems` holds a commit marked `Audit-By: Codex` to the
 * Codex section of review records and nothing else. `copiedCommentProblems` checks a section
 * copied from Codex's pull request comment matches the comment.
 */
import {
  PASSED_INTERNAL_AUDIT,
  PRODUCTION_HEADER,
  type ProductionItem,
} from "./production-record";

export const REVIEW_HEADINGS = [
  "## 1. Claude self-audit",
  "## 2. Codex audit",
  "## 3. Claude response",
  "## 4. Karl decision",
] as const;

export const VERDICTS = ["APPROVE", "REVISE", "REJECT"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** A table row's cells, trimmed, without the outer pipes. */
type Row = string[];

/** The text under each heading (up to the next `## `), or null when the heading is missing. */
export function reviewSections(text: string): (string | null)[] {
  const lines = text.split("\n");
  return REVIEW_HEADINGS.map((heading) => {
    const start = lines.findIndex((l) => l.trim() === heading);
    if (start === -1) return null;
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => l.startsWith("## "));
    return (end === -1 ? rest : rest.slice(0, end)).join("\n");
  });
}

/**
 * The body rows of the first table in a section (header and separator skipped). A pipe escaped
 * as `\|` (as in a page title, "… | Lyceon") stays inside its cell, unescaped.
 */
export function tableRows(section: string): Row[] {
  const rows = section
    .split("\n")
    .filter((l) => l.trim().startsWith("|"))
    .map((l) =>
      l
        .trim()
        .replace(/^\|/, "")
        .replace(/(?<!\\)\|$/, "")
        .split(/(?<!\\)\|/)
        .map((c) => c.replace(/\\\|/g, "|").trim()),
    );
  return rows.slice(2);
}

/** `` `slug` `` → `slug`. */
export function itemOf(cell: string | undefined): string {
  return (cell ?? "").replace(/^`|`$/g, "").trim();
}

const PLACEHOLDER =
  /^(slug|why\.|source url and quoted text\.|the finding\.|fixed: what changed\.)$/i;
const filled = (cell: string | undefined): boolean =>
  (cell ?? "").trim().length > 0 && !PLACEHOLDER.test((cell ?? "").trim());

export type ReviewContext = {
  /** What the cycle carries now (./production-record.ts `cycleProduction`): one per item. */
  production: readonly ProductionItem[];
  /** The pull request is marked ready for review (not a draft). */
  ready: boolean;
};

export function reviewRecordProblems(
  text: string,
  ctx: ReviewContext,
): string[] {
  const problems: string[] = [];
  const sections = reviewSections(text);
  REVIEW_HEADINGS.forEach((heading, i) => {
    if (sections[i] === null) problems.push(`missing the heading "${heading}"`);
  });
  const positions = REVIEW_HEADINGS.map((h) =>
    text.split("\n").findIndex((l) => l.trim() === h),
  );
  if (
    positions.every((p) => p >= 0) &&
    positions.some((p, i) => i > 0 && p < (positions[i - 1] ?? 0))
  ) {
    problems.push(
      "the four sections are out of order (self-audit, Codex audit, Claude response, Karl decision)",
    );
  }
  const [selfAudit, codex, response] = sections;
  const items = ctx.production.map((p) => p.item);

  problems.push(...productionRecordProblems(selfAudit ?? "", ctx.production));
  if (!ctx.ready) return problems;

  // Ready: the Codex section, with a verdict per item.
  const source = /^Source:\s*(.+)$/m.exec(codex ?? "")?.[1]?.trim() ?? "";
  if (!/Codex/.test(source) || /YYYY-MM-DD/.test(source)) {
    problems.push(
      "the Codex audit has no Source line naming Codex and a date (it has not been written)",
    );
  }
  const codexRows = tableRows(codex ?? "").filter(
    (r) => itemOf(r[0]) !== "slug",
  );
  const verdicts = new Map<string, Verdict>();
  for (const row of codexRows) {
    const item = itemOf(row[0]);
    const verdict = (row[1] ?? "").trim();
    if (!(VERDICTS as readonly string[]).includes(verdict)) {
      problems.push(
        `Codex verdict for ${item} is "${verdict}" (APPROVE, REVISE or REJECT)`,
      );
      continue;
    }
    if (!filled(row[2]) || !filled(row[3]))
      problems.push(`Codex verdict for ${item} has no reasons or no evidence`);
    if (verdicts.has(item))
      problems.push(`Codex gives ${item} more than one verdict`);
    verdicts.set(item, verdict as Verdict);
  }
  for (const item of items) {
    if (!verdicts.has(item))
      problems.push(`the Codex audit has no verdict for ${item}`);
  }

  // Ready: a Claude response to every REVISE and REJECT; the one-round rule.
  const responses = new Map(
    tableRows(response ?? "")
      .filter((r) => itemOf(r[0]) !== "slug")
      .map((r) => [itemOf(r[0]), (r[2] ?? "").trim()] as const),
  );
  for (const [item, verdict] of verdicts) {
    if (verdict === "APPROVE") continue;
    const answer = responses.get(item);
    if (answer === undefined || !filled(answer)) {
      problems.push(`no Claude response to the Codex ${verdict} of ${item}`);
      continue;
    }
    const inBatch = items.includes(item);
    if (verdict === "REJECT" && inBatch)
      problems.push(`${item} was REJECTed but is still in the batch`);
    if (/^(Carried|Dropped)\b/i.test(answer) && inBatch) {
      problems.push(
        `${item} is answered "${answer.split(/[.:]/)[0]}" but is still in the batch`,
      );
    }
  }
  return problems;
}

/** The text outside HTML comments, line by line. */
function uncommentedLines(section: string): string[] {
  return section.replace(/<!--[\s\S]*?-->/g, "").split("\n");
}

const squashSpaces = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * Section 1 is the production table and nothing else (SCL-229): its header, one row per item the
 * cycle carries, every cell equal to what was produced, the sources cell holding only the cited
 * URLs, and the last cell "Passed internal audit.". Any other line, such as a finding, a note or
 * a doubt, is refused.
 */
export function productionRecordProblems(
  section: string,
  production: readonly ProductionItem[],
): string[] {
  const problems: string[] = [];
  const lines = uncommentedLines(section).map((l) => l.trim());
  for (const line of lines) {
    if (line === "" || line.startsWith("|")) continue;
    problems.push(
      `section 1 holds only the production table (SCL-229); remove "${line.slice(0, 60)}"`,
    );
  }
  const header = lines.find((l) => l.startsWith("|"));
  if (
    header !== undefined &&
    squashSpaces(header) !== squashSpaces(PRODUCTION_HEADER[0])
  ) {
    problems.push(
      `section 1's table header is "${header}", not "${PRODUCTION_HEADER[0]}"`,
    );
  }
  const rows = tableRows(section);
  const expected = new Map(production.map((p) => [p.item, p]));
  const seen = new Set<string>();
  for (const row of rows) {
    const item = itemOf(row[0]);
    const want = expected.get(item);
    if (want === undefined) {
      problems.push(
        `section 1 has a row for ${item}, which the cycle does not carry`,
      );
      continue;
    }
    if (seen.has(item))
      problems.push(`section 1 has more than one row for ${item}`);
    seen.add(item);
    if (row.length !== PRODUCTION_HEADER[0].split("|").length - 2) {
      problems.push(
        `section 1's row for ${item} has ${row.length} cells, not 6`,
      );
      continue;
    }
    const [, title, publishes, keyword, sources, audit] = row;
    const cell = (
      name: string,
      got: string | undefined,
      wanted: string,
    ): void => {
      if ((got ?? "") !== wanted)
        problems.push(
          `section 1's ${name} for ${item} is "${got ?? ""}", not "${wanted}"`,
        );
    };
    cell("title", title, want.title);
    cell("publish time", publishes, want.publishes);
    cell("target keyword", keyword, want.keyword);
    cell("audit cell", audit, PASSED_INTERNAL_AUDIT);
    const tokens = (sources ?? "").split(/\s+/).filter(Boolean);
    const urls = tokens.map((t) => t.replace(/^<(.*)>$/, "$1"));
    const stray = urls.filter((u) => !/^https:\/\/\S+$/.test(u));
    if (stray.length > 0) {
      problems.push(
        `section 1's sources for ${item} hold only links; remove "${stray.join(" ").slice(0, 60)}"`,
      );
    }
    const got = [...new Set(urls.filter((u) => !stray.includes(u)))].sort();
    if (got.join(" ") !== [...want.sources].join(" ")) {
      problems.push(
        `section 1's sources for ${item} are not the ${want.sources.length} it cites: ${want.sources.join(", ")}`,
      );
    }
  }
  for (const p of production) {
    if (!seen.has(p.item)) problems.push(`section 1 has no row for ${p.item}`);
  }
  return problems;
}

/** A commit marked `Audit-By: Codex` may change only the Codex section of review records. */
export function codexCommitProblems(
  changes: readonly { path: string; before: string; after: string }[],
): string[] {
  const problems: string[] = [];
  for (const { path, before, after } of changes) {
    if (!/^content\/batches\/[^/]+\/REVIEW\.md$/.test(path)) {
      problems.push(
        `a Codex audit commit changed ${path}; Codex writes only its section of the review record`,
      );
      continue;
    }
    const withoutCodex = (text: string): string => {
      const s = reviewSections(text);
      return [s[0], s[2], s[3], text.split("## 1. Claude self-audit")[0]].join(
        "\n---\n",
      );
    };
    if (withoutCodex(before) !== withoutCodex(after)) {
      problems.push(
        `a Codex audit commit changed ${path} outside "## 2. Codex audit"`,
      );
    }
  }
  return problems;
}

const squash = (s: string): string => s.replace(/\s+/g, " ").trim();

/** A Codex section copied from Codex's PR comment: every verdict row must appear in the comment. */
export function copiedCommentProblems(
  codexSection: string,
  commentBody: string,
): string[] {
  const comment = squash(commentBody);
  return tableRows(codexSection)
    .filter((r) => itemOf(r[0]) !== "slug")
    .filter((r) => !comment.includes(squash(r.slice(1).join(" | "))))
    .map(
      (r) =>
        `the Codex row for ${itemOf(r[0])} is not in Codex's comment verbatim`,
    );
}
