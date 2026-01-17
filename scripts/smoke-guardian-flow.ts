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

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  data?: any;
}

const results: TestResult[] = [];

function log(msg: string) {
  console.log(`[SMOKE] ${msg}`);
}

function logResult(result: TestResult) {
  const icon = result.passed ? '✅' : '❌';
  console.log(`${icon} ${result.name}${result.error ? ': ' + result.error : ''}`);
  results.push(result);
}

async function signIn(email: string, password: string): Promise<{ accessToken: string; user: any } | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Sign in failed: ${res.status} - ${err}`);
    }
    const data = await res.json();
    return {
      accessToken: data.session?.access_token || data.access_token,
      user: data.user,
    };
  } catch (err: any) {
    log(`Sign in error for ${email}: ${err.message}`);
    return null;
  }
}

async function getProfile(token: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/auth/user`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error(`Get profile failed: ${res.status}`);
  return res.json();
}

async function getGuardianStudents(token: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/guardian/students`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });
  return { status: res.status, data: await res.json() };
}

async function linkStudent(token: string, code: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/guardian/link`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code }),
  });
  return { status: res.status, data: await res.json() };
}

async function getStudentSummary(token: string, studentId: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/guardian/students/${studentId}/summary`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });
  return { status: res.status, data: await res.json() };
}

async function unlinkStudent(token: string, studentId: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/guardian/link/${studentId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
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
    passed: !!studentAuth?.accessToken,
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
    studentProfile = await getProfile(studentAuth.accessToken);
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
    passed: !!guardianAuth?.accessToken,
    error: guardianAuth ? undefined : 'Failed to sign in guardian',
  });
  if (!guardianAuth) {
    log('Cannot continue without guardian auth');
    return printSummary();
  }

  // Test 4: Guardian profile has role=guardian
  log('Test 4: Guardian profile has role=guardian');
  try {
    const guardianProfile = await getProfile(guardianAuth.accessToken);
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
  const unlinkedSummary = await getStudentSummary(guardianAuth.accessToken, studentId);
  logResult({
    name: 'Unlinked student summary blocked',
    passed: unlinkedSummary.status === 404 || unlinkedSummary.status === 403,
    data: { status: unlinkedSummary.status },
  });

  // Test 6: Link student
  log('Test 6: Link student with code');
  const linkResult = await linkStudent(guardianAuth.accessToken, studentLinkCode);
  logResult({
    name: 'Link student',
    passed: linkResult.status === 200 && linkResult.data?.ok === true,
    data: linkResult.data,
  });

  // Test 7: List students shows linked student
  log('Test 7: List students shows linked student');
  const studentsResult = await getGuardianStudents(guardianAuth.accessToken);
  const foundStudent = studentsResult.data?.students?.find((s: any) => s.id === studentId);
  logResult({
    name: 'List students includes linked student',
    passed: !!foundStudent,
    data: { studentCount: studentsResult.data?.students?.length },
  });

  // Test 8: Can access linked student summary
  log('Test 8: Can access linked student summary');
  const linkedSummary = await getStudentSummary(guardianAuth.accessToken, studentId);
  logResult({
    name: 'Linked student summary accessible',
    passed: linkedSummary.status === 200,
    data: linkedSummary.data,
  });

  // Test 9: Unlink student
  log('Test 9: Unlink student');
  const unlinkResult = await unlinkStudent(guardianAuth.accessToken, studentId);
  logResult({
    name: 'Unlink student',
    passed: unlinkResult.status === 200 && unlinkResult.data?.ok === true,
    data: unlinkResult.data,
  });

  // Test 10: Cannot access after unlink
  log('Test 10: Cannot access after unlink');
  const afterUnlinkSummary = await getStudentSummary(guardianAuth.accessToken, studentId);
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
