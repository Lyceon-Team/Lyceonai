/**
 * Style Sampler - Deterministic selection of style anchors for jobs
 */
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import type { PdfStyleRef } from "../types";
import { getV4Config } from "./v4Config";

export interface SampleOptions {
  jobId: string;
  requested?: PdfStyleRef[] | null;
  fromLibrary?: {
    exam?: string;
    section?: "Math" | "RW";
    limit?: number;
  };
}

export interface SampledStyleRefs {
  refs: PdfStyleRef[];
  source: "requested" | "library";
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function deterministicSample<T>(items: T[], seed: number, k: number): T[] {
  if (items.length === 0) return [];
  if (k >= items.length) return [...items];
  
  const n = items.length;
  const step = Math.max(1, Math.floor(n / k));
  const selected: T[] = [];
  const usedIndices = new Set<number>();
  
  for (let i = 0; i < k && selected.length < k; i++) {
    let idx = (seed + i * step) % n;
    let attempts = 0;
    while (usedIndices.has(idx) && attempts < n) {
      idx = (idx + 1) % n;
      attempts++;
    }
    if (!usedIndices.has(idx)) {
      usedIndices.add(idx);
      selected.push(items[idx]);
    }
  }
  
  return selected;
}

export async function pickStyleRefsForJob(opts: SampleOptions): Promise<SampledStyleRefs> {
  const config = getV4Config();
  const anchorsPerRun = config.styleAnchorsPerRun;
  
  if (opts.requested && opts.requested.length > 0) {
    const seed = simpleHash(opts.jobId);
    const sampled = deterministicSample(opts.requested, seed, anchorsPerRun);
    return {
      refs: sampled,
      source: "requested"
    };
  }
  
  const supabase = getSupabaseAdmin();
  
  let query = supabase
    .from("ingestion_v4_style_library")
    .select("bucket, path, page_hint, section")
    .order("path", { ascending: true });
  
  if (opts.fromLibrary?.exam) {
    query = query.eq("exam", opts.fromLibrary.exam);
  }
  if (opts.fromLibrary?.section) {
    query = query.eq("section", opts.fromLibrary.section);
  }
  
  const limit = opts.fromLibrary?.limit || 100;
  query = query.limit(limit);
  
  const { data, error } = await query;
  
  if (error || !data || data.length === 0) {
    console.warn(`[StyleSampler] No style refs found in library`);
    return { refs: [], source: "library" };
  }
  
  const libraryRefs: PdfStyleRef[] = data.map((row: any) => ({
    bucket: row.bucket,
    path: row.path,
    pageHint: row.page_hint
  }));
  
  const seed = simpleHash(opts.jobId);
  const sampled = deterministicSample(libraryRefs, seed, anchorsPerRun);
  
  return {
    refs: sampled,
    source: "library"
  };
}

export function getDeterministicSeed(jobId: string): number {
  return simpleHash(jobId);
}

export { simpleHash, deterministicSample };
