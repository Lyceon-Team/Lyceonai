/**
 * @spec [Doc 05B §10.3 single-route contract + RB-05B-V1-05 (no role branching in handlers),
 *   §10.4 empty-list semantics, §10.5 column projection, §10.7 no pagination; Doc 05C §10.2;
 *   Doc 05 Parent AC#19/#20; owner rulings 2026-08-26 R3/R5/R6 and 2026-08-27 OQ1/OQ3/OQ4
 *   and the PR 2 build list] | @implemented [2026-08-27]
 *
 * plain English: the subject-scoped resources. ONE route per resource, served to the student
 * and to a linked guardian by the same handler. Nothing below `resolveSubject` knows who is
 * calling — every handler reads `req.subject.studentId` and nothing else about the caller.
 *
 * WHY THIS REPLACES FOUR SEPARATE FAMILIES. The retired student mastery routes, the guardian
 * weaknesses route and the guardian summary each served a resource that also had a student
 * twin (see scripts/ci/retired-endpoints-gate.mjs for the full list), and every
 * collapse of such a twin in this vertical has produced a privilege divergence: a hardcoded
 * `includeHistoricalTrends = true`, a `reportAvailable` with no entitlement term, and a
 * metric allowlist that gave the guardian of a PAYING student less than the student. Three
 * for three. One route cannot disagree with itself.
 *
 * THE ONE PERMITTED ROLE-AWARE BRANCH IS ABOVE THE HANDLERS. RB-05B-V1-05 allows exactly one
 * — the path-layer authorization check — and `resolveSubject` is it. `/mastery/skills` reads
 * `req.subject.via` to apply §10.4's empty list, and that value was decided by the resolver,
 * not re-derived here. `scripts/ci/subject-resolver-chokepoint-gate.mjs` fails the build if
 * any handler in this file references the caller's role or a guardian link table.
 */
import { Router, type Request, type Response } from "express";
import {
  STUDENT_RESOURCE_PATHS,
  type MasterySection,
} from "../../packages/shared/src/index";
import { masterySectionSchema } from "../../packages/shared/src/mastery-levels";
import { readDomainMasteryView, readSkillCatalogView } from "../../apps/api/src/services/mastery-view";
import { readDomainKpi, readSectionKpi } from "../../apps/api/src/services/kpi-rollup-read";
import {
  readProjectionSnapshots,
  readSectionProjections,
} from "../../apps/api/src/services/projection-read";
import { buildStudentKpiViewFromCanonical } from "../services/canonical-runtime-views";
import { resolveHistoricalTrendsAccess } from "../services/kpi-access";
import { EntitlementService } from "../services/entitlement-service";
import { logger } from "../logger";
import { resolveSubject } from "../middleware/subject-resolver";

const router = Router({ mergeParams: true });

/**
 * PER-RESOURCE ENTITLEMENT POSTURE, IN ONE TABLE.
 *
 * Each entry preserves EXACTLY what the route it replaces did, so this PR moves the topology
 * without also changing who can see what:
 *   - mastery/*      402 unless the subject's entitlement is active (what the retired student
 *                    mastery routes did via `ensurePremiumMasteryAccess`)
 *   - kpi/*          served to everyone; `/kpi/overall` carries its own `gating.historicalTrends`
 *                    block, which is how a reader tells WITHHELD from zero
 *   - projections/*  served to everyone; the paid/unpaid split is inside the payload
 *
 * THERE IS A KNOWN ASYMMETRY HERE AND IT IS NOT MINE TO SETTLE — see owner question 2.
 * `guardian_view_decision` requires an active student entitlement for EVERY resource, so a
 * free student sees their own `/kpi/overall` while their guardian gets 402 for the same
 * student. Making the gate uniform would fix the asymmetry and would also take
 * `/kpi/overall` away from free students, which is a product decision. Changing it is one
 * edit to this table.
 */
