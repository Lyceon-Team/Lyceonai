import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..');

function read(relPath: string): string {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

describe('Mastery Event Routing Contract', () => {
  it('maps practice submit outcomes to practice_pass/practice_fail through applyMasteryUpdate', () => {
    const content = read('server/routes/practice-canonical.ts');

    expect(content).toContain('applyMasteryUpdate({');
    expect(content).toContain('MasteryEventType.PRACTICE_PASS');
    expect(content).toContain('MasteryEventType.PRACTICE_FAIL');
  });

  it('maps full-test outcomes to test_pass/test_fail through applyMasteryUpdate', () => {
    const content = read('apps/api/src/services/fullLengthExam.ts');

    expect(content).toContain('applyMasteryUpdate({');
    expect(content).toContain('MasteryEventType.TEST_PASS');
    expect(content).toContain('MasteryEventType.TEST_FAIL');
  });

  it('keeps deprecated runtime mastery event names out of active service/routes code', () => {
    const runtimeFiles = [
      'apps/api/src/services/mastery-constants.ts',
      'apps/api/src/services/mastery-write.ts',
      'apps/api/src/services/fullLengthExam.ts',
      'server/routes/practice-canonical.ts',
      'server/routes/review-session-routes.ts',
    ];

    const forbidden = ['PRACTICE_SUBMIT', 'DIAGNOSTIC_SUBMIT', 'FULL_LENGTH_SUBMIT', 'TUTOR_VIEW'];

    for (const file of runtimeFiles) {
      const content = read(file);
      for (const token of forbidden) {
        expect(content).not.toContain(token);
      }
    }
  });
});
