/**
 * @spec [Doc 05B §10.3 single-route contract (the six 05B resources); Doc 05C §10.2
 *   (projections, "mirrors 05B §10.3"); Doc 05B §10.4 empty-list semantics; §10.5 column
 *   projection (mastery_level only); §10.7 no pagination; owner ruling 2026-08-27 PR 2
 *   (FLAT /mastery/skills; the route list built here)] | @implemented [2026-08-27]
 *
 * plain English: the subject-scoped resource contract. Paths and response shapes live in ONE
 * place so the server serialises and the client parses the same definition — a client type
 * that matches no server response is a wish, and eleven hand-written guardian types produced
 * the `GuardianWeaknessResponse` crash.
 *
 * THE PATHS ARE CONSTANTS FOR A REASON. Doc 05C §10.2 spells the projection resources
 * `/projection/sections`, `/projection/total` and `/projection/history`; the owner's PR 2
 * build list names `/projections/sections` and `/projections/snapshots`, and omits
 * `/kpi/skills` and `/projection/total`, which §10.3 and §10.2 do name. This module builds
 * the owner's list — see owner question 1 in the PR — and centralises the strings so that
 * reconciling the two is a one-line change here rather than a sweep through routes, client
 * and tests.
 *
 * THERE IS NO GUARDIAN SHAPE. One response per resource; a guardian receives the student's
 * response. The only guardian-specific behaviour in the whole contract is that
 * `/mastery/skills` returns an empty list for `via='guardian'`, and that is Doc 05B §10.4's
 * specified denial-by-absence-of-policy, not a different shape.
 */
import { z } from "zod";
import { masterySectionSchema } from "./mastery-levels.js";

/** Mounted at this prefix; every path below is relative to `${STUDENT_RESOURCE_MOUNT}/:studentId`. */
export const STUDENT_RESOURCE_MOUNT = "/api/students";

export const STUDENT_RESOURCE_PATHS = {
  masteryDomains: "/mastery/domains",
  masterySkills: "/mastery/skills",
  kpiSections: "/kpi/sections",
  kpiDomains: "/kpi/domains",
  kpiOverall: "/kpi/overall",
  projectionsSections: "/projections/sections",
  projectionsSnapshots: "/projections/snapshots",
} as const;

export type StudentResourceKey = keyof typeof STUDENT_RESOURCE_PATHS;

/**
 * @spec [Doc 01 V8 §36.1 Initiation; owner ruling 2026-08-27 Q3 — link actions mount on the
 *   subject-scoped topology behind the PR 1 resolver, requiring `via === 'self'`]
 *
 * LINK-LIFECYCLE ACTIONS. Mutations, not resources, so they are a separate table from
 * `STUDENT_RESOURCE_PATHS` and carry no response schema alongside — but they share the mount,
 * and therefore the ONE resolver, deliberately.
 *
 * WHY NOT `/api/me/links`. A second router with its own auth convention is how this vertical
 * acquired the privilege divergences the resolver exists to remove, and `/api/me/*` is the
 * convention PR 2 deleted. `via` is already the single sanctioned branch, resolved ABOVE the
 * handler rather than tested as a role inside it (owner ruling Q3).
 */
export const STUDENT_LINK_PATHS = {
  /** §36.1 step 1, student-initiated — the student invites a guardian by email. */
  linkInitiate: "/links",
  /** The student half of §36.1 step 5 — accepting a link a guardian initiated. */
  linkAccept: "/links/:linkId/accept",
} as const;

export type StudentLinkPathKey = keyof typeof STUDENT_LINK_PATHS;

/** Full client-side path for initiating a link, e.g. `/api/students/<id>/links`. */
export function studentLinkInitiateUrl(studentId: string): string {
  return `${STUDENT_RESOURCE_MOUNT}/${encodeURIComponent(studentId)}/links`;
}

/** Full client-side path, e.g. `/api/students/<id>/links/<linkId>/accept`. */
export function studentLinkAcceptUrl(
  studentId: string,
  linkId: string,
): string {
  return `${STUDENT_RESOURCE_MOUNT}/${encodeURIComponent(studentId)}/links/${encodeURIComponent(linkId)}/accept`;
}