const REQUIRES_ACTIVE_ENTITLEMENT: Record<string, boolean> = {
  [STUDENT_RESOURCE_PATHS.masteryDomains]: true,
  [STUDENT_RESOURCE_PATHS.masterySkills]: true,
  [STUDENT_RESOURCE_PATHS.kpiSections]: false,
  [STUDENT_RESOURCE_PATHS.kpiDomains]: false,
  [STUDENT_RESOURCE_PATHS.kpiOverall]: false,
  [STUDENT_RESOURCE_PATHS.projectionsSections]: false,
  [STUDENT_RESOURCE_PATHS.projectionsSnapshots]: false,
};

/** `req.subject` is set by the resolver; reaching a handler without it is a wiring bug. */
function requireSubject(req: Request, res: Response): { studentId: string; via: "self" | "guardian" } | null {
  if (!req.subject) {
    logger.error(
      "STUDENT_RESOURCES",
      "subject_missing",
      "handler reached without req.subject; the resolver is not mounted on this route",
      { path: req.path, requestId: req.requestId },
    );
    res.status(500).json({ error: "Internal server error", requestId: req.requestId });
    return null;
  }
  return req.subject;
}

/**
 * The SAME predicate `guardian_view_decision` uses (`entitlement_active(uuid)`), applied to
 * the SUBJECT, never to the caller.
 *
 * It deliberately does not go through `resolvePaidKpiAccessForStudent`, which the routes this
 * file replaces used: that function reaches `getLinkedGuardianForStudent`, which selects
 * `student_user_id`, `account_id` and `linked_at` — three columns that exist in no spec, no
 * genesis schema, and no production table. The read throws, an outer `catch` converts the
 * throw into `hasPaidAccess: false`, and the result is that EVERY student is denied 402 on
 * the retired student mastery routes in production today. See owner question 3.
 */
async function subjectEntitlementActive(studentId: string): Promise<boolean> {
  return EntitlementService.isEntitlementActiveForProfile(studentId);
}

function sendPaymentRequired(res: Response, requestId?: string) {
  return res.status(402).json({
    error: "Subscription required",
    code: "PAYMENT_REQUIRED",
    message: "An active subscription is required to see this.",
    requestId,
  });
}

/**
 * One wrapper for the fixed handler order: subject -> entitlement -> read -> serialize.
 * A thrown read is a 500 and is never rendered as an empty result (Coding Standards §13).
 */
function resource<T>(
  path: string,
  read: (subject: { studentId: string; via: "self" | "guardian" }) => Promise<T>,
): void {
  router.get(`/:studentId${path}`, resolveSubject, async (req: Request, res: Response) => {
    const subject = requireSubject(req, res);
    if (!subject) return;

    try {
      if (REQUIRES_ACTIVE_ENTITLEMENT[path] === true) {
        if (!(await subjectEntitlementActive(subject.studentId))) {
          return sendPaymentRequired(res, req.requestId);
        }
      }
      const body = await read(subject);
      return res.json({ ok: true, ...body, requestId: req.requestId });
    } catch (err) {
      logger.error("STUDENT_RESOURCES", "read_failed", "Subject-scoped read failed", {
        path,
        err,
        requestId: req.requestId,
      });
      return res
        .status(500)
        .json({ error: "Internal server error", requestId: req.requestId });
    }
  });
}

/** `?section=M|RW` is accepted on the domain view, as the route it replaces did. */
function parseSection(value: unknown): { ok: true; section: MasterySection | undefined } | { ok: false } {
  const parsed = masterySectionSchema.optional().safeParse(value);
  return parsed.success ? { ok: true, section: parsed.data } : { ok: false };
}

// --- mastery ---------------------------------------------------------------

