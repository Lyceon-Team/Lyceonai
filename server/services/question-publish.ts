/**
 * Service-only canonical publish/version owner.
 * Intentionally unmounted from public routes: runtime callers should invoke this service directly.
 */
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import {
  buildCanonicalId,
  isValidCanonicalId,
  normalizeLifecycleStatus,
  normalizeSectionCode,
  normalizeSourceType,
  validateQuestionForPublish,
  type CanonicalQuestionRowLike,
} from "../../shared/question-bank-contract";

type SupabaseLike = {
  from: (table: string) => any;
};

const PUBLISH_SELECT = [
  "id",
  "canonical_id",
  "status",
  "section_code",
  "source_type",
  "question_type",
  "stem",
  "options",
  "correct_answer",
  "explanation",
  "answer_text",
  "option_metadata",
  "domain",
  "skill",
  "subskill",
  "skill_code",
  "difficulty",
  "tags",
  "updated_at",
].join(",");

export interface PublishQuestionParams {
  questionId: string;
  actorUserId?: string | null;
  supabase?: SupabaseLike;
}

export interface VersionPublishedQuestionParams {
  questionId: string;
  actorUserId?: string | null;
  patch: Partial<
    Pick<
      CanonicalQuestionRowLike,
      | "stem"
      | "options"
      | "correct_answer"
      | "explanation"
      | "option_metadata"
      | "domain"
      | "skill"
      | "subskill"
      | "skill_code"
      | "difficulty"
      | "tags"
      | "source_type"
      | "section_code"
    >
  >;
  supabase?: SupabaseLike;
}

async function loadQuestionForPublish(supabase: SupabaseLike, questionId: string) {
  const { data, error } = await supabase
    .from("questions")
    .select(PUBLISH_SELECT)
    .eq("id", questionId)
    .single();

  if (error || !data) {
    throw new Error(`question_not_found:${error?.message ?? questionId}`);
  }

  return data as CanonicalQuestionRowLike;
}

async function getLatestVersionNumber(supabase: SupabaseLike, canonicalId: string): Promise<number> {
  const { data, error } = await supabase
    .from("question_versions")
    .select("version_number")
    .eq("question_canonical_id", canonicalId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`version_lookup_failed:${error.message}`);
  }

  return (data as { version_number: number } | null)?.version_number ?? 0;
}

async function isCanonicalIdAvailable(supabase: SupabaseLike, canonicalId: string, questionId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("questions")
    .select("id")
    .eq("canonical_id", canonicalId)
    .maybeSingle();

  if (error) {
    throw new Error(`canonical_id_lookup_failed:${error.message}`);
  }

  if (!data) {
    return true;
  }

  return String((data as { id: string }).id) === String(questionId);
}

function resolvePublishSourceType(row: CanonicalQuestionRowLike) {
  const explicit = normalizeSourceType(row.source_type ?? null);
  if (explicit) {
    return explicit;
  }
  return 1 as const;
}

async function insertQuestionVersion(params: {
  supabase: SupabaseLike;
  questionId: string;
  canonicalId: string;
  versionNumber: number;
  lifecycleStatus: "qa" | "published";
  actorUserId?: string | null;
  snapshot: Record<string, unknown>;
  publishedAt?: string | null;
}) {
  const { supabase, canonicalId, versionNumber, lifecycleStatus, actorUserId, snapshot, publishedAt } = params;

  const { error } = await supabase.from("question_versions").insert({
    question_canonical_id: canonicalId,
    version_number: versionNumber,
    lifecycle_status: lifecycleStatus,
    snapshot,
    created_by: actorUserId ?? null,
    created_at: new Date().toISOString(),
    published_at: publishedAt ?? null,
  });

  if (error) {
    throw new Error(`question_version_insert_failed:${error.message}`);
  }
}

