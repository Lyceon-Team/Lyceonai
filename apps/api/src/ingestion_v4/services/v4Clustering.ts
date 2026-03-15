/**
 * V4 Dynamic Clustering Service (Supaprompt v2)
 * 
 * Provides LLM-based clustering of style pages into "question families"
 * for coherent pack selection during Teacher + QA runs.
 * 
 * Uses the Lyceon V4 Clustering Supaprompt v2 as the sole system prompt.
 */

import { z } from "zod";
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import { generateJsonWithAttachments, isV4GeminiEnabled, type PdfAttachment } from "./gemini";

const MAX_CLUSTERS_PER_SECTION = 500;
const CONFIDENCE_THRESHOLD = 0.7;
const DEFAULT_PACK_SIZE = 8;

const SUPAPROMPT_V2 = `You are the "Style-Page Clustering" model for Lyceon's V4 ingestion pipeline.

Your only job: given ONE rendered SAT question page image (a PNG) plus minimal context, produce
a STRICT JSON object that:
1) Extracts trustworthy metadata that is visibly present on the page (especially domain +
skill, and difficulty when shown),
2) Summarizes what the question is testing (at a high level),
3) Produces a stable "structure signature" used for clustering,
4) Recommends a cluster key (but never invents facts).

Hard rules (non-negotiable)
- ZERO hallucination: If you cannot see it on the page, output null/unknown (do not guess).
- Prefer page truth over any prior assumptions.
- If multiple signals conflict, use what is explicitly labeled on the page.
- Output MUST be valid JSON (no markdown, no trailing comments).
- Keep text short and factual.

SAT content domains (must match exactly)
Math domains:
Algebra, Advanced Math, Problem-Solving and Data Analysis, Geometry and Trigonometry

Reading & Writing domains:
Information and Ideas, Craft and Structure, Expression of Ideas, Standard English Conventions

Difficulty extraction
- If the page includes an explicit difficulty label (e.g., "Difficulty: Easy/Medium/Hard" or a
similar, clearly labeled scale),
  capture it in difficultyLabel (string) and also map to difficultyLevel:
   - "Easy" -> 1
   - "Medium" -> 2
   - "Hard" -> 3
- If difficulty is shown as something else (stars, numeric), capture the raw label in
difficultyLabel and set difficultyLevel to null unless the mapping is explicitly provided on the page.
- If no difficulty is visible, set difficultyLabel = null and difficultyLevel = null.

How to determine domain + skill
1) First scan for explicit labels like:
  - "Domain:", "Content Domain", "Skill:", "Content Skill", or a domain header.
2) If not found, look for a clearly presented "reporting portal style" box that lists Domain /
Skill / Difficulty.
3) If still not found: domain=null, skill=null. Do NOT infer from the math itself.

How to build clusterKey (deterministic)
- clusterKey = "<section>::<domain or 'unknown'>::<skill or 'unknown'>::<signatureText>"
- signatureText MUST be stable and based only on visible features (signals).
- If domain/skill are unknown, clustering should still work by grouping similar structure
(signatureText).

Confidence guidance
- 0.90-1.00: domain and skill are explicitly labeled and clear.
- 0.65-0.89: domain labeled but skill missing or ambiguous.
- 0.40-0.64: no labels, but structure signature is strong.
- <0.40: page is hard to parse; output minimal metadata and keep confidence low.

Output JSON schema (STRICT)
{
  "version": "v4_style_cluster_v2",
  "section": "math|rw",
  "pdfPath": "<string>",
  "pageNumber": <int>,
  "domain": "<one of the enums above or null>",
  "skill": "<short label from page if present or null>",
  "difficultyLabel": "<string or null>",
  "difficultyLevel": <1|2|3|null>,
  "questionType": "<very short: e.g., 'multiple-choice', 'grid-in', or null if not visible>",
  "topicSummary": "<one sentence describing what is being tested, no numbers unless visible>",
  "evidence": {
    "domainFound": <true|false>,
    "skillFound": <true|false>,
    "difficultyFound": <true|false>,
    "notes": ["<0-3 short notes about what you saw>"]
  },
  "structureSignature": {
    "signals": {
     "hasTable": <true|false|null>,
     "hasGraph": <true|false|null>,
     "hasChart": <true|false|null>,
     "hasEquationBlock": <true|false|null>,
     "hasOptionsAtoD": <true|false|null>,
     "hasUnderlinedText": <true|false|null>
    },
    "signatureText": "<stable short string built from the visible signals + domain + skill (when known)>"
  },
  "clusterRecommendation": {
    "clusterKey": "<deterministic key; see rules>",
    "confidence": <0.0-1.0>,
    "reason": "<one sentence>"
  }
}

Return exactly one JSON object following the schema above.`;

