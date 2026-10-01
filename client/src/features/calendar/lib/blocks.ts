/**
 * @spec [Doc_05F_Study_Calendar, §17.1 rows, §17.2 day editor, §13 progress]
 *       [Doc_05F_formula_sheet.md §8 item 3 (scope jsonb), item 12 (enabled_block_types)]
 * @implemented [2026-09-23]
 *
 * plain English: how one block is DESCRIBED — its title, its colour family, its estimated
 * minutes, the domain chips beneath it. Expected outcome: every screen that shows a block
 * shows the same words for it, because there is one function per question.
 *
 * NOTHING HERE DECIDES ANYTHING THE SERVER DECIDES. Status, progress and the plan itself
 * arrive computed (§13, §14). These functions only format what arrived, which is why they
 * are pure and why none of them takes a `Date`.
 *
 * trade-offs: `minutesFor` takes the estimates as an ARGUMENT rather than importing a
 * constant. The two seconds-per-unit values are server-owned and travel on the payload —
 * a module-level constant here would be the literal §17 forbids, and would drift from the
 * budget the generator actually planned against.
 *
 * edge cases: a full-length block's duration is NOT derived from a per-question figure —
 * the digital SAT is a fixed-length sitting and `target_count` is the literal 1 that
 * `calendar_blocks_full_length_single` enforces. Its minutes come from the exam form, which
 * this surface does not have, so the row says the count of tests and not a duration.
 */
import {
  DOMAIN_SECTION,
  type CanonicalDomain,
  type PlanBlock,
  type PlanningEstimates,
} from "@lyceon/shared/calendar";

/** The four colour families the prototype paints. */
export type BlockTone = "math" | "rw" | "review" | "exam";

export function toneOf(
  block: Pick<PlanBlock, "block_type" | "section">,
): BlockTone {
  if (block.block_type === "review") return "review";
  if (block.block_type === "full_length") return "exam";
  return block.section === "M" ? "math" : "rw";
}

/** The human name of a section. Full words — the wire uses "M"/"RW", students do not. */
export function sectionName(section: "M" | "RW"): string {
  return section === "M" ? "Math" : "Reading & Writing";
}

/**
 * The chip label for a domain — the prototype's own abbreviations.
 *
 * @spec [Doc 05F §17.1; docs/design/calendar-prototype.html `SHORT`] | @implemented [2026-09-24]
 *
 * The canonical names are what the database stores and what the sheet's Domain select
 * offers, and they are correct there. In a chip they are not: at 11.5px in a 132px column,
 * "Problem Solving and Data Analysis 10" wraps to FOUR lines and is the least readable
 * thing on the card. The prototype has always abbreviated here (`SHORT`, line 481); the
 * build shipped the full names, which is the divergence, not the type size.
 *
 * A `Record<CanonicalDomain, string>` rather than a lookup with a fallback: a new domain is
 * then a compile error here, where someone picks the short form deliberately, instead of
 * silently rendering the long name again on one chip out of eight.
 */
const DOMAIN_CHIP: Readonly<Record<CanonicalDomain, string>> = {
  Algebra: "Algebra",
  "Advanced Math": "Adv Math",
  "Problem Solving and Data Analysis": "Data Analysis",
  "Geometry and Trigonometry": "Geo & Trig",
  "Information and Ideas": "Info & Ideas",
  "Craft and Structure": "Craft & Structure",
  "Expression of Ideas": "Expression",
  "Standard English Conventions": "Conventions",
};

export function domainChipLabel(domain: CanonicalDomain): string {
  return DOMAIN_CHIP[domain];
}

export const TONE_LABEL: Readonly<Record<BlockTone, string>> = {
  math: "Math practice",
  rw: "Reading & Writing",
  review: "Review",
  exam: "Practice test",
};

/**
 * §17.1's row title: "Math · 15 questions", "Review · 7 items", "Full-length practice test".
 */
export function titleOf(block: PlanBlock): string {
  if (block.block_type === "review") {
    return `Review · ${block.target_count} ${block.target_count === 1 ? "item" : "items"}`;
  }
  if (block.block_type === "full_length") return "Full-length practice test";
  return `${sectionName(block.section)} · ${block.target_count} ${block.target_count === 1 ? "question" : "questions"}`;
}

/**
 * The per-domain chips under a practice row. A `section`-level scope (cold start and every
 * fallback plan — formula sheet §1, owner ruling B1) has no mix and therefore no chips,
 * which is the honest rendering: the plan has not chosen domains yet.
 */
