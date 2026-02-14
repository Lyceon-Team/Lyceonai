/**
 * Style Bank Service - Scans Supabase Storage and syncs to style library
 */
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import type { PdfStyleRef } from "../types";
import { normalizeSection, type CanonicalSection } from "../utils/section";

const STYLE_BANK_BUCKET = "lyceon-style-bank";
const PREFIXES: Record<CanonicalSection, string> = {
  math: "sat/math/pdf/",
  rw: "sat/rw/pdf/"
};
const MAX_FILES_SAFETY_CAP = 10000;
const PAGE_SIZE = 1000;

export interface StoragePdfEntry {
  bucket: string;
  path: string;
  name: string;
  section: CanonicalSection;
  sizeBytes: number;
}

export interface ScanResult {
  ok: boolean;
  entries: StoragePdfEntry[];
  totalCount: number;
  truncated: boolean;
}

export interface SyncResult {
  ok: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  totalSeen: number;
}

async function listPdfsFromPrefix(
  bucket: string,
  prefix: string,
  section: CanonicalSection
): Promise<StoragePdfEntry[]> {
  const supabase = getSupabaseAdmin();
  const entries: StoragePdfEntry[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore && entries.length < MAX_FILES_SAFETY_CAP) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, {
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" }
      });

    if (error) {
      console.error(`[StyleBank] Error listing ${prefix}:`, error.message);
      break;
    }

    if (!data || data.length === 0) {
      hasMore = false;
      break;
    }

    for (const file of data) {
      if (file.name && file.name.toLowerCase().endsWith(".pdf")) {
        entries.push({
          bucket,
          path: `${prefix}${file.name}`,
          name: file.name.replace(/\.pdf$/i, ""),
          section,
          sizeBytes: (file.metadata as any)?.size || 0
        });
      }
    }

    offset += data.length;
    if (data.length < PAGE_SIZE) {
      hasMore = false;
    }
  }

  return entries;
}

export async function scanStyleBank(
  limit: number = 200,
  sectionFilter?: CanonicalSection
): Promise<ScanResult> {
  let allEntries: StoragePdfEntry[] = [];

  if (!sectionFilter || sectionFilter === 'math') {
    const mathPdfs = await listPdfsFromPrefix(STYLE_BANK_BUCKET, PREFIXES.math, "math");
    allEntries = [...allEntries, ...mathPdfs];
  }
  if (!sectionFilter || sectionFilter === 'rw') {
    const rwPdfs = await listPdfsFromPrefix(STYLE_BANK_BUCKET, PREFIXES.rw, "rw");
    allEntries = [...allEntries, ...rwPdfs];
  }
  
  const totalCount = allEntries.length;
  const truncated = totalCount > limit;
  
  return {
    ok: true,
    entries: allEntries.slice(0, limit),
    totalCount,
    truncated
  };
}

export async function syncStyleBankToLibrary(opts?: { section?: CanonicalSection }): Promise<SyncResult> {
  const supabase = getSupabaseAdmin();
  const sectionFilter = opts?.section;
  
  let allEntries: StoragePdfEntry[] = [];

  if (!sectionFilter || sectionFilter === 'math') {
    const mathPdfs = await listPdfsFromPrefix(STYLE_BANK_BUCKET, PREFIXES.math, "math");
    allEntries = [...allEntries, ...mathPdfs];
  }
  if (!sectionFilter || sectionFilter === 'rw') {
    const rwPdfs = await listPdfsFromPrefix(STYLE_BANK_BUCKET, PREFIXES.rw, "rw");
    allEntries = [...allEntries, ...rwPdfs];
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const entry of allEntries) {
    const { data: existing } = await supabase
      .from("ingestion_v4_style_library")
      .select("id")
      .eq("bucket", entry.bucket)
      .eq("path", entry.path)
      .eq("section", entry.section)
      .maybeSingle();

    if (existing) {
      skipped++;
      continue;
    }

    const { error } = await supabase
      .from("ingestion_v4_style_library")
      .insert({
        label: entry.name,
        bucket: entry.bucket,
        path: entry.path,
        exam: "SAT",
        section: entry.section,
        page_hint: null,
        notes: null
      });

    if (error) {
      if (error.code === "23505") {
        skipped++;
      } else {
        console.error(`[StyleBank] Failed to insert ${entry.path}:`, error.message);
        skipped++;
      }
    } else {
      inserted++;
    }
  }

  return {
    ok: true,
    inserted,
    updated,
    skipped,
    totalSeen: allEntries.length
  };
}

export async function downloadPdfFromStorage(
  bucket: string,
  path: string
): Promise<{ data: Buffer; sizeBytes: number } | null> {
  const supabase = getSupabaseAdmin();
  
  const { data, error } = await supabase.storage
    .from(bucket)
    .download(path);

  if (error || !data) {
    console.error(`[StyleBank] Failed to download ${bucket}/${path}:`, error?.message);
    return null;
  }

  const arrayBuffer = await data.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  return {
    data: buffer,
    sizeBytes: buffer.length
  };
}

export async function downloadImageFromStorage(
  bucket: string,
  path: string
): Promise<{ data: Buffer; sizeBytes: number } | null> {
  const supabase = getSupabaseAdmin();
  
  const { data, error } = await supabase.storage
    .from(bucket)
    .download(path);

  if (error || !data) {
    console.error(`[StyleBank] Failed to download image ${bucket}/${path}:`, error?.message);
    return null;
  }

  const arrayBuffer = await data.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  return {
    data: buffer,
    sizeBytes: buffer.length
  };
}

export function styleBankBucket(): string {
  return STYLE_BANK_BUCKET;
}
