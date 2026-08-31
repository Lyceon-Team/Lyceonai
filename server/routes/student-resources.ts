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
import {
  acceptGuardianLink,
  createGuardianLink,
  getGuardianLinkById,
  revokeGuardianLink,
} from "../lib/account";
import {
  GUARDIAN_LINK_ERROR,
  guardianLinkRequestSchema,
  guardianLinkRevokeSchema,
} from "../../packages/shared/src/guardian-link-schema";
import {
  normaliseEmail,
  subjectDigest,
  DIGEST_LEN_LOG,
} from "../../packages/shared/src/services/subject-digest";
import { guardianLinkRateLimit } from "../middleware/guardian-link-rate-limit";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
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
 * @spec [Doc-01_V8 §27.2 entitlement_features; owner ruling 2026-08-28 step 7 — "route-table
 *        requiresEntitlement, one canAccessFeature('mastery_detail') call site, no new keys,
 *        never the entitlement_active predicate directly"] | @implemented [2026-08-28]
 *
 * PER-RESOURCE ENTITLEMENT POSTURE, IN ONE TABLE — and this time the table is the mechanism.
 *
 * WHAT WAS WRONG WITH THE VERSION THIS REPLACES. It was `Record<string, boolean>` and it
 * gated nothing. Its only two `true` entries were `masteryDomains` and `masterySkills`, and
 * neither of those routes goes through `resource()` — they are declared with their own
 * `router.get` because they parse query params and shape their own payloads. Every path that
 * DID go through `resource()` was `false`. So the `=== true` branch inside `resource()` never
 * executed in any request, ever, and the two routes the table claimed to describe were gated
 * by hand-written `subjectEntitlementActive` calls copied into each handler.
 *
 * That is the failure this vertical keeps finding, one layer down: a mechanism that reads as
 * the single source of truth, is typed, is documented, and is not consulted. A table nobody
 * queries is a comment with a type annotation.
 *
 * WHAT IT IS NOW. Path -> the `entitlement_features` key that gates it, or `null` for open.
 * Every gated route reads it through `entitlementGate`, which is the ONLY place
 * `canAccessFeature` is called on this surface.
 *
 * WHY A FEATURE KEY AND NOT A BOOLEAN. `canAccessFeature` consults `entitlement_features`
 * (`required_tier`, `enabled`), so the mastery paywall becomes a row an operator can turn off
 * rather than a boolean only a deploy can change. `mastery_detail` is seeded by genesis
 * (`00000000000000_genesis.sql:206` — premium, enabled by column default). No key is
 * introduced here.
 *
 * POSTURE PRESERVED EXACTLY, so this step moves the mechanism and not who can see what:
 *   - mastery/*      402 unless the subject can access `mastery_detail`
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
export const requiresEntitlement: Record<string, string | null> = {
  [STUDENT_RESOURCE_PATHS.masteryDomains]: "mastery_detail",
  [STUDENT_RESOURCE_PATHS.masterySkills]: "mastery_detail",
  [STUDENT_RESOURCE_PATHS.kpiSections]: null,
  [STUDENT_RESOURCE_PATHS.kpiDomains]: null,
  [STUDENT_RESOURCE_PATHS.kpiOverall]: null,
  [STUDENT_RESOURCE_PATHS.projectionsSections]: null,
  [STUDENT_RESOURCE_PATHS.projectionsSnapshots]: null,
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

function sendPaymentRequired(res: Response, requestId?: string) {
  return res.status(402).json({
    error: "Subscription required",
    code: "PAYMENT_REQUIRED",
    message: "An active subscription is required to see this.",
    requestId,
  });
}

/**
 * THE ONE ENTITLEMENT CALL SITE ON THIS SURFACE. Returns true when the request may proceed;
 * when it may not, the 402 is already written and the caller must return immediately.
 *
 * It asks `canAccessFeature`, never the canonical entitlement_active predicate directly. That
 * predicate is reachable from exactly one file (`entitlement-service.ts`, SP25-001) and
 * `canAccessFeature` is the feature-aware layer above it. Going straight to the predicate
 * would gate on "is this profile paying" and lose "is this feature premium, and is it
 * switched on" — which is the question a per-resource table is asking.
 *
 * (The two sentences above deliberately do NOT spell that predicate as a call expression.
 * `entitlement.single-evaluator.contract.test.ts` enforces SP25-001 with a line scan, and a
 * comment written in call syntax is indistinguishable from a call to it. The scan is right to
 * be strict — loosening it to parse comments would trade a real invariant for prose comfort —
 * so the awkward phrasing stays. Do not "fix" it back.)
 *
 * Applied to the SUBJECT, never to the caller: a guardian reading a student's mastery is
 * gated on THAT STUDENT's entitlement, the same term `guardian_view_decision` uses.
 *
 * FAIL-CLOSED comes from `canAccessFeature` itself — unknown key, disabled feature, DB error
 * and read error all return false. Nothing here turns a failure into access.
 *
 * The predicate this replaces, `isEntitlementActiveForProfile`, is still the right one for
 * `guardian_view_decision`'s own term; it is simply not the right one for a per-FEATURE table.
 */
async function entitlementGate(
  path: string,
  studentId: string,
  res: Response,
  requestId?: string,
): Promise<boolean> {
  const featureKey = requiresEntitlement[path];
  if (!featureKey) return true;

  if (await EntitlementService.canAccessFeature(studentId, featureKey)) {
    return true;
  }
  sendPaymentRequired(res, requestId);
  return false;
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
        if (
          !(await entitlementGate(path, subject.studentId, res, req.requestId))
        ) {
          return;
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
      if (
        !(await entitlementGate(
          STUDENT_RESOURCE_PATHS.masteryDomains,
          subject.studentId,
          res,
          req.requestId,
        ))
      ) {
        return;
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
      if (
        !(await entitlementGate(
          STUDENT_RESOURCE_PATHS.masterySkills,
          subject.studentId,
          res,
          req.requestId,
        ))
      ) {
        return;
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
 * POST /api/students/:studentId/links — §36.1 step 1, student-initiated.
 *
 * @spec [Doc-01_V8 §36.1 Initiation (student-initiated → `pending_guardian_accept`);
 *   §36.2 rate limiting; owner rulings 2026-08-27 Q2 (both directions ship in V1),
 *   Q3 (subject-scoped mount, `via === 'self'`)] | @implemented [2026-08-27]
 *
 * plain English: a student invites a guardian by email. The link lands PENDING on the
 * guardian, who confirms it through the route that already exists. This is the direction a
 * student who finds Lyceon themselves needs — they cannot pay, so somebody has to be asked.
 *
 * WHAT WAS MISSING. `PENDING_STATUS_FOR_INITIATOR.student` and the whole domain path existed;
 * the only caller passing `"student"` was the consent flow, which R1 removes. So the sole
 * producer of a `pending_guardian_accept` link was a flow that is not in V1.
 *
 * ANTI-ENUMERATION, THE SAME SHAPE THE GUARDIAN ROUTE USES. An address with no guardian
 * account gets the SAME 202 as one that has. §36.1 step 3 reaches the invitee by email
 * either way, so the student learns nothing here they are entitled to learn. The address is
 * never written to a retained row — only its digest (§12.1).
 *
 * RATE LIMITING REUSES `guardianLinkRateLimit` UNCHANGED, and that is a reading worth stating:
 * §36.2's two controls are written for the guardian direction ("10 per guardian per day, 3 per
 * student-email per day"), but the middleware keys on the AUTHENTICATED INITIATOR's profile
 * and on the TARGETED address, neither of which is direction-specific. One account's daily
 * invitations and one address's daily invitations are the quantities §36.2 is protecting, so
 * the same buckets are the right buckets. Forking a second pair would double-count nothing and
 * halve the protection. See owner question — whether §36.2's limits are per-direction or
 * shared is not something the spec says.
 *
 * It runs AFTER `resolveSubject`, so a caller who is not the subject still consumes their OWN
 * quota before the 404. That is deliberate: probing this route is exactly what a daily cap
 * should cost something.
 */
router.post(
  `/:studentId${STUDENT_LINK_PATHS.linkInitiate}`,
  resolveSubject,
  guardianLinkRateLimit,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    const subject = requireSubject(req, res);
    if (!subject) return;

    if (subject.via !== "self") {
      return sendNotFound(res, requestId);
    }

    const parsed = guardianLinkRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      await auditGuardianLink({
        action: "guardian_link_denied",
        actorProfileId: subject.studentId,
        changes: { reason: "invalid_input" },
        requestId,
      });
      return res.status(400).json({
        error: { message: "A guardian email address is required" },
        requestId,
      });
    }

    const email = normaliseEmail(parsed.data.email);

    const { data: guardian, error: lookupError } = await supabaseServer
      .from("profiles")
      .select("id")
      .eq("email", email)
      .eq("role", "guardian")
      .maybeSingle();

    if (lookupError && lookupError.code !== "PGRST116") {
      logger.error(
        "STUDENT_RESOURCES",
        "link_initiate",
        "Guardian lookup failed",
        {
          requestId,
          reason: lookupError.message,
        },
      );
      return res.status(500).json({
        error: { message: "Failed to create link request" },
        requestId,
      });
    }

    if (!guardian) {
      await auditGuardianLink({
        action: "guardian_link_denied",
        actorProfileId: subject.studentId,
        changes: {
          reason: "no_matching_guardian",
          email_digest: subjectDigest(email, DIGEST_LEN_LOG),
        },
        requestId,
      });
      return res.status(202).json({
        data: { status: "pending_guardian_accept" },
        requestId,
      });
    }

    let link;
    try {
      link = await createGuardianLink(
        guardian.id,
        subject.studentId,
        "student",
      );
    } catch (createError: unknown) {
      const code =
        typeof createError === "object" &&
        createError !== null &&
        "code" in createError &&
        typeof (createError as { code: unknown }).code === "string"
          ? (createError as { code: string }).code
          : null;

      if (code === GUARDIAN_LINK_ERROR.ALREADY_EXISTS) {
        await auditGuardianLink({
          action: "guardian_link_denied",
          actorProfileId: subject.studentId,
          targetProfileId: guardian.id,
          changes: { reason: "link_already_exists" },
          requestId,
        });
        return res.status(409).json({
          error: {
            message: "A link with this guardian already exists",
            code,
          },
          requestId,
        });
      }

      logger.error(
        "STUDENT_RESOURCES",
        "link_initiate",
        "Failed to create link",
        {
          requestId,
          reason:
            createError instanceof Error ? createError.message : "unknown",
        },
      );
      return res.status(500).json({
        error: { message: "Failed to create link request" },
        requestId,
      });
    }

    logger.info(
      "STUDENT_RESOURCES",
      "link_initiate",
      "Student initiated link",
      {
        studentId: subject.studentId,
        requestId,
      },
    );

    return res.status(202).json({
      data: { link_id: link.id, status: link.status },
      requestId,
    });
  },
);

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

/**
 * DELETE /api/students/:studentId/links/:linkId — §36.3's student half.
 *
 * @spec [Doc-01_V8 §36.3 Revocation — "either party" may revoke; owner rulings 2026-08-27
 *   Q3 (subject-scoped mount, `via === 'self'`), Q7 (404 non-party / 409 party)]
 *   | @implemented [2026-08-27]
 *
 * plain English: the student ends an active link, and the guardian loses visibility on the
 * next read — every read gate requires `status = 'active'`.
 *
 * WHY THIS IS NOT OPTIONAL. §36.3 says either party may revoke and the domain function has
 * taken a `revokedByProfileId` since WS-GL Phase B, precisely so the revoker is recorded
 * rather than assumed to be the guardian. But the only mounted route was the guardian's, so
 * on a platform for 13-18 year olds the minor could not end an adult's access to their own
 * learning data. That is the gap this closes, and it is the one in the lifecycle with a
 * safeguarding argument rather than a completeness argument.
 *
 * Addressed by LINK ID, not by guardian id: §35 lets a student hold links to more than one
 * guardian, and the id is what makes "which link" unambiguous. It also matches the accept
 * route, so the student surface addresses a link the same way twice.
 *
 * The reason is bounded by `guardianLinkRevokeSchema` rather than truncated here, so the cap
 * is part of the contract. It is stored verbatim on the row and is never a log field: §12.1,
 * and a revocation reason from a minor is exactly the kind of free text that must not leak.
 */
router.delete(
  `/:studentId${STUDENT_LINK_PATHS.linkRevoke}`,
  resolveSubject,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    const subject = requireSubject(req, res);
    if (!subject) return;

    if (subject.via !== "self") {
      return sendNotFound(res, requestId);
    }

    const params = linkIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({
        error: { message: "Invalid link id", details: params.error.flatten() },
        requestId,
      });
    }
    const { linkId } = params.data;

    const body = guardianLinkRevokeSchema.safeParse(req.body ?? {});
    if (!body.success) {
      return res.status(400).json({
        error: { message: "Invalid reason", details: body.error.flatten() },
        requestId,
      });
    }

    let existing;
    try {
      existing = await getGuardianLinkById(linkId);
    } catch (readError: unknown) {
      logger.error("STUDENT_RESOURCES", "link_revoke", "Failed to read link", {
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

    let revoked;
    try {
      revoked = await revokeGuardianLink(
        existing.guardian_profile_id,
        subject.studentId,
        subject.studentId,
        body.data.reason,
      );
    } catch (revokeError: unknown) {
      const code =
        typeof revokeError === "object" &&
        revokeError !== null &&
        "code" in revokeError &&
        typeof (revokeError as { code: unknown }).code === "string"
          ? (revokeError as { code: string }).code
          : null;

      // The caller is a party, so a non-active link is a state conflict, not an authz failure.
      if (code === GUARDIAN_LINK_ERROR.NOT_ACTIVE) {
        return res.status(409).json({
          error: { message: "This link is not active", code },
          requestId,
        });
      }

      logger.error(
        "STUDENT_RESOURCES",
        "link_revoke",
        "Failed to revoke link",
        {
          requestId,
          reason:
            revokeError instanceof Error ? revokeError.message : "unknown",
        },
      );
      return res
        .status(500)
        .json({ error: "Internal server error", requestId });
    }

    logger.info("STUDENT_RESOURCES", "link_revoke", "Student revoked link", {
      studentId: subject.studentId,
      requestId,
    });

    return res.json({
      data: { link_id: revoked.id, status: revoked.status },
      requestId,
    });
  },
);

export default router;