const VALID_MATH_DOMAINS = [
  "Algebra",
  "Advanced Math", 
  "Problem-Solving and Data Analysis",
  "Geometry and Trigonometry"
] as const;

const VALID_RW_DOMAINS = [
  "Information and Ideas",
  "Craft and Structure",
  "Expression of Ideas",
  "Standard English Conventions"
] as const;

export const StructureSignalsSchema = z.object({
  hasTable: z.boolean().nullable().optional(),
  hasGraph: z.boolean().nullable().optional(),
  hasChart: z.boolean().nullable().optional(),
  hasEquationBlock: z.boolean().nullable().optional(),
  hasOptionsAtoD: z.boolean().nullable().optional(),
  hasUnderlinedText: z.boolean().nullable().optional(),
});

export const StructureSignatureV2Schema = z.object({
  signals: StructureSignalsSchema,
  signatureText: z.string().max(256),
});

export const EvidenceSchema = z.object({
  domainFound: z.boolean(),
  skillFound: z.boolean(),
  difficultyFound: z.boolean(),
  notes: z.array(z.string()).max(5).default([]),
});

export const ClusterRecommendationSchema = z.object({
  clusterKey: z.string().min(1).max(256),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(500),
});

export const SupapromptV2ResponseSchema = z.object({
  version: z.literal("v4_style_cluster_v2"),
  section: z.enum(["math", "rw"]),
  pdfPath: z.string(),
  pageNumber: z.number().int().positive(),
  domain: z.string().nullable(),
  skill: z.string().nullable(),
  difficultyLabel: z.string().nullable(),
  difficultyLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]),
  questionType: z.string().nullable(),
  topicSummary: z.string().max(500),
  evidence: EvidenceSchema,
  structureSignature: StructureSignatureV2Schema,
  clusterRecommendation: ClusterRecommendationSchema,
});

export type SupapromptV2Response = z.infer<typeof SupapromptV2ResponseSchema>;

export const ClusterSignatureSchema = z.object({
  section: z.enum(["math", "rw"]),
  structure_type: z.string().min(1).max(64),
  core_skill: z.string().min(1).max(64),
  domain: z.string().nullable().optional(),
  difficulty: z.enum(["easy", "medium", "hard", "unknown"]).default("unknown"),
  prompt_pattern: z.string().max(256).optional(),
  key_features: z.array(z.string()).max(6).default([]),
  diagram_present: z.boolean().default(false),
  copy_risk_sensitivity: z.enum(["low", "medium", "high"]).default("medium"),
  signals: StructureSignalsSchema.optional(),
  signatureText: z.string().max(256).optional(),
});

export type ClusterSignature = z.infer<typeof ClusterSignatureSchema>;

