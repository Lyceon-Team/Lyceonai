/**
 * Gemini-only embeddings and LLM client.
 * Used by RAG and search services.
 */

import { GoogleGenAI } from "@google/genai";

let _geminiClient: GoogleGenAI | null = null;

function isTestEnv(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

function getGeminiClient(): GoogleGenAI | null {
  if (_geminiClient) return _geminiClient;
  if (!process.env.GEMINI_API_KEY) {
    if (isTestEnv()) {
      // During CI we purposely don't have a key; return null so callers can
      // handle the missing API without crashing. Logging at debug to avoid
      // cluttering CI output.
      console.debug('[EMBEDDINGS] GEMINI_API_KEY missing in test mode, using stub');
      return null;
    }
    // In development/production we want a hard failure so the absence of the
    // key is obvious during startup.
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
  if (!client) {
    // no API key / stub client: return deterministic empty vector
    return [];
  }
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
 * Backwards-compatible alias retained for older callers.
 */
export async function embeddings(text: string): Promise<number[]> {
  return generateEmbedding(text);
}

/**
 * Lightweight text generation wrapper for Gemini.
 * Used by tutor-v2.ts and related runtime AI services.
 * 
 * @param contents - Simple string or structured content parts/roles
 * @param systemInstruction - Optional system instruction to guide the model
 */
export async function callLlm(
  contents: string | any[],
  systemInstruction?: string
): Promise<string> {
  const client = getGeminiClient();
  if (!client) {
    // no key available in test env; return empty string rather than throw
    return '';
  }

  const body: any = {
    model: "gemini-2.0-flash",
    contents: typeof contents === "string" ? [{ role: "user", parts: [{ text: contents }] }] : contents,
  };

  if (systemInstruction) {
    body.config = {
      ...body.config,
      systemInstruction: systemInstruction,
    };
  }

  const response: any = await (client as any).models.generateContent(body);

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
