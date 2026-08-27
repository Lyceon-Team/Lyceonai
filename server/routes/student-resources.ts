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
import { z } from "zod";
import {
  STUDENT_LINK_PATHS,
  STUDENT_RESOURCE_PATHS,
  type MasterySection,
} from "../../packages/shared/src/index";
import { acceptGuardianLink, getGuardianLinkById } from "../lib/account";
import { GUARDIAN_LINK_ERROR } from "../../packages/shared/src/guardian-link-schema";
import { auditGuardianLink } from "../services/guardian-link-audit";
import { masterySectionSchema } from "../../packages/shared/src/mastery-levels";
import {
  readDomainMasteryView,
  readSkillCatalogView,
} from "../../apps/api/src/services/mastery-view";
import {
  readDomainKpi,
  readSectionKpi,
} from "../../apps/api/src/services/kpi-rollup-read";
import {
  readProjectionSnapshots,
  readSectionProjections,
} from "../../apps/api/src/services/projection-read";
import { buildStudentKpiViewFromCanonical } from "../services/canonical-runtime-views";
import { resolveHistoricalTrendsAccess } from "../services/kpi-access";
import { EntitlementService } from "../services/entitlement-service";
import { logger } from "../logger";
import { resolveSubject, sendNotFound } from "../middleware/subject-resolver";

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
function requireSubject(
  req: Request,
  res: Response,
): { studentId: string; via: "self" | "guardian" } | null {
  if (!req.subject) {
    logger.error(
      "STUDENT_RESOURCES",
      "subject_missing",
      "handler reached without req.subject; the resolver is not mounted on this route",
      { path: req.path, requestId: req.requestId },
    );
    res
      .status(500)
      .json({ error: "Internal server error", requestId: req.requestId });
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
  read: (subject: {
    studentId: string;
    via: "self" | "guardian";
  }) => Promise<T>,
): void {
  router.get(
    `/:studentId${path}`,
    resolveSubject,
    async (req: Request, res: Response) => {
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
        logger.error(
          "STUDENT_RESOURCES",
          "read_failed",
          "Subject-scoped read failed",
          {
            path,
            err,
            requestId: req.requestId,
          },
        );
        return res
          .status(500)
          .json({ error: "Internal server error", requestId: req.requestId });
      }
    },
  );
}

/** `?section=M|RW` is accepted on the domain view, as the route it replaces did. */
function parseSection(
  value: unknown,
): { ok: true; section: MasterySection | undefined } | { ok: false } {
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
      logger.error(
        "STUDENT_RESOURCES",
        "mastery_domains_failed",
        "Domain view failed",
        {
          err,
          requestId: req.requestId,
        },
      );
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
      logger.error(
        "STUDENT_RESOURCES",
        "mastery_skills_failed",
        "Skill view failed",
        {
          err,
          requestId: req.requestId,
        },
      );
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
  const includeHistoricalTrends = await resolveHistoricalTrendsAccess(
    subject.studentId,
  );
  return buildStudentKpiViewFromCanonical(
    subject.studentId,
    includeHistoricalTrends,
  );
});

// --- projections -----------------------------------------------------------

resource(STUDENT_RESOURCE_PATHS.projectionsSections, async (subject) => ({
  sections: await readSectionProjections({ studentId: subject.studentId }),
}));

resource(STUDENT_RESOURCE_PATHS.projectionsSnapshots, async (subject) => ({
  snapshots: await readProjectionSnapshots({ studentId: subject.studentId }),
}));

// --- link lifecycle --------------------------------------------------------

const linkIdParamSchema = z.object({ linkId: z.string().uuid() });

