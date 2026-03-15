import { test, expect } from '@playwright/test';
import { TEST } from '../utils/testEnv';
import { StageTimer } from '../utils/timer';
import { writeMarkdownReport } from '../utils/report';
import fs from 'node:fs';

test('Ingest PDF and verify persistence; fail if not inserted; time each stage', async ({ request }) => {
  if (!TEST.PDF_PATH) test.fail(true, 'No PDF_PATH provided');

  const timer = new StageTimer();
  const stages = ['upload','ocr','parse','qa','persist','vectors'] as const;
  const obs: Record<string, any> = {};

  // Start job
  const startRes = await request.post('/api/ingest/start');
  expect(startRes.ok()).toBeTruthy();
  const { jobId } = await startRes.json();
  expect(jobId).toBeTruthy();

  // Upload PDF file
  timer.start('upload');
  
  // Read the PDF file from the path
  const pdfBuffer = fs.readFileSync(TEST.PDF_PATH);
  
  // Upload via /api/ingest/run with file data
  const runRes = await request.post('/api/ingest/run', {
    data: {
      jobId,
      file: {
        buffer: pdfBuffer.toString('base64'),
        originalname: 'SAT Suite Question Bank - math17.pdf',
        mimetype: 'application/pdf'
      }
    }
  });
  timer.end('upload');
  obs.upload = { ok: runRes.ok() };

  expect(runRes.ok()).toBeTruthy();

  // Poll status until done/failed/timeout; also infer OCR/QA/persist timings from server fields if provided
  const t0 = Date.now();
  let status: any = null;
  
  while (Date.now() - t0 < TEST.INGEST_TIMEOUT_MS) {
    const s = await request.get(`/api/ingest/status/${jobId}`);
    status = await s.json();
    
    if (status?.stageTimes) {
      // Prefer server-provided timings if available
      for (const k of stages) {
        if (status.stageTimes[k] && !obs[k]) {
          obs[k] = { ms: status.stageTimes[k] };
        }
      }
    }
    
    if (status?.status === 'done') break;
    if (status?.status === 'failed') break;
    
    await new Promise(r => setTimeout(r, 1500));
  }
  
  expect(status).toBeTruthy();

  // If server didn't provide per-stage times, use local timers for rough measures
  obs.upload = obs.upload?.ms ? obs.upload : { ms: obs.upload?.ok ? (timer.get().upload ?? 0) : -1 };

  // Outcome checks
  if (status.status !== 'done') {
    // Explain bottleneck
    const elapsed = Date.now() - t0;
    const why = status.error || `timeout after ${elapsed}ms at stage=${status.stage||'unknown'}`;
    
    writeMarkdownReport('ingest-failure', [
      `# Ingestion FAILED`,
      `- Job: ${jobId}`,
      `- Status: ${status.status}`,
      `- Error/Why: ${why}`,
      `- StageTimes: ${JSON.stringify(status.stageTimes || obs, null, 2)}`
    ].join('\n'));
    
    test.fail(true, why);
  }

  // Verify DB persistence (status should include counts or we fetch a verify endpoint)
  expect(status.insertedCount ?? status.processed ?? 0).toBeGreaterThan(0);

  // Identify slow stages vs thresholds
  const warnLines: string[] = [];
  for (const st of stages) {
    const ms = status.stageTimes?.[st] ?? obs[st]?.ms;
    if (typeof ms === 'number' && ms > (TEST.STAGE_WARN_MS as any)[st]) {
      warnLines.push(`- ${st} slow: ${ms}ms (> ${(TEST.STAGE_WARN_MS as any)[st]}ms)`);
    }
  }

  // Produce report
  writeMarkdownReport('ingest-success', [
    `# Ingestion PASSED`,
    `- Job: ${jobId}`,
    `- Inserted: ${status.insertedCount ?? status.processed ?? 'n/a'}`,
    `- StageTimes:`,
    '```json',
    JSON.stringify(status.stageTimes || obs, null, 2),
    '```',
    warnLines.length ? '## Warnings\n' + warnLines.join('\n') : ''
  ].join('\n'));
});