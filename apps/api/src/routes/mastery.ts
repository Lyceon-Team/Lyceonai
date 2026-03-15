import { Response, Router } from 'express';
import { type AuthenticatedRequest, requireRequestUser } from '../../../../server/middleware/supabase-auth';
import { getMasterySummary, getWeakestSkills } from '../services/studentMastery';
import { getSupabaseAdmin } from '../lib/supabase-admin';
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

<<<<<<< HEAD
=======
function getMasteryStatus(score: number, attempts: number): "not_started" | "weak" | "improving" | "proficient" {
  if (attempts === 0) return "not_started";
  if (score < 40) return "weak";
  if (score < 70) return "improving";
  return "proficient";
}

>>>>>>> 72cc5b30fd35c01a282a1128e9b6226a69d0399b
function getTomorrowDate(): string {
  return DateTime.now().plus({ days: 1 }).toISODate()!;
}

const router = Router();

router.get('/summary', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const section = req.query.section as string | undefined;

    const summary = await getMasterySummary(user.id, section);

    res.json({
      ok: true,
      sections: summary,
    });
  } catch (error) {
    console.error('[Mastery] Error getting mastery summary:', error);
    res.status(500).json({ error: 'Failed to get mastery summary' });
  }
});

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
    const userId = user.id;
    const supabase = getSupabaseAdmin();

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
            accuracy: Math.round(accuracy * 100),
            mastery_score: Math.round(mastery_score * 100),
            status: getMasteryStatus(mastery_score * 100, attempts),
          });

          domainTotalMastery += mastery_score * 100;
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

router.get('/weakest', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const userId = user.id;
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
      accuracy: Math.round(row.accuracy * 100),
      mastery_score: Math.round(row.mastery_score * 100),
      status: getMasteryStatus(row.mastery_score * 100, row.attempts),
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
