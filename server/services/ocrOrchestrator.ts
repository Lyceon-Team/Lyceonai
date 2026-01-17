/**
 * OCR Orchestrator for Ingestion v2
 * Implements tiered OCR: DocAI (primary) → Mathpix (selective) → Nougat (fallback)
 * with intelligent result merging and confidence tracking
 */

import { DocumentProcessorServiceClient } from '@google-cloud/documentai';
import { ImprovedMathpixService } from './mathpix-improved';
import { PDFDocument } from 'pdf-lib';
import { ocrConfig } from '../../apps/api/src/env';

// DocAI page limit constant - use config or fallback
const DOC_AI_MAX_PAGES_PER_CHUNK = ocrConfig.docAiMaxPagesPerChunk;

// OCR Engine type
export type OcrEngineName = 'docai' | 'mathpix' | 'nougat' | 'tesseract';

// OCR Statistics for tracking engine usage and errors
export interface OcrStats {
  totalPages: number;
  byEngine: {
    docai: { pages: number; chunks: number; errors: number };
    mathpix: { pages: number; errors: number };
    nougat: { pages: number; errors: number };
    tesseract: { pages: number; errors: number };
  };
  errors: { engine: OcrEngineName; message: string }[];
  // Provider tracing fields (for fallback observability)
  providerUsed: OcrEngineName | null;
  providerAttempts: OcrEngineName[];
  mathpixPatchCount: number;
  nougatMergeCount: number;
}

// Common OCR result interface
export interface OcrBlock {
  text: string;
  bbox: number[]; // [x, y, width, height]
  confidence: number;
  type?: 'text' | 'math';
  engine: 'docai' | 'mathpix' | 'nougat';
  metadata?: Record<string, unknown>;
}

export interface OcrResult {
  text: string;
  blocks: OcrBlock[];
  engine: 'docai' | 'mathpix' | 'nougat';
  page: number;
  confidence: number; // Average confidence for this page
  metadata?: {
    docaiUsed?: boolean;
    mathpixPatched?: boolean;
    nougatMerged?: boolean;
    mathRegionsCount?: number;
    lowConfRegionsCount?: number;
  };
}

export interface OrchestratorConfig {
  ocrConfidenceThreshold: number; // Default: 0.85
  mathpixPatchThreshold: number; // Confidence below this triggers Mathpix patch
  enableMathpix: boolean;
  enableNougat: boolean;
  detectMathRegions: boolean;
  nougatMinTokenGain: number; // Minimum 20% token gain to use Nougat
}

export class OcrOrchestrator {
  private config: OrchestratorConfig;
  private docaiClient: DocumentProcessorServiceClient | null = null;
  private mathpixService: ImprovedMathpixService | null = null;

  constructor(config?: Partial<OrchestratorConfig>) {
    this.config = {
      ocrConfidenceThreshold: parseFloat(process.env.OCR_CONFIDENCE_THRESHOLD || '0.85'),
      mathpixPatchThreshold: 0.75, // Trigger Mathpix if confidence < 0.75
      enableMathpix: !!process.env.MATHPIX_API_ID,
      enableNougat: false, // Nougat/Replicate removed - no longer supported
      detectMathRegions: true,
      nougatMinTokenGain: 0.2,
      ...config,
    };
  }

