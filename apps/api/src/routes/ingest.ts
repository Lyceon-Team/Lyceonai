/**
 * POST /api/ingest
 * Accepts Q&A items, validates with zod, upserts idempotently, generates embeddings
 * Supports both legacy and Ingestion v2 payloads with canonical fields
 */

import { Request, Response } from "express";
import { z } from "zod";
import { supabase } from "../lib/vector";
import { generateEmbedding } from "../lib/embeddings";

const Option = z.object({
  key: z.enum(["A", "B", "C", "D"]),
  text: z.string().min(1)
});

const Competency = z.object({
  code: z.string(),
  raw: z.string().nullable().optional()
});

const QAItem = z.object({
  id: z.string().uuid(),

  section: z.enum(["Reading", "Writing", "Math"]).nullable().optional(),

  exam: z.string().nullable().optional(),
  testCode: z.string().nullable().optional(),
  sectionCode: z.string().nullable().optional(),
  sourceType: z.number().int().nullable().optional(),
  canonicalId: z.string().nullable().optional(),
  pageNumber: z.number().int().nullable().optional(),
  questionNumber: z.string().nullable().optional(),
  competencies: z.array(Competency).nullable().optional(),

  stem: z.string().min(3),
  options: z.array(Option).min(2),
  answer: z.enum(["A", "B", "C", "D"]).nullable().optional(),
  explanation: z.string().nullable().optional(),
  tags: z.array(z.string()).default([])
});

function cleanStem(raw: string): string {
  if (!raw) return raw;

  let text = raw;

  text = text.replace(/\s+/g, " ").trim();

  text = text.replace(/Question ID\s+\S+/gi, "");
  text = text.replace(/\bAssessment\b/gi, "");
  text = text.replace(/\bSAT\b/gi, "");
  text = text.replace(/\bID:\s*\S+/gi, "");
  text = text.replace(/\bTest\b/gi, "");
  text = text.replace(/\bDomain\b/gi, "");
  text = text.replace(/\bSkill\b/gi, "");
  text = text.replace(/\bDifficulty\b/gi, "");
  text = text.replace(/\bMath\b/gi, "");
  text = text.replace(/\bAlgebra\b/gi, "");
  text = text.replace(/\bGeometry\b/gi, "");
  text = text.replace(/\bTrigonometry\b/gi, "");
  text = text.replace(/\bLinear functions?\b/gi, "");
  text = text.replace(/\bLines,?\s*angles,?\s*and\s*triangles\b/gi, "");
  text = text.replace(/\bArea and volume\b/gi, "");
  text = text.replace(/\band Trigonometry\b/gi, "");

  text = text.replace(/\s+/g, " ").trim();

  text = text.replace(/\bthexy-plane\b/gi, "the xy-plane");
  text = text.replace(/\bIn thexy-plane\b/gi, "In the xy-plane");
  text = text.replace(/\bin thexy-plane\b/gi, "in the xy-plane");
  text = text.replace(/\bA circle in the\b/gi, "A circle in the");
  
  text = text.replace(
    /with a length of inches and a width of inches\?4 9/gi,
    "with a length of 4 inches and a width of 9 inches?"
  );
  text = text.replace(
    /with a length of inches and a width of inches\?\s*4\s*9/gi,
    "with a length of 4 inches and a width of 9 inches?"
  );
  
  text = text.replace(/\bdefined byof\b/gi, "defined by");
  text = text.replace(/\bvalue oft\s*\?\s*,\s*q\b/gi, "value of t?");
  text = text.replace(/\blinep\b/gi, "line p");
  text = text.replace(/\bat circle\?\b/gi, "at (h, k). What is the radius of the circle?");

  text = text.replace(/\s+/g, " ").trim();

  const openerRegex =
    /\b(What|Which|When|Where|In the|If|A cargo|A circle|A rectangle|A function|The graph|The function|How many|Find the|Solve|Calculate|Determine|Given that|Consider|Let|Suppose|An)\b/i;

  const match = text.match(openerRegex);
  if (match && typeof match.index === "number" && match.index > 0) {
    text = text.slice(match.index).trim();
  }

  text = text.replace(/\s+/g, " ").trim();

  if (text.length < 20) {
    return raw.replace(/\s+/g, " ").trim();
  }

  return text;
}