export const ClusterMatchResultSchema = z.object({
  decision: z.enum(["match_existing", "create_new"]),
  existing_cluster_key: z.string().nullable(),
  new_cluster: z.object({
    cluster_key: z.string(),
    title: z.string(),
    description: z.string(),
  }).nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export type ClusterMatchResult = z.infer<typeof ClusterMatchResultSchema>;

export const LLMClusteringResponseSchema = z.object({
  signature: ClusterSignatureSchema,
  match: ClusterMatchResultSchema,
});

export type LLMClusteringResponse = z.infer<typeof LLMClusteringResponseSchema>;

export interface StyleCluster {
  id: string;
  section: string;
  cluster_key: string;
  title: string;
  description: string;
  signature: ClusterSignature;
  confidence: number;
  usage_count: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StylePageForClustering {
  id: string;
  bucket: string;
  image_path: string;
  section: string;
  domain: string | null;
  difficulty: string | null;
  skill: string | null;
  subskill?: string | null;
  primary_cluster_id: string | null;
  structure_signature: ClusterSignature | null;
}

export interface StylePageMetadata {
  domain: string | null;
  skill: string | null;
  subskill?: string | null;
  difficulty: string;
  structure_signature: ClusterSignature;
  cluster_id: string | null;
  fallback: boolean;
}

function validateDomain(section: "math" | "rw", domain: string | null): string | null {
  if (!domain) return null;
  
  const validDomains = section === "math" ? VALID_MATH_DOMAINS : VALID_RW_DOMAINS;
  const normalized = domain.trim();
  
  for (const valid of validDomains) {
    if (normalized.toLowerCase() === valid.toLowerCase()) {
      return valid;
    }
  }
  
  return null;
}

function mapDifficultyLevel(level: 1 | 2 | 3 | null): "easy" | "medium" | "hard" | "unknown" {
  switch (level) {
    case 1: return "easy";
    case 2: return "medium";
    case 3: return "hard";
    default: return "unknown";
  }
}

export function normalizeClusterKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_\s:]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 128)
    .replace(/^_+|_+$/g, "");
}

export async function listClusters(
  section?: "math" | "rw",
  limit: number = 100
): Promise<StyleCluster[]> {
  const supabase = getSupabaseAdmin();
  
  let query = supabase
    .from("ingestion_v4_style_clusters")
    .select("*")
    .eq("active", true)
    .order("usage_count", { ascending: false })
    .limit(limit);
  
  if (section) {
    query = query.eq("section", section);
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error("[v4Clustering] Failed to list clusters:", error.message);
    return [];
  }
  
  return (data || []) as StyleCluster[];
}

export async function getClusterById(clusterId: string): Promise<StyleCluster | null> {
  const supabase = getSupabaseAdmin();
  
  const { data, error } = await supabase
    .from("ingestion_v4_style_clusters")
    .select("*")
    .eq("id", clusterId)
    .single();
  
  if (error || !data) return null;
  return data as StyleCluster;
}

export async function getClusterPages(
  clusterId: string,
  limit: number = 200
): Promise<StylePageForClustering[]> {
  const supabase = getSupabaseAdmin();
  
  const { data, error } = await supabase
    .from("ingestion_v4_style_pages")
    .select("id, bucket, image_path, section, domain, difficulty, skill, primary_cluster_id, structure_signature")
    .eq("primary_cluster_id", clusterId)
    .limit(limit);
  
  if (error) {
    console.error("[v4Clustering] Failed to get cluster pages:", error.message);
    return [];
  }
  
  return (data || []) as StylePageForClustering[];
}

export interface GetUnclusteredPagesResult {
  pages: StylePageForClustering[];
  error: string | null;
}

export async function getUnclusteredPages(
  section: "math" | "rw",
  limit: number = 25
): Promise<StylePageForClustering[]> {
  const result = await getUnclusteredPagesWithError(section, limit);
  if (result.error) {
    throw new Error(`[v4Clustering] getUnclusteredPages query failed: ${result.error}`);
  }
  return result.pages;
}