export async function publishQuestion(params: PublishQuestionParams) {
  const supabase = params.supabase ?? supabaseServer;
  const row = await loadQuestionForPublish(supabase, params.questionId);

  const lifecycle = normalizeLifecycleStatus(row.status ?? null);
  if (lifecycle === "published") {
    throw new Error("publish_blocked_already_published");
  }

  const validation = validateQuestionForPublish({
    ...row,
    status: lifecycle ?? row.status,
    source_type: resolvePublishSourceType(row),
  });

  if (!validation.ok) {
    throw new Error(`publish_validation_failed:${validation.errors.join("|")}`);
  }

  let canonicalId = row.canonical_id && isValidCanonicalId(row.canonical_id) ? row.canonical_id : null;
  const sectionCode = normalizeSectionCode(row.section_code ?? null);
  const sourceType = resolvePublishSourceType(row);

  if (!sectionCode) {
    throw new Error("publish_validation_failed:section_code_invalid");
  }

  if (canonicalId) {
    const available = await isCanonicalIdAvailable(supabase, canonicalId, params.questionId);
    if (!available) {
      throw new Error("publish_duplicate_canonical_id");
    }
  } else {
    const maxAttempts = 20;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const candidate = buildCanonicalId(sectionCode, sourceType);
      const available = await isCanonicalIdAvailable(supabase, candidate, params.questionId);
      if (available) {
        canonicalId = candidate;
        break;
      }
    }
  }

  if (!canonicalId) {
    throw new Error("publish_duplicate_canonical_id");
  }

  const now = new Date().toISOString();
  // For new publish, if version exists in history, we might want to start from 1. 
  // If it's the first time, it's version 1.
  const currentMax = canonicalId ? await getLatestVersionNumber(supabase, canonicalId) : 0;
  const versionNumber = currentMax + 1;

  const updatePatch = {
    canonical_id: canonicalId,
    section_code: sectionCode,
    source_type: sourceType,
    question_type: "multiple_choice",
    status: "published",
    version: versionNumber,
    updated_at: now,
  };

  const { data: updated, error: updateError } = await supabase
    .from("questions")
    .update(updatePatch)
    .eq("id", params.questionId)
    .select(PUBLISH_SELECT)
    .single();

  if (updateError || !updated) {
    throw new Error(`publish_update_failed:${updateError?.message ?? "unknown"}`);
  }

  await insertQuestionVersion({
    supabase,
    questionId: params.questionId,
    canonicalId,
    versionNumber,
    lifecycleStatus: "published",
    actorUserId: params.actorUserId,
    snapshot: updated as Record<string, unknown>,
    publishedAt: now,
  });

  return {
    questionId: params.questionId,
    canonicalId,
    status: "published" as const,
    version: versionNumber,
  };
}

export async function versionPublishedQuestion(params: VersionPublishedQuestionParams) {
  const supabase = params.supabase ?? supabaseServer;
  const row = await loadQuestionForPublish(supabase, params.questionId);

  const lifecycle = normalizeLifecycleStatus(row.status ?? null);
  if (lifecycle !== "published") {
    throw new Error("version_blocked_not_published");
  }

  const canonicalId = row.canonical_id;
  if (!canonicalId || !isValidCanonicalId(canonicalId)) {
    throw new Error("version_blocked_missing_canonical_id");
  }

  if ((params.patch as Record<string, unknown>).canonical_id) {
    throw new Error("version_blocked_canonical_id_immutable");
  }

  const nextVersion = (await getLatestVersionNumber(supabase, canonicalId)) + 1;
  const nextStatus = "qa" as const;
  const nextSourceType = normalizeSourceType(params.patch.source_type ?? row.source_type ?? null) ?? resolvePublishSourceType(row);
  const nextSectionCode = normalizeSectionCode(params.patch.section_code ?? row.section_code ?? null);

  if (!nextSectionCode) {
    throw new Error("version_validation_failed:section_code_invalid");
  }

  const mergedCandidate: CanonicalQuestionRowLike = {
    ...(row as CanonicalQuestionRowLike),
    ...(params.patch as Record<string, unknown>),
    canonical_id: canonicalId,
    status: nextStatus,
    question_type: "multiple_choice",
    source_type: nextSourceType,
    section_code: nextSectionCode,
  };

  const validation = validateQuestionForPublish(mergedCandidate);
  if (!validation.ok) {
    throw new Error(`version_validation_failed:${validation.errors.join("|")}`);
  }

  const now = new Date().toISOString();
  const updatePatch = {
    ...(params.patch as Record<string, unknown>),
    canonical_id: canonicalId,
    status: nextStatus,
    question_type: "multiple_choice",
    section_code: nextSectionCode,
    source_type: nextSourceType,
    version: nextVersion,
    updated_at: now,
  };

  const { data: updated, error: updateError } = await supabase
    .from("questions")
    .update(updatePatch)
    .eq("id", params.questionId)
    .select(PUBLISH_SELECT)
    .single();

  if (updateError || !updated) {
    throw new Error(`version_update_failed:${updateError?.message ?? "unknown"}`);
  }

  await insertQuestionVersion({
    supabase,
    questionId: params.questionId,
    canonicalId,
    versionNumber: nextVersion,
    lifecycleStatus: "qa",
    actorUserId: params.actorUserId,
    snapshot: updated as Record<string, unknown>,
  });

  return {
    questionId: params.questionId,
    canonicalId,
    status: "qa" as const,
    version: nextVersion,
  };
}

