import { Request, Response } from "express";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import {
  isCanonicalPublishedMcQuestion,
  mapGenesisQuestionRow,
  projectStudentSafeQuestion,
  resolveCanonicalDomain,
  resolveSectionFilterValues,
  type CanonicalQuestionRowLike,
  type CanonicalSectionCode,
} from "../../shared/question-bank-contract";
import { sectionDisplayLabel } from "../../shared/section-display";

// @spec [Doc-05B §4.2] | @implemented [2026-09-02]
// plain English: keyed by the canonical section code, so the key, the response's
// `section` field and the `questions.section` column are all the same string. The
// previous shape carried THREE fields for one concept — `section: "math"`,
// `sectionCode: "M"` and `label: "Math"` — and the client matched on the one the
// database does not store.
const SAT_TOPICS: Record<CanonicalSectionCode, { domains: string[] }> = {
  M: {
    domains: [
      "Algebra",
      "Advanced Math",
      "Problem Solving and Data Analysis",
      "Geometry and Trigonometry",
    ],
  },
  RW: {
    domains: [
      "Craft and Structure",
      "Information and Ideas",
      "Standard English Conventions",
      "Expression of Ideas",
    ],
  },
};

/**
 * @spec [Doc-02B_V4 §14; Coding Standards §9] | @implemented [2026-06-30]
 * Returns sections with domains and skills for practice topic selection.
 * Real schema: questions has section (text), domain (text), skill_codes (text[]).
 */
export async function getPracticeTopics(_req: Request, res: Response) {
  try {
    const { data: skillRows, error } = await supabaseServer
      .from("servable_questions")
      .select("section, domain, skill_codes");

    if (error) {
      return res.status(500).json({ error: "Failed to fetch topics" });
    }

    const skillsBySection: Record<string, Record<string, Set<string>>> = {};
    for (const row of skillRows ?? []) {
      const sec = String(row.section);
      const dom = String(row.domain);
      const codes: string[] = Array.isArray(row.skill_codes)
        ? row.skill_codes
        : [];
      if (!skillsBySection[sec]) skillsBySection[sec] = {};
      if (!skillsBySection[sec][dom]) skillsBySection[sec][dom] = new Set();
      for (const code of codes) {
        if (typeof code === "string" && code.length > 0) {
          skillsBySection[sec][dom].add(code);
        }
      }
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
      sections: (["M", "RW"] as const).map((sectionCode) => ({
        section: sectionCode,
        // The only label produced by this route, from the one display mapping.
        label: sectionDisplayLabel(sectionCode),
        domains: buildDomains(sectionCode, SAT_TOPICS[sectionCode].domains),
      })),
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
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "10"), 10) || 10, 1),
      30,
    );

    let query = supabaseServer
      .from("servable_questions")
      .select(
        "id, stem, section, options, difficulty, domain, skill_codes, status",
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    const sectionFilters = resolveSectionFilterValues(sectionParam ?? null);
    if (sectionFilters && sectionFilters.length > 0) {
      query = query.in("section", sectionFilters);
    }

    if (domain) {
      query = query.eq("domain", resolveCanonicalDomain(domain));
    }
    if (skill) query = query.contains("skill_codes", [skill]);

    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ error: "Failed to fetch questions" });
    }

    const safeQuestions = ((data ?? []) as CanonicalQuestionRowLike[])
      .map((row) => mapGenesisQuestionRow(row))
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
        limit,
      },
    });
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
}

export default { getPracticeTopics, getPracticeQuestions };
