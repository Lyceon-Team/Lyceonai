/**
 * Style Page Sampler - Selects 8 PNG style pages for Teacher + QA with provenance tracking
 * Supports cluster-first sampling for coherent pack selection
 */
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import type { MathDomain, DifficultyLevel } from "../types";

export interface StylePageRecord {
  id: string;
  bucket: string;
  pdf_path: string;
  page_number: number;
  image_path: string;
  exam: string;
  section: string;
  domain: MathDomain | null;
  difficulty: DifficultyLevel | null;
  skill: string | null;
  tag_confidence: number | null;
  diagram_present: boolean | null;
  teacher_used_count: number;
  qa_used_count: number;
  primary_cluster_id?: string | null;
}

export interface StylePackResult {
  pages: StylePageRecord[];
  style_page_ids: string[];
  domainMixScore: number;
  tagConfidenceAvg: number | null;
  clusterId?: string | null;
  clusterKey?: string | null;
  usedClusterSampling: boolean;
}

export interface PickStylePagesParams {
  jobId: string;
  iteration: number;
  exam?: string;
  section?: "math" | "rw";
  targetCount?: number;
  useClusterSampling?: boolean;
  clusterId?: string;
}

const DEFAULT_PACK_SIZE = 8;

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

function computeDomainMixScore(pages: StylePageRecord[]): number {
  const concreteDomains = pages
    .map(p => p.domain)
    .filter((d): d is MathDomain => d !== null && d !== undefined);
  
  if (concreteDomains.length === 0) return 0;
  
  const uniqueDomains = new Set(concreteDomains);
  return Math.max(0, uniqueDomains.size - 1);
}

function computeTagConfidenceAvg(pages: StylePageRecord[]): number | null {
  const confidences = pages
    .map(p => p.tag_confidence)
    .filter((c): c is number => c !== null && c !== undefined);
  
  if (confidences.length === 0) return null;
  return confidences.reduce((a, b) => a + b, 0) / confidences.length;
}

function isCleanDomainPack(pages: StylePageRecord[]): boolean {
  const concreteDomains = pages
    .map(p => p.domain)
    .filter((d): d is MathDomain => d !== null && d !== undefined);
  
  if (concreteDomains.length === 0) return true;
  
  const unknownCount = pages.filter(p => p.domain === null || p.domain === undefined).length;
  if (unknownCount >= 6) return true;
  
  const uniqueDomains = new Set(concreteDomains);
  return uniqueDomains.size <= 1;
}

async function pickFromCluster(
  section: "math" | "rw",
  clusterId: string | undefined,
  seed: number,
  targetCount: number
): Promise<{ pages: StylePageRecord[]; clusterId: string | null; clusterKey: string | null } | null> {
  const supabase = getSupabaseAdmin();
  
  let selectedClusterId = clusterId;
  let selectedClusterKey: string | null = null;
  
  if (selectedClusterId) {
    // Fetch cluster metadata when clusterId is explicitly provided
    const { data: clusterInfo, error: infoErr } = await supabase
      .from("ingestion_v4_style_clusters")
      .select("id, cluster_key")
      .eq("id", selectedClusterId)
      .single();
    
    if (infoErr || !clusterInfo) {
      console.log(`[StylePageSampler] Provided clusterId=${selectedClusterId} not found, falling back to weighted selection`);
      selectedClusterId = undefined;
    } else {
      selectedClusterKey = clusterInfo.cluster_key;
    }
  }
  
  if (!selectedClusterId) {
    const { data: clusters, error: clusterErr } = await supabase
      .from("ingestion_v4_style_clusters")
      .select("id, cluster_key, usage_count")
      .eq("section", section)
      .eq("active", true)
      .order("usage_count", { ascending: true })
      .limit(50);
    
    if (clusterErr || !clusters || clusters.length === 0) {
      return null;
    }
    
    const weights = clusters.map(c => 1 / (c.usage_count + 1));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let pick = (seed % 10000) / 10000 * totalWeight;
    
    for (let i = 0; i < clusters.length; i++) {
      pick -= weights[i];
      if (pick <= 0) {
        selectedClusterId = clusters[i].id;
        selectedClusterKey = clusters[i].cluster_key;
        break;
      }
    }
    
    if (!selectedClusterId) {
      selectedClusterId = clusters[0].id;
      selectedClusterKey = clusters[0].cluster_key;
    }
  }
  
  const { data: pages, error: pageErr } = await supabase
    .from("ingestion_v4_style_pages")
    .select("id, bucket, pdf_path, page_number, image_path, exam, section, domain, difficulty, skill, tag_confidence, diagram_present, teacher_used_count, qa_used_count, primary_cluster_id")
    .eq("primary_cluster_id", selectedClusterId)
    .order("teacher_used_count", { ascending: true })
    .limit(targetCount * 2);
  
  if (pageErr || !pages || pages.length === 0) {
    return null;
  }
  
  await supabase.rpc("v4_increment_cluster_usage", { p_cluster_id: selectedClusterId, p_n: 1 });
  
  const selectedPages = deterministicSample(pages as StylePageRecord[], seed, targetCount);
  
  return {
    pages: selectedPages,
    clusterId: selectedClusterId || null,
    clusterKey: selectedClusterKey
  };
}

