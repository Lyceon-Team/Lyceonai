/**
 * Domain-aware Style Sampler - Deterministic selection of 8 PNG style anchors
 * Implements "no-mushy" anchor selection with domain isolation
 */
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import type { StylePageRef, StylePackProvenance, MathDomain, DifficultyLevel } from "../types";
import { getV4Config } from "./v4Config";

export interface DomainSampleOptions {
  jobId: string;
  iterationNumber: number;
  exam: string;
  section: "math" | "rw";
  requestedDomain?: MathDomain | null;
  requestedDifficulty?: DifficultyLevel | null;
}

export interface SampledStylePack {
  pages: StylePageRef[];
  provenance: StylePackProvenance;
  source: "domain_match" | "section_fallback" | "empty";
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

function computeDomainMixScore(pages: StylePageRef[]): number {
  const nonNullDomains = pages
    .map(p => p.domain)
    .filter((d): d is MathDomain => d !== null && d !== undefined);
  
  if (nonNullDomains.length === 0) return 0;
  
  const uniqueDomains = new Set(nonNullDomains);
  return Math.max(0, uniqueDomains.size - 1);
}

function computeTagConfidenceAvg(pages: StylePageRef[]): number | null {
  const confidences = pages
    .map(p => p.tagConfidence)
    .filter((c): c is number => c !== null && c !== undefined);
  
  if (confidences.length === 0) return null;
  return confidences.reduce((a, b) => a + b, 0) / confidences.length;
}

function isCleanDomainPack(pages: StylePageRef[], maxAllowedMixed: number = 1): boolean {
  const domains = pages
    .map(p => p.domain)
    .filter((d): d is MathDomain => d !== null && d !== undefined);
  
  if (domains.length === 0) return true;
  
  const unknownCount = pages.filter(p => p.domain === null || p.domain === undefined).length;
  if (unknownCount >= 6) return true;
  
  const uniqueDomains = new Set(domains);
  return uniqueDomains.size <= maxAllowedMixed;
}

export async function pickStylePackForAttempt(opts: DomainSampleOptions): Promise<SampledStylePack> {
  const config = getV4Config();
  const anchorsPerRun = config.styleAnchorsPerRun;
  const seed = simpleHash(`${opts.jobId}-${opts.iterationNumber}`);
  
  const supabase = getSupabaseAdmin();
  
  let query = supabase
    .from("ingestion_v4_style_pages")
    .select("id, bucket, pdf_path, page_number, image_path, domain, difficulty, tag_confidence")
    .eq("exam", opts.exam.toUpperCase())
    .eq("section", opts.section)
    .order("pdf_path", { ascending: true })
    .order("page_number", { ascending: true })
    .limit(200);
  
  if (opts.requestedDomain) {
    const domainQuery = supabase
      .from("ingestion_v4_style_pages")
      .select("id, bucket, pdf_path, page_number, image_path, domain, difficulty, tag_confidence")
      .eq("exam", opts.exam.toUpperCase())
      .eq("section", opts.section)
      .eq("domain", opts.requestedDomain)
      .order("pdf_path", { ascending: true })
      .order("page_number", { ascending: true })
      .limit(100);
    
    if (opts.requestedDifficulty && opts.requestedDifficulty !== "unknown") {
      const difficultyQuery = supabase
        .from("ingestion_v4_style_pages")
        .select("id, bucket, pdf_path, page_number, image_path, domain, difficulty, tag_confidence")
        .eq("exam", opts.exam.toUpperCase())
        .eq("section", opts.section)
        .eq("domain", opts.requestedDomain)
        .eq("difficulty", opts.requestedDifficulty)
        .order("pdf_path", { ascending: true })
        .order("page_number", { ascending: true })
        .limit(100);
      
      const { data: diffData } = await difficultyQuery;
      if (diffData && diffData.length >= anchorsPerRun) {
        const pages = mapRowsToPages(diffData);
        const sampled = deterministicSample(pages, seed, anchorsPerRun);
        return buildResult(sampled, "domain_match");
      }
    }
    
    const { data: domainData } = await domainQuery;
    if (domainData && domainData.length >= anchorsPerRun) {
      const pages = mapRowsToPages(domainData);
      const sampled = deterministicSample(pages, seed, anchorsPerRun);
      return buildResult(sampled, "domain_match");
    }
  }
  
  const { data: sectionData, error } = await query;
  
  if (error || !sectionData || sectionData.length === 0) {
    console.warn(`[DomainSampler] No style pages found for ${opts.exam}/${opts.section}`);
    return {
      pages: [],
      provenance: { stylePageIds: [], styleDomainMixScore: 0, styleTagConfidenceAvg: null },
      source: "empty"
    };
  }
  
  const allPages = mapRowsToPages(sectionData);
  
  if (opts.requestedDomain) {
    const sameDomainPages = allPages.filter(p => 
      p.domain === opts.requestedDomain || p.domain === null || p.domain === undefined
    );
    if (sameDomainPages.length >= anchorsPerRun) {
      const sampled = deterministicSample(sameDomainPages, seed, anchorsPerRun);
      if (isCleanDomainPack(sampled)) {
        return buildResult(sampled, "domain_match");
      }
    }
  }
  
  const sampled = deterministicSample(allPages, seed, anchorsPerRun);
  return buildResult(sampled, "section_fallback");
}

function mapRowsToPages(rows: any[]): StylePageRef[] {
  return rows.map(row => ({
    id: row.id,
    bucket: row.bucket,
    pdfPath: row.pdf_path,
    pageNumber: row.page_number,
    imagePath: row.image_path,
    domain: row.domain as MathDomain | null,
    difficulty: row.difficulty as DifficultyLevel | null,
    tagConfidence: row.tag_confidence as number | null,
  }));
}

function buildResult(pages: StylePageRef[], source: "domain_match" | "section_fallback"): SampledStylePack {
  const mixScore = computeDomainMixScore(pages);
  const avgConfidence = computeTagConfidenceAvg(pages);
  
  console.log(`[DomainSampler] Selected ${pages.length} pages, mixScore=${mixScore}, source=${source}`);
  
  return {
    pages,
    provenance: {
      stylePageIds: pages.map(p => p.id),
      styleDomainMixScore: mixScore,
      styleTagConfidenceAvg: avgConfidence,
    },
    source,
  };
}

export async function incrementTeacherUsage(pageIds: string[]): Promise<void> {
  if (pageIds.length === 0) return;
  
  const supabase = getSupabaseAdmin();
  
  const { error } = await supabase.rpc("increment_style_page_teacher_usage", {
    page_ids: pageIds,
  });
  
  if (error) {
    console.warn(`[DomainSampler] Failed to increment teacher usage (may need RPC migration): ${error.message}`);
    const { error: updateError } = await supabase
      .from("ingestion_v4_style_pages")
      .update({ 
        teacher_used_count: supabase.rpc("add_one_to_teacher_count"),
        last_teacher_used_at: new Date().toISOString() 
      })
      .in("id", pageIds);
    
    if (updateError) {
      console.error(`[DomainSampler] Fallback update also failed: ${updateError.message}`);
    }
  }
}

export async function incrementQaUsage(pageIds: string[]): Promise<void> {
  if (pageIds.length === 0) return;
  
  const supabase = getSupabaseAdmin();
  
  const { error } = await supabase.rpc("increment_style_page_qa_usage", {
    page_ids: pageIds,
  });
  
  if (error) {
    console.warn(`[DomainSampler] Failed to increment QA usage (may need RPC migration): ${error.message}`);
  }
}

export { simpleHash, deterministicSample, computeDomainMixScore, computeTagConfidenceAvg, isCleanDomainPack };
