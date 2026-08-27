import {
  buildDomainLevelView,
  buildSkillLevelView,
  fetchDomainMasteryRows,
  fetchSkillMasteryRows,
} from "./mastery-read";
import { loadMasteryLevels } from "./mastery-levels-read";
import { fetchSkillCatalog } from "./skill-catalog-read";
import {
  masterySectionSchema,
  type MasteryDomainNode,
  type MasterySection,
  type MasterySkillNode,
} from "../../../../packages/shared/src/mastery-levels";

/**
 * @spec [owner standing rule 2026-08-21 — "every mastery and KPI path a guardian sees is a
 *   direct read of the student path, gated by authorization. There is exactly one
 *   derivation, one query, one DTO, one shape."; Doc 05 Parent AC#19 + owner ruling
 *   2026-08-20 RULE 7 — guardians get domain grain only, no skill drill-down]
 * | @implemented [2026-08-21]
 *
 * plain English: the ONE place a mastery read is composed. The student route and the
 * guardian route both call `readDomainMasteryView`. Neither builds the view itself.
 *
 * WHY THIS FILE EXISTS.
 *   Before it, both routes reached for the same three primitives — `loadMasteryLevels`,
 *   `fetchDomainMasteryRows`, `buildDomainLevelView` — and composed them separately. Shared
 *   primitives are not a shared path: the ORCHESTRATION was duplicated, so a change to the
 *   student's shape (a new field, a different narrowing, an added filter) would leave the
 *   guardian behind, silently, with both suites green. That is the parallel-paths-built-
 *   differently pattern that produced `GuardianWeaknessResponse` claiming `skills` while the
 *   route returned `domains`, and it crashed for every guardian whose student had rows.
 *
 *   With one function there is nothing to diverge from. The only guardian-specific logic
 *   left in the guardian route is the GATE — auth, link-active, entitlement-active, audit
 *   emission — which is what the rule says it should be.
 *
 * WHY THE SCOPE NARROWING IS A PARAMETER, NOT A SECOND IMPLEMENTATION.
 *   Guardians see domain grain and no drill-down. That is expressed by the guardian route
 *   simply never calling `readSkillPanelView` — there is no guardian skill endpoint to call
 *   it from. The narrowing is the absence of a call, not a different derivation.
 *
 * expected outcome: identical `domains` payloads for the same student, whoever asked.
 * trade-offs: the guardian route can no longer shape its own response. That is the point.
 * edge cases: every failure mode belongs to the primitives — a failed read throws, an
 * unlabelled level throws. Nothing here converts either into an empty list.
 */

export type SectionParseResult =
  | { ok: true; section: MasterySection | undefined }
  | { ok: false; details: unknown };

/**
 * The `?section=` filter, parsed once for both routes. Returning a Result rather than
 * throwing keeps the 400 in the route layer, where the response shape lives.
 */
export function parseSectionFilter(value: unknown): SectionParseResult {
  const parsed = masterySectionSchema.optional().safeParse(value);
  if (!parsed.success) {
    return { ok: false, details: parsed.error.flatten() };
  }
  return { ok: true, section: parsed.data };
}

export type DomainMasteryView = {
  domains: MasteryDomainNode[];
};

/**
 * Every canonical domain for one student, each carrying its level and the name of that
 * level. `studentId` is whose data is read; WHO IS ASKING is not this function's business,
 * which is exactly why both callers can share it.
 */
export async function readDomainMasteryView(args: {
  studentId: string;
  section?: MasterySection | undefined;
}): Promise<DomainMasteryView> {
  const [labels, domainRows] = await Promise.all([
    loadMasteryLevels(),
    fetchDomainMasteryRows({
      userId: args.studentId,
      section: args.section,
    }),
  ]);

  return {
    domains: buildDomainLevelView(
      domainRows,
      labels,
      args.section ? { section: args.section } : {},
    ),
  };
}

export type SkillCatalogView = {
  catalogEmpty: boolean;
  skills: MasterySkillNode[];
};

/**
 * EVERY skill the question bank publishes, for one student, in one read — FLAT.
 *
 * This replaced `readSkillPanelView(studentId, section, domain)` on 2026-08-27 (owner
 * ruling, PR 2). Doc 05B §10.3 names the resource `/api/students/{student_id}/mastery/skills`
 * with no path or query segment, and §10.7 bounds it at ~80 rows and says presentation
 * belongs to "the API surface doc that wraps these routes — not in 05B's table contract".
 * The drill-down filters by domain in the CLIENT, from this one fetch, so a student opening
 * three domains makes one request rather than three.
 *
 * STUDENT GRAIN. Doc 05A :73 — "Guardians have NO SELECT policy on student_skill_mastery,
 * so guardian queries return zero rows regardless of column projection." The route, not this
 * function, applies §10.4's empty-list semantics for a guardian caller; this function has no
 * idea who is asking, which is why it can be shared.
 *
 * `catalogEmpty` reports on the QUESTION BANK, not on the student, and is distinct from an
 * empty `skills` array. A failed read THROWS before reaching here.
 */
export async function readSkillCatalogView(args: {
  studentId: string;
}): Promise<SkillCatalogView> {
  const [labels, catalog, skillRows] = await Promise.all([
    loadMasteryLevels(),
    fetchSkillCatalog(),
    fetchSkillMasteryRows({ userId: args.studentId }),
  ]);

  return {
    catalogEmpty: catalog.length === 0,
    skills: buildSkillLevelView(catalog, skillRows, labels),
  };
}
