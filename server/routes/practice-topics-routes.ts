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
import { fetchSkillCatalog } from "../../apps/api/src/services/skill-catalog-read";
import { logger } from "../logger";

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
 * @spec [Doc-02B_V4 §14; Coding Standards §9; student-UI register §8 F-56, owner ruling (Karl)
 *   2026-10-02: build the topic list from canonical_skill_catalog] | @implemented [2026-06-30;
 *   rebuilt 2026-10-02]
 * Returns sections with domains and skills for practice topic selection.
 *
 * plain English: the skill list comes from `canonical_skill_catalog` (distinct section, domain,
 * skill over published questions) through `fetchSkillCatalog`, the one reader of that view.
 * It used to be built from an unbounded `select section, domain, skill_codes` over every
 * `servable_questions` row. PostgREST caps a response at the project's `max_rows` (1,000 in
 * production, where the bank holds 6,821 servable questions: every call returned rows 0-999),
 * so any skill that appeared only after the first 1,000 rows silently left the picker. The
 * catalog is one row per (section, domain, skill), 29 today, so the cap never bites.
 * trade-offs: the catalog is "published" and the old read was "servable". In production the two
 * give the same 29 triples (checked 2026-10-02). A skill published but not yet servable would
 * appear in the picker and start an empty session (422 PRACTICE_POOL_EMPTY), which is honest.
 * edge cases: a catalog read failure throws inside `fetchSkillCatalog` and becomes a 500 here,
 * never an empty skill list.
 */
export async function getPracticeTopics(_req: Request, res: Response) {
  try {
    const catalog = await fetchSkillCatalog();

    const skillsBySection: Record<string, Record<string, string[]>> = {};
    for (const entry of catalog) {
      const bySection = (skillsBySection[entry.section] ??= {});
      (bySection[entry.domain] ??= []).push(entry.skill);
    }

    function buildDomains(
      sectionCode: CanonicalSectionCode,
    ): Array<{ domain: string; skills: string[] }> {
      const domainMap = skillsBySection[sectionCode] ?? {};
      // fetchSkillCatalog already sorts by section, domain, skill.
      return SAT_TOPICS[sectionCode].domains.map((d) => ({
        domain: d,
        skills: domainMap[d] ?? [],
      }));
    }

    return res.status(200).json({
      sections: (["M", "RW"] as const).map((sectionCode) => ({
        section: sectionCode,
        // The only label produced by this route, from the one display mapping.
        label: sectionDisplayLabel(sectionCode),
        domains: buildDomains(sectionCode),
      })),
    });
  } catch (err) {
    logger.error(
      "practice_topics",
      "catalog_read_failed",
      "Practice topic list failed",
      err,
    );
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

    // @spec [Doc-02B_V4 §14; owner ruling UI-07 2026-09-29] | @implemented [2026-09-29]
    // plain English: no `count` (or any other tally) on this student response — students
    // never see question-bank counts. The shape is pinned by the strict
    // `practiceReferenceQuestionsResponseSchema` in packages/shared; `filters.limit` is the
    // requested page size echoed back, not a bank count.
    return res.status(200).json({
      questions: safeQuestions,
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
