/**
 * Lyceon Ingestion v3 - Document AI Client
 * 
 * Wraps Google Document AI for OCR and layout extraction.
 * Uses the existing processor configured via environment variables.
 * 
 * PDF Chunking (v3.1):
 * All DocAI usage should go through processDocumentInChunks() which automatically
 * handles PDFs larger than the DocAI page limit (default: 30 pages).
 * Larger PDFs are safely chunked at the DocAI boundary and results merged.
 */

import { DocumentProcessorServiceClient, protos } from '@google-cloud/documentai';
import { PDFDocument } from 'pdf-lib';

type Document = protos.google.cloud.documentai.v1.IDocument;

// ============================================================================
// Page Chunking Configuration & Types
// ============================================================================

/** Maximum pages DocAI can process in a single request (15 for non-imageless mode) */
export const DOCAI_MAX_PAGES_PER_CHUNK = parseInt(process.env.DOCAI_MAX_PAGES || '15', 10);

/** Configuration for a single DocAI chunk */
export interface DocAiChunkConfig {
  startPage: number;   // 1-based inclusive
  endPage: number;     // 1-based inclusive
  chunkIndex: number;  // 0-based chunk index
  totalChunks: number; // Total number of chunks
}

/**
 * Calculate chunk configurations for a given page count
 * @param totalPages Total number of pages in the PDF
 * @param maxPerChunk Maximum pages per chunk (default: DOCAI_MAX_PAGES_PER_CHUNK)
 * @returns Array of chunk configurations
 */
export function buildDocAiChunks(totalPages: number, maxPerChunk: number = DOCAI_MAX_PAGES_PER_CHUNK): DocAiChunkConfig[] {
  if (totalPages <= 0) return [];
  if (totalPages <= maxPerChunk) {
    return [{
      startPage: 1,
      endPage: totalPages,
      chunkIndex: 0,
      totalChunks: 1,
    }];
  }
  
  const chunks: DocAiChunkConfig[] = [];
  const totalChunks = Math.ceil(totalPages / maxPerChunk);
  
  for (let i = 0; i < totalChunks; i++) {
    const startPage = i * maxPerChunk + 1;
    const endPage = Math.min((i + 1) * maxPerChunk, totalPages);
    chunks.push({
      startPage,
      endPage,
      chunkIndex: i,
      totalChunks,
    });
  }
  
  return chunks;
}

let _docaiClient: DocumentProcessorServiceClient | null = null;

function getCredentialsJson(): string | undefined {
  return process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || 
         process.env.GOOGLE_APPLICATION_CREDENTIALS ||
         process.env.DOCUMENT_AI_APIJSON;
}

function getProjectId(): string | undefined {
  const credsJson = getCredentialsJson();
  if (credsJson) {
    try {
      const creds = JSON.parse(credsJson);
      if (creds.project_id) return creds.project_id;
    } catch {}
  }
  return process.env.GCP_PROJECT_ID || process.env.DOCUMENT_AI_PROJECT_ID;
}

function checkDocAIEnvVars(): string[] {
  const missing: string[] = [];
  
  if (!getCredentialsJson()) {
    missing.push('GOOGLE_APPLICATION_CREDENTIALS_JSON (or GOOGLE_APPLICATION_CREDENTIALS)');
  }
  
  if (!getProjectId()) {
    missing.push('GCP_PROJECT_ID');
  }
  
  const processorId = process.env.DOC_AI_PROCESSOR_ID || process.env.DOCUMENT_AI_PROCESSOR_ID;
  if (!processorId) {
    missing.push('DOC_AI_PROCESSOR_ID');
  }
  
  return missing;
}

function getDocAIClient(): DocumentProcessorServiceClient {
  if (_docaiClient) return _docaiClient;
  
  const missing = checkDocAIEnvVars();
  if (missing.length > 0) {
    console.error('[DocAI] Missing required env vars:', missing);
    throw new Error(`Missing required DocAI env vars: ${missing.join(', ')}`);
  }
  
  const credentialsJson = getCredentialsJson()!;
  const credentials = JSON.parse(credentialsJson);
  _docaiClient = new DocumentProcessorServiceClient({ credentials });
  console.log('✅ [DocAI] Document AI client initialized');
  return _docaiClient;
}

function getProcessorName(): string {
  const missing = checkDocAIEnvVars();
  if (missing.length > 0) {
    console.error('[DocAI] Missing required env vars:', missing);
    throw new Error(`Missing required DocAI env vars: ${missing.join(', ')}`);
  }
  
  const projectId = getProjectId()!;
  const location = process.env.DOC_AI_LOCATION || process.env.GCP_LOCATION || process.env.DOCUMENT_AI_LOCATION || 'us';
  const processorId = process.env.DOC_AI_PROCESSOR_ID || process.env.DOCUMENT_AI_PROCESSOR_ID;
  
  return `projects/${projectId}/locations/${location}/processors/${processorId}`;
}

export interface DocAIProcessResult {
  document: Document;
  text: string;
  pages: DocAIPage[];
}