function normalizeBody(body: any): any[] {
  const raw = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [];
  return raw.map((it: any) => {
    if (!it.options && Array.isArray(it.choices)) {
      it.options = it.choices.map((c: any) => ({
        key: String(c.letter || c.key).toUpperCase(),
        text: c.text
      }));
    }
    if (Array.isArray(it.options)) {
      it.options = it.options.map((o: any) => ({
        key: String(o.key || o.letter).toUpperCase(),
        text: String(o.text || "").trim()
      }));
    }
    if (it.section && typeof it.section === "string") {
      const s = it.section.toLowerCase();
      it.section = s === "math" ? "Math" : s === "reading" ? "Reading" : s === "writing" ? "Writing" : null;
    }

    if (typeof it.exam === "string") {
      it.exam = it.exam.trim().toUpperCase();
    }
    if (typeof it.testCode === "string") {
      it.testCode = it.testCode.trim().toUpperCase();
    }
    if (!it.exam && it.testCode) {
      it.exam = it.testCode;
    }
    if (!it.testCode && it.exam) {
      it.testCode = it.exam;
    }

    if (!it.sectionCode && typeof it.section === "string") {
      if (it.section === "Math") it.sectionCode = "M";
      else if (it.section === "Reading" || it.section === "Writing") it.sectionCode = "RW";
    }

    // STEP 2.2: Derive canonical ID BEFORE stem cleaning (uses raw stem)
    // The Question ID pattern is stripped by cleanStem, so extract it first
    if (!it.canonicalId && typeof it.stem === "string") {
      const rawStem = it.stem; // Preserve raw stem for ID extraction
      const derivedId = deriveCanonicalIdFromStem(rawStem);
      if (derivedId) {
        it.canonicalId = derivedId;
        // Auto-set exam/testCode/sectionCode if we found a SAT question ID
        if (!it.exam) it.exam = "SAT";
        if (!it.testCode) it.testCode = "SAT";
        if (!it.sectionCode) it.sectionCode = "M"; // Default to Math for parsed questions
        console.log(`🔖 [INGEST] Auto-derived canonicalId: ${derivedId} (exam=${it.exam}, sectionCode=${it.sectionCode})`);
      }
    }

    if (typeof it.stem === "string") {
      it.stem = cleanStem(it.stem);
    }

    return it;
  });
}

/**
 * STEP 2.2: Extract Question ID from stem and generate canonical ID
 * Looks for patterns like "Question ID XXXXXXXX" in the stem
 */
function deriveCanonicalIdFromStem(stem: string | undefined): string | null {
  if (!stem) return null;
  
  // Pattern: "Question ID XXXXXXXX" where X is hex
  const match = stem.match(/Question\s+ID\s*[:\-]?\s*([a-fA-F0-9]{6,10})/i);
  if (match && match[1]) {
    const hexId = match[1].toUpperCase();
    return `SATM1-${hexId}`;
  }
  
  return null;
}

export async function ingest(req: Request, res: Response) {
  const items = normalizeBody(req.body);
  
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "No items" });
  }

  const parsed: z.infer<typeof QAItem>[] = [];
  const errors: any[] = [];
  
  for (const [idx, it] of items.entries()) {
    const v = QAItem.safeParse(it);
    if (!v.success) {
      errors.push({ idx, issues: v.error.flatten() });
    } else {
      parsed.push(v.data);
    }
  }
  
  if (errors.length) {
    return res.status(422).json({ error: "Invalid items", details: errors });
  }

  if (!supabase) {
    return res.status(500).json({ error: "Supabase not configured" });
  }
  const { data: qres, error: qerr } = await supabase
    .from("questions")
    .upsert(
      parsed.map((q) => ({
        id: q.id,
        section: q.section ?? null,
        stem: q.stem,
        options: q.options,
        answer: q.answer ?? null,
        explanation: q.explanation ?? null,
        tags: q.tags ?? [],
        question_type: "multiple_choice",
        exam: q.exam ?? q.testCode ?? null,
        test_code: q.testCode ?? q.exam ?? null,
        section_code: q.sectionCode ?? null,
        source_type: q.sourceType ?? 1,
        canonical_id: q.canonicalId ?? null,
        competencies: q.competencies ?? null
      })),
      { onConflict: "id", ignoreDuplicates: false }
    )
    .select("id, stem, section, exam, test_code, section_code, difficulty, competencies, canonical_id");
  
  if (qerr) {
    console.error('[INGEST] Supabase questions upsert failed:', qerr.message);
    return res.status(500).json({ error: "Upsert questions failed", details: qerr.message });
  }

  for (const row of qres) {
    const emb = await generateEmbedding(row.stem);
    
    const competencyCodes =
      Array.isArray(row.competencies)
        ? row.competencies
            .map((c: any) => c?.code)
            .filter((c: any) => typeof c === "string")
        : [];

    const metadata = {
      canonicalId: row.canonical_id ?? null,
      testCode: row.test_code ?? row.exam ?? null,
      sectionCode: row.section_code ?? null,
      competencyCodes,
      difficulty: row.difficulty ?? null,
      section: row.section ?? null
    };

    const { error: e2 } = await supabase
      .from("question_embeddings")
      .upsert(
        {
          question_id: row.id,
          section: row.section ?? null,
          exam: row.exam ?? row.test_code ?? null,
          stem: row.stem,
          embedding: emb as any,
          metadata
        },
        { onConflict: "question_id" }
      );
    
    if (e2) {
      console.error('[INGEST] Supabase embeddings upsert failed:', e2.message);
      return res.status(500).json({ error: "Upsert embeddings failed", details: e2.message });
    }
  }

  res.json({ ok: true, upserted: qres.length });
}