  /**
   * Initialize Document AI client
   */
  private async initDocAI(): Promise<DocumentProcessorServiceClient> {
    if (!this.docaiClient) {
      const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || process.env.DOCUMENT_AI_APIJSON || '{}');
      this.docaiClient = new DocumentProcessorServiceClient({ credentials });
      console.log('✅ [OCR] Document AI client initialized');
    }
    return this.docaiClient;
  }

  /**
   * Initialize Mathpix service
   */
  private getMathpixService(): ImprovedMathpixService {
    if (!this.mathpixService) {
      this.mathpixService = new ImprovedMathpixService();
      console.log('✅ [OCR] Mathpix service initialized');
    }
    return this.mathpixService;
  }

  /**
   * Stub Nougat extractor - Nougat/Replicate is no longer supported
   */
  private getNougatExtractor(): { extractWithRetry: (_path: string, _opts: any) => Promise<{ success: boolean; content: string; contentLength: number; error?: string }> } {
    return {
      extractWithRetry: async () => ({ success: false, content: '', contentLength: 0, error: 'Nougat is disabled' })
    };
  }

  /**
   * Get total page count from PDF buffer
   */
  private async getPdfPageCount(buffer: Buffer): Promise<number> {
    try {
      const pdfDoc = await PDFDocument.load(buffer);
      return pdfDoc.getPageCount();
    } catch (error: any) {
      console.warn(`⚠️ [OCR] Failed to count PDF pages:`, error.message);
      return 0;
    }
  }

  /**
   * Extract a page range from PDF buffer
   */
  private async extractPdfPages(buffer: Buffer, startPage: number, endPage: number): Promise<Buffer> {
    try {
      const pdfDoc = await PDFDocument.load(buffer);
      const newPdf = await PDFDocument.create();
      
      // Copy pages (0-indexed in pdf-lib)
      const pages = await newPdf.copyPages(
        pdfDoc, 
        Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i - 1)
      );
      
      pages.forEach(page => newPdf.addPage(page));
      
      const pdfBytes = await newPdf.save();
      return Buffer.from(pdfBytes);
    } catch (error: any) {
      console.error(`❌ [OCR] Failed to extract PDF pages ${startPage}-${endPage}:`, error.message);
      throw error;
    }
  }

  /**
   * Check if error is a DocAI page limit error
   */
  private isPageLimitError(error: any): boolean {
    const errorMessage = error?.message?.toLowerCase() || '';
    return errorMessage.includes('page limit') || 
           errorMessage.includes('too many pages') ||
           errorMessage.includes('exceeds') && errorMessage.includes('page');
  }

  /**
   * Run Document AI OCR on a PDF buffer (with automatic chunking for large PDFs)
   */
  private async runDocAI(buffer: Buffer, page?: number): Promise<OcrResult[]> {
    console.log(`🔧 [OCR] Running Document AI (page: ${page || 'all'})`);

    try {
      const client = await this.initDocAI();
      const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || process.env.DOCUMENT_AI_APIJSON || '{}');
      const projectId = credentials.project_id;
      const location = process.env.GCP_LOCATION || process.env.DOCUMENT_AI_LOCATION || 'us';
      const processorId = process.env.DOC_AI_PROCESSOR || process.env.DOCUMENT_AI_PROCESSOR_ID;

      if (!projectId || !processorId) {
        throw new Error('Document AI credentials or processor ID missing');
      }

      const processorName = `projects/${projectId}/locations/${location}/processors/${processorId}`;

      // First, try processing the full document
      let document;
      let usedChunking = false;
      
      try {
        console.log(`🔧 [OCR] Attempting full-document DocAI processing`);
        const [result] = await client.processDocument({
          name: processorName,
          rawDocument: {
            content: buffer.toString('base64'),
            mimeType: 'application/pdf',
          },
          processOptions: {
            ocrConfig: {
              enableNativePdfParsing: true,
              computeStyleInfo: true, // Need this for confidence scores
            },
          },
        });
        
        document = result.document;
        if (!document?.pages) {
          throw new Error('No pages extracted from Document AI');
        }
        
        console.log(`✅ [OCR] Full-document DocAI succeeded: ${document.pages.length} pages`);
        
      } catch (docaiError: any) {
        // Check if this is a page limit error
        if (this.isPageLimitError(docaiError)) {
          console.warn(`⚠️ [OCR] DocAI page limit exceeded, switching to chunked mode`);
          
          // Get total page count
          const totalPages = await this.getPdfPageCount(buffer);
          if (totalPages === 0) {
            throw new Error('Failed to count PDF pages for chunking');
          }
          
          console.log(`🔧 [OCR] PDF has ${totalPages} pages, chunking into ${DOC_AI_MAX_PAGES_PER_CHUNK}-page segments`);
          
          // Calculate number of chunks
          const numChunks = Math.ceil(totalPages / DOC_AI_MAX_PAGES_PER_CHUNK);
          console.log(`🔧 [OCR] Processing ${numChunks} chunks`);
          
          // Process each chunk
          const allChunkResults: OcrResult[] = [];
          
          for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
            const startPage = chunkIdx * DOC_AI_MAX_PAGES_PER_CHUNK + 1;
            const endPage = Math.min((chunkIdx + 1) * DOC_AI_MAX_PAGES_PER_CHUNK, totalPages);
            
            console.log(`🔧 [OCR] Processing chunk ${chunkIdx + 1}/${numChunks}: pages ${startPage}-${endPage}`);
            
            // Extract chunk
            const chunkBuffer = await this.extractPdfPages(buffer, startPage, endPage);
            
            // Process chunk with DocAI
            let chunkResult;
            try {
              [chunkResult] = await client.processDocument({
                name: processorName,
                rawDocument: {
                  content: chunkBuffer.toString('base64'),
                  mimeType: 'application/pdf',
                },
                processOptions: {
                  ocrConfig: {
                    enableNativePdfParsing: true,
                    computeStyleInfo: true,
                  },
                },
              });
            } catch (chunkError: any) {
              console.error(`❌ [OCR] Chunk ${chunkIdx + 1} failed:`, chunkError.message);
              // Skip failed chunk and continue with others
              continue;
            }
            
            // Guard against missing or empty pages in chunk result
            if (!chunkResult?.document?.pages || chunkResult.document.pages.length === 0) {
              console.warn(`⚠️ [OCR] Chunk ${chunkIdx + 1} returned no pages, skipping`);
              continue;
            }
            
            // Convert chunk pages to OcrResults with correct page numbers
            for (let i = 0; i < chunkResult.document.pages.length; i++) {
              const docPage = chunkResult.document.pages[i];
              const realPageNumber = startPage + i; // Map to actual PDF page number
              
              const blocks: OcrBlock[] = [];
              let pageText = '';
              let totalConfidence = 0;
              let confidenceCount = 0;

              // Extract text from paragraphs with bounding boxes
              if (docPage.paragraphs) {
                for (const para of docPage.paragraphs) {
                  const segment = para.layout?.textAnchor?.textSegments?.[0];
                  if (segment && chunkResult.document.text) {
                    const startIdx = parseInt(String(segment.startIndex || 0));
                    const endIdx = parseInt(String(segment.endIndex || 0));
                    const text = chunkResult.document.text.substring(startIdx, endIdx);

                    // Get bounding box
                    const vertices = para.layout?.boundingPoly?.normalizedVertices || [];
                    const bbox = vertices.length >= 4 ? [
                      vertices[0].x || 0,
                      vertices[0].y || 0,
                      (vertices[2].x || 0) - (vertices[0].x || 0),
                      (vertices[2].y || 0) - (vertices[0].y || 0),
                    ] : [0, 0, 1, 1];

                    // Get confidence
                    const confidence = para.layout?.confidence || 0.8;

                    blocks.push({
                      text,
                      bbox,
                      confidence,
                      engine: 'docai',
                    });

                    pageText += text + '\n';
                    totalConfidence += confidence;
                    confidenceCount++;
                  }
                }
              }

              const avgConfidence = confidenceCount > 0 ? totalConfidence / confidenceCount : 0;

              allChunkResults.push({
                text: pageText,
                blocks,
                engine: 'docai',
                page: realPageNumber,
                confidence: avgConfidence,
                metadata: {
                  docaiUsed: true,
                },
              });
            }
            
            console.log(`✅ [OCR] Chunk ${chunkIdx + 1}/${numChunks} processed: ${chunkResult.document.pages.length} pages`);
          }
          
          // If no chunks succeeded, throw to trigger fallback
          if (allChunkResults.length === 0) {
            throw new Error('All DocAI chunks failed - no pages extracted');
          }
          
          usedChunking = true;
          console.log(`✅ [OCR] Chunked DocAI complete: ${allChunkResults.length} total pages processed`);
          return allChunkResults;
          
        } else {
          // Not a page limit error, rethrow
          throw docaiError;
        }
      }

      // If we get here, full-document processing succeeded
      // Convert Document AI pages to our format
      const ocrResults: OcrResult[] = [];

      for (let i = 0; i < document.pages.length; i++) {
        const docPage = document.pages[i];
        const blocks: OcrBlock[] = [];
        let pageText = '';
        let totalConfidence = 0;
        let confidenceCount = 0;

        // Extract text from paragraphs with bounding boxes
        if (docPage.paragraphs) {
          for (const para of docPage.paragraphs) {
            const segment = para.layout?.textAnchor?.textSegments?.[0];
            if (segment && document.text) {
              const startIdx = parseInt(String(segment.startIndex || 0));
              const endIdx = parseInt(String(segment.endIndex || 0));
              const text = document.text.substring(startIdx, endIdx);

              // Get bounding box
              const vertices = para.layout?.boundingPoly?.normalizedVertices || [];
              const bbox = vertices.length >= 4 ? [
                vertices[0].x || 0,
                vertices[0].y || 0,
                (vertices[2].x || 0) - (vertices[0].x || 0),
                (vertices[2].y || 0) - (vertices[0].y || 0),
              ] : [0, 0, 1, 1];

              // Get confidence
              const confidence = para.layout?.confidence || 0.8;

              blocks.push({
                text,
                bbox,
                confidence,
                engine: 'docai',
              });

              pageText += text + '\n';
              totalConfidence += confidence;
              confidenceCount++;
            }
          }
        }

        const avgConfidence = confidenceCount > 0 ? totalConfidence / confidenceCount : 0;

        ocrResults.push({
          text: pageText,
          blocks,
          engine: 'docai',
          page: i + 1,
          confidence: avgConfidence,
          metadata: {
            docaiUsed: true,
          },
        });
      }

      console.log(`✅ [OCR] Document AI extracted ${ocrResults.length} pages, avg confidence: ${(ocrResults.reduce((sum, r) => sum + r.confidence, 0) / ocrResults.length).toFixed(2)}`);
      return ocrResults;

    } catch (error: any) {
      console.error(`❌ [OCR] Document AI failed:`, error.message);
      // Return structured error instead of throwing
      return [];
    }
  }

  /**
   * Detect math regions in OCR blocks using enhanced SAT-specific heuristics
   * 
   * SAT Math patterns include:
   * - Algebraic expressions (x, y, variables with exponents)
   * - Fractions and ratios
   * - Geometric formulas (π, √, angles)
   * - Coordinate geometry ((x, y) pairs)
   * - Inequalities and equations
   * - Function notation f(x)
   * - Scientific notation
   * - Unit conversions
   */
  private detectMathRegions(blocks: OcrBlock[]): OcrBlock[] {
    if (!this.config.detectMathRegions) return [];

    const mathBlocks: OcrBlock[] = [];
    
    // Enhanced SAT math patterns - designed to avoid false positives on prose
    const mathPatterns = {
      // Core math operators and symbols (strong math indicator)
      operators: /[=<>≤≥≠±×÷∙·•]/,
      // Algebraic variables in math context only (adjacent to operators/numbers, not standalone articles)
      // Matches: "x = 5", "2x", "x²", "solve for x", but NOT "a book" or "I was"
      algebraic: /(?:\d[xyz]|[xyz]\d|[xyz]\s*[=<>≤≥≠±×÷]|[=<>≤≥≠±×÷]\s*[xyz]|[xyz][²³⁴]|solve\s+for\s+[xyzn]|\b[xyzn]\s*\+|\b[xyzn]\s*\-)/i,
      // Exponents and roots (strong math indicator)
      exponents: /\^|²|³|⁴|√|∛|\\sqrt|\\frac/,
      // Greek letters common in math (less common in prose)
      greek: /[πθαβγδ]|\\pi|\\theta/,
      // Function notation (strong math indicator)
      functions: /\bf\s*\([^)]*\)|\bg\s*\([^)]*\)|sin\s*\(|cos\s*\(|tan\s*\(|log\s*\(|ln\s*\(/i,
      // Coordinate pairs (strong math indicator)
      coordinates: /\(\s*-?\d+\.?\d*\s*,\s*-?\d+\.?\d*\s*\)/,
      // Fractions written as a/b (must have numbers)
      fractions: /\d+\s*\/\s*\d+/,
      // Percentage and ratios (must have numbers)
      ratios: /\d+\s*:\s*\d+|\d+\.?\d*\s*%/,
      // SAT-specific equation solving markers (strong math indicator)
      solving: /solve\s+for|find\s+the\s+value|simplify\s+the|factor\s+the|evaluate\s+the/i,
      // Geometry terms with numbers or units (require numeric context to reduce false positives)
      geometry: /\d+\s*degrees?|\d+°|\d+\s*(?:cm|m|ft|in|mm)|\bangle\s+[A-Z]|\btriangle\s+[A-Z]/i,
      // Scientific notation (strong math indicator)
      scientific: /\d+\.?\d*\s*×\s*10\s*\^?\s*[+-]?\d+/,
      // Equations with variables and operators together
      equations: /\d+[xyz]\s*[=<>+\-]|[xyz]\s*[=]\s*\d+/i,
    };

    for (const block of blocks) {
      const text = block.text;
      let isMathRegion = false;
      let matchedPatterns: string[] = [];

      // Check each pattern category
      for (const [category, pattern] of Object.entries(mathPatterns)) {
        if (pattern.test(text)) {
          isMathRegion = true;
          matchedPatterns.push(category);
        }
      }

      // Also flag low-confidence regions (OCR struggles with math symbols)
      if (block.confidence < this.config.mathpixPatchThreshold) {
        isMathRegion = true;
        matchedPatterns.push('low_confidence');
      }

      if (isMathRegion) {
        mathBlocks.push({ 
          ...block, 
          type: 'math',
          metadata: { 
            ...block.metadata, 
            mathPatterns: matchedPatterns 
          }
        });
      }
    }

    // Log summary of detected math patterns
    if (mathBlocks.length > 0) {
      const patternSummary: Record<string, number> = {};
      for (const block of mathBlocks) {
        const patterns = (block.metadata?.mathPatterns as string[]) || [];
        for (const p of patterns) {
          patternSummary[p] = (patternSummary[p] || 0) + 1;
        }
      }
      console.log(`🔍 [OCR] Math detection: ${mathBlocks.length} blocks, patterns: ${JSON.stringify(patternSummary)}`);
    }

    return mathBlocks;
  }

  /**
   * Patch math/low-confidence regions with Mathpix (MINIMAL PHASE 1 IMPLEMENTATION)
   * 
   * Strategy:
   * - Only patch blocks with confidence < threshold
   * - Use Mathpix per-page text with anchor matching ONLY (no position fallback)
   * - Skip if anchor not found (conservative approach)
   * - Validate page numbers before merging
   * 
   * Phase 2 enhancements:
   * - Add block-order-based matching for better coverage
   * - Verify patched content is math (TeX/LaTeX markers)
   * - Add regression tests
   */
  private mathpixCache: Map<string, { text: string; confidence: number; pageCount: number; pages?: Array<{ pageNum: number; text: string }> }> | null = null;
  
  private async patchWithMathpix(buffer: Buffer, mathRegions: OcrBlock[], pageNumber: number): Promise<Map<string, OcrBlock>> {
    if (!this.config.enableMathpix || mathRegions.length === 0) {
      return new Map();
    }

    console.log(`🔧 [OCR] Patching ${mathRegions.length} math/low-conf regions on page ${pageNumber} with Mathpix`);

    try {
      // Get or create Mathpix results (upload once, cache for all pages)
      if (!this.mathpixCache) {
        const mathpix = this.getMathpixService();
        const pdfId = await mathpix.uploadPdfForStreaming(buffer);
        const result = await mathpix.streamPdfResults(pdfId);
        
        this.mathpixCache = new Map();
        this.mathpixCache.set('full', result);
        console.log(`✅ [OCR] Mathpix processing complete: ${result.pageCount} pages, ${result.pages?.length || 0} per-page results`);
      }

      const mathpixResult = this.mathpixCache.get('full');
      if (!mathpixResult || !mathpixResult.pages) {
        console.warn(`⚠️ [OCR] No Mathpix per-page results available`);
        return new Map();
      }

      // Validate page number alignment (Mathpix is 1-based, DocAI page numbers vary)
      // Find matching page by trying both page number and page number-1
      const mathpixPageData = mathpixResult.pages.find(p => p.pageNum === pageNumber) ||
                              mathpixResult.pages.find(p => p.pageNum === pageNumber - 1) ||
                              mathpixResult.pages.find(p => p.pageNum === pageNumber + 1);

      if (!mathpixPageData) {
        console.warn(`⚠️ [OCR] No Mathpix data for page ${pageNumber} (tried ±1 offset)`);
        return new Map();
      }

      const mathpixPageText = mathpixPageData.text;
      console.log(`🔍 [OCR] Using Mathpix page ${mathpixPageData.pageNum} for DocAI page ${pageNumber}`);

      // Create patch map
      const patchedMap = new Map<string, OcrBlock>();

      // CONSERVATIVE APPROACH: Only patch if we find exact anchor match
      for (const region of mathRegions) {
        // Skip high-confidence blocks (don't patch what's already good)
        if (region.confidence >= this.config.mathpixPatchThreshold) {
          continue;
        }

        const bboxKey = region.bbox.map(n => n.toFixed(3)).join(',');

        // Try anchor matching (case-insensitive, first 30 chars)
        const searchAnchor = region.text.substring(0, 30).trim().toLowerCase();
        if (searchAnchor.length < 5) {
          // Too short to be a reliable anchor
          continue;
        }

        const mathpixIndex = mathpixPageText.toLowerCase().indexOf(searchAnchor);

        if (mathpixIndex >= 0) {
          // Found match! Extract improved text
          const extractLength = Math.max(region.text.length, 50);
          const improvedText = mathpixPageText.substring(mathpixIndex, mathpixIndex + extractLength).trim();

          // Only patch if text actually changes
          if (improvedText.length > 5 && improvedText !== region.text) {
            patchedMap.set(bboxKey, {
              ...region,
              text: improvedText,
              confidence: 0.95, // Mathpix has high confidence for math
              engine: 'mathpix',
              type: 'math',
            });
            console.log(`✓ [OCR] Patched region on page ${pageNumber} (found anchor at ${mathpixIndex})`);
          }
        } else {
          // No anchor found - skip (conservative, avoids wrong patches)
          console.log(`⏭️ [OCR] Skipped region on page ${pageNumber} (no anchor match)`);
        }
      }

      console.log(`✅ [OCR] Mathpix patched ${patchedMap.size}/${mathRegions.length} regions on page ${pageNumber}`);
      return patchedMap;

    } catch (error: any) {
      console.warn(`⚠️ [OCR] Mathpix patch failed (continuing):`, error.message);
      return new Map(); // Graceful fallback
    }
  }

  /**
   * Run Nougat OCR as fallback
   */
  private async runNougat(pdfPath: string): Promise<OcrResult[]> {
    if (!this.config.enableNougat) {
      throw new Error('Nougat is disabled');
    }

    console.log(`🔧 [OCR] Running Nougat fallback for ${pdfPath}`);

    try {
      const nougat = this.getNougatExtractor();

      const result = await nougat.extractWithRetry(pdfPath, {
        timeout: 600000, // 10 minutes
        maxRetries: 2,
      });

      if (!result.success) {
        throw new Error(result.error || 'Nougat extraction failed');
      }

      // Parse Nougat markdown into blocks
      // For now, create a single block per page (Nougat returns full document)
      const blocks: OcrBlock[] = [{
        text: result.content,
        bbox: [0, 0, 1, 1],
        confidence: 0.85, // Nougat doesn't provide confidence
        engine: 'nougat',
      }];

      console.log(`✅ [OCR] Nougat extracted ${result.contentLength} chars`);

      return [{
        text: result.content,
        blocks,
        engine: 'nougat',
        page: 1, // Nougat returns full document
        confidence: 0.85,
        metadata: {
          nougatMerged: true,
        },
      }];

    } catch (error: any) {
      console.error(`❌ [OCR] Nougat fallback failed:`, error.message);
      throw error;
    }
  }

  /**
   * Merge results from different engines
   * Priority: Mathpix (math regions) > DocAI (high conf) > Nougat (fallback)
   */
  private mergeResults(docaiResults: OcrResult[], mathpixPatchMaps: Map<number, Map<string, OcrBlock>>, nougatResults?: OcrResult[]): OcrResult[] {
    console.log(`🔧 [OCR] Merging results: DocAI=${docaiResults.length}pages, Mathpix=${Array.from(mathpixPatchMaps.values()).reduce((sum, map) => sum + map.size, 0)}blocks, Nougat=${nougatResults?.length || 0}pages`);

    const mergedResults: OcrResult[] = [];

    for (const docaiPage of docaiResults) {
      let mergedBlocks = [...docaiPage.blocks];
      let mathpixPatchCount = 0;

      // Get Mathpix patches for this specific page
      const pageMathpixPatches = mathpixPatchMaps.get(docaiPage.page) || new Map();

      // Replace low-confidence blocks with Mathpix patches (per-page scoped)
      for (let i = 0; i < mergedBlocks.length; i++) {
        const block = mergedBlocks[i];
        const bboxKey = block.bbox.map(n => n.toFixed(3)).join(',');

        // Check if this block has a Mathpix patch
        const mathpixPatch = pageMathpixPatches.get(bboxKey);
        if (mathpixPatch) {
          mergedBlocks[i] = mathpixPatch; // Actually replace with improved text
          mathpixPatchCount++;
        }
      }

      // Skip Nougat merge for now - requires proper page segmentation
      // TODO: Implement page-aware Nougat segmentation in Phase 2
      const nougatMerged = false;

      mergedResults.push({
        ...docaiPage,
        blocks: mergedBlocks,
        text: mergedBlocks.map(b => b.text).join('\n'),
        metadata: {
          docaiUsed: true,
          mathpixPatched: mathpixPatchCount > 0,
          nougatMerged,
          mathRegionsCount: pageMathpixPatches.size,
          lowConfRegionsCount: docaiPage.blocks.filter(b => b.confidence < this.config.mathpixPatchThreshold).length,
        },
      });
    }

    return mergedResults;
  }

  /**
   * SAT-aware routing: detect if document is likely math-heavy based on filename
   */
  private isLikelyMathDocument(fileName?: string): boolean {
    if (!fileName) return false;
    const lower = fileName.toLowerCase();
    return lower.includes('math') || lower.includes('calc') || lower.includes('no-calculator');
  }

  /**
   * Detect preferred OCR engines based on document characteristics
   */
  private detectPreferredEngines(opts: { fileName?: string }): {
    primary: OcrEngineName;
    fallbacks: OcrEngineName[];
  } {
    const isMath = ocrConfig.enableMathRouting && this.isLikelyMathDocument(opts.fileName);
    
    if (isMath) {
      console.log(`📊 [OCR] Math document detected: ${opts.fileName}`);
      return {
        primary: 'docai', // DocAI still best for layout
        fallbacks: ocrConfig.enableMathpixFallback ? ['mathpix', 'nougat'] : ['nougat'],
      };
    }
    
    return {
      primary: 'docai',
      fallbacks: ocrConfig.enableNougatFallback ? ['nougat'] : [],
    };
  }

  /**
   * Initialize empty stats object
   */
  private createEmptyStats(): OcrStats {
    return {
      totalPages: 0,
      byEngine: {
        docai: { pages: 0, chunks: 0, errors: 0 },
        mathpix: { pages: 0, errors: 0 },
        nougat: { pages: 0, errors: 0 },
        tesseract: { pages: 0, errors: 0 },
      },
      errors: [],
      providerUsed: null,
      providerAttempts: [],
      mathpixPatchCount: 0,
      nougatMergeCount: 0,
    };
  }

  /**
   * Main orchestration method: run tiered OCR with fallbacks
   * Never throws - returns structured error as empty array if all engines fail
   * Returns both results and stats for Option C
   */
  async run(pdfPathOrBuffer: string | Buffer, opts?: { page?: number; fileName?: string }): Promise<{ results: OcrResult[]; stats: OcrStats }> {
    const startTime = Date.now();
    const stats = this.createEmptyStats();
    const page = opts?.page;
    const fileName = opts?.fileName;
    
    // Detect preferred engines based on SAT content type
    const { primary, fallbacks } = this.detectPreferredEngines({ fileName });
    console.log(`\n🚀 [OCR] Starting Option C pipeline | Primary: ${primary} | Fallbacks: ${fallbacks.join(', ')}`);

    let buffer: Buffer;
    let pdfPath: string | undefined;

    // Handle both buffer and path inputs
    try {
      if (Buffer.isBuffer(pdfPathOrBuffer)) {
        buffer = pdfPathOrBuffer;
      } else {
        pdfPath = pdfPathOrBuffer;
        const fs = await import('fs');
        buffer = fs.readFileSync(pdfPath);
      }
    } catch (error: any) {
      console.error(`❌ [OCR] Failed to read PDF:`, error.message);
      stats.errors.push({ engine: 'docai', message: `PDF read error: ${error.message}` });
      return { results: [], stats }; // Structured failure
    }

    let ocrResults: OcrResult[] = [];
    let docaiSuccess = false;
    let docaiError: Error | null = null;

    // Step 1: Try Document AI (primary)
    stats.providerAttempts.push('docai');
    try {
      ocrResults = await this.runDocAI(buffer, page);
      docaiSuccess = ocrResults.length > 0;
      
      if (docaiSuccess) {
        stats.byEngine.docai.pages = ocrResults.length;
        stats.totalPages = ocrResults.length;
        stats.providerUsed = 'docai';
      } else {
        console.warn(`⚠️ [OCR] Document AI returned no results`);
        stats.byEngine.docai.errors++;
      }
    } catch (error: any) {
      docaiError = error;
      stats.byEngine.docai.errors++;
      stats.errors.push({ engine: 'docai', message: error.message });
      console.warn(`⚠️ [OCR] Document AI failed, will try Nougat fallback:`, error.message);
    }

    // Step 2: Selective Mathpix patching (per-page scoped, conservative approach)
    const mathpixPatchMaps = new Map<number, Map<string, OcrBlock>>();
    if (docaiSuccess && this.config.enableMathpix) {
      stats.providerAttempts.push('mathpix');
      for (const ocrPage of ocrResults) {
        const mathRegions = this.detectMathRegions(ocrPage.blocks);

        if (mathRegions.length > 0) {
          console.log(`🔍 [OCR] Detected ${mathRegions.length} math/low-conf regions on page ${ocrPage.page}`);
          const patchMap = await this.patchWithMathpix(buffer, mathRegions, ocrPage.page);
          if (patchMap.size > 0) {
            mathpixPatchMaps.set(ocrPage.page, patchMap);
            stats.mathpixPatchCount += patchMap.size;
          }
        }
      }
    }

    // Step 3: Nougat fallback (if DocAI failed OR for merging)
    let nougatResults: OcrResult[] | undefined;
    if (!docaiSuccess && this.config.enableNougat) {
      stats.providerAttempts.push('nougat');
      try {
        if (!pdfPath) {
          // Save buffer to temp file for Nougat
          const fs = await import('fs');
          const path = await import('path');
          const os = await import('os');
          const tmpPath = path.join(os.tmpdir(), `nougat-${Date.now()}.pdf`);
          fs.writeFileSync(tmpPath, buffer);
          pdfPath = tmpPath;
        }

        console.log(`🔧 [OCR] Attempting Nougat fallback after DocAI failure`);
        nougatResults = await this.runNougat(pdfPath);

        if (nougatResults && nougatResults.length > 0) {
          // Use Nougat as primary if DocAI failed
          ocrResults = nougatResults;
          stats.byEngine.nougat.pages = nougatResults.length;
          stats.totalPages = nougatResults.length;
          stats.providerUsed = 'nougat';
          console.log(`✅ [OCR] Nougat fallback succeeded with ${nougatResults.length} pages`);
        } else {
          stats.byEngine.nougat.errors++;
          console.warn(`⚠️ [OCR] Nougat returned no results`);
        }
      } catch (nougatError: any) {
        console.error(`❌ [OCR] Nougat fallback failed:`, nougatError.message);

        // Both DocAI and Nougat failed - return structured error
        if (!docaiSuccess) {
          stats.byEngine.nougat.errors++;
          stats.errors.push({ engine: 'nougat', message: nougatError.message });
          console.error(`❌ [OCR] All OCR engines failed. DocAI: ${docaiError?.message}, Nougat: ${nougatError.message}`);
          return { results: [], stats }; // Structured failure instead of throwing
        }
      }
    } else if (!docaiSuccess && !this.config.enableNougat) {
      console.error(`❌ [OCR] DocAI failed and Nougat is disabled. No fallback available.`);
      stats.errors.push({ engine: 'nougat', message: 'Nougat disabled, no fallback available' });
      return { results: [], stats }; // Structured failure
    }

    // Step 4: Merge results (page-scoped)
    if (docaiSuccess && (mathpixPatchMaps.size > 0 || nougatResults)) {
      ocrResults = this.mergeResults(ocrResults, mathpixPatchMaps, nougatResults);
      if (nougatResults && nougatResults.length > 0) {
        stats.nougatMergeCount = nougatResults.length;
      }
    }

    const elapsedMs = Date.now() - startTime;
    
    // Log final stats summary with provider tracing
    console.log(`✅ [OCR] Option C pipeline complete in ${elapsedMs}ms`, {
      totalPages: stats.totalPages,
      providerUsed: stats.providerUsed,
      providerAttempts: stats.providerAttempts,
      docai: stats.byEngine.docai.pages,
      nougat: stats.byEngine.nougat.pages,
      mathpix: stats.byEngine.mathpix.pages,
      mathpixPatchCount: stats.mathpixPatchCount,
      nougatMergeCount: stats.nougatMergeCount,
      errors: stats.errors.length,
    });

    return { results: ocrResults, stats };
  }

  /**
   * Extract page images from PDF for Vision-based extraction
   * Returns an array of page images as PDF buffers (one page per PDF)
   */
  async extractPageImages(pdfBuffer: Buffer): Promise<Array<{ pageNumber: number; image: Buffer }>> {
    const pageImages: Array<{ pageNumber: number; image: Buffer }> = [];
    
    try {
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      const pageCount = pdfDoc.getPageCount();
      
      console.log(`[VISION] Extracting ${pageCount} page images from PDF`);
      
      for (let i = 0; i < pageCount; i++) {
        try {
          const singlePagePdf = await PDFDocument.create();
          const [copiedPage] = await singlePagePdf.copyPages(pdfDoc, [i]);
          singlePagePdf.addPage(copiedPage);
          
          const singlePageBytes = await singlePagePdf.save();
          
          pageImages.push({
            pageNumber: i + 1,
            image: Buffer.from(singlePageBytes),
          });
        } catch (pageError: any) {
          console.warn(`[VISION] Failed to extract page ${i + 1}:`, pageError.message);
        }
      }
      
      console.log(`[VISION] Extracted ${pageImages.length} page images`);
      return pageImages;
      
    } catch (error: any) {
      console.error(`[VISION] Failed to extract page images:`, error.message);
      return [];
    }
  }

  /**
   * Get page count from PDF
   */
  async getPageCount(pdfBuffer: Buffer): Promise<number> {
    return this.getPdfPageCount(pdfBuffer);
  }
}

// Export singleton instance
let orchestratorInstance: OcrOrchestrator | null = null;

export function getOcrOrchestrator(config?: Partial<OrchestratorConfig>): OcrOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new OcrOrchestrator(config);
  }
  return orchestratorInstance;
}
