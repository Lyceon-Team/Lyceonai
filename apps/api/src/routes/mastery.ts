import { Response, Router } from "express";
import { z } from "zod";
import {
  type AuthenticatedRequest,
  requireRequestUser,
} from "../../../../server/middleware/supabase-auth";
import { fetchWeakestSkills } from "../services/mastery-read";
import { loadMasteryLevels } from "../services/mastery-levels-read";
import {
  parseSectionFilter,
  readDomainMasteryView,
  readSkillPanelView,
} from "../services/mastery-view";
import { masterySectionSchema } from "../../../../packages/shared/src/mastery-levels";
import { isCanonicalDomainForSection } from "../../../../shared/question-bank-contract";
import { resolvePaidKpiAccessForUser } from "../../../../server/services/kpi-access";
import { logger } from "../../../../server/logger";

const router = Router();

async function ensurePremiumMasteryAccess(
  req: AuthenticatedRequest,
  res: Response,
  user: { id: string; role: string },
  feature: string,
): Promise<boolean> {
  const access = await resolvePaidKpiAccessForUser(
    user.id,
    user.role as "student" | "guardian" | "admin",
  );
  if (!access.hasPaidAccess) {
    res.status(402).json({
      error: "Premium feature required",
      code: "PREMIUM_REQUIRED",
      feature,
      message: "Upgrade to an active paid plan to unlock this feature.",
      reason: access.reason,
      entitlement: {
        plan: access.plan,
        status: access.status,
        currentPeriodEnd: access.currentPeriodEnd,
      },
      requestId: req.requestId,
    });
    return false;
  }
  return true;
}

/**
 * Route-boundary parse for the drill-down's path parameters. It composes the shared
 * `masterySectionSchema` with the canonical (section, domain) predicate that already
 * single-sources the pairing — it does not restate either. A non-canonical pair is a
 * 400, not an empty panel: asking for a domain that cannot exist is a bad request, and
 * answering 200 with `skills: []` would make it look like a domain with no content.
 */
const skillPanelParamsSchema = z
  .object({
    section: masterySectionSchema,
    domain: z.string().min(1),
  })
  .refine((value) => isCanonicalDomainForSection(value.section, value.domain), {
    message: "not a canonical (section, domain) pair",
  });

/**
 * @spec [Doc 05B §5.4 — student_domain_mastery is the canonical domain grain;
 *   owner ruling 2026-08-20 RULE 1 (level names), RULE 4 (nine never-exposed columns),
 *   RULE 5 (drill-down: domain first), RULE 6 (NULL is a distinct state)]
 * | @implemented [2026-08-20]
 *
 * plain English: the first screen of the mastery drill-down — one card per canonical
 * domain, each carrying the LEVEL and the NAME of that level, and nothing about how the
 * level was reached. All eight domains are always present: a student with no events
 * sees eight cards reading "Not enough answers yet", which is true, rather than an empty
 * page, which is not.
 *
 * expected outcome: 8 domains (or 4 with `?section=M|RW`), each `{ section, domain,
 * levelKey, level, displayName }`.
 * trade-offs: the level is coarser than the score by design — the score is admin-only.
 * edge cases: a query failure throws and answers 500. It never renders as a student
 * with no mastery.
 */
