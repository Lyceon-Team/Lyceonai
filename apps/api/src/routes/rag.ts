/**
 * POST /api/rag
 * RAG endpoint: embeddings → match_questions → LLM composition
 */

import { Request, Response, Router } from "express";
import { z } from "zod";
import { generateEmbedding, callLlm } from "../lib/embeddings.ts";
import { matchSimilar } from "../lib/vector.ts";

const router = Router();

const RagInput = z.object({
  query: z.string().min(3).max(500), // Prevent excessive query length
  section: z.enum(["Reading", "Writing", "Math"]).optional(),
  topK: z.number().int().min(1).max(8).default(5) // Enforce reasonable bounds
});

export async function rag(req: Request, res: Response) {
  try {
    const v = RagInput.safeParse(req.body);
    if (!v.success) {
      return res.status(400).json({ error: v.error.flatten() });
    }
    
    const { query, section, topK } = v.data;

    // Generate query embedding
    const qvec = await generateEmbedding(query);
    
    // Vector search using match_questions RPC
    const hits = await matchSimilar(qvec, topK, section);

    // Build LLM prompt with context using Lyceon tutor style
    const contextLines = hits.map(h => `ID: ${h.question_id} | Section: ${h.section || "Unknown"} | Stem: ${h.stem}`);
    const prompt = `You are Lyceon — an AI SAT tutor. Speak naturally and clearly.

Format your response as:
1. **Quick answer** - One short sentence with the main idea or result.
2. **Step-by-step** - 3–5 numbered steps, each 1–2 sentences.
3. **Why this works** - 1–2 sentences on the core concept.
4. **Next step** - One helpful follow-up suggestion.

Rules: Be concise. Cite question IDs when used (e.g., from Q-123). Do not invent SAT content.

Context:
${contextLines.join("\n")}

Student's question: ${query}

Respond now:`;

    const answer = await callLlm(prompt);
    
    res.json({
      answer,
      citations: hits.map(h => h.question_id),
      context: hits
    });
  } catch (error: any) {
    console.error("❌ RAG error:", error);
    res.status(500).json({ 
      error: "RAG request failed", 
      details: error.message || String(error)
    });
  }
}

// Mount the rag handler on POST /
router.post('/', rag);

export default router;