export interface DocAIPage {
  pageNumber: number;
  text: string;
  paragraphs: DocAIParagraph[];
  tables: DocAITable[];
  width: number;
  height: number;
}

export interface DocAIParagraph {
  text: string;
  boundingBox?: number[];
  confidence: number;
}

export interface DocAITable {
  rows: string[][];
  boundingBox?: number[];
}

export async function processDocument(pdfBuffer: Buffer, mimeType: string = 'application/pdf'): Promise<DocAIProcessResult> {
  const client = getDocAIClient();
  const processorName = getProcessorName();
  
  console.log(`📄 [DocAI] Processing document (${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
  
  const request = {
    name: processorName,
    rawDocument: {
      content: pdfBuffer.toString('base64'),
      mimeType,
    },
  };
  
  const [result] = await client.processDocument(request);
  const document = result.document;
  
  if (!document) {
    throw new Error("DocAI returned no document");
  }
  
  const fullText = document.text || '';
  const pages = extractPages(document);
  
  console.log(`✅ [DocAI] Extracted ${pages.length} pages, ${fullText.length} characters`);
  
  return {
    document,
    text: fullText,
    pages,
  };
}

function extractPages(document: Document): DocAIPage[] {
  const fullText = document.text || '';
  const pages: DocAIPage[] = [];
  
  if (!document.pages) return pages;
  
  for (let i = 0; i < document.pages.length; i++) {
    const page = document.pages[i];
    const pageNumber = i + 1;
    
    const paragraphs: DocAIParagraph[] = [];
    const tables: DocAITable[] = [];
    
    if (page.paragraphs) {
      for (const para of page.paragraphs) {
        const paraText = extractTextFromLayout(para.layout, fullText);
        paragraphs.push({
          text: paraText,
          boundingBox: extractBoundingBox(para.layout),
          confidence: para.layout?.confidence || 0,
        });
      }
    }
    
    if (page.tables) {
      for (const table of page.tables) {
        const rows: string[][] = [];
        if (table.bodyRows) {
          for (const row of table.bodyRows) {
            const cells: string[] = [];
            if (row.cells) {
              for (const cell of row.cells) {
                const cellText = extractTextFromLayout(cell.layout, fullText);
                cells.push(cellText);
              }
            }
            rows.push(cells);
          }
        }
        tables.push({
          rows,
          boundingBox: extractBoundingBox(table.layout),
        });
      }
    }
    
    const pageText = paragraphs.map(p => p.text).join('\n');
    
    pages.push({
      pageNumber,
      text: pageText,
      paragraphs,
      tables,
      width: page.dimension?.width || 0,
      height: page.dimension?.height || 0,
    });
  }
  
  return pages;
}

function extractTextFromLayout(layout: any, fullText: string): string {
  if (!layout?.textAnchor?.textSegments) return '';
  
  let text = '';
  for (const segment of layout.textAnchor.textSegments) {
    const start = parseInt(segment.startIndex || '0');
    const end = parseInt(segment.endIndex || '0');
    text += fullText.slice(start, end);
  }
  return text.trim();
}

function extractBoundingBox(layout: any): number[] | undefined {
  if (!layout?.boundingPoly?.normalizedVertices) return undefined;
  
  const vertices = layout.boundingPoly.normalizedVertices;
  if (vertices.length < 4) return undefined;
  
  const x = vertices[0].x || 0;
  const y = vertices[0].y || 0;
  const width = (vertices[2].x || 0) - x;
  const height = (vertices[2].y || 0) - y;
  
  return [x, y, width, height];
}

export async function extractPageImages(pdfBuffer: Buffer): Promise<Buffer[]> {
  console.log('⚠️ [DocAI] extractPageImages: Using pdf-lib for page extraction');
  return [];
}

// ============================================================================
// PDF Chunking Functions
// ============================================================================

/**
 * Extract a page range from a PDF buffer
 * @param pdfBuffer Original PDF buffer
 * @param startPage 1-based start page (inclusive)
 * @param endPage 1-based end page (inclusive)
 * @returns New PDF buffer containing only the specified pages
 */
async function extractPdfPageRange(pdfBuffer: Buffer, startPage: number, endPage: number): Promise<Buffer> {
  const srcDoc = await PDFDocument.load(pdfBuffer);
  const newDoc = await PDFDocument.create();
  
  const pageIndices: number[] = [];
  for (let i = startPage - 1; i < endPage; i++) {
    pageIndices.push(i);
  }
  
  const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
  for (const page of copiedPages) {
    newDoc.addPage(page);
  }
  
  const pdfBytes = await newDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Get the total page count of a PDF
 * @param pdfBuffer PDF buffer
 * @returns Total number of pages
 */
export async function getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  return doc.getPageCount();
}

/**
 * Process a single chunk of a PDF through DocAI
 * @param pdfBuffer Full PDF buffer
 * @param chunk Chunk configuration
 * @returns DocAI result for this chunk with adjusted page numbers
 */
async function processDocumentChunk(
  pdfBuffer: Buffer,
  chunk: DocAiChunkConfig
): Promise<DocAIProcessResult> {
  console.log(`📄 [DocAI] Processing chunk ${chunk.chunkIndex + 1}/${chunk.totalChunks} (pages ${chunk.startPage}-${chunk.endPage})`);
  
  const chunkBuffer = await extractPdfPageRange(pdfBuffer, chunk.startPage, chunk.endPage);
  const result = await processDocument(chunkBuffer);
  
  for (const page of result.pages) {
    page.pageNumber = page.pageNumber + (chunk.startPage - 1);
  }
  
  return result;
}

/**
 * Merge multiple DocAI results into a single combined result
 * @param results Array of DocAI results from each chunk
 * @param chunks Chunk configs for page offset calculation
 * @returns Combined result with all pages, text, and merged Document protobuf
 */
function mergeDocAIResults(results: DocAIProcessResult[], chunks: DocAiChunkConfig[]): DocAIProcessResult {
  if (results.length === 0) {
    throw new Error('No DocAI results to merge');
  }
  
  if (results.length === 1) {
    return results[0];
  }
  
  const allPages: DocAIPage[] = [];
  const allText: string[] = [];
  const allDocumentPages: any[] = [];
  const allEntities: any[] = [];
  
  let textOffset = 0;
  
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const chunk = chunks[i];
    const pageOffset = chunk.startPage - 1;
    
    allPages.push(...result.pages);
    allText.push(result.text);
    
    if (result.document?.pages) {
      for (const page of result.document.pages) {
        const clonedPage = JSON.parse(JSON.stringify(page));
        clonedPage.pageNumber = (clonedPage.pageNumber || 0) + pageOffset;
        allDocumentPages.push(clonedPage);
      }
    }
    
    if (result.document?.entities) {
      for (const entity of result.document.entities) {
        const clonedEntity = JSON.parse(JSON.stringify(entity));
        if (clonedEntity.pageAnchor?.pageRefs) {
          for (const ref of clonedEntity.pageAnchor.pageRefs) {
            ref.page = (parseInt(ref.page || '0') + pageOffset).toString();
          }
        }
        if (clonedEntity.textAnchor?.textSegments) {
          for (const seg of clonedEntity.textAnchor.textSegments) {
            seg.startIndex = (parseInt(seg.startIndex || '0') + textOffset).toString();
            seg.endIndex = (parseInt(seg.endIndex || '0') + textOffset).toString();
          }
        }
        allEntities.push(clonedEntity);
      }
    }
    
    textOffset += (result.text?.length || 0) + 2;
  }
  
  allPages.sort((a, b) => a.pageNumber - b.pageNumber);
  
  const mergedDocument: Document = {
    ...results[0].document,
    text: allText.join('\n\n'),
    pages: allDocumentPages,
    entities: allEntities,
  };
  
  return {
    document: mergedDocument,
    text: allText.join('\n\n'),
    pages: allPages,
  };
}

/** Options for chunk processing */
export interface ChunkProcessingOptions {
  maxPagesPerChunk?: number;
}

/** Result with chunk metadata */
export interface ChunkedDocAIProcessResult extends DocAIProcessResult {
  chunkCount: number;
  totalPages: number;
}

/**
 * Process a PDF document through DocAI with automatic chunking for large PDFs.
 * This is the recommended entry point for all DocAI processing in v3+.
 * 
 * For PDFs with pageCount <= maxPagesPerChunk: Single DocAI call (same as before)
 * For PDFs with pageCount > maxPagesPerChunk: Automatic chunking and merging
 * 
 * @param pdfBuffer PDF buffer to process
 * @param options Optional configuration (maxPagesPerChunk)
 * @returns Combined DocAI result with chunk metadata
 */
export async function processDocumentInChunks(
  pdfBuffer: Buffer,
  options: ChunkProcessingOptions = {}
): Promise<ChunkedDocAIProcessResult> {
  const maxPages = options.maxPagesPerChunk ?? DOCAI_MAX_PAGES_PER_CHUNK;
  
  const totalPages = await getPdfPageCount(pdfBuffer);
  console.log(`📊 [DocAI] PDF has ${totalPages} pages (limit: ${maxPages} per chunk)`);
  
  const chunks = buildDocAiChunks(totalPages, maxPages);
  
  if (chunks.length === 1) {
    console.log(`📄 [DocAI] Single chunk - processing entire document`);
    const result = await processDocument(pdfBuffer);
    return {
      ...result,
      chunkCount: 1,
      totalPages,
    };
  }
  
  console.log(`🔪 [DocAI] Splitting into ${chunks.length} chunks`);
  
  const results: DocAIProcessResult[] = [];
  
  for (const chunk of chunks) {
    const chunkResult = await processDocumentChunk(pdfBuffer, chunk);
    results.push(chunkResult);
  }
  
  console.log(`✅ [DocAI] Completed ${chunks.length} chunks (${totalPages} pages total)`);
  
  const merged = mergeDocAIResults(results, chunks);
  
  return {
    ...merged,
    chunkCount: chunks.length,
    totalPages,
  };
}
