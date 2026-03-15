/**
 * Lyceon Ingestion v3 - HTTP Endpoints
 * 
 * POST /api/ingest-llm - Start ingestion job
 * POST /api/ingest-llm/test - Test endpoint with limited questions
 * GET /api/ingest-llm/status/:jobId - Get job status
 * GET /api/ingest-llm/jobs - List all jobs
 * POST /api/ingest-llm/retry/:jobId - Retry a failed job
 */

import { Request, Response } from 'express';
import multer from 'multer';
import { runIngestionJob, createIngestionJob, getJobFromDB, getJobsFromDB } from '../ingestion/ingestionService';

const upload = multer({
  dest: 'uploads/pdfs/',
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

export const uploadMiddleware = upload.single('file');

export const ingestLlm = async (req: Request, res: Response) => {
  try {
    const { pdfPath, testCode, sectionCode } = req.body;
    
    if (!pdfPath && !req.file) {
      return res.status(400).json({ error: 'pdfPath or file upload required' });
    }

    const path = pdfPath || req.file?.path;
    const jobId = await createIngestionJob(path, testCode, sectionCode);

    void runIngestionJob(jobId, path, { testCode, sectionCode }).catch(err => {
      console.error(`❌ [ingest-llm] Job ${jobId} failed:`, err.message);
    });

    res.json({
      jobId,
      status: 'processing',
      message: 'Ingestion job started',
    });

  } catch (error: any) {
    console.error('❌ [ingest-llm] Error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const ingestLlmTest = async (req: Request, res: Response) => {
  try {
    const { pdfPath, maxQuestions = 3, testCode, sectionCode } = req.body;
    
    if (!pdfPath && !req.file) {
      return res.status(400).json({ error: 'pdfPath or file upload required' });
    }

    const path = pdfPath || req.file?.path;
    const jobId = await createIngestionJob(path, testCode, sectionCode);

    console.log(`🧪 [ingest-llm/test] Running limited ingestion: ${maxQuestions} questions`);

    const result = await runIngestionJob(jobId, path, {
      maxQuestions,
      testCode,
      sectionCode,
    });

    res.json({
      jobId: result.jobId,
      status: result.status,
      counts: {
        totalDocAiDrafts: result.metrics.totalDocAiDrafts,
        docAiGood: result.metrics.docAiGoodCount,
        visionUsed: result.metrics.visionUsedCount,
        finalAccepted: result.metrics.finalAcceptedCount,
        finalRejected: result.metrics.finalRejectedCount,
      },
      timings: result.metrics.timings,
      sampleQuestions: result.questions.slice(0, 3).map(q => ({
        canonicalId: q.canonicalId,
        stem: q.stem.slice(0, 200) + (q.stem.length > 200 ? '...' : ''),
        optionsCount: q.options.length,
        answer: q.answer,
        difficulty: q.difficulty,
      })),
      errors: result.errors,
    });

  } catch (error: any) {
    console.error('❌ [ingest-llm/test] Error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const getIngestLlmStatus = async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    
    const job = await getJobFromDB(jobId);
    
    if (!job) {
      console.log(`⚠️ [ingest-llm/status] Job not found: ${jobId}`);
      return res.status(404).json({ error: 'Job not found' });
    }

    const metrics = job.notes_json || {};
    const config = job.configuration || {};
    
    res.json({
      jobId: job.id,
      status: job.status,
      metrics: metrics,
      config: config,
      error: metrics.error || null,
      questionsImported: job.succeeded || metrics.finalAcceptedCount || 0,
      startedAt: job.started_at,
      finishedAt: job.finished_at,
      createdAt: job.created_at,
    });

  } catch (error: any) {
    console.error('❌ [ingest-llm/status] Error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const getIngestLlmJobs = async (_req: Request, res: Response) => {
  try {
    const jobs = await getJobsFromDB(50);
    
    const mappedJobs = jobs.map((job) => {
      const metrics = job.notes_json || {};
      const config = job.configuration || {};
      return {
        jobId: job.id,
        status: job.status,
        startedAt: job.started_at,
        finishedAt: job.finished_at,
        totalQuestions: job.total_questions || metrics.totalDocAiDrafts || 0,
        succeeded: job.succeeded || metrics.finalAcceptedCount || 0,
        failed: job.failed || metrics.finalRejectedCount || 0,
        error: metrics.error || null,
        pdfPath: config.pdfPath || null,
      };
    });

    res.json({ jobs: mappedJobs });

  } catch (error: any) {
    console.error('❌ [ingest-llm/jobs] Error:', error);
    res.json({ jobs: [] });
  }
};

export const retryIngestLlmJob = async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    
    const job = await getJobFromDB(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status !== 'failed') {
      return res.status(400).json({ error: 'Only failed jobs can be retried' });
    }

    const config = job.configuration || {};
    const pdfPath = config.pdfPath;
    if (!pdfPath) {
      return res.status(400).json({ error: 'No PDF path found for this job' });
    }

    void runIngestionJob(jobId, pdfPath, config).catch(err => {
      console.error(`❌ [ingest-llm/retry] Job ${jobId} failed:`, err.message);
    });

    res.json({
      jobId,
      status: 'processing',
      message: 'Job retry initiated',
    });

  } catch (error: any) {
    console.error('❌ [ingest-llm/retry] Error:', error);
    res.status(500).json({ error: error.message });
  }
};