router.get("/domains", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }
    if (
      !(await ensurePremiumMasteryAccess(req, res, user, "mastery_domains"))
    ) {
      return;
    }

    const parsedSection = parseSectionFilter(req.query.section);
    if (!parsedSection.ok) {
      return res.status(400).json({
        error: {
          message: "Invalid section",
          code: "INVALID_SECTION",
          details: parsedSection.details,
        },
        requestId: req.requestId,
      });
    }

    // THE shared read. The guardian route calls this same function with the linked
    // student's id — see the standing rule in services/mastery-view.ts.
    const { domains } = await readDomainMasteryView({
      studentId: user.id,
      section: parsedSection.section,
    });

    return res.json({ ok: true, domains });
  } catch (err) {
    logger.error("MASTERY", "domains", "Failed to build domain view", {
      err,
      requestId: req.requestId,
    });
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * @spec [Doc 05A §7.4 — student_skill_mastery grain; Doc 05B §4.2 domain canonicality;
 *   owner ruling 2026-08-20 RULE 5 (then skills), RULE 6, build question 2 answer
 *   (skill names render verbatim), build question 6 answer (hard gate AND an explicit
 *   empty state)] | @implemented [2026-08-20]
 *
 * plain English: the second screen — every skill the question bank publishes for one
 * domain, each with its level name. Unmeasured skills are present and labelled
 * "Not enough answers yet"; they are never omitted, because a missing row and an
 * unmeasured row say different things to a student deciding what to practise.
 *
 * WHAT REPLACED `SAT_TAXONOMY`.
 *   The deleted /skills route joined student rows against a hardcoded object whose
 *   slugs (`math`, `advanced_math`, `linear_equations`) matched nothing in a database
 *   holding `M`, `Advanced Math` and `Linear Equations in One Variable`. Every node
 *   resolved to NULL and the page said "No Mastery Data Yet" to every student who had
 *   one. The catalog is now derived from the question bank itself, so both sides of the
 *   join are the same values by construction.
 *
 * expected outcome: 200 with the domain's skills; `catalogEmpty` false in production.
 * trade-offs: the panel tracks published questions, so a skill with no published
 * question does not appear — correct, since there is nothing to practise.
 * edge cases: `catalogEmpty: true` with `skills: []` is the honest empty answer for a
 * domain the bank publishes nothing for. A FAILED read is a 500 and never reaches here.
 * A non-canonical (section, domain) pair is a 400.
 */
router.get(
  "/domains/:section/:domain/skills",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = requireRequestUser(req, res);
      if (!user) {
        return;
      }
      if (
        !(await ensurePremiumMasteryAccess(req, res, user, "mastery_skills"))
      ) {
        return;
      }

      const parsed = skillPanelParamsSchema.safeParse({
        section: req.params.section,
        domain: req.params.domain,
      });
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            message: "Invalid section or domain",
            code: "INVALID_DOMAIN",
            details: parsed.error.flatten(),
          },
          requestId: req.requestId,
        });
      }
      const { section, domain } = parsed.data;

      const panel = await readSkillPanelView({
        studentId: user.id,
        section,
        domain,
      });

      return res.json({ ok: true, ...panel });
    } catch (err) {
      logger.error("MASTERY", "domain_skills", "Failed to build skill panel", {
        err,
        requestId: req.requestId,
      });
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @spec [Doc 05A §7.4 + AC#20 — mastery_score stripped at serialization; owner ruling
 *   2026-08-20 RULE 1 (level names), build question 2 answer (skill names verbatim),
 *   Q4 answer 2026-08-21 (one shape per fact)] | @implemented [2026-08-21]
 * plain English: returns weakest skills by canonical mastery_score ordering (ascending),
 * each carrying the LEVEL and the NAME of that level.
 * ANTI-LEAK BOUNDARY: mastery_score/accuracy are server-side only (adaptiveSelector needs them);
 * this route strips them before the response crosses to the client.
 *
 * `tier` is GONE. It was the retiring four-tier vocabulary, carried for one transitional
 * PR while the surfaces moved to the six owner-ruled level names. Two vocabularies for
 * one fact is the shape that let SAT_TAXONOMY's slugs diverge unnoticed, so the second
 * one does not outlive its transition.
 */
router.get("/weakest", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }
    if (
      !(await ensurePremiumMasteryAccess(req, res, user, "mastery_weakest"))
    ) {
      return;
    }

    const userId = user.id;
    const limit = parseInt(req.query.limit as string) || 5;

    const [labels, weakest] = await Promise.all([
      loadMasteryLevels(),
      fetchWeakestSkills({ userId, limit }),
    ]);

    const formatted = weakest.map((row) => {
      const label = labels.forLevel(row.mastery_level);
      return {
        section: row.section,
        domain: row.domain,
        skill: row.skill,
        levelKey: label.levelKey,
        level: label.level,
        displayName: label.displayName,
      };
    });

    return res.json({ ok: true, weakest: formatted });
  } catch (err) {
    logger.error("MASTERY", "weakest", "Failed to get weakest skills", {
      err,
      requestId: req.requestId,
    });
    return res.status(500).json({ error: "Internal server error" });
  }
});

export const masteryRouter = router;
