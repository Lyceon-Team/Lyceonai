import { Response, Router } from 'express';
import { type AuthenticatedRequest, getSupabaseAdmin, requireRequestUser } from '../../../../server/middleware/supabase-auth';
import {
  buildMasterySkillTreeFromRows,
  buildMasterySummaryFromRows,
  fetchSkillMasteryRows,
  fetchWeakestSkills,
} from '../services/mastery-read';
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
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const section = req.query.section as string | undefined;

    const rows = await fetchSkillMasteryRows({ userId: user.id, section });
    const summary = buildMasterySummaryFromRows(rows);

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
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const access = await resolvePaidKpiAccessForUser(user.id, user.role);
    if (!access.hasPaidAccess) {
      return res.status(402).json({
        error: 'Premium KPI feature required',
        code: 'PREMIUM_KPI_REQUIRED',
        feature: 'mastery_hexagon',
        message: 'Upgrade to an active paid plan to unlock mastery KPI surfaces.',
        reason: access.reason,
        requestId: (req as any).requestId,
      });
    }
    const rows = await fetchSkillMasteryRows({ userId: user.id });
    const result = buildMasterySkillTreeFromRows(rows, SAT_TAXONOMY);
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
    const user = requireRequestUser(req, res);
    if (!user) {
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
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const userId = user.id;
    const { section, domain, skill, targetDate } = req.body;

    if (!section || !skill) {
      return res.status(400).json({ error: 'Section and skill are required' });
    }

    const dayDate = targetDate || getTomorrowDate();
    const supabase = getSupabaseAdmin();

    const { data: profile, error: profileError } = await supabase
      .from('student_study_profile')
      .select('planner_mode')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileError) {
      console.error('[Mastery] Failed to load planner mode:', profileError.message);
      return res.status(500).json({ error: 'Failed to load planner mode' });
    }

    const plannerMode = profile?.planner_mode === 'custom' ? 'custom' : 'auto';
    const competencyId = domain ? `${domain}.${skill}` : skill;
    const sectionLabel = section === 'math' ? 'Math' : 'Reading & Writing';

    return res.json({
      success: true,
      applied: false,
      planner_mode: plannerMode,
      dayDate,
      addedSkill: competencyId,
      suggestion: {
        type: 'skill_focus',
        section: sectionLabel,
        competency: competencyId,
        reason:
          plannerMode === 'custom'
            ? 'Custom mode keeps planner ownership with the student, so mastery suggestions never auto-apply.'
            : 'Planner ownership is centralized in /api/calendar day edit/regenerate flows.',
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
    console.error('[Mastery] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export const masteryRouter = router;