/**
 * POST /api/students/:studentId/links/:linkId/accept — §36.1's student-side acceptance.
 *
 * @spec [Doc-01_V8 §36.1 Initiation (guardian-initiated, the student confirms →
 *   `status = 'active'`); owner rulings 2026-08-27 Q2 (both directions ship in V1),
 *   Q3 (mount on the subject-scoped topology, require `via === 'self'`),
 *   Q7 (404 to a non-party, 409 to a party in the wrong state)] | @implemented [2026-08-27]
 *
 * plain English: the student confirms a link their guardian started, and it goes live. This
 * is the half §36.1 always specified and no route ever served.
 *
 * WHAT WAS ACTUALLY BROKEN. `POST /api/guardian/link` writes `pending_student_accept`, and
 * the only acceptance route in the codebase sits behind `requireGuardianAccess` and can only
 * settle `pending_guardian_accept`. So a guardian could invite a student and the link could
 * never become active by any path — which is why `guardian_links` holds zero rows in
 * production while the link surface is live. The domain function was already party-agnostic
 * (`acceptGuardianLink`); only this mount was missing.
 *
 * WHY `via === 'self'` IS THE GATE, AND WHY IT IS NOT A ROLE CHECK.
 *   `resolveSubject` has already turned the principal into a subject above this handler, so
 *   `via` is a RESOLVED FACT, not the caller's role re-tested inside the handler — the branch
 *   RB-05B-V1-05 permits, in the one place it permits it. A guardian reaching this path is
 *   not denied information; they are on the wrong route, and their own acceptance route
 *   already exists. It answers 404 rather than 403 so the two denials this surface can give
 *   — "not your link" and "not your route" — are indistinguishable from outside.
 *
 * STATUS CODES (owner ruling Q7, a reasoned deviation from R3's uniform 404 — recorded here
 * so it is not "corrected" back):
 *   400 — `linkId` is not a uuid. Names no row, so no enumeration surface.
 *   404 — no such link, OR the caller is not a party to it. R3's purpose is stopping a
 *         stranger from learning that a link or a student exists; both answers are the same
 *         bytes for exactly that reason.
 *   409 — the caller IS a party, and the link is not theirs to accept right now (already
 *         active, revoked, or waiting on the guardian). They already know the link exists —
 *         they are named on it — so the informative answer discloses nothing, and it is a
 *         STATE CONFLICT rather than an authorization failure, which is why 409 and not 403.
 */
router.post(
  `/:studentId${STUDENT_LINK_PATHS.linkAccept}`,
  resolveSubject,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    const subject = requireSubject(req, res);
    if (!subject) return;

    // Link actions are the subject's own (owner ruling Q3). A guardian has their own route.
    if (subject.via !== "self") {
      return sendNotFound(res, requestId);
    }

    const parsed = linkIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({
        error: { message: "Invalid link id", details: parsed.error.flatten() },
        requestId,
      });
    }
    const { linkId } = parsed.data;

    // Party-hood decides 404-versus-409, and only a read can answer it: `acceptGuardianLink`
    // raises the same WRONG_ACCEPTOR for the party who must wait and for a stranger.
    let existing;
    try {
      existing = await getGuardianLinkById(linkId);
    } catch (readError: unknown) {
      logger.error("STUDENT_RESOURCES", "link_accept", "Failed to read link", {
        requestId,
        reason: readError instanceof Error ? readError.message : "unknown",
      });
      return res
        .status(500)
        .json({ error: "Internal server error", requestId });
    }

    if (!existing || existing.student_profile_id !== subject.studentId) {
      return sendNotFound(res, requestId);
    }

    let link;
    try {
      link = await acceptGuardianLink(linkId, subject.studentId);
    } catch (acceptError: unknown) {
      const code =
        typeof acceptError === "object" &&
        acceptError !== null &&
        "code" in acceptError &&
        typeof (acceptError as { code: unknown }).code === "string"
          ? (acceptError as { code: string }).code
          : null;

      // The caller is a party (checked above), so both of these are state conflicts.
      if (
        code === GUARDIAN_LINK_ERROR.WRONG_ACCEPTOR ||
        code === GUARDIAN_LINK_ERROR.NOT_PENDING
      ) {
        return res.status(409).json({
          error: {
            message: "This link is not awaiting your acceptance",
            code,
          },
          requestId,
        });
      }

      logger.error(
        "STUDENT_RESOURCES",
        "link_accept",
        "Failed to accept link",
        {
          requestId,
          reason:
            acceptError instanceof Error ? acceptError.message : "unknown",
        },
      );
      return res
        .status(500)
        .json({ error: "Internal server error", requestId });
    }

    await auditGuardianLink({
      action: "guardian_link_accepted",
      actorProfileId: subject.studentId,
      targetProfileId: link.guardian_profile_id,
      // Read from the row this handler observed BEFORE the write, not asserted: the guardian
      // route hardcodes `from: "pending_guardian_accept"`, which is true only by virtue of
      // which half it serves and would silently record a false prior state if that changed.
      changes: { from: existing.status, to: link.status },
      context: { link_id: link.id },
      requestId,
    });

    logger.info("STUDENT_RESOURCES", "link_accept", "Student accepted link", {
      studentId: subject.studentId,
      requestId,
    });

    return res.json({
      data: { link_id: link.id, status: link.status },
      requestId,
    });
  },
);

export default router;