export async function getUnclusteredPagesWithError(
  section: "math" | "rw",
  limit: number = 25
): Promise<GetUnclusteredPagesResult> {
  const supabase = getSupabaseAdmin();
  
  const { data, error } = await supabase
    .from("ingestion_v4_style_pages")
    .select("id, bucket, image_path, section, domain, difficulty, skill, primary_cluster_id, structure_signature")
    .ilike("section", section)
    .is("primary_cluster_id", null)
    .order("rendered_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);
  
  if (error) {
    console.error("[v4Clustering] Failed to get unclustered pages:", error.message);
    return { pages: [], error: error.message };
  }
  
  return { pages: (data || []) as StylePageForClustering[], error: null };
}

async function createCluster(
  section: "math" | "rw",
  clusterKey: string,
  title: string,
  description: string,
  signature: ClusterSignature,
  confidence: number
): Promise<StyleCluster | null> {
  const supabase = getSupabaseAdmin();
  
  const normalizedKey = normalizeClusterKey(clusterKey);
  
  const { data: existing } = await supabase
    .from("ingestion_v4_style_clusters")
    .select("id")
    .eq("section", section)
    .eq("cluster_key", normalizedKey)
    .single();
  
  if (existing) {
    const { data: cluster } = await supabase
      .from("ingestion_v4_style_clusters")
      .select("*")
      .eq("id", existing.id)
      .single();
    return cluster as StyleCluster | null;
  }
  
  const clusterCount = await getClusterCount(section);
  if (clusterCount >= MAX_CLUSTERS_PER_SECTION) {
    console.warn(`[v4Clustering] Max clusters reached for section ${section}. Cannot create new cluster.`);
    return null;
  }
  
  const { data, error } = await supabase
    .from("ingestion_v4_style_clusters")
    .insert({
      section,
      cluster_key: normalizedKey,
      title,
      description,
      signature,
      confidence,
    })
    .select()
    .single();
  
  if (error) {
    console.error("[v4Clustering] Failed to create cluster:", error.message);
    return null;
  }
  
  console.log(`[v4Clustering] Created new cluster: ${normalizedKey} (${title})`);
  return data as StyleCluster;
}

async function getClusterCount(section: "math" | "rw"): Promise<number> {
  const supabase = getSupabaseAdmin();
  
  const { count, error } = await supabase
    .from("ingestion_v4_style_clusters")
    .select("id", { count: "exact", head: true })
    .eq("section", section)
    .eq("active", true);
  
  if (error) return MAX_CLUSTERS_PER_SECTION;
  return count || 0;
}

async function assignPageToCluster(
  pageId: string,
  clusterId: string,
  confidence: number,
  reason: string,
  assignedBy: "llm" | "admin" | "system" | "fallback" = "llm"
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  
  const { error: mapError } = await supabase
    .from("ingestion_v4_style_page_cluster_map")
    .upsert({
      style_page_id: pageId,
      cluster_id: clusterId,
      match_confidence: confidence,
      match_reason: reason,
      assigned_by: assignedBy,
    }, {
      onConflict: "style_page_id,cluster_id"
    });
  
  if (mapError) {
    console.error("[v4Clustering] Failed to create cluster mapping:", mapError.message);
    return false;
  }
  
  const { error: updateError } = await supabase.rpc("v4_set_primary_cluster", {
    p_style_page_id: pageId,
    p_cluster_id: clusterId,
    p_confidence: confidence,
  });
  
  if (updateError) {
    console.error("[v4Clustering] Failed to set primary cluster:", updateError.message);
    return false;
  }
  
  return true;
}

export async function incrementClusterUsage(clusterId: string, n: number = 1): Promise<void> {
  const supabase = getSupabaseAdmin();
  
  const { error } = await supabase.rpc("v4_increment_cluster_usage", {
    p_cluster_id: clusterId,
    p_n: n,
  });
  
  if (error) {
    console.warn("[v4Clustering] Failed to increment cluster usage:", error.message);
  }
}

async function persistStylePageMetadata(
  pageId: string,
  metadata: StylePageMetadata
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  
  const updateData: Record<string, unknown> = {
    domain: metadata.domain,
    skill: metadata.skill,
    difficulty: metadata.difficulty,
    structure_signature: metadata.structure_signature,
    primary_cluster_id: metadata.cluster_id,
  };
  
  const { error } = await supabase
    .from("ingestion_v4_style_pages")
    .update(updateData)
    .eq("id", pageId);
  
  if (error) {
    console.error("[v4Clustering] Failed to persist metadata:", error.message);
    return false;
  }
  
  return true;
}

export async function finalizePageClustering(
  pageId: string,
  clusterId: string,
  metadata: {
    domain: string | null;
    skill: string | null;
    difficulty: string;
    structure_signature: ClusterSignature;
    confidence: number;
    reason: string;
  }
): Promise<{ success: boolean; error?: string }> {
  if (!clusterId || typeof clusterId !== "string" || clusterId.length < 10) {
    return { success: false, error: `Invalid clusterId: ${clusterId}` };
  }
  
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();
  
  const enrichedSignature = {
    ...metadata.structure_signature,
    clusterId,
    clusterDecision: "linked",
    clusterConfidence: metadata.confidence,
    clusterReason: metadata.reason?.substring(0, 200),
  };
  
  const updateData = {
    domain: metadata.domain,
    skill: metadata.skill,
    difficulty: metadata.difficulty,
    structure_signature: enrichedSignature,
    primary_cluster_id: clusterId,
    cluster_confidence: metadata.confidence,
    last_clustered_at: now,
  };
  
  const { data, error, count } = await supabase
    .from("ingestion_v4_style_pages")
    .update(updateData)
    .eq("id", pageId)
    .select("id")
    .single();
  
  if (error) {
    console.error(`[v4Clustering] finalizePageClustering failed for page ${pageId}:`, error.message);
    return { success: false, error: error.message };
  }
  
  if (!data) {
    console.error(`[v4Clustering] finalizePageClustering: 0 rows updated for page ${pageId}`);
    return { success: false, error: "No rows updated - page not found" };
  }
  
  console.log(`[v4Clustering] Finalized page ${pageId} -> cluster ${clusterId}`);
  return { success: true };
}

export async function getUnlinkedPagesWithMetadata(
  section: "math" | "rw",
  limit: number = 50
): Promise<StylePageForClustering[]> {
  const supabase = getSupabaseAdmin();
  
  const { data, error } = await supabase
    .from("ingestion_v4_style_pages")
    .select("id, bucket, image_path, section, domain, difficulty, skill, primary_cluster_id, structure_signature")
    .ilike("section", section)
    .is("primary_cluster_id", null)
    .or("domain.not.is.null,skill.not.is.null,difficulty.not.is.null")
    .order("rendered_at", { ascending: true })
    .limit(limit);
  
  if (error) {
    console.error("[v4Clustering] Failed to get unlinked pages:", error.message);
    return [];
  }
  
  return (data || []) as StylePageForClustering[];
}

export async function repairUnlinkedPages(
  section: "math" | "rw",
  limitPages: number = 50
): Promise<{
  attempted: number;
  linked: number;
  createdClusters: number;
  failed: number;
  sampleErrors: string[];
}> {
  const pages = await getUnlinkedPagesWithMetadata(section, limitPages);
  const clusters = await listClusters(section, 200);
  
  let linked = 0;
  let createdClusters = 0;
  let failed = 0;
  const sampleErrors: string[] = [];
  
  for (const page of pages) {
    try {
      const domain = page.domain || "unknown";
      const skill = page.skill || "unknown";
      const difficulty = (page.difficulty as "easy" | "medium" | "hard" | "unknown") || "unknown";
      
      const clusterKey = normalizeClusterKey(`${section}::${domain}::${skill}::repaired`);
      const title = `${section.toUpperCase()} ${domain} - ${skill}`;
      const description = `Auto-repaired cluster for ${section} ${domain}`;
      
      const signature: ClusterSignature = {
        section,
        structure_type: "unknown",
        core_skill: skill,
        domain: domain === "unknown" ? null : domain,
        difficulty,
        key_features: ["repaired_link"],
        diagram_present: false,
        copy_risk_sensitivity: "medium",
      };
      
      let cluster = clusters.find(c => c.cluster_key === clusterKey);
      let isNewCluster = false;
      
      if (!cluster) {
        cluster = await createCluster(section, clusterKey, title, description, signature, 0.6);
        if (cluster) {
          clusters.push(cluster);
          isNewCluster = true;
          createdClusters++;
        }
      }
      
      if (!cluster) {
        failed++;
        if (sampleErrors.length < 5) {
          sampleErrors.push(`Page ${page.id}: Could not create/find cluster for key ${clusterKey}`);
        }
        continue;
      }
      
      const result = await finalizePageClustering(page.id, cluster.id, {
        domain: page.domain,
        skill: page.skill,
        difficulty,
        structure_signature: signature,
        confidence: 0.6,
        reason: "Repaired via repair-links endpoint",
      });
      
      if (result.success) {
        linked++;
        console.log(`[v4Clustering] Repaired link: page ${page.id} -> cluster ${cluster.cluster_key}`);
      } else {
        failed++;
        if (sampleErrors.length < 5) {
          sampleErrors.push(`Page ${page.id}: ${result.error}`);
        }
      }
    } catch (err: any) {
      failed++;
      if (sampleErrors.length < 5) {
        sampleErrors.push(`Page ${page.id}: ${err.message?.substring(0, 100)}`);
      }
    }
  }
  
  console.log(`[v4Clustering] Repair complete: ${linked} linked, ${createdClusters} new clusters, ${failed} failed`);
  return { attempted: pages.length, linked, createdClusters, failed, sampleErrors };
}

function convertV2ResponseToLegacy(v2: SupapromptV2Response): LLMClusteringResponse {
  const section = v2.section;
  const validDomain = validateDomain(section, v2.domain);
  const difficulty = mapDifficultyLevel(v2.difficultyLevel);
  
  const hasDiagram = v2.structureSignature.signals.hasGraph || 
                     v2.structureSignature.signals.hasChart ||
                     v2.structureSignature.signals.hasTable;
  
  const signature: ClusterSignature = {
    section,
    structure_type: v2.questionType || "unknown",
    core_skill: v2.skill || "unknown",
    domain: validDomain,
    difficulty,
    key_features: v2.evidence.notes.slice(0, 6),
    diagram_present: hasDiagram ?? false,
    copy_risk_sensitivity: "medium",
    signals: v2.structureSignature.signals,
    signatureText: v2.structureSignature.signatureText,
  };
  
  const clusterKey = normalizeClusterKey(v2.clusterRecommendation.clusterKey);
  
  return {
    signature,
    match: {
      decision: "create_new",
      existing_cluster_key: null,
      new_cluster: {
        cluster_key: clusterKey,
        title: `${section.toUpperCase()} ${validDomain || 'Unknown'} - ${v2.skill || 'Unknown'}`,
        description: v2.topicSummary || `Auto-generated cluster for ${section}`,
      },
      confidence: v2.clusterRecommendation.confidence,
      reason: v2.clusterRecommendation.reason,
    },
  };
}

function createFallbackClusteringResponse(page: StylePageForClustering): LLMClusteringResponse {
  const section = page.section as "math" | "rw";
  const domain = page.domain || "unknown";
  const skill = page.skill || "unknown";
  const difficulty = (page.difficulty as "easy" | "medium" | "hard" | "unknown") || "unknown";
  
  const clusterKey = `${section}::${domain}::${skill}::fallback`;
  
  return {
    signature: {
      section,
      structure_type: "unknown",
      core_skill: skill,
      domain: domain === "unknown" ? null : domain,
      difficulty,
      key_features: ["fallback_clustering"],
      diagram_present: false,
      copy_risk_sensitivity: "medium",
    },
    match: {
      decision: "create_new",
      existing_cluster_key: null,
      new_cluster: {
        cluster_key: normalizeClusterKey(clusterKey),
        title: `${section.toUpperCase()} ${domain} - ${skill}`,
        description: `Auto-generated cluster for ${section} ${domain} questions (fallback)`,
      },
      confidence: 0.5,
      reason: "Fallback clustering without image analysis",
    },
  };
}

export async function clusterStylePage(
  page: StylePageForClustering,
  existingClusters?: StyleCluster[]
): Promise<{ clusterId: string; clusterKey: string; confidence: number; fallback: boolean } | null> {
  const geminiEnabled = isV4GeminiEnabled();
  const section = page.section as "math" | "rw";
  const clusters = existingClusters || await listClusters(section, 200);
  
  const supabase = getSupabaseAdmin();
  let response: LLMClusteringResponse;
  let fallback = false;
  let v2Response: SupapromptV2Response | null = null;
  
  try {
    if (!geminiEnabled) {
      console.log("[v4Clustering] Gemini not enabled, using fallback clustering for page", page.id);
      response = createFallbackClusteringResponse(page);
      fallback = true;
    } else {
      const { data: imageData } = await supabase.storage
        .from(page.bucket)
        .download(page.image_path);
      
      if (!imageData) {
        console.warn("[v4Clustering] Could not download image, using fallback clustering");
        response = createFallbackClusteringResponse(page);
        fallback = true;
      } else {
        const buffer = Buffer.from(await imageData.arrayBuffer());
        
        const attachment: PdfAttachment = {
          mimeType: "image/png",
          data: buffer,
          name: page.image_path,
        };
        
        const contextPrompt = `${SUPAPROMPT_V2}

Context for this page:
- section: "${section}"
- exam: "SAT"
- pdfPath: "${page.bucket}/${page.image_path}"
- pageNumber: 1

Analyze the attached PNG image and return ONLY valid JSON matching the schema above.`;
        
        try {
          const rawResponse = await generateJsonWithAttachments(
            contextPrompt,
            SupapromptV2ResponseSchema,
            [attachment]
          );
          
          v2Response = rawResponse;
          
          const validatedDomain = validateDomain(section, rawResponse.domain);
          if (rawResponse.domain && !validatedDomain) {
            console.warn(`[v4Clustering] Invalid domain "${rawResponse.domain}" for section ${section}, treating as null`);
          }
          
          if (validatedDomain === null && rawResponse.skill === null && 
              rawResponse.clusterRecommendation.confidence < 0.4) {
            console.warn("[v4Clustering] Low confidence response, marking as fallback");
            fallback = true;
          }
          
          response = convertV2ResponseToLegacy(rawResponse);
          
        } catch (llmErr: any) {
          const errorMsg = llmErr.message || "Unknown LLM error";
          console.warn(`[v4Clustering] LLM parse failed for page ${page.id}: ${errorMsg.substring(0, 200)}`);
          
          await supabase
            .from("ingestion_v4_style_pages")
            .update({ 
              structure_signature: { 
                section: page.section, 
                error: errorMsg.substring(0, 200),
                fallback: true 
              } 
            })
            .eq("id", page.id);
          
          response = createFallbackClusteringResponse(page);
          fallback = true;
        }
      }
    }
    
    const metadata: StylePageMetadata = {
      domain: v2Response ? validateDomain(section, v2Response.domain) : (page.domain || null),
      skill: v2Response?.skill || page.skill || null,
      subskill: null,
      difficulty: response.signature.difficulty || "unknown",
      structure_signature: response.signature,
      cluster_id: null,
      fallback,
    };
    
    let cluster: StyleCluster | null = null;
    
    if (response.match.new_cluster) {
      const canCreateNew = response.match.confidence >= CONFIDENCE_THRESHOLD || clusters.length === 0;
      
      if (canCreateNew) {
        cluster = await createCluster(
          section,
          response.match.new_cluster.cluster_key,
          response.match.new_cluster.title,
          response.match.new_cluster.description,
          response.signature,
          response.match.confidence
        );
      } else if (clusters.length > 0) {
        console.warn(`[v4Clustering] Low confidence ${response.match.confidence} < ${CONFIDENCE_THRESHOLD}, matching best existing`);
        cluster = clusters[0];
      }
    }
    
    if (!cluster && clusters.length === 0 && response.match.new_cluster) {
      console.log("[v4Clustering] Bootstrap: creating first cluster for section", section);
      cluster = await createCluster(
        section,
        response.match.new_cluster.cluster_key,
        response.match.new_cluster.title,
        response.match.new_cluster.description,
        response.signature,
        response.match.confidence
      );
    }
    
    if (!cluster && response.match.new_cluster) {
      console.log("[v4Clustering] Final fallback: creating cluster anyway");
      cluster = await createCluster(
        section,
        response.match.new_cluster.cluster_key,
        response.match.new_cluster.title,
        response.match.new_cluster.description,
        response.signature,
        response.match.confidence
      );
    }
    
    if (cluster) {
      const finalizeResult = await finalizePageClustering(page.id, cluster.id, {
        domain: metadata.domain,
        skill: metadata.skill,
        difficulty: metadata.difficulty,
        structure_signature: response.signature,
        confidence: response.match.confidence,
        reason: response.match.reason,
      });
      
      if (finalizeResult.success) {
        await assignPageToCluster(
          page.id,
          cluster.id,
          response.match.confidence,
          response.match.reason,
          fallback ? "fallback" : "llm"
        );
        
        console.log(`[v4Clustering] Assigned page ${page.id} to cluster ${cluster.cluster_key} (fallback=${fallback})`);
        return {
          clusterId: cluster.id,
          clusterKey: cluster.cluster_key,
          confidence: response.match.confidence,
          fallback,
        };
      } else {
        console.warn(`[v4Clustering] finalizePageClustering failed for page ${page.id}: ${finalizeResult.error}`);
      }
    } else {
      console.warn(`[v4Clustering] No cluster created/found for page ${page.id}, persisting metadata without cluster link`);
      await persistStylePageMetadata(page.id, metadata);
    }
    
    return null;
  } catch (err: any) {
    console.error("[v4Clustering] Clustering failed:", err.message);
    return null;
  }
}

export interface ClusterCoherentPackResult {
  clusterId: string;
  clusterKey: string;
  pages: StylePageForClustering[];
  confidence: number;
}

export async function sampleClusterCoherentPack(
  section: "math" | "rw",
  options?: {
    clusterId?: string;
    domain?: string;
    difficulty?: string;
    targetCount?: number;
  }
): Promise<ClusterCoherentPackResult | null> {
  const supabase = getSupabaseAdmin();
  const targetCount = options?.targetCount || DEFAULT_PACK_SIZE;
  
  let cluster: StyleCluster | null = null;
  
  if (options?.clusterId) {
    cluster = await getClusterById(options.clusterId);
  }
  
  if (!cluster) {
    const clusters = await listClusters(section, 50);
    if (clusters.length === 0) {
      console.warn("[v4Clustering] No clusters available for section:", section);
      return null;
    }
    
    const weights = clusters.map(c => 1 / (c.usage_count + 1));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;
    
    for (let i = 0; i < clusters.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        cluster = clusters[i];
        break;
      }
    }
    
    if (!cluster) cluster = clusters[0];
  }
  
  let query = supabase
    .from("ingestion_v4_style_pages")
    .select("id, bucket, image_path, section, domain, difficulty, skill, primary_cluster_id, structure_signature")
    .eq("primary_cluster_id", cluster.id)
    .order("teacher_used_count", { ascending: true })
    .limit(targetCount * 2);
  
  if (options?.domain) {
    query = query.eq("domain", options.domain);
  }
  
  if (options?.difficulty) {
    query = query.eq("difficulty", options.difficulty);
  }
  
  const { data, error } = await query;
  
  if (error || !data || data.length === 0) {
    console.warn(`[v4Clustering] No pages in cluster ${cluster.cluster_key}`);
    return null;
  }
  
  const pages = (data as StylePageForClustering[]).slice(0, targetCount);
  
  return {
    clusterId: cluster.id,
    clusterKey: cluster.cluster_key,
    pages,
    confidence: cluster.confidence,
  };
}

