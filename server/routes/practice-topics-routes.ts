import { Request, Response } from "express";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";

const SAT_TOPICS = {
  math: {
    section: "MATH",
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
        { section: "reading_writing", label: "Reading & Writing", sectionCode: SAT_TOPICS.reading_writing.section, domains: SAT_TOPICS.reading_writing.domains },
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
      .select("id, canonical_id, stem, section, section_code, question_type, options, difficulty, domain, skill, subskill, skill_code, tags, competencies")
      .eq("status", "published")
      .eq("question_type", "multiple_choice")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (sectionParam) {
      const normalized = sectionParam.toLowerCase();
      if (normalized === "math") query = query.eq("section_code", "MATH");
      if (normalized === "reading_writing" || normalized === "reading" || normalized === "writing" || normalized === "rw") {
        query = query.eq("section_code", "RW");
      }
    }

    if (domain) query = query.eq("domain", domain);
    if (skill) query = query.eq("skill", skill);
    if (skillCode) query = query.eq("skill_code", skillCode);

    const { data: questions, error } = await query;
    if (error) return res.status(500).json({ error: "Failed to fetch questions" });

    const safeQuestions = (questions || []).map((q: any) => ({
      id: q.id,
      canonical_id: q.canonical_id,
      section: q.section,
      section_code: q.section_code,
      question_type: q.question_type,
      stem: q.stem,
      options: Array.isArray(q.options) ? q.options : [],
      difficulty: q.difficulty,
      domain: q.domain,
      skill: q.skill,
      subskill: q.subskill,
      skill_code: q.skill_code,
      tags: q.tags ?? null,
      competencies: q.competencies ?? null,
      explanation: null,
    }));

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