export function mixOf(block: PlanBlock): readonly {
  domain: CanonicalDomain;
  count: number;
  explanation_key: string;
}[] {
  if (block.block_type !== "practice") return [];
  if (block.scope.level !== "domain") return [];
  return block.scope.mix;
}

/**
 * The domains a block may use: the eight canonical names, filtered to the block's OWN
 * section. §17.2's Domain select must not offer a Math domain on a Reading & Writing block —
 * the database CHECK would refuse it, and offering a choice the server rejects is a trap.
 *
 * Built from the shared `DOMAIN_SECTION` map, never a local array: `scope.ts` warns that
 * `practice-topics-routes.ts` already holds a second copy of the eight in a different order,
 * and a third would be worse.
 */
export function domainsForSection(
  section: "M" | "RW",
): readonly CanonicalDomain[] {
  return (Object.keys(DOMAIN_SECTION) as CanonicalDomain[]).filter(
    (domain) => DOMAIN_SECTION[domain] === section,
  );
}

/**
 * §17.1's "~N min". Rounded to the nearest minute from the server's own seconds-per-unit.
 * Returns null for a full-length block — see the module note.
 */
export function minutesFor(
  block: PlanBlock,
  estimates: PlanningEstimates,
): number | null {
  if (block.block_type === "full_length") return null;
  const seconds =
    block.block_type === "review"
      ? estimates.review_seconds_per_unit
      : estimates.practice_seconds_per_unit;
  return Math.max(1, Math.round((block.target_count * seconds) / 60));
}

/** "~23 min", or null when there is no honest figure to give. */
export function minutesLabel(
  block: PlanBlock,
  estimates: PlanningEstimates,
): string | null {
  const minutes = minutesFor(block, estimates);
  return minutes === null ? null : `~${minutes} min`;
}

/**
 * §12.2: a block the student has LAUNCHED is protected state — it cannot be moved, edited or
 * removed, and V-12 makes the server carry it onto every later version of its date.
 *
 * Derived from `status`, which §13 computes from the allocator, rather than from `actual > 0`:
 * a launched block with no answers yet is started, and `actual` would call it untouched.
 */
export function isStarted(entry: { status: string; actual: number }): boolean {
  return (
    entry.status === "in_progress" ||
    entry.status === "partial" ||
    entry.status === "completed"
  );
}

/** A day in the past is read-only (§12.2) — nothing on it may be dragged or edited. */
export function isPastDate(date: string, today: string): boolean {
  return date < today;
}

/**
 * Whether this block may be picked up. Mirrors `calendar_move_block`'s refusals so an
 * illegal drag never leaves the pointer — the server still decides, and the client still
 * handles a refusal, because the two clocks can disagree about "today".
 */
export function isDraggable(input: {
  status: string;
  actual: number;
  date: string;
  today: string;
  readOnly: boolean;
}): boolean {
  if (input.readOnly) return false;
  if (isPastDate(input.date, input.today)) return false;
  return !isStarted({ status: input.status, actual: input.actual });
}

/** The label on the primary control of a block row (§17.1: one primary action per row). */
export function primaryActionLabel(entry: {
  status: string;
  actual: number;
}): "Start" | "Resume" | "Done" {
  if (entry.status === "completed") return "Done";
  return isStarted(entry) ? "Resume" : "Start";
}

/**
 * §15.1 + formula sheet item 12: which engines a student can actually START today.
 *
 * ONE DEFINITION. This used to exist twice — `isLaunchable` in `api/launch.ts` for the
 * launch path, and a hand-written `block.block_type === "practice"` in `view-model.ts` for
 * the button. They agreed by coincidence, and the moment review shipped the launch path
 * accepted it while the view model still drew "Coming soon" on it. It lives here, next to
 * `isDraggable`, because this is where block rules live.
 *
 * It is about the ENGINE being real, not about `enabled_block_types`. The flag decides
 * whether a review block is ever PLANNED; this decides whether one the student already
 * holds — from a hand-edited day, say — can be started. Since E9b (2026-09-25) all three
 * engines are real — the full-length adapter replaced its fail-open stub — so every block
 * type is launchable. The function stays the one place the rule lives: the next engine to
 * arrive as a stub makes it false again here, and the "Coming soon" branch returns with it.
 */
export function isLaunchableBlockType(
  blockType: PlanBlock["block_type"],
): boolean {
  return (
    blockType === "practice" ||
    blockType === "review" ||
    blockType === "full_length"
  );
}
