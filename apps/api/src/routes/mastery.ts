import { Response, Router } from "express";
import {
  type AuthenticatedRequest,
  requireRequestUser,
} from "../../../../server/middleware/supabase-auth";
import {
  buildMasterySkillTreeFromRows,
  buildMasterySummaryFromRows,
  fetchDomainMasteryRows,
  fetchSkillMasteryRows,
  fetchWeakestSkills,
} from "../services/mastery-read";
import { masteryTierFromLevel } from "../../../../packages/shared/src/mastery";
import { DateTime } from "luxon";
import { resolvePaidKpiAccessForUser } from "../../../../server/services/kpi-access";
import { getSupabaseAdmin } from "../lib/supabase-admin";

const SAT_TAXONOMY = {
  math: {
    label: "Math",
    domains: {
      algebra: {
        label: "Algebra",
        skills: [
          "linear_equations",
          "linear_inequalities",
          "linear_functions",
          "systems_of_equations",
          "absolute_value",
        ],
      },
      advanced_math: {
        label: "Advanced Math",
        skills: [
          "quadratics",
          "polynomials",
          "exponential_functions",
          "radical_expressions",
          "rational_expressions",
        ],
      },
      problem_solving: {
        label: "Problem Solving and Data Analysis", // presentation-only
        skills: [
          "ratios_rates_proportions",
          "percentages",
          "unit_conversions",
          "linear_growth",
          "data_interpretation",
          "probability",
          "statistics",
        ],
      },
      geometry: {
        label: "Geometry and Trigonometry", // presentation-only
        skills: [
          "area_volume",
          "lines_angles",
          "triangles",
          "circles",
          "trigonometry",
          "coordinate_geometry",
        ],
      },
    },
  },
  rw: {
    label: "Reading & Writing",
    domains: {
      craft_structure: {
        label: "Craft and Structure",
        skills: [
          "words_in_context",
          "text_structure",
          "cross_text_connections",
          "purpose",
        ],
      },
      information_ideas: {
        label: "Information and Ideas",
        skills: [
          "central_ideas",
          "command_of_evidence_textual",
          "command_of_evidence_quantitative",
          "inferences",
        ],
      },
      standard_english: {
        label: "Standard English Conventions",
        skills: [
          "boundaries",
          "form_structure_sense",
          "punctuation",
          "verb_tense",
          "pronoun_agreement",
        ],
      },
      expression_ideas: {
        label: "Expression of Ideas",
        skills: ["rhetorical_synthesis", "transitions", "sentence_placement"],
      },
    },
  },
};

function getTomorrowDate(): string {
  return DateTime.now().plus({ days: 1 }).toISODate()!;
}

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
      requestId: (req as any).requestId,
    });
    return false;
  }
  return true;
}

/**
 * @spec [Doc 05B §5.4 + AC#20 — tier-only domain summary, no mastery_score/pct/percent] | @implemented [2026-06-23]
 * plain English: returns section→domain tier summary from canonical domain mastery_level.
 * The prior version aggregated non-existent `attempts/correct/accuracy` columns (never worked).
 */
router.get("/summary", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }
    if (
      !(await ensurePremiumMasteryAccess(req, res, user, "mastery_summary"))
    ) {
      return;
    }

    const section = req.query.section as string | undefined;

    const domainRows = await fetchDomainMasteryRows({
      userId: user.id,
      section,
    });
    const summary = buildMasterySummaryFromRows(domainRows);

    res.json({
      ok: true,
      sections: summary,
    });
  } catch (error) {
    console.error("[Mastery] Error getting mastery summary:", error);
    res.status(500).json({ error: "Failed to get mastery summary" });
  }
});

/**
 * @spec [Doc 05A §7.4 + Doc 05B §5.4 + AC#20 — tier-only skill tree] | @implemented [2026-06-23]
 * plain English: returns section→domain→skill tree with tier-only data (no mastery_score,
 * no mastery_pct, no percent). Skill tier from canonical mastery_level; domain tier from
 * the domain's own canonical level; section = pure container.
 */
router.get("/skills", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }
    if (
      !(await ensurePremiumMasteryAccess(req, res, user, "mastery_hexagon"))
    ) {
      return;
    }
    const [rows, domainRows] = await Promise.all([
      fetchSkillMasteryRows({ userId: user.id }),
      fetchDomainMasteryRows({ userId: user.id }),
    ]);
    const result = buildMasterySkillTreeFromRows(
      rows,
      SAT_TAXONOMY,
      domainRows,
    );
    return res.json({ sections: result });
  } catch (err: any) {
    console.error("[Mastery] Error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * @spec [Doc 05A §7.4 + AC#20 — tier-only weakest skills, mastery_score stripped at serialization]
 * | @implemented [2026-06-23]
 * plain English: returns weakest skills by canonical mastery_score ordering (ascending).
 * ANTI-LEAK BOUNDARY: mastery_score/accuracy are server-side only (adaptiveSelector needs them);
 * this route strips them before the response crosses to the client.
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

    const weakest = await fetchWeakestSkills({
      userId,
      limit,
      minAttempts: 2,
    });

    const formatted = weakest.map((row) => ({
      section: row.section,
      domain: row.domain,
      skill: row.skill,
      label: row.skill
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c: string) => c.toUpperCase()),
      tier: masteryTierFromLevel(row.mastery_level),
      masteryLevel: row.mastery_level,
    }));

    return res.json({ weakest: formatted });
  } catch (err: any) {
    console.error("[Mastery] Error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/add-to-plan",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = requireRequestUser(req, res);
      if (!user) {
        return;
      }
      if (
        !(await ensurePremiumMasteryAccess(
          req,
          res,
          user,
          "mastery_plan_mutation",
        ))
      ) {
        return;
      }

      const userId = user.id;
      const { section, domain, skill, targetDate } = req.body;

      if (!section || !skill) {
        return res
          .status(400)
          .json({ error: "Section and skill are required" });
      }

      const dayDate = targetDate || getTomorrowDate();
      const supabase = getSupabaseAdmin();

      const { data: profile, error: profileError } = await supabase
        .from("student_study_profile")
        .select("planner_mode")
        .eq("user_id", userId)
        .maybeSingle();

      if (profileError) {
        console.error(
          "[Mastery] Failed to load planner mode:",
          profileError.message,
        );
        return res.status(500).json({ error: "Failed to load planner mode" });
      }

      const plannerMode =
        profile?.planner_mode === "custom" ? "custom" : "auto";
      const competencyId = domain ? `${domain}.${skill}` : skill;
      const sectionLabel = section === "math" ? "Math" : "Reading & Writing";

      return res.json({
        success: true,
        applied: false,
        planner_mode: plannerMode,
        dayDate,
        addedSkill: competencyId,
        suggestion: {
          type: "skill_focus",
          section: sectionLabel,
          competency: competencyId,
          reason:
            plannerMode === "custom"
              ? "Custom mode keeps planner ownership with the student, so mastery suggestions never auto-apply."
              : "Planner ownership is centralized in /api/calendar day edit/regenerate flows.",
          applyEndpoint: `/api/calendar/day/${dayDate}`,
          suggestedPatch: {
            focus: [
              {
                section: sectionLabel,
                competencies: [competencyId],
              },
            ],
          },
        },
      });
    } catch (err: any) {
      console.error("[Mastery] Error:", err.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

export const masteryRouter = router;
