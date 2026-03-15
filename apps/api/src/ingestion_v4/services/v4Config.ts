import { isV4GeminiEnabled, getGeminiKeySource } from "./gemini";

export interface V4Config {
  geminiEnabled: boolean;
  geminiKeySource: string | null;
  geminiError: string | null;
  batchMax: number;
  sleepMsDefault: number;
  qaFailDefault: number;
  styleAnchorsPerRun: number;
  styleMaxBytesTotal: number;
}

function parseIntSafe(value: string | undefined, defaultVal: number, min: number, max: number): number {
  if (!value) return defaultVal;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) return defaultVal;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

export function getV4Config(): V4Config {
  const geminiEnabled = isV4GeminiEnabled();
  const geminiKeySource = getGeminiKeySource();
  
  return {
    geminiEnabled,
    geminiKeySource,
    geminiError: geminiEnabled ? null : "Missing Gemini API key env var (GEMINI_API_KEY, GOOGLE_AI_API_KEY, or GOOGLE_API_KEY)",
    batchMax: parseIntSafe(process.env.V4_BATCH_MAX, 25, 1, 100),
    sleepMsDefault: parseIntSafe(process.env.V4_SLEEP_MS_DEFAULT, 1200, 100, 10000),
    qaFailDefault: parseIntSafe(process.env.V4_QA_FAIL_DEFAULT, 3, 1, 10),
    styleAnchorsPerRun: parseIntSafe(process.env.V4_STYLE_ANCHORS_PER_RUN, 3, 1, 8),
    styleMaxBytesTotal: parseIntSafe(process.env.V4_STYLE_MAX_BYTES_TOTAL, 8 * 1024 * 1024, 1024 * 1024, 20 * 1024 * 1024),
  };
}

export function requireGeminiEnabled(): void {
  if (!isV4GeminiEnabled()) {
    throw new Error("Gemini API key not configured");
  }
}
