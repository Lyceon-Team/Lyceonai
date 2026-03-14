import { Request, Response } from "express";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import {
  isCanonicalPublishedMcQuestion,
  projectStudentSafeQuestion,
  resolveSectionFilterValues,
  type CanonicalQuestionRowLike,
} from "../../shared/question-bank-contract";

const SAT_TOPICS = {
  math: {
    section: "M",
    domains: ["Algebra", "Advanced Math", "Problem Solving & Data Analysis", "Geometry & Trigonometry"],
  },
  reading_writing: {
    section: "RW",
    domains: ["Craft and Structure", "Information and Ideas", "Standard English Conventions", "Expression of Ideas"],
  },
};

export async function getPracticeTopics(_req: Request, res: Response) {
  try {
    return res.status(200).json({
      sections: [
        { section: "math", label: "Math", sectionCode: SAT_TOPICS.math.section, domains: SAT_TOPICS.math.domains },
        {
          section: "reading_writing",
          label: "Reading & Writing",
          sectionCode: SAT_TOPICS.reading_writing.section,
          domains: SAT_TOPICS.reading_writing.domains,
        },
      ],
    });
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function getPracticeQuestions(req: Request, res: Response) {
  try {
    const sectionParam = req.query.section as string | undefined;
    const domain = req.query.domain as string | undefined;
    const skill = req.query.skill as string | undefined;
    const skillCode = req.query.skillCode as string | undefined;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "10"), 10) || 10, 1), 30);

    let query = supabaseServer
      .from("questions")
      .select(
        "id, canonical_id, status, stem, section, section_code, question_type, options, difficulty, domain, skill, subskill, skill_code, tags, competencies"
      )
      .eq("status", "published")
      .eq("question_type", "multiple_choice")
      .order("created_at", { ascending: false })
      .limit(limit);

    const sectionFilters = resolveSectionFilterValues(sectionParam ?? null);
    if (sectionFilters && sectionFilters.length > 0) {
      query = query.in("section_code", sectionFilters);
    }

    if (domain) query = query.eq("domain", domain);
    if (skill) query = query.eq("skill", skill);
    if (skillCode) query = query.eq("skill_code", skillCode);

    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ error: "Failed to fetch questions" });
    }

    const safeQuestions = ((data ?? []) as CanonicalQuestionRowLike[])
      .filter((row) => isCanonicalPublishedMcQuestion(row))
      .map((row) => {
        const safe = projectStudentSafeQuestion(row);
        return {
          ...safe,
          canonicalId: safe.canonical_id,
          sectionCode: safe.section_code,
          questionType: "multiple_choice" as const,
          type: "mc" as const,
        };
      });

    return res.status(200).json({
      questions: safeQuestions,
      count: safeQuestions.length,
      filters: {
        section: sectionParam || null,
        domain: domain || null,
        skill: skill || null,
        skillCode: skillCode || null,
        limit,
      },
    });
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export default { getPracticeTopics, getPracticeQuestions };
