import { getSupabaseAdmin } from "../../lib/supabase-admin";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createHash } from "crypto";

const STYLE_BANK_BUCKET = "lyceon-style-bank";

export interface RenderPageResult {
  imagePath: string;
  bytes: number;
  width: number;
  height: number;
  sha256: string;
}

export type PageMode = "first" | "all" | "range";

export interface RenderPagesForPdfOptions {
  bucket?: string;
  pdfPath: string;
  exam: string;
  section: "math" | "rw";
  dpi?: number;
  maxPages?: number;
  overwrite?: boolean;
  pageMode?: PageMode;
  pageStart?: number;
  pageEnd?: number;
}

export interface RenderPagesResult {
  pdfPath: string;
  totalPages: number;
  renderedPages: number;
  skippedPages: number;
  pages: Array<{
    pageNumber: number;
    imagePath: string;
    bytes: number;
    width: number;
    height: number;
  }>;
}

function getPdfSlug(pdfPath: string): string {
  const fileName = pdfPath.split("/").pop() || pdfPath;
  return fileName.replace(/\.pdf$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getOutputPath(section: string, pdfSlug: string, pageNumber: number): string {
  const paddedPage = String(pageNumber).padStart(4, "0");
  return `sat/${section}/pages/${pdfSlug}/p${paddedPage}.png`;
}

async function downloadPdf(bucket: string, pdfPath: string): Promise<Uint8Array> {
  const supabase = getSupabaseAdmin();
  
  const { data, error } = await supabase.storage
    .from(bucket)
    .download(pdfPath);
    
  if (error || !data) {
    throw new Error(`Failed to download PDF: ${error?.message || "No data"}`);
  }
  
  const arrayBuffer = await data.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

async function uploadPng(bucket: string, path: string, pngBuffer: Buffer): Promise<void> {
  const supabase = getSupabaseAdmin();
  
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, pngBuffer, {
      contentType: "image/png",
      upsert: true,
    });
    
  if (error) {
    throw new Error(`Failed to upload PNG: ${error.message}`);
  }
}

async function pageExistsInDb(
  bucket: string,
  pdfPath: string,
  pageNumber: number,
  dpi: number
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  
  const { data } = await supabase
    .from("ingestion_v4_style_pages")
    .select("id")
    .eq("bucket", bucket)
    .eq("pdf_path", pdfPath)
    .eq("page_number", pageNumber)
    .eq("dpi", dpi)
    .maybeSingle();
    
  return !!data;
}

async function upsertPageRecord(
  bucket: string,
  pdfPath: string,
  pageNumber: number,
  dpi: number,
  imagePath: string,
  imageBytes: number,
  imageSha256: string,
  width: number,
  height: number,
  exam: string,
  section: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  
  const { error } = await supabase
    .from("ingestion_v4_style_pages")
    .upsert(
      {
        bucket,
        pdf_path: pdfPath,
        page_number: pageNumber,
        dpi,
        image_path: imagePath,
        image_bytes: imageBytes,
        image_sha256: imageSha256,
        width,
        height,
        exam,
        section,
        rendered_at: new Date().toISOString(),
      },
      { onConflict: "bucket,pdf_path,page_number,dpi" }
    );
    
  if (error) {
    throw new Error(`Failed to upsert page record: ${error.message}`);
  }
}

async function renderSinglePage(
  pdfDocument: pdfjs.PDFDocumentProxy,
  pageNumber: number,
  dpi: number
): Promise<{ pngBuffer: Buffer; width: number; height: number }> {
  const page = await pdfDocument.getPage(pageNumber);
  const viewport = page.getViewport({ scale: dpi / 72 });
  
  const width = Math.floor(viewport.width);
  const height = Math.floor(viewport.height);
  
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, width, height);
  
  const renderContext = {
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
    canvas: canvas as unknown as HTMLCanvasElement,
  };
  
  await page.render(renderContext as any).promise;
  
  const pngBuffer = canvas.toBuffer("image/png");
  
  return { pngBuffer, width, height };
}

export async function renderPagesForPdf(
  options: RenderPagesForPdfOptions
): Promise<RenderPagesResult> {
  const {
    bucket = STYLE_BANK_BUCKET,
    pdfPath,
    exam,
    section,
    dpi = 150,
    maxPages = 60,
    overwrite = false,
    pageMode = "first",
    pageStart,
    pageEnd,
  } = options;
  
  if (dpi < 72 || dpi > 300) {
    throw new Error("DPI must be between 72 and 300");
  }
  if (maxPages < 1 || maxPages > 200) {
    throw new Error("maxPages must be between 1 and 200");
  }
  
  const pdfBytes = await downloadPdf(bucket, pdfPath);
  const pdfDocument = await pdfjs.getDocument({ data: pdfBytes }).promise;
  
  const totalPages = pdfDocument.numPages;
  
  let startPage = 1;
  let endPage = Math.min(totalPages, maxPages);
  
  if (pageMode === "first") {
    startPage = 1;
    endPage = 1;
  } else if (pageMode === "range" && pageStart && pageEnd) {
    startPage = Math.max(1, pageStart);
    endPage = Math.min(totalPages, pageEnd, pageStart + maxPages - 1);
  }
  
  const pdfSlug = getPdfSlug(pdfPath);
  const result: RenderPagesResult = {
    pdfPath,
    totalPages,
    renderedPages: 0,
    skippedPages: 0,
    pages: [],
  };
  
  for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
    const exists = await pageExistsInDb(bucket, pdfPath, pageNum, dpi);
    
    if (exists && !overwrite) {
      result.skippedPages++;
      continue;
    }
    
    try {
      const { pngBuffer, width, height } = await renderSinglePage(pdfDocument, pageNum, dpi);
      const imagePath = getOutputPath(section, pdfSlug, pageNum);
      const sha256 = createHash("sha256").update(pngBuffer).digest("hex");
      
      await uploadPng(bucket, imagePath, pngBuffer);
      
      await upsertPageRecord(
        bucket,
        pdfPath,
        pageNum,
        dpi,
        imagePath,
        pngBuffer.length,
        sha256,
        width,
        height,
        exam,
        section
      );
      
      result.renderedPages++;
      result.pages.push({
        pageNumber: pageNum,
        imagePath,
        bytes: pngBuffer.length,
        width,
        height,
      });
    } catch (pageErr: any) {
      console.error(`[V4PageRenderer] Failed to render page ${pageNum}: ${pageErr.message}`);
    }
  }
  
  return result;
}

export async function getRenderedPagesForPdf(
  bucket: string,
  pdfPath: string,
  dpi?: number
): Promise<Array<{ pageNumber: number; imagePath: string; bytes: number }>> {
  const supabase = getSupabaseAdmin();
  
  let query = supabase
    .from("ingestion_v4_style_pages")
    .select("page_number, image_path, image_bytes")
    .eq("bucket", bucket)
    .eq("pdf_path", pdfPath)
    .order("page_number", { ascending: true });
    
  if (dpi) {
    query = query.eq("dpi", dpi);
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error(`[V4PageRenderer] Failed to get pages: ${error.message}`);
    return [];
  }
  
  return (data || []).map((row) => ({
    pageNumber: row.page_number,
    imagePath: row.image_path,
    bytes: row.image_bytes,
  }));
}
