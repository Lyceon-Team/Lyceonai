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
  /**
   * Doc 05F §16 as amended by the formula sheet §8 item 14: the guardian calendar read is
   * `/api/students/:studentId/calendar` through the existing subject resolver, NOT a
   * `/api/guardian/…` path. The student's own rich surface is `GET /api/calendar`; this one
   * serves the narrow `{ days, facts, streak }` projection to whoever the resolver admits,
   * student and guardian alike, because a route that cannot tell them apart cannot give
   * them different answers.
   */
  calendar: "/calendar",
} as const;

export type StudentResourceKey = keyof typeof STUDENT_RESOURCE_PATHS;

/**
 * @spec [Doc-04C §12 as amended by SCL-181; Doc 04 Parent Q9 as amended by SCL-180]
 *   | @implemented [2026-09-27]
 *
 * G1 — a linked guardian reads a student's full-length exam results on this mount, behind
 * the same resolver, rather than at 04C §12.1's `/api/guardian/students/…` (SCL-181). A
 * sibling of `STUDENT_RESOURCE_PATHS`, not a member: `testReport` carries a second path
 * parameter, and every loop over the resource table calls each path verbatim. The shapes
 * live in `exam-guardian-report-schema.ts`; like the calendar, one narrow payload is served
 * to whoever the resolver admits — the student's full report stays at `/api/tests/…`.
 */
export const STUDENT_EXAM_PATHS = {
  tests: "/tests",
  testReport: "/tests/:sessionId/report",
} as const;

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
  /**
   * SCL-080 — the student's own link code, for display. Replaces `linkInitiate`
   * (`/links`, "the student invites a guardian by email"): under the code flow the student
   * publishes a credential rather than addressing an invitation to anyone.
   */
  linkCode: "/link-code",
  /** SCL-080 — the student invalidates the current code and receives a new one. */
  linkCodeRegenerate: "/link-code/regenerate",
  /** §36.3 — "either party" ends an active link; this is the student's half. */
  linkRevoke: "/links/:linkId",
  /**
   * §36.3 — the student's ACTIVE guardian links, so the "Remove guardian" control has a
   * link id to address. Identity only (Doc 01 §38.1 in reverse: the student learns who is
   * linked, nothing about the guardian beyond their display name).
   */
  links: "/links",
  /**
   * Guardian invite by email (2026-09-15). The CURRENT code travels by email with a deep
   * link to the redeem page; nothing about redeeming changes. A direct send, not an event.
   */
  linkCodeInvite: "/link-code/invite",
} as const;

/** One active guardian link as the student sees it. Display name and dates only. */
export const studentGuardianLinkViewSchema = z.object({
  link_id: z.string().min(1),
  guardian_display_name: z.string(),
  linked_at: z.string(),
});
export type StudentGuardianLinkView = z.infer<
  typeof studentGuardianLinkViewSchema
>;
export const studentGuardianLinksViewSchema = z.object({
  links: z.array(studentGuardianLinkViewSchema),
});
export type StudentGuardianLinksView = z.infer<
  typeof studentGuardianLinksViewSchema
>;

/** Full client-side path for the student's active links, e.g. `/api/students/<id>/links`. */
export function studentLinksUrl(studentId: string): string {
  return `${STUDENT_RESOURCE_MOUNT}/${encodeURIComponent(studentId)}/links`;
}

/** Full client-side path for inviting a guardian by email, e.g. `/api/students/<id>/link-code/invite`. */
export function studentLinkCodeInviteUrl(studentId: string): string {
  return `${STUDENT_RESOURCE_MOUNT}/${encodeURIComponent(studentId)}/link-code/invite`;
}

/** Full client-side path for the student's own code, e.g. `/api/students/<id>/link-code`. */
export function studentLinkCodeUrl(studentId: string): string {
  return `${STUDENT_RESOURCE_MOUNT}/${encodeURIComponent(studentId)}/link-code`;
}

/** Full client-side path for regenerating, e.g. `/api/students/<id>/link-code/regenerate`. */
export function studentLinkCodeRegenerateUrl(studentId: string): string {
  return `${STUDENT_RESOURCE_MOUNT}/${encodeURIComponent(studentId)}/link-code/regenerate`;
}

