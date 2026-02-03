/**
 * Practice Topics and Filtering Routes
 * 
 * Provides endpoints for browsing and filtering practice questions by topic.
 * Part of Sprint 2 Final Closeout (Gap 5).
 */

import { Router, Request, Response } from "express";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";

const router = Router();

/**
 * SAT Content Areas Taxonomy
 * Based on official SAT knowledge base structure
 */
const SAT_TOPICS = {
  math: {
    section: "Math",
    domains: [
      {
        domain: "Algebra",
        skills: [
          "Linear equations in one variable",
          "Linear equations in two variables",
          "Linear functions and systems",
          "Linear inequalities",
        ],
      },
      {
        domain: "Advanced Math",
        skills: [
          "Equivalent expressions and equations",
          "Nonlinear equations in one variable",
          "Systems of equations in two variables",
          "Nonlinear functions",
        ],
      },
      {
        domain: "Problem-Solving and Data Analysis",
        skills: [
          "Ratios, rates, proportional relationships",
          "Percentages and percent change",
          "One-variable data distributions",
          "Two-variable data relationships",
          "Probability",
        ],
      },
      {
        domain: "Geometry and Trigonometry",
        skills: [
          "Area and volume calculations",
          "Lines, angles, and triangles",
          "Right triangles and trigonometry",
          "Circles",
        ],
      },
    ],
  },
  reading_writing: {
    section: "Reading/Writing",
    domains: [
      {
        domain: "Craft and Structure",
        skills: [
          "Words in context vocabulary",
          "Text structure and purpose analysis",
          "Cross-text connections",
        ],
      },
      {
        domain: "Information and Ideas",
        skills: [
          "Central ideas and details",
          "Command of textual evidence",
          "Inferences and interpretations",
        ],
      },
      {
        domain: "Standard English Conventions",
        skills: [
          "Sentence boundaries and structure",
          "Subject-verb agreement",
          "Verb forms and tenses",
          "Pronouns",
          "Punctuation usage",
        ],
      },
      {
        domain: "Expression of Ideas",
        skills: [
          "Rhetorical synthesis and transitions",
          "Logical sequence and cohesion",
          "Style, tone, and syntax",
        ],
      },
    ],
  },
};

/**
 * GET /api/practice/topics
 * 
 * Returns the canonical list of SAT topics (domains and skills) available for practice.
 * 
 * @route GET /api/practice/topics
 * @auth requireSupabaseAuth, requireStudentOrAdmin
 */
export async function getPracticeTopics(req: Request, res: Response) {
  try {
    // Return structured topic taxonomy
    const sections = [
      {
        section: "math",
        label: "Math",
        domains: SAT_TOPICS.math.domains,
      },
      {
        section: "reading_writing",
        label: "Reading & Writing",
        domains: SAT_TOPICS.reading_writing.domains,
      },
    ];

    return res.status(200).json({ sections });
  } catch (error: any) {
    console.error("[practice/topics] Unexpected error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * GET /api/practice/questions
 * 
 * Returns filtered question stubs for practice (without answer leakage).
 * 
 * @route GET /api/practice/questions
 * @auth requireSupabaseAuth, requireStudentOrAdmin
 * @query section - Optional: 'math' | 'reading_writing'
 * @query domain - Optional: domain name (e.g., 'Algebra')
 * @query skill - Optional: skill name (for future filtering)
 * @query limit - Optional: number of questions (default 10, max 30)
 */
export async function getPracticeQuestions(req: Request, res: Response) {
  try {
    // Parse query parameters
    const sectionParam = req.query.section as string | undefined;
    const domain = req.query.domain as string | undefined;
    const limitParam = parseInt(req.query.limit as string) || 10;
    const limit = Math.min(Math.max(limitParam, 1), 30);

    // Normalize section parameter
    let section: string | null = null;
    if (sectionParam) {
      const normalized = sectionParam.toLowerCase();
      if (normalized === "math") {
        section = "Math";
      } else if (normalized === "reading_writing" || normalized === "reading" || normalized === "writing") {
        // Accept both 'Reading' and 'Writing' as they may be stored separately
        // For now, we'll search for both Reading and Writing sections
        section = null; // Will use OR filter below
      }
    }

    // Build query
    let query = supabaseServer
      .from("questions")
      .select(`
        id,
        stem,
        section,
        type,
        options,
        difficulty,
        classification,
        canonical_id
      `)
      .order("created_at", { ascending: false });

    // Apply section filter
    if (section === "Math") {
      query = query.eq("section", "Math");
    } else if (sectionParam && (sectionParam.toLowerCase() === "reading_writing" || sectionParam.toLowerCase() === "reading" || sectionParam.toLowerCase() === "writing")) {
      query = query.in("section", ["Reading", "Writing"]);
    }

    // Apply domain filter if provided
    // Note: This is a simple implementation. In production, you'd want to:
    // 1. Store domain/skill as indexed columns, OR
    // 2. Use full-text search on classification JSONB, OR
    // 3. Have a question_competencies join table
    // For now, we'll just return questions without deep filtering
    // and let the client do additional filtering if needed

    // Apply limit
    query = query.limit(limit);

    const { data: questions, error } = await query;

    if (error) {
      console.error("[practice/questions] Database error:", error);
      return res.status(500).json({ error: "Failed to fetch questions" });
    }

    // Map to safe DTOs (no answer leakage)
    const safeQuestions = (questions || []).map((q: any) => {
      // Parse options if it's a string
      let options = null;
      if (q.type === "mc" && q.options) {
        if (typeof q.options === "string") {
          try {
            options = JSON.parse(q.options);
          } catch {
            options = null;
          }
        } else if (Array.isArray(q.options)) {
          options = q.options;
        }
      }

      return {
        id: q.id,
        canonical_id: q.canonical_id || null,
        section: q.section,
        stem: q.stem,
        type: q.type,
        options,
        difficulty: q.difficulty || null,
        // Don't include classification which may contain answer keys
      };
    });

    return res.status(200).json({
      questions: safeQuestions,
      count: safeQuestions.length,
      filters: {
        section: sectionParam || null,
        domain: domain || null,
        limit,
      },
    });
  } catch (error: any) {
    console.error("[practice/questions] Unexpected error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export default router;
