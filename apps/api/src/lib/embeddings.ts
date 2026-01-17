/**
 * Gemini-only embeddings and LLM client.
 * Used by RAG, search, and some legacy ingestion endpoints.
 */

import { GoogleGenAI } from "@google/genai";

let _geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (_geminiClient) return _geminiClient;
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY - required for embeddings and LLM");
  }
  _geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return _geminiClient;
}

/**
 * Primary embedding function used by newer code.
 * Model: text-embedding-004 (768-dim).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getGeminiClient();
  const clean = (text || "").trim();
  if (!clean) return [];

  // Basic length guard to avoid giant payloads
  const input = clean.slice(0, 8000);

  const response: any = await (client as any).models.embedContent({
    model: "text-embedding-004",
    contents: input,
  });

  // Library shape: response.embeddings[0].values
  const values =
    response?.embeddings?.[0]?.values ??
    response?.embedding?.values ??
    [];

  return values as number[];
}

/**
 * Backwards-compatible alias used by older ingestion MVP code.
 */
export async function embeddings(text: string): Promise<number[]> {
  return generateEmbedding(text);
}

/**
 * Lightweight text generation wrapper for Gemini.
 * Used by rag.ts, tutor-v2.ts, etc.
 */
export async function callLlm(prompt: string): Promise<string> {
  const client = getGeminiClient();
  const response: any = await (client as any).models.generateContent({
    model: "gemini-2.0-flash",
    contents: prompt,
  });

  // Older @google/genai helpers often expose `.text`
  if (typeof response?.text === "string") {
    return response.text;
  }

  // More structured shape (if present)
  const candidates = response?.response?.candidates ?? [];
  const parts = candidates[0]?.content?.parts ?? [];
  const text = parts
    .map((p: any) => p?.text ?? "")
    .join("")
    .trim();

  return text || "";
}