/** Full client-side path for revoking, e.g. `/api/students/<id>/links/<linkId>`. */
export function studentLinkRevokeUrl(
  studentId: string,
  linkId: string,
): string {
  return `${STUDENT_RESOURCE_MOUNT}/${encodeURIComponent(studentId)}/links/${encodeURIComponent(linkId)}`;
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

// ---------------------------------------------------------------------------
// kpi/overall — two audiences, two shapes (G3-01, SCL-188).
// ---------------------------------------------------------------------------

/**
 * @spec [Doc 05B §10 as amended by SCL-188; Guardian_Closure_Plan G3-01, owner ruling R3]
 *   | @implemented [2026-09-30]
 *
 * plain English: the one schema for `GET /api/students/:studentId/kpi/overall`. The student
 * gets the full KPI view (`studentKpiOverallSchema`); a linked guardian gets the streak and
 * nothing else (`guardianKpiOverallSchema`). The server's `StudentKpiView` is inferred from
 * this schema; there is no second definition.
 *
 * TWO POSTURES, ONE PER AUDIENCE (owner ruling 2026-09-30, #994):
 *   - GUARDIAN: `.strict()`. A counter added to the guardian branch fails the server's own
 *     parse — a 500 — instead of reaching a parent's screen. A leak is worse than an outage.
 *   - STUDENT: Zod's default STRIP, at every depth. An unknown key is dropped (and the server
 *     logs it once, `toStudentKpiOverallWire`), so a field added to the builder without a schema
 *     update cannot 500 a student's own dashboard. What catches that field is CI, not
 *     production: the wire-contract test asserts the parse is the identity on real route
 *     output (`parse(body)` deep-equals `body`), which fails the moment anything is stripped.
 */
export const kpiExplanationSchema = z.object({
  ruleId: z.string(),
  whatThisMeans: z.string(),
  whyThisChanged: z.string(),
  whatToDoNext: z.string(),
});
export type KpiExplanation = z.infer<typeof kpiExplanationSchema>;

export const explainedKpiMetricSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["official", "weighted", "diagnostic"]),
  unit: z.enum(["count", "percent", "minutes", "seconds", "score"]),
  value: z.number().nullable(),
  explanation: kpiExplanationSchema,
});
export type ExplainedKpiMetric = z.infer<typeof explainedKpiMetricSchema>;

export const studentKpiOverallSchema = z.object({
  modelVersion: z.string(),
  timezone: z.string(),
  week: z.object({
    questionsSolved: z.number().int().min(0),
    accuracy: accuracyPercentSchema,
    explanations: z.record(kpiExplanationSchema),
  }),
  recency: z
    .object({
      window: z.number().int().positive(),
      totalAttempts: z.number().int().min(0),
      accuracy: accuracyPercentSchema,
      explanations: z.record(kpiExplanationSchema),
    })
    .nullable(),
  metrics: z.array(explainedKpiMetricSchema),
  gating: z.object({
    historicalTrends: z.object({
      allowed: z.boolean(),
      requiredPlan: z.literal("paid"),
      reason: z.string(),
    }),
  }),
  measurementModel: z.object({
    official: z.array(z.string()),
    weighted: z.array(z.string()),
    diagnostic: z.array(z.string()),
  }),
});
export type StudentKpiOverall = z.infer<typeof studentKpiOverallSchema>;

/** R3: the streak, and nothing about how many questions or how many were right. */
export const guardianKpiOverallSchema = z
  .object({ currentStreakDays: z.number().int().min(0) })
  .strict();
export type GuardianKpiOverall = z.infer<typeof guardianKpiOverallSchema>;

/** The wire envelopes, as `resource()` sends them: `{ ok: true, ...body, requestId }`. */
const kpiEnvelope = { ok: z.literal(true), requestId: z.string().optional() };
export const studentKpiOverallResponseSchema =
  studentKpiOverallSchema.extend(kpiEnvelope);
export const guardianKpiOverallResponseSchema =
  guardianKpiOverallSchema.extend(kpiEnvelope);
export type GuardianKpiOverallResponse = z.infer<
  typeof guardianKpiOverallResponseSchema
>;
