import { Request, Response, Router } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { getMasterySummary, getWeakestSkills } from '../services/studentMastery';
import { getSupabaseAdmin } from '../lib/supabase-admin';
import { getMasteryStatus } from '../services/mastery-projection';
import { DateTime } from 'luxon';
import { resolvePaidKpiAccessForUser } from '../../../../server/services/kpi-access';

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
        label: "Problem Solving & Data Analysis",
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
        label: "Geometry & Trigonometry",
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
        skills: [
          "rhetorical_synthesis",
          "transitions",
          "sentence_placement",
        ],
      },
    },
  },
};

interface SkillMasteryRow {
  section: string;
  domain: string | null;
  skill: string;
  attempts: number;
  correct: number;
  accuracy: number;
  mastery_score: number;
}

interface SkillNode {
  id: string;
  label: string;
  attempts: number;
  correct: number;
  accuracy: number;
  mastery_score: number;
  status: "not_started" | "weak" | "improving" | "proficient";
}

interface DomainNode {
  id: string;
  label: string;
  skills: SkillNode[];
  avgMastery: number;
  status: "not_started" | "weak" | "improving" | "proficient";
}

interface SectionNode {
  id: string;
  label: string;
  domains: DomainNode[];
  avgMastery: number;
}

/**
 * DERIVED COMPUTATION: Compute mastery status from stored mastery_score
 * 
 * This function is now imported from mastery-projection.ts
 * It computes a UI-facing status label from the stored mastery_score.
 * It does NOT recalculate mastery_score itself.
 * 
 * Thresholds:
 * - not_started: attempts === 0
 * - weak: mastery_score < 40%
 * - improving: mastery_score < 70%
 * - proficient: mastery_score >= 70%
 */
// Function moved to mastery-projection.ts - using import instead

function getTomorrowDate(): string {
  return DateTime.now().plus({ days: 1 }).toISODate()!;
}

const router = Router();

/**
 * GET /mastery/summary - READ ONLY endpoint
 * 
 * Returns aggregated mastery summary by section and domain.
 * Does NOT mutate mastery state or recalculate scores.
 */
router.get('/summary', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const section = req.query.section as string | undefined;

    const summary = await getMasterySummary(req.user.id, section);

    res.json({
      ok: true,
      sections: summary,
    });
  } catch (error) {
    console.error('[Mastery] Error getting mastery summary:', error);
    res.status(500).json({ error: 'Failed to get mastery summary' });
  }
});

/**
 * GET /mastery/skills - READ ONLY endpoint
 * 
 * Returns full skill tree with mastery status computed from STORED mastery scores.
 * 
 * DERIVED COMPUTATION: Status thresholds (not_started, weak, improving, proficient)
 * are computed from stored mastery_score, but mastery_score itself is NOT recalculated.
 * 
 * Does NOT apply decay, weighting, or mutate mastery state.
 */
