import { describe, it, expect, vi, afterEach } from 'vitest';
import { logger } from '../../server/logger';

/**
 * Structured JSON log output — redaction proof
 * @spec [01A, §10 §14] | @implemented [2026-08-12]
 * Proves that redactSensitive() runs on every structured JSON log entry.
 * A token, a password, and a raw student answer (via `body`) must never
 * appear in the JSON output.
 *
 * NODE_ENV=test triggers the structured JSON path (non-development),
 * so this test exercises the production output format.
 */
describe('structured JSON log output — redaction proof', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    if (writeSpy) writeSpy.mockRestore();
  });

  it('redacts token, password, and raw student answer from JSON output', () => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const sensitivePayload = {
      auth_token: 'eyJhbGciOiJIUzI1NiJ9.secret-jwt-payload',
      password: 'P@ssw0rd-never-log-this',
      body: { student_answer: 'B', raw_work: 'I chose B because the passage says...' },
      normalField: 42,
    };

    logger.info('TEST', 'redaction_proof', 'Sensitive data test', sensitivePayload);

    // Find the structured JSON line written to stdout
    const jsonCalls = writeSpy.mock.calls.filter((call) => {
      const str = String(call[0]);
      try {
        const parsed = JSON.parse(str);
        return parsed.event === 'redaction_proof';
      } catch {
        return false;
      }
    });

    expect(jsonCalls.length).toBe(1);
    const rawJson = String(jsonCalls[0][0]);
    const parsed = JSON.parse(rawJson);

    // 1. Sensitive VALUES must not appear anywhere in the raw JSON string
    expect(rawJson).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(rawJson).not.toContain('secret-jwt-payload');
    expect(rawJson).not.toContain('P@ssw0rd-never-log-this');
    expect(rawJson).not.toContain('I chose B because');
    expect(rawJson).not.toContain('student_answer');

    // 2. Sensitive keys are replaced with [REDACTED]
    expect(parsed.data.auth_token).toBe('[REDACTED]');
    expect(parsed.data.password).toBe('[REDACTED]');
    expect(parsed.data.body).toBe('[REDACTED]');

    // 3. Non-sensitive data survives
    expect(parsed.data.normalField).toBe(42);

    // 4. Cloud Logging fields are present and correct
    expect(parsed.severity).toBe('INFO');
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.event).toBe('redaction_proof');
    expect(parsed.component).toBe('TEST');
    expect(parsed.service).toBeDefined();
    expect(parsed.environment).toBeDefined();
  });

  it('redacts sensitive fields in error log entries', () => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const errorObj = new Error('DB connection failed');
    const sensitiveContext = {
      credential: 'super-secret-db-cred',
      session_id: 'sess_abc123xyz',
      query: 'SELECT * FROM users',
    };

    logger.error('DB', 'connection_failed', 'Database error', errorObj, sensitiveContext);

    // Find the structured JSON line for this specific event
    const jsonCalls = writeSpy.mock.calls.filter((call) => {
      const str = String(call[0]);
      try {
        const parsed = JSON.parse(str);
        return parsed.event === 'connection_failed';
      } catch {
        return false;
      }
    });

    expect(jsonCalls.length).toBe(1);
    const rawJson = String(jsonCalls[0][0]);
    const parsed = JSON.parse(rawJson);

    // Sensitive values absent from raw output
    expect(rawJson).not.toContain('super-secret-db-cred');
    expect(rawJson).not.toContain('sess_abc123xyz');

    // Sensitive keys redacted
    expect(parsed.data.credential).toBe('[REDACTED]');
    expect(parsed.data.session_id).toBe('[REDACTED]');

    // Non-sensitive field survives
    expect(parsed.data.query).toBe('SELECT * FROM users');

    // Severity is ERROR
    expect(parsed.severity).toBe('ERROR');

    // Error object is present (serialized)
    expect(parsed.error).toBeDefined();
    expect(parsed.error.message).toBe('DB connection failed');
  });

  it('emits valid single-line JSON parseable by Cloud Logging', () => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    logger.info('API', 'health_check', 'System healthy', { uptime: 3600 }, {
      requestId: 'req-123-abc',
      userId: 'user-456',
    });

    const jsonCalls = writeSpy.mock.calls.filter((call) => {
      const str = String(call[0]);
      try {
        JSON.parse(str);
        return true;
      } catch {
        return false;
      }
    });

    expect(jsonCalls.length).toBeGreaterThanOrEqual(1);
    const line = String(jsonCalls[jsonCalls.length - 1][0]);

    // Must be a single line (no embedded newlines before the trailing \n)
    const trimmed = line.trimEnd();
    expect(trimmed).not.toMatch(/\n/);

    // Must parse as valid JSON
    const parsed = JSON.parse(trimmed);

    // All 01A §10 required fields present
    expect(parsed.severity).toBe('INFO');
    expect(parsed.timestamp).toBeDefined();
    expect(parsed.message).toBe('System healthy');
    expect(parsed.event).toBe('health_check');
    expect(parsed.service).toBeDefined();
    expect(parsed.environment).toBeDefined();

    // Correlation ID threaded through, un-digested: `request_id` is a
    // domain-entity correlation key, not a person.
    expect(parsed.request_id).toBe('req-123-abc');

    // CHANGED 2026-08-28 (Codex HIGH-6). This previously asserted the RAW
    // 'user-456'. A user id is a person-linked identifier and the logger
    // boundary now digests it structurally, so asserting the raw value would
    // be asserting the defect. Correlation is preserved — the digest is stable,
    // so two lines about the same user still join — while the log no longer
    // discloses WHO. Asserting a non-empty digest that differs from the input
    // is the pair of claims that matters; asserting only "not raw" would pass
    // for a logger that blanked the field and destroyed correlation.
    expect(parsed.user_id).not.toBe('user-456');
    expect(parsed.user_id).toMatch(/^[0-9a-f]{8}$/);
  });
});
