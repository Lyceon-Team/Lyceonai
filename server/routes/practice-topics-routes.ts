import { Request, Response } from "express";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import {
  isCanonicalPublishedMcQuestion,
  projectStudentSafeQuestion,
  resolveCanonicalDomain,
  resolveSectionFilterValues,
  type CanonicalQuestionRowLike,
} from "../../shared/question-bank-contract";

const SAT_TOPICS = {
  math: {
    section: "M",
    domains: [
      "Algebra",
      "Advanced Math",
      "Problem Solving & Data Analysis",
      "Geometry & Trigonometry",
    ],
  },
  reading_writing: {
    section: "RW",
    domains: [
      "Craft and Structure",
      "Information and Ideas",
      "Standard English Conventions",
      "Expression of Ideas",
    ],
  },
};

/**
 * @spec [Doc-02B_V4 §14; Coding Standards §9] | @implemented [2026-06-29]
 * Returns sections with domains and skills for practice topic selection.
 */
export async function getPracticeTopics(_req: Request, res: Response) {
  try {
    const { data: skillRows, error } = await supabaseServer
      .from("questions")
      .select("section_code, domain, skill")
      .eq("question_type", "multiple_choice")
      .eq("status", "published");

    if (error) {
      return res.status(500).json({ error: "Failed to fetch topics" });
    }

    const skillsBySection: Record<string, Record<string, Set<string>>> = {};
    for (const row of skillRows ?? []) {
      const sec = String(row.section_code);
      const dom = String(row.domain);
      const sk = row.skill ? String(row.skill) : null;
      if (!skillsBySection[sec]) skillsBySection[sec] = {};
      if (!skillsBySection[sec][dom]) skillsBySection[sec][dom] = new Set();
      if (sk) skillsBySection[sec][dom].add(sk);
    }

    function buildDomains(
      sectionCode: string,
      staticDomains: string[],
    ): Array<{ domain: string; skills: string[] }> {
      const domainMap = skillsBySection[sectionCode] ?? {};
      return staticDomains.map((d) => ({
        domain: d,
        skills: Array.from(domainMap[d] ?? []).sort(),
      }));
    }

    return res.status(200).json({
      sections: [
        {
          section: "math",
          label: "Math",
          sectionCode: SAT_TOPICS.math.section,
          domains: buildDomains("M", SAT_TOPICS.math.domains),
        },
        {
          section: "reading_writing",
          label: "Reading & Writing",
          sectionCode: SAT_TOPICS.reading_writing.section,
          domains: buildDomains("RW", SAT_TOPICS.reading_writing.domains),
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
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "10"), 10) || 10, 1),
      30,
    );

    let query = supabaseServer
      .from("questions")
      .select(
        "id, canonical_id, stem, section_code, question_type, options, difficulty, domain, skill, subskill, skill_code, tags, status",
      )
      .eq("question_type", "multiple_choice")
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(limit);

    const sectionFilters = resolveSectionFilterValues(sectionParam ?? null);
    if (sectionFilters && sectionFilters.length > 0) {
      query = query.in("section_code", sectionFilters);
    }

    if (domain) {
      query = query.eq("domain", resolveCanonicalDomain(domain));
    }
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
