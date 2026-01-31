import { GoogleGenAI, GenerateContentResponse, Part } from "@google/genai";
import { z } from "zod";

let geminiInstance: GoogleGenAI | null = null;

function tryRepairTruncatedJson(text: string): string | null {
  if (!text || text.length < 10) return null;
  
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let lastValidEnd = -1;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const prevChar = i > 0 ? text[i - 1] : '';
    
    if (char === '"' && prevChar !== '\\') {
      inString = !inString;
      continue;
    }
    
    if (inString) continue;
    
    if (char === '{') openBraces++;
    else if (char === '}') {
      openBraces--;
      if (openBraces === 0 && openBrackets === 0) {
        lastValidEnd = i;
      }
    }
    else if (char === '[') openBrackets++;
    else if (char === ']') {
      openBrackets--;
      if (openBraces === 0 && openBrackets === 0) {
        lastValidEnd = i;
      }
    }
  }
  
  if (lastValidEnd > 0 && lastValidEnd < text.length - 1) {
    return text.substring(0, lastValidEnd + 1);
  }
  
  if (openBraces > 0 || openBrackets > 0) {
    let repaired = text;
    
    while (openBrackets > 0) {
      repaired += ']';
      openBrackets--;
    }
    while (openBraces > 0) {
      repaired += '}';
      openBraces--;
    }
    
    return repaired;
  }
  
  return null;
}

export interface PdfAttachment {
  mimeType: string;
  data: Buffer;
  name?: string;
}

/**
 * Returns the Gemini API key from environment variables.
 * Checks multiple possible env var names.
 */
export function getGeminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY 
    || process.env.GOOGLE_AI_API_KEY 
    || process.env.GOOGLE_API_KEY 
    || null;
}

/**
 * Returns which env var the Gemini key was found in, or null if missing.
 */
export function getGeminiKeySource(): string | null {
  if (process.env.GEMINI_API_KEY) return "GEMINI_API_KEY";
  if (process.env.GOOGLE_AI_API_KEY) return "GOOGLE_AI_API_KEY";
  if (process.env.GOOGLE_API_KEY) return "GOOGLE_API_KEY";
  return null;
}

/**
 * Gemini is enabled when a valid API key is present.
 * No toggle - key presence is the only gate.
 */
export function isV4GeminiEnabled(): boolean {
  return Boolean(getGeminiApiKey());
}

export function getGeminiModel(): GoogleGenAI {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("Gemini API key not configured. Set GEMINI_API_KEY, GOOGLE_AI_API_KEY, or GOOGLE_API_KEY");
  }

  if (!geminiInstance) {
    geminiInstance = new GoogleGenAI({ apiKey });
  }

  return geminiInstance;
}

export async function generateJson<TSchema extends z.ZodTypeAny>(
  prompt: string,
  schema: TSchema,
  modelName: string = "gemini-2.0-flash"
): Promise<z.output<TSchema>> {
  return generateJsonWithAttachments(prompt, schema, [], modelName);
}

export async function generateJsonWithAttachments<TSchema extends z.ZodTypeAny>(
  prompt: string,
  schema: TSchema,
  attachments: PdfAttachment[] = [],
  modelName: string = "gemini-2.0-flash"
): Promise<z.output<TSchema>> {
  const gemini = getGeminiModel();

  const parts: Part[] = [{ text: prompt }];
  
  for (const attachment of attachments) {
    parts.push({
      inlineData: {
        mimeType: attachment.mimeType,
        data: attachment.data.toString("base64")
      }
    });
  }

  const response: GenerateContentResponse = await gemini.models.generateContent({
    model: modelName,
    contents: [
      {
        role: "user",
        parts
      }
    ],
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned empty response");
  }

  console.log(`[Gemini] Response length: ${text.length} chars, finishReason: ${response.candidates?.[0]?.finishReason || 'unknown'}`);

  let jsonPayload: unknown;
  try {
    jsonPayload = JSON.parse(text);
  } catch (e) {
    const cleanedText = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    try {
      jsonPayload = JSON.parse(cleanedText);
    } catch (e2) {
      const repaired = tryRepairTruncatedJson(cleanedText);
      if (repaired) {
        try {
          jsonPayload = JSON.parse(repaired);
          console.log("[Gemini] Successfully repaired truncated JSON response");
        } catch (e3) {
          throw new Error(`Failed to parse Gemini JSON after repair attempt: ${text.substring(0, 300)}`);
        }
      } else {
        throw new Error(`Failed to parse Gemini JSON: ${text.substring(0, 300)}`);
      }
    }
  }

  const result = schema.safeParse(jsonPayload);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Gemini output validation failed: ${issues}`);
  }

  return result.data;
}