export async function pickStylePagesForJob(params: PickStylePagesParams): Promise<StylePackResult> {
  const { 
    jobId, 
    iteration, 
    exam = "SAT", 
    section, 
    targetCount = DEFAULT_PACK_SIZE,
    useClusterSampling = false,
    clusterId
  } = params;
  const seed = simpleHash(`${jobId}-${iteration}`);
  
  const supabase = getSupabaseAdmin();
  
  if (useClusterSampling && section) {
    const clusterResult = await pickFromCluster(section, clusterId, seed, targetCount);
    
    if (clusterResult && clusterResult.pages.length >= Math.min(4, targetCount)) {
      const domainMixScore = computeDomainMixScore(clusterResult.pages);
      const tagConfidenceAvg = computeTagConfidenceAvg(clusterResult.pages);
      
      console.log(`[StylePageSampler] Cluster-sampled ${clusterResult.pages.length} pages from cluster=${clusterResult.clusterKey}, seed=${seed}`);
      
      return {
        pages: clusterResult.pages,
        style_page_ids: clusterResult.pages.map(p => p.id),
        domainMixScore,
        tagConfidenceAvg,
        clusterId: clusterResult.clusterId,
        clusterKey: clusterResult.clusterKey,
        usedClusterSampling: true
      };
    }
    console.log(`[StylePageSampler] Cluster sampling failed or insufficient pages, falling back to domain sampling`);
  }
  
  // Normalize exam - database may store uppercase (SAT) or lowercase (sat)
  // We use ilike for case-insensitive matching
  const normalizedExam = exam.toUpperCase();
  const normalizedSection = section ? section.toLowerCase() : null;
  
  let query = supabase
    .from("ingestion_v4_style_pages")
    .select("id, bucket, pdf_path, page_number, image_path, exam, section, domain, difficulty, skill, tag_confidence, diagram_present, teacher_used_count, qa_used_count, primary_cluster_id")
    .ilike("exam", normalizedExam)
    .order("teacher_used_count", { ascending: true })
    .order("pdf_path", { ascending: true })
    .order("page_number", { ascending: true })
    .limit(200);
  
  if (normalizedSection) {
    query = query.ilike("section", normalizedSection);
  }
  
  const { data, error } = await query;
  
  if (error || !data || data.length === 0) {
    console.warn(`[StylePageSampler] No style pages found for exam=${exam}, section=${section}`);
    return {
      pages: [],
      style_page_ids: [],
      domainMixScore: 0,
      tagConfidenceAvg: null,
      usedClusterSampling: false
    };
  }
  
  const allPages = data as StylePageRecord[];
  
  const grouped: Record<string, StylePageRecord[]> = {};
  for (const page of allPages) {
    const domain = page.domain || "__unknown__";
    if (!grouped[domain]) grouped[domain] = [];
    grouped[domain].push(page);
  }
  
  const domainKeys = Object.keys(grouped).filter(k => k !== "__unknown__");
  const unknownPages = grouped["__unknown__"] || [];
  
  let selectedPages: StylePageRecord[] = [];
  
  if (domainKeys.length === 1) {
    const domainPages = grouped[domainKeys[0]];
    const combined = [...domainPages, ...unknownPages];
    selectedPages = deterministicSample(combined, seed, targetCount);
  } else if (unknownPages.length >= 6) {
    const otherPages = allPages.filter(p => p.domain !== null);
    const combined = [...unknownPages, ...otherPages.slice(0, 2)];
    selectedPages = deterministicSample(combined, seed, targetCount);
  } else if (domainKeys.length > 0) {
    const primaryDomainIdx = seed % domainKeys.length;
    const primaryDomain = domainKeys[primaryDomainIdx];
    const primaryPages = grouped[primaryDomain];
    const combined = [...primaryPages, ...unknownPages];
    selectedPages = deterministicSample(combined, seed, targetCount);
  } else {
    selectedPages = deterministicSample(unknownPages, seed, targetCount);
  }
  
  if (!isCleanDomainPack(selectedPages) && selectedPages.length > 0) {
    const dominantDomain = selectedPages
      .map(p => p.domain)
      .filter((d): d is MathDomain => d !== null)
      .reduce((acc: Record<string, number>, d) => {
        acc[d] = (acc[d] || 0) + 1;
        return acc;
      }, {});
    
    const sortedDomains = Object.entries(dominantDomain).sort((a, b) => b[1] - a[1]);
    if (sortedDomains.length > 0) {
      const keepDomain = sortedDomains[0][0];
      const cleanPages = allPages.filter(p => p.domain === keepDomain || p.domain === null);
      if (cleanPages.length >= targetCount) {
        selectedPages = deterministicSample(cleanPages, seed, targetCount);
      } else if (cleanPages.length >= 4) {
        const remaining = allPages.filter(p => !cleanPages.includes(p));
        const backfill = deterministicSample(remaining, seed + 1, targetCount - cleanPages.length);
        selectedPages = [...cleanPages, ...backfill].slice(0, targetCount);
      }
    }
  }
  
  if (selectedPages.length < targetCount && allPages.length >= targetCount) {
    const existing = new Set(selectedPages.map(p => p.id));
    const remaining = allPages.filter(p => !existing.has(p.id));
    const backfill = deterministicSample(remaining, seed + 2, targetCount - selectedPages.length);
    selectedPages = [...selectedPages, ...backfill];
  }
  
  const domainMixScore = computeDomainMixScore(selectedPages);
  const tagConfidenceAvg = computeTagConfidenceAvg(selectedPages);
  
  console.log(`[StylePageSampler] Selected ${selectedPages.length} pages via domain sampling, mixScore=${domainMixScore}, seed=${seed}`);
  
  return {
    pages: selectedPages,
    style_page_ids: selectedPages.map(p => p.id),
    domainMixScore,
    tagConfidenceAvg,
    clusterId: null,
    clusterKey: null,
    usedClusterSampling: false
  };
}

export async function incrementTeacherUsage(stylePageIds: string[]): Promise<void> {
  if (stylePageIds.length === 0) return;
  
  const supabase = getSupabaseAdmin();
  
  try {
    const { error } = await supabase.rpc("increment_style_page_teacher_usage", {
      page_ids: stylePageIds
    });
    
    if (error) {
      console.warn(`[StylePageSampler] Failed to increment teacher usage via RPC: ${error.message}`);
    }
  } catch (err: any) {
    console.warn(`[StylePageSampler] Teacher usage increment failed: ${err.message}`);
  }
}

export async function incrementQaUsage(stylePageIds: string[]): Promise<void> {
  if (stylePageIds.length === 0) return;
  
  const supabase = getSupabaseAdmin();
  
  try {
    const { error } = await supabase.rpc("increment_style_page_qa_usage", {
      page_ids: stylePageIds
    });
    
    if (error) {
      console.warn(`[StylePageSampler] Failed to increment QA usage via RPC: ${error.message}`);
    }
  } catch (err: any) {
    console.warn(`[StylePageSampler] QA usage increment failed: ${err.message}`);
  }
}

export { simpleHash, deterministicSample, computeDomainMixScore, computeTagConfidenceAvg, isCleanDomainPack };