router.get('/skills', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const access = await resolvePaidKpiAccessForUser(req.user.id, req.user.role);
    if (!access.hasPaidAccess) {
      return res.status(402).json({
        error: 'Premium KPI feature required',
        code: 'PREMIUM_KPI_REQUIRED',
        feature: 'mastery_hexagon',
        message: 'Upgrade to an active paid plan to unlock mastery KPI surfaces.',
        reason: access.reason,
      });
    }
    const userId = req.user.id;
    const supabase = getSupabaseAdmin();

    // READ ONLY: Fetch stored mastery scores
    const { data: masteryData, error } = await supabase
      .from("student_skill_mastery")
      .select("section, domain, skill, attempts, correct, accuracy, mastery_score")
      .eq("user_id", userId);

    if (error) {
      console.error("[Mastery] Failed to fetch skills:", error.message);
      return res.status(500).json({ error: "Failed to fetch mastery data" });
    }

    const masteryMap = new Map<string, SkillMasteryRow>();
    for (const row of masteryData || []) {
      const key = `${row.section}:${row.domain || "unknown"}:${row.skill}`;
      masteryMap.set(key, row);
    }

    const result: SectionNode[] = [];

    for (const [sectionId, sectionDef] of Object.entries(SAT_TAXONOMY)) {
      const domains: DomainNode[] = [];
      let sectionTotalMastery = 0;
      let sectionDomainCount = 0;

      for (const [domainId, domainDef] of Object.entries(sectionDef.domains)) {
        const skills: SkillNode[] = [];
        let domainTotalMastery = 0;

        for (const skillId of domainDef.skills) {
          const key = `${sectionId}:${domainId}:${skillId}`;
          const row = masteryMap.get(key);

          const attempts = row?.attempts ?? 0;
          const correct = row?.correct ?? 0;
          const accuracy = row?.accuracy ?? 0;
          const mastery_score = row?.mastery_score ?? 0;

          skills.push({
            id: skillId,
            label: skillId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            attempts,
            correct,
            accuracy: Math.round(accuracy * 100), // accuracy still in 0-1 range
            mastery_score: Math.round(mastery_score), // mastery_score now in 0-100 range
            status: getMasteryStatus(mastery_score, attempts),
          });

          domainTotalMastery += mastery_score;
        }

        const avgDomainMastery = domainDef.skills.length > 0 
          ? domainTotalMastery / domainDef.skills.length 
          : 0;

        domains.push({
          id: domainId,
          label: domainDef.label,
          skills,
          avgMastery: Math.round(avgDomainMastery),
          status: getMasteryStatus(avgDomainMastery, skills.reduce((a, s) => a + s.attempts, 0)),
        });

        sectionTotalMastery += avgDomainMastery;
        sectionDomainCount++;
      }

      result.push({
        id: sectionId,
        label: sectionDef.label,
        domains,
        avgMastery: sectionDomainCount > 0 
          ? Math.round(sectionTotalMastery / sectionDomainCount) 
          : 0,
      });
    }

    return res.json({ sections: result });
  } catch (err: any) {
    console.error("[Mastery] Error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /mastery/weakest - READ ONLY endpoint
 * 
 * Returns weakest skills sorted by stored accuracy.
 * Does NOT mutate mastery state or recalculate scores.
 */
router.get('/weakest', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userId = req.user.id;
    const limit = parseInt(req.query.limit as string) || 5;

    const weakest = await getWeakestSkills({
      userId,
      limit,
      minAttempts: 2,
    });

    const formatted = weakest.map((row) => ({
      section: row.section,
      domain: row.domain,
      skill: row.skill,
      label: row.skill.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
      attempts: row.attempts,
      accuracy: Math.round(row.accuracy * 100), // accuracy still in 0-1 range
      mastery_score: Math.round(row.mastery_score), // mastery_score now in 0-100 range
      status: getMasteryStatus(row.mastery_score, row.attempts),
    }));

    return res.json({ weakest: formatted });
  } catch (err: any) {
    console.error("[Mastery] Error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post('/add-to-plan', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userId = req.user.id;
    const { section, domain, skill, targetDate } = req.body;

    if (!section || !skill) {
      return res.status(400).json({ error: 'Section and skill are required' });
    }

    const dayDate = targetDate || getTomorrowDate();
    const supabase = getSupabaseAdmin();

    const { data: existingDay, error: fetchError } = await supabase
      .from("student_study_plan_days")
      .select("focus, tasks, planned_minutes")
      .eq("user_id", userId)
      .eq("day_date", dayDate)
      .single();

    if (fetchError && fetchError.code !== "PGRST116") {
      console.error("[Mastery] Failed to fetch day:", fetchError.message);
      return res.status(500).json({ error: "Failed to fetch study plan day" });
    }

    const competencyId = domain ? `${domain}.${skill}` : skill;
    const sectionLabel = section === "math" ? "Math" : "Reading & Writing";

    const focus = JSON.parse(JSON.stringify(existingDay?.focus || []));
    const tasks = JSON.parse(JSON.stringify(existingDay?.tasks || []));
    const plannedMinutes = existingDay?.planned_minutes || 30;

    const existingFocusIndex = focus.findIndex((f: any) => f.section === sectionLabel);
    if (existingFocusIndex >= 0) {
      const existingFocus = focus[existingFocusIndex];
      const competencies = existingFocus.competencies || [];
      if (!competencies.includes(competencyId)) {
        focus[existingFocusIndex] = {
          ...existingFocus,
          competencies: [...competencies, competencyId],
        };
      }
    } else {
      focus.push({
        section: sectionLabel,
        weight: 0.5,
        competencies: [competencyId],
      });
    }

    const existingTaskIndex = tasks.findIndex((t: any) => t.section === sectionLabel);
    if (existingTaskIndex < 0) {
      tasks.push({
        type: "practice",
        section: sectionLabel,
        mode: "skill-focused",
        minutes: Math.round(plannedMinutes * 0.5),
      });
    }

    const { error: upsertError } = await supabase
      .from("student_study_plan_days")
      .upsert({
        user_id: userId,
        day_date: dayDate,
        focus,
        tasks,
        planned_minutes: plannedMinutes,
        plan_version: 1,
        generated_at: new Date().toISOString(),
      }, { onConflict: "user_id,day_date" });

    if (upsertError) {
      console.error("[Mastery] Failed to update plan:", upsertError.message);
      return res.status(500).json({ error: "Failed to update study plan" });
    }

    return res.json({
      success: true,
      dayDate,
      addedSkill: competencyId,
    });
  } catch (err: any) {
    console.error("[Mastery] Error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export const masteryRouter = router;

