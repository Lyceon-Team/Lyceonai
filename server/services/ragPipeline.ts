/**
 * RAG pipeline utilities for SAT question retrieval metadata.
 * Generates Q-chunks, E-chunks, and embeddings for SAT questions.
 */

import { GoogleGenAI } from "@google/genai";
import { generateEmbedding } from '../../apps/api/src/lib/embeddings';
import type { QuestionDoc } from './questionTypes';

// Local type definition for ParsedQuestion (missing module; deterministic CI fix)
interface ParsedQuestionOption {
  key: string;
  text: string;
}

interface ParsedQuestion {
  questionId: string;
  stem: string;
  options: ParsedQuestionOption[];
  answer: string;
  explanation?: string;
  section?: string;
  difficulty?: string;
  confidence: number;
  pageNumber?: number;
  bbox?: number[];
}

export interface RAGChunks {
  questionId: string;
  qChunk: string; // Question text optimized for retrieval
  eChunk: string; // Enriched content for display
  embedding: number[];
  embeddingModel: string;
}

interface RAGConfig {
  embeddingModel: 'gemini';
  qChunkMaxLength: number;
  eChunkMaxLength: number;
}

export class RAGPipeline {
  private gemini: GoogleGenAI | null = null;
  private config: RAGConfig;

  constructor(config?: Partial<RAGConfig>) {
    this.config = {
      embeddingModel: 'gemini', // Gemini-only
      qChunkMaxLength: config?.qChunkMaxLength ?? 500,
      eChunkMaxLength: config?.eChunkMaxLength ?? 2000,
    };

    // Initialize Gemini
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      this.gemini = new GoogleGenAI({ apiKey: geminiKey });
      console.log('✅ [RAG] Gemini client initialized for embeddings');
    }
  }

  /**
   * Generate Q-chunk (optimized for retrieval)
   * Combines question stem and key context
   */
  private generateQChunk(question: ParsedQuestion): string {
    const parts: string[] = [];

    // Add section context
    if (question.section) {
      parts.push(`[${question.section}]`);
    }

    // Add difficulty if available
    if (question.difficulty) {
      parts.push(`[${question.difficulty}]`);
    }

    // Add question stem (truncate if needed)
    const stem = question.stem.substring(0, this.config.qChunkMaxLength);
    parts.push(stem);

    // Add options for context (abbreviated)
    if (question.options.length > 0) {
      const optionsSummary = question.options
        .map(o => `${o.key}:${o.text.substring(0, 50)}`)
        .join(' | ');
      parts.push(optionsSummary);
    }

    return parts.join(' ').substring(0, this.config.qChunkMaxLength);
  }

  /**
   * Generate E-chunk (enriched content for display)
   * Includes full question, options, explanation, and metadata
   */
  private generateEChunk(question: ParsedQuestion): string {
    const parts: string[] = [];

    // Full question stem
    parts.push(`Question: ${question.stem}`);

    // Full options
    if (question.options.length > 0) {
      parts.push('\nOptions:');
      question.options.forEach(opt => {
        parts.push(`${opt.key}) ${opt.text}`);
      });
    }

    // Answer
    parts.push(`\nCorrect Answer: ${question.answer}`);

    // Explanation if available
    if (question.explanation) {
      parts.push(`\nExplanation: ${question.explanation}`);
    }

    // Metadata
    const metadata: string[] = [];
    if (question.section) metadata.push(`Section: ${question.section}`);
    if (question.difficulty) metadata.push(`Difficulty: ${question.difficulty}`);
    metadata.push(`Confidence: ${question.confidence.toFixed(2)}`);
    
    if (metadata.length > 0) {
      parts.push(`\nMetadata: ${metadata.join(', ')}`);
    }

    return parts.join('\n').substring(0, this.config.eChunkMaxLength);
  }

  /**
   * Generate embedding using Gemini (only)
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    return this.generateGeminiEmbedding(text);
  }

  /**
   * Generate embedding using Gemini
   */
  private async generateGeminiEmbedding(text: string): Promise<number[]> {
    if (!this.gemini) {
      throw new Error('Gemini client not initialized');
    }

    const response = await this.gemini.models.embedContent({
      model: 'text-embedding-004',
      contents: text,
    });

    if (!response.embeddings || response.embeddings.length === 0 || !response.embeddings[0].values) {
      throw new Error('No embedding returned from Gemini');
    }

    return response.embeddings[0].values;
  }

  /**
   * Process a single question through the RAG pipeline
   */
  async processQuestion(question: ParsedQuestion): Promise<RAGChunks> {
    console.log(`🔗 [RAG] Processing question ${question.questionId}`);

    // Generate chunks
    const qChunk = this.generateQChunk(question);
    const eChunk = this.generateEChunk(question);

    // Generate embedding from Q-chunk
    const embedding = await this.generateEmbedding(qChunk);

    const embeddingModel = 'gemini-text-embedding-004';

    console.log(`✅ [RAG] Generated ${embedding.length}D embedding for ${question.questionId} using ${embeddingModel}`);

    return {
      questionId: question.questionId,
      qChunk,
      eChunk,
      embedding,
      embeddingModel,
    };
  }

  /**
   * Upsert embeddings to database
   * Disabled: embeddings are persisted by the canonical question storage flow.
   * Extended metadata includes canonicalId, testCode, sectionCode, competencyCodes
   */
  async upsertEmbeddings(
    chunks: RAGChunks, 
    questionDbId: string,
    metadata?: {
      sourcePdf?: string;
      pageNumber?: number;
      bbox?: number[];
      section?: string;
      difficulty?: string;
      canonicalId?: string;
      testCode?: string;
      sectionCode?: string;
      competencyCodes?: string[];
      questionNumber?: number;
    }
  ): Promise<void> {
    // Embeddings are handled by the canonical question storage flow.
    // Neon question_embeddings table is not used as canonical store
    console.log(
      `ℹ️ [RAGPipeline] Skipping Neon embedding write for question ${questionDbId}. Embeddings are handled by the canonical question storage flow.`
    );
  }

  /**
   * Process a batch of questions with canonical metadata
   */
  async processBatch(
    questions: ParsedQuestion[],
    questionDbIds: Map<string, string>, // Map of questionId -> DB ID
    sourcePdf?: string,
    questionDocs?: QuestionDoc[] // Optional QuestionDoc array for canonical metadata
  ): Promise<void> {
    console.log(`🔗 [RAG] Processing batch of ${questions.length} questions`);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      const questionDoc = questionDocs?.[i];
      
      try {
        const chunks = await this.processQuestion(question);
        
        const dbId = questionDbIds.get(question.questionId);
        if (!dbId) {
          console.warn(`⚠️ [RAG] No DB ID found for ${question.questionId}, skipping`);
          continue;
        }

        // Build metadata with canonical fields
        const metadata = {
          sourcePdf,
          pageNumber: question.pageNumber,
          bbox: question.bbox,
          section: question.section,
          difficulty: question.difficulty,
          // Canonical metadata
          canonicalId: questionDoc?.canonicalId,
          testCode: questionDoc?.testCode,
          sectionCode: questionDoc?.sectionCode,
          competencyCodes: questionDoc?.competencies?.map(c => c.code),
          questionNumber: questionDoc?.questionNumber || undefined,
        };

        await this.upsertEmbeddings(chunks, dbId, metadata);
        
        // Log example embedding metadata shape for debugging
        if (i === 0) {
          console.log(`📝 [RAG] Example embedding metadata shape:`, JSON.stringify({
            questionDbId: dbId,
            canonicalId: metadata.canonicalId,
            testCode: metadata.testCode,
            sectionCode: metadata.sectionCode,
            competencyCodes: metadata.competencyCodes,
            section: metadata.section,
            difficulty: metadata.difficulty,
          }, null, 2));
        }
        
        successCount++;

        // Brief delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error: any) {
        console.error(`❌ [RAG] Failed to process ${question.questionId}:`, error.message);
        errorCount++;
      }
    }

    console.log(`✅ [RAG] Batch complete: ${successCount} success, ${errorCount} errors`);
  }

  /**
   * Verify HNSW index exists for pgvector
   * MVP: Disabled - Supabase is canonical vector store
   */
  async verifyHNSWIndex(): Promise<boolean> {
    console.warn('ℹ️ [RAGPipeline] HNSW index checks disabled for MVP; Supabase is canonical vector store.');
    return false;
  }
}