/** Full client-side path for a resource, e.g. `/api/students/<id>/kpi/overall`. */
export function studentResourceUrl(
  studentId: string,
  key: StudentResourceKey,
): string {
  return `${STUDENT_RESOURCE_MOUNT}/${encodeURIComponent(studentId)}${STUDENT_RESOURCE_PATHS[key]}`;
}

// ---------------------------------------------------------------------------
// Mastery — the canonical node and response schemas live in ./mastery-levels.js and are
// re-exported here so a consumer of this contract has one import. They are NOT redefined:
// a second definition of `masterySkillNodeSchema` was written here and tsc's ambiguous
// re-export error caught it, which is the same forking CLAUDE.md forbids.
// ---------------------------------------------------------------------------

export {
  masteryDomainNodeSchema,
  masterySkillNodeSchema,
  masteryDomainsResponseSchema,
  masterySkillsResponseSchema,
} from "./mastery-levels.js";
export type {
  MasteryDomainNode,
  MasterySkillNode,
  MasteryDomainsResponse,
  MasterySkillsResponse,
  MasterySection,
  MasteryLevelKey,
} from "./mastery-levels.js";

// ---------------------------------------------------------------------------
// KPI rollups — the granted columns of §6.7 and nothing else.
// ---------------------------------------------------------------------------

/** Accuracy crosses as an integer percent or null; `null` means "no events", never zero. */
const accuracyPercentSchema = z.number().int().min(0).max(100).nullable();

export const sectionKpiSchema = z.object({
  section: masterySectionSchema,
  eventsTotal: z.number().int().min(0),
  accuracyPct: accuracyPercentSchema,
  currentStreakDays: z.number().int().min(0),
  lastActiveAt: z.string().nullable(),
});
export type SectionKpiDto = z.infer<typeof sectionKpiSchema>;

export const domainKpiSchema = z.object({
  section: masterySectionSchema,
  domain: z.string().min(1),
  eventsTotal: z.number().int().min(0),
  accuracyPct: accuracyPercentSchema,
  lastActiveAt: z.string().nullable(),
});
export type DomainKpiDto = z.infer<typeof domainKpiSchema>;

export const sectionKpiResponseSchema = z.object({
  sections: z.array(sectionKpiSchema),
  requestId: z.string().optional(),
});
export type SectionKpiResponse = z.infer<typeof sectionKpiResponseSchema>;

export const domainKpiResponseSchema = z.object({
  domains: z.array(domainKpiSchema),
  requestId: z.string().optional(),
});
export type DomainKpiResponse = z.infer<typeof domainKpiResponseSchema>;

// ---------------------------------------------------------------------------
// Projections — the band, never the blend anchors (Doc 05C §10.5).
// ---------------------------------------------------------------------------

export const sectionProjectionSchema = z.object({
  section: masterySectionSchema,
  projectedScoreMid: z.number().int().nullable(),
  projectedScoreLow: z.number().int().nullable(),
  projectedScoreHigh: z.number().int().nullable(),
  relevantQuestionCount: z.number().int().min(0).nullable(),
  computedAt: z.string().nullable(),
});
export type SectionProjectionDto = z.infer<typeof sectionProjectionSchema>;

export const projectionSnapshotSchema = sectionProjectionSchema
  .omit({ computedAt: true })
  .extend({
    snapshotAt: z.string(),
    snapshotKind: z.string(),
  });
export type ProjectionSnapshotDto = z.infer<typeof projectionSnapshotSchema>;

export const sectionProjectionsResponseSchema = z.object({
  sections: z.array(sectionProjectionSchema),
  requestId: z.string().optional(),
});
export type SectionProjectionsResponse = z.infer<
  typeof sectionProjectionsResponseSchema
>;

export const projectionSnapshotsResponseSchema = z.object({
  snapshots: z.array(projectionSnapshotSchema),
  requestId: z.string().optional(),
});
export type ProjectionSnapshotsResponse = z.infer<
  typeof projectionSnapshotsResponseSchema
>;