export interface ClusterBatchResult {
  attemptedCount: number;
  clusteredCount: number;
  createdClusters: number;
  failedCount: number;
  fallbackCount: number;
  sampleErrors: string[];
}

export async function clusterBatch(
  section: "math" | "rw",
  limitPages: number = 25
): Promise<ClusterBatchResult> {
  const pages = await getUnclusteredPages(section, limitPages);
  
  const clusters = await listClusters(section, 200);
  
  let clusteredCount = 0;
  let createdClusters = 0;
  let failedCount = 0;
  let fallbackCount = 0;
  const sampleErrors: string[] = [];
  let attemptedCount = 0;
  
  for (const page of pages) {
    attemptedCount++;
    
    try {
      const result = await clusterStylePage(page, clusters);
      if (result) {
        clusteredCount++;
        if (result.fallback) {
          fallbackCount++;
        }
        const isNewCluster = !clusters.some(c => c.cluster_key === result.clusterKey);
        if (isNewCluster) {
          createdClusters++;
          const newCluster = await getClusterById(result.clusterId);
          if (newCluster) clusters.push(newCluster);
        }
      } else {
        failedCount++;
        if (sampleErrors.length < 5) {
          sampleErrors.push(`Page ${page.id}: clustering returned null`);
        }
      }
    } catch (err: any) {
      console.error(`[v4Clustering] Failed to cluster page ${page.id}:`, err.message);
      failedCount++;
      if (sampleErrors.length < 5) {
        sampleErrors.push(`Page ${page.id}: ${err.message.substring(0, 100)}`);
      }
    }
    
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.log(`[v4Clustering] Batch complete: ${clusteredCount} clustered, ${createdClusters} new clusters, ${fallbackCount} fallback, ${failedCount} errors`);
  
  return { attemptedCount, clusteredCount, createdClusters, failedCount, fallbackCount, sampleErrors };
}