router.get(
  `/:studentId${STUDENT_RESOURCE_PATHS.masteryDomains}`,
  resolveSubject,
  async (req: Request, res: Response) => {
    const subject = requireSubject(req, res);
    if (!subject) return;

    const section = parseSection(req.query.section);
    if (!section.ok) {
      return res.status(400).json({
        error: { message: "Invalid section", code: "INVALID_SECTION" },
        requestId: req.requestId,
      });
    }

    try {
      if (!(await subjectEntitlementActive(subject.studentId))) {
        return sendPaymentRequired(res, req.requestId);
      }
      const { domains } = await readDomainMasteryView({
        studentId: subject.studentId,
        section: section.section,
      });
      return res.json({ ok: true, domains, requestId: req.requestId });
    } catch (err) {
      logger.error("STUDENT_RESOURCES", "mastery_domains_failed", "Domain view failed", {
        err,
        requestId: req.requestId,
      });
      return res
        .status(500)
        .json({ error: "Internal server error", requestId: req.requestId });
    }
  },
);

/**
 * §10.4 EMPTY-LIST SEMANTICS, AND WHY THIS IS NOT A ROLE BRANCH.
 *
 * A guardian receives `200` with `skills: []`, never `403`. Doc 05B §10.4 is explicit that
 * "403 would imply the resource exists but is forbidden — leaking that skill mastery rows
 * exist for that student", while an empty 200 "is the same response a student would get if
 * they had no skill mastery rows yet".
 *
 * In the target state RLS produces this by itself: `student_skill_mastery` has NO guardian
 * SELECT policy (Doc 05A :73), so a guardian's query returns zero rows. The application
 * still reads with the service role, which bypasses RLS (Doc 01 §14 — Layer 1 is
 * launch-canonical, Layer 2 is target-state), so the empty list is produced here instead,
 * from the `via` the RESOLVER decided. When guardian reads move onto an `authenticated`
 * client this branch is deleted and nothing else changes.
 *
 * `catalogEmpty` stays FALSE for a guardian: the question bank is full, and saying otherwise
 * would be a claim about the catalogue made from a permission result.
 */
router.get(
  `/:studentId${STUDENT_RESOURCE_PATHS.masterySkills}`,
  resolveSubject,
  async (req: Request, res: Response) => {
    const subject = requireSubject(req, res);
    if (!subject) return;

    try {
      if (!(await subjectEntitlementActive(subject.studentId))) {
        return sendPaymentRequired(res, req.requestId);
      }

      if (subject.via === "guardian") {
        return res.json({
          ok: true,
          skills: [],
          catalogEmpty: false,
          requestId: req.requestId,
        });
      }

      const view = await readSkillCatalogView({ studentId: subject.studentId });
      return res.json({ ok: true, ...view, requestId: req.requestId });
    } catch (err) {
      logger.error("STUDENT_RESOURCES", "mastery_skills_failed", "Skill view failed", {
        err,
        requestId: req.requestId,
      });
      return res
        .status(500)
        .json({ error: "Internal server error", requestId: req.requestId });
    }
  },
);

// --- KPI rollups -----------------------------------------------------------

resource(STUDENT_RESOURCE_PATHS.kpiSections, async (subject) => ({
  sections: await readSectionKpi({ studentId: subject.studentId }),
}));

resource(STUDENT_RESOURCE_PATHS.kpiDomains, async (subject) => ({
  domains: await readDomainKpi({ studentId: subject.studentId }),
}));

/**
 * The overall KPI envelope, unchanged in shape from what the student route served. The
 * historical-trends term is resolved for the SUBJECT on both paths — that hardcoded `true`
 * on the guardian side was privilege divergence #1 (#644).
 */
resource(STUDENT_RESOURCE_PATHS.kpiOverall, async (subject) => {
  const includeHistoricalTrends = await resolveHistoricalTrendsAccess(subject.studentId);
  return buildStudentKpiViewFromCanonical(subject.studentId, includeHistoricalTrends);
});

// --- projections -----------------------------------------------------------

resource(STUDENT_RESOURCE_PATHS.projectionsSections, async (subject) => ({
  sections: await readSectionProjections({ studentId: subject.studentId }),
}));

resource(STUDENT_RESOURCE_PATHS.projectionsSnapshots, async (subject) => ({
  snapshots: await readProjectionSnapshots({ studentId: subject.studentId }),
}));

export default router;
