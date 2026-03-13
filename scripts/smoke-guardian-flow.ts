#!/usr/bin/env npx tsx
/**
 * Guardian Flow Smoke Test Script
 *
 * Prerequisites:
 * - Server running on http://localhost:5000 (or $BASE_URL)
 * - Two test accounts created:
 *   - Student: STUDENT_EMAIL / STUDENT_PASSWORD
 *   - Guardian: GUARDIAN_EMAIL / GUARDIAN_PASSWORD
 *
 * Usage:
 *   STUDENT_EMAIL=test-student@example.com \
 *   STUDENT_PASSWORD=secret123 \
 *   GUARDIAN_EMAIL=test-guardian@example.com \
 *   GUARDIAN_PASSWORD=secret456 \
 *   npx tsx scripts/smoke-guardian-flow.ts
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const BASE_ORIGIN = (() => {
  try {
    return new URL(BASE_URL).origin;
  } catch {
    return BASE_URL;
  }
})();

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  data?: any;
}

interface AuthSession {
  cookieHeader: string;
  user: any;
}

const results: TestResult[] = [];

function log(msg: string) {
  console.log(`[SMOKE] ${msg}`);
}

function logResult(result: TestResult) {
  const icon = result.passed ? 'PASS' : 'FAIL';
  console.log(`${icon} ${result.name}${result.error ? ': ' + result.error : ''}`);
  results.push(result);
}

function extractCookieHeader(res: Response): string {
  const headersAny = res.headers as any;
  const setCookieHeaders: string[] = typeof headersAny.getSetCookie === 'function'
    ? headersAny.getSetCookie()
    : (() => {
        const single = res.headers.get('set-cookie');
        return single ? [single] : [];
      })();

  const cookieParts = setCookieHeaders
    .map((value) => value.split(';')[0]?.trim())
    .filter((value): value is string => !!value);

  if (cookieParts.length === 0) {
    throw new Error('No auth cookies were returned by /api/auth/signin');
  }

  return cookieParts.join('; ');
}

async function signIn(email: string, password: string): Promise<AuthSession | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': BASE_ORIGIN,
        'Referer': `${BASE_ORIGIN}/`,
      },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Sign in failed: ${res.status} - ${err}`);
    }

    const data = await res.json();
    return {
      cookieHeader: extractCookieHeader(res),
      user: data.user,
    };
  } catch (err: any) {
    log(`Sign in error for ${email}: ${err.message}`);
    return null;
  }
}

async function getProfile(cookieHeader: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/profile`, {
    headers: {
      'Cookie': cookieHeader,
    },
  });
  if (!res.ok) throw new Error(`Get profile failed: ${res.status}`);
  const data = await res.json();
  return data?.user || data;
}

async function getGuardianStudents(cookieHeader: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/guardian/students`, {
    headers: {
      'Cookie': cookieHeader,
    },
  });
  return { status: res.status, data: await res.json() };
}

async function linkStudent(cookieHeader: string, code: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/guardian/link`, {
    method: 'POST',
    headers: {
      'Cookie': cookieHeader,
      'Origin': BASE_ORIGIN,
      'Referer': `${BASE_ORIGIN}/`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code }),
  });
  return { status: res.status, data: await res.json() };
}

async function getStudentSummary(cookieHeader: string, studentId: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/guardian/students/${studentId}/summary`, {
    headers: {
      'Cookie': cookieHeader,
    },
  });
  return { status: res.status, data: await res.json() };
}

async function unlinkStudent(cookieHeader: string, studentId: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/guardian/link/${studentId}`, {
    method: 'DELETE',
    headers: {
      'Cookie': cookieHeader,
      'Origin': BASE_ORIGIN,
      'Referer': `${BASE_ORIGIN}/`,
    },
  });
  return { status: res.status, data: await res.json() };
}

async function runTests() {
  log('Starting Guardian Flow Smoke Tests');
  log(`Base URL: ${BASE_URL}`);
  log('');

  const studentEmail = process.env.STUDENT_EMAIL;
  const studentPassword = process.env.STUDENT_PASSWORD;
  const guardianEmail = process.env.GUARDIAN_EMAIL;
  const guardianPassword = process.env.GUARDIAN_PASSWORD;

  if (!studentEmail || !studentPassword || !guardianEmail || !guardianPassword) {
    console.error('Missing environment variables. Required:');
    console.error('  STUDENT_EMAIL, STUDENT_PASSWORD, GUARDIAN_EMAIL, GUARDIAN_PASSWORD');
    console.error('');
    console.error('Example:');
    console.error('  STUDENT_EMAIL=student@test.com STUDENT_PASSWORD=test123 \\');
    console.error('  GUARDIAN_EMAIL=parent@test.com GUARDIAN_PASSWORD=test123 \\');
    console.error('  npx tsx scripts/smoke-guardian-flow.ts');
    process.exit(1);
  }

  // Test 1: Student sign in
  log('Test 1: Student sign in');
  const studentAuth = await signIn(studentEmail, studentPassword);
  logResult({
    name: 'Student sign in',
    passed: !!studentAuth?.cookieHeader,
    error: studentAuth ? undefined : 'Failed to sign in student',
  });
  if (!studentAuth) {
    log('Cannot continue without student auth');
    return printSummary();
  }

  // Test 2: Student profile has link code
  log('Test 2: Student profile has link code');
  let studentProfile: any;
  try {
    studentProfile = await getProfile(studentAuth.cookieHeader);
    const hasLinkCode = !!studentProfile?.student_link_code;
    logResult({
      name: 'Student profile has link code',
      passed: hasLinkCode,
      data: { linkCode: studentProfile?.student_link_code },
    });
  } catch (err: any) {
    logResult({ name: 'Student profile has link code', passed: false, error: err.message });
    return printSummary();
  }

  const studentLinkCode = studentProfile.student_link_code;
  const studentId = studentProfile.id;

  // Test 3: Guardian sign in
  log('Test 3: Guardian sign in');
  const guardianAuth = await signIn(guardianEmail, guardianPassword);
  logResult({
    name: 'Guardian sign in',
    passed: !!guardianAuth?.cookieHeader,
    error: guardianAuth ? undefined : 'Failed to sign in guardian',
  });
  if (!guardianAuth) {
    log('Cannot continue without guardian auth');
    return printSummary();
  }

  // Test 4: Guardian profile has role=guardian
  log('Test 4: Guardian profile has role=guardian');
  try {
    const guardianProfile = await getProfile(guardianAuth.cookieHeader);
    logResult({
      name: 'Guardian role is correct',
      passed: guardianProfile?.role === 'guardian',
      data: { role: guardianProfile?.role },
    });
  } catch (err: any) {
    logResult({ name: 'Guardian role is correct', passed: false, error: err.message });
  }

  // Test 5: Guardian cannot access unlinked student summary
  log('Test 5: Cannot access unlinked student summary');
  const unlinkedSummary = await getStudentSummary(guardianAuth.cookieHeader, studentId);
  logResult({
    name: 'Unlinked student summary blocked',
    passed: unlinkedSummary.status === 404 || unlinkedSummary.status === 403,
    data: { status: unlinkedSummary.status },
  });

  // Test 6: Link student
  log('Test 6: Link student with code');
  const linkResult = await linkStudent(guardianAuth.cookieHeader, studentLinkCode);
  logResult({
    name: 'Link student',
    passed: linkResult.status === 200 && linkResult.data?.ok === true,
    data: linkResult.data,
  });

  // Test 7: List students shows linked student
  log('Test 7: List students shows linked student');
  const studentsResult = await getGuardianStudents(guardianAuth.cookieHeader);
  const foundStudent = studentsResult.data?.students?.find((s: any) => s.id === studentId);
  logResult({
    name: 'List students includes linked student',
    passed: !!foundStudent,
    data: { studentCount: studentsResult.data?.students?.length },
  });

  // Test 8: Can access linked student summary
  log('Test 8: Can access linked student summary');
  const linkedSummary = await getStudentSummary(guardianAuth.cookieHeader, studentId);
  logResult({
    name: 'Linked student summary accessible',
    passed: linkedSummary.status === 200,
    data: linkedSummary.data,
  });

  // Test 9: Unlink student
  log('Test 9: Unlink student');
  const unlinkResult = await unlinkStudent(guardianAuth.cookieHeader, studentId);
  logResult({
    name: 'Unlink student',
    passed: unlinkResult.status === 200 && unlinkResult.data?.ok === true,
    data: unlinkResult.data,
  });

  // Test 10: Cannot access after unlink
  log('Test 10: Cannot access after unlink');
  const afterUnlinkSummary = await getStudentSummary(guardianAuth.cookieHeader, studentId);
  logResult({
    name: 'Unlinked student summary blocked again',
    passed: afterUnlinkSummary.status === 404 || afterUnlinkSummary.status === 403,
    data: { status: afterUnlinkSummary.status },
  });

  printSummary();
}

function printSummary() {
  console.log('');
  console.log('========================================');
  console.log('SMOKE TEST SUMMARY');
  console.log('========================================');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  if (failed > 0) {
    console.log('');
    console.log('Failed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error || 'Unknown error'}`);
    });
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
