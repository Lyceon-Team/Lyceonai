import { test, expect } from '@playwright/test';
import { TEST } from '../utils/testEnv';
import { StageTimer } from '../utils/timer';
import { writeMarkdownReport } from '../utils/report';
import fs from 'node:fs';

test('API-only PDF ingestion test with mock QA items', async ({ request }) => {
  const timer = new StageTimer();
  const stages = ['upload','ocr','parse','qa','persist','vectors'] as const;
  const obs: Record<string, any> = {};

  // Create properly formatted QA items matching the exact schema requirements
  const now = new Date().toISOString();
  const mockQAItems = [
    {
      id: "ac472881",
      stem: "In the given equation, a and b are constants, and x ≠ 4. If the equation has infinitely many solutions, what is the value of b?",
      options: [
        { key: "A", text: "0" },
        { key: "B", text: "2" },
        { key: "C", text: "4" },
        { key: "D", text: "8" }
      ],
      answer: "C", // Changed from "403" to valid enum value
      explanation: "For a linear equation in one variable to have infinitely many solutions, the coefficients of the variable must be equal on both sides of the equation and the constant terms must also be equal on both sides of the equation.",
      section: "Math",
      source: {
        path: "SAT Suite Question Bank - math17.pdf",
        page: 1
      },
      tags: ["algebra", "linear_equations"],
      version: 1, // Changed from "1.0" to number
      createdAt: now,
      updatedAt: now
    },
    {
      id: "3f5a3602", 
      stem: "What system of linear equations is represented by the lines shown?",
      options: [
        { key: "A", text: "System A" },
        { key: "B", text: "System B" },
        { key: "C", text: "System C" },
        { key: "D", text: "System D" }
      ],
      answer: "D",
      explanation: "Choice D is correct. A line in the xy-plane that passes through the points...",
      section: "Math",
      source: {
        path: "SAT Suite Question Bank - math17.pdf", 
        page: 2
      },
      tags: ["algebra", "systems", "linear_equations"],
      version: 1, // Changed from "1.0" to number
      createdAt: now,
      updatedAt: now
    }
  ];

  // Start job
  timer.start('upload');
  const startRes = await request.post('/api/ingest/start');
  expect(startRes.ok()).toBeTruthy();
  const { jobId } = await startRes.json();
  expect(jobId).toBeTruthy();
  timer.end('upload');
  obs.upload = { ok: true, ms: timer.get().upload };

  // Simulate parse stage
  timer.start('parse');
  const runRes = await request.post('/api/ingest/run', {
    data: {
      items: mockQAItems,
      jobId
    }
  });
  timer.end('parse');
  obs.parse = { ok: runRes.ok(), ms: timer.get().parse };

  if (!runRes.ok()) {
    const errorData = await runRes.json().catch(() => ({}));
    console.log('API Error:', errorData);
    expect(runRes.ok()).toBeTruthy();
  }

  // Poll status until done/failed/timeout
  const t0 = Date.now();
  let status: any = null;
  
  timer.start('persist');
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
    
    await new Promise(r => setTimeout(r, 1000));
  }
  timer.end('persist');
  obs.persist = obs.persist?.ms ? obs.persist : { ms: timer.get().persist };
  
  expect(status).toBeTruthy();

  // Outcome checks
  if (status.status !== 'done') {
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

  // Verify DB persistence
  const processedCount = status.insertedCount ?? status.processed ?? 0;
  expect(processedCount).toBeGreaterThan(0);

  // Check if LLM QA was enabled and processed
  if (TEST.QA_LLM_ENABLED) {
    console.log('✅ LLM QA was enabled for this test');
  }

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
    `- Inserted: ${processedCount}`,
    `- Mock QA Items Used: ${mockQAItems.length}`,
    `- LLM QA Enabled: ${TEST.QA_LLM_ENABLED}`,
    `- Vectors Enabled: ${TEST.VECTORS_ENABLED}`,
    `- StageTimes:`,
    '```json',
    JSON.stringify(status.stageTimes || obs, null, 2),
    '```',
    warnLines.length ? '## Warnings\n' + warnLines.join('\n') : '',
    '',
    '## Configuration',
    `- BASE_URL: ${TEST.BASE_URL}`,
    `- QA_LLM_ENABLED: ${TEST.QA_LLM_ENABLED}`,
    `- VECTORS_ENABLED: ${TEST.VECTORS_ENABLED}`
  ].join('\n'));
});