#!/usr/bin/env npx tsx
/**
 * Guardian Smoke Test Script
 * 
 * Runs in two modes:
 * 1. Unauthenticated mode (default): Tests server reachability and 401 responses
 * 2. Authenticated mode: Runs full link/unlink tests with test credentials
 * 
 * Required environment variables:
 * - SMOKE_TEST_BASE_URL (optional, defaults to http://localhost:5000)
 * 
 * For authenticated mode (optional):
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * 
 * Usage:
 *   npx tsx scripts/guardian-smoke-test.ts
 */

interface TestResult {
  step: string;
  passed: boolean;
  message: string;
}

const results: TestResult[] = [];
const BASE_URL = process.env.SMOKE_TEST_BASE_URL || 'http://localhost:5000';

function log(step: string, passed: boolean, message: string) {
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${status}: ${step} - ${message}`);
  results.push({ step, passed, message });
}

async function testHealthz(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/healthz`);
    const ok = res.status === 200;
    log('Server reachable (/healthz)', ok, ok ? 'Server is running' : `Status: ${res.status}`);
    return ok;
  } catch (err: any) {
    log('Server reachable (/healthz)', false, `Connection failed: ${err.message}`);
    return false;
  }
}

async function testUnauthenticatedEndpoints(): Promise<void> {
  const endpoints = [
    { method: 'GET', path: '/api/guardian/students', name: 'GET /students' },
    { method: 'POST', path: '/api/guardian/link', name: 'POST /link' },
    { method: 'DELETE', path: '/api/guardian/link/test-id', name: 'DELETE /link/:id' },
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(`${BASE_URL}${ep.path}`, {
        method: ep.method,
        headers: { 'Content-Type': 'application/json' },
        body: ep.method !== 'GET' ? JSON.stringify({}) : undefined,
      });
      
      const body = await res.json().catch(() => ({}));
      const hasRequestId = 'requestId' in body;
      const is401 = res.status === 401;
      
      log(
        `${ep.name} returns 401 unauthenticated`,
        is401,
        is401 ? `401 with requestId: ${hasRequestId}` : `Got ${res.status}`
      );
      
      if (is401 && !hasRequestId) {
        log(`${ep.name} includes requestId`, false, 'Missing requestId in 401 response');
      }
    } catch (err: any) {
      log(`${ep.name} returns 401 unauthenticated`, false, `Request failed: ${err.message}`);
    }
  }
}

async function testAuthenticatedMode(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.log('\n⚠️  Skipping authenticated tests (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set)\n');
    return;
  }

  console.log('\n📋 Running authenticated tests...\n');

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const testGuardianEmail = 'guardian_smoke_test@lyceon.test';
  const testStudentEmail = 'student_smoke_test@lyceon.test';
  const testPassword = 'SmokeTest123!';

  let guardianId: string | null = null;
  let studentId: string | null = null;
  let linkCode: string | null = null;

  try {
    const { data: guardianUser } = await supabase.auth.admin.createUser({
      email: testGuardianEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { role: 'guardian' }
    });

    if (guardianUser?.user) {
      guardianId = guardianUser.user.id;
      await supabase.from('profiles').upsert({
        id: guardianId,
        email: testGuardianEmail,
        role: 'guardian',
        display_name: 'Smoke Test Guardian'
      });
      log('Create test guardian', true, `ID: ${guardianId.substring(0, 8)}...`);
    }

    const { data: studentUser } = await supabase.auth.admin.createUser({
      email: testStudentEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { role: 'student' }
    });

    if (studentUser?.user) {
      studentId = studentUser.user.id;
      linkCode = Math.random().toString(36).substring(2, 10).toUpperCase();
      await supabase.from('profiles').upsert({
        id: studentId,
        email: testStudentEmail,
        role: 'student',
        display_name: 'Smoke Test Student',
        student_link_code: linkCode
      });
      log('Create test student', true, `ID: ${studentId.substring(0, 8)}..., code: ${linkCode}`);
    }

    const { data: session } = await supabase.auth.signInWithPassword({
      email: testGuardianEmail,
      password: testPassword
    });

    if (!session?.session) {
      log('Guardian sign-in', false, 'Failed to get session');
      return;
    }

    log('Guardian sign-in', true, 'Got access token');

    const invalidCodeRes = await fetch(`${BASE_URL}/api/guardian/link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.session.access_token}`
      },
      body: JSON.stringify({ code: 'INVALID1' })
    });

    const invalidBody = await invalidCodeRes.json().catch(() => ({}));
    const invalid404 = invalidCodeRes.status === 404;
    const invalidHasReqId = 'requestId' in invalidBody;

    log(
      'Invalid code returns 404 + requestId',
      invalid404 && invalidHasReqId,
      `Status: ${invalidCodeRes.status}, hasRequestId: ${invalidHasReqId}`
    );

    if (linkCode) {
      const linkRes = await fetch(`${BASE_URL}/api/guardian/link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.session.access_token}`
        },
        body: JSON.stringify({ code: linkCode })
      });

      const linkBody = await linkRes.json().catch(() => ({}));
      const linkOk = linkRes.status === 200 && linkBody.ok === true;
      const linkHasReqId = 'requestId' in linkBody;

      log(
        'Valid link succeeds + requestId',
        linkOk && linkHasReqId,
        `Status: ${linkRes.status}, ok: ${linkBody.ok}, hasRequestId: ${linkHasReqId}`
      );

      if (linkOk && studentId) {
        const unlinkRes = await fetch(`${BASE_URL}/api/guardian/link/${studentId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${session.session.access_token}`
          }
        });

        const unlinkBody = await unlinkRes.json().catch(() => ({}));
        const unlinkOk = unlinkRes.status === 200 && unlinkBody.ok === true;
        const unlinkHasReqId = 'requestId' in unlinkBody;

        log(
          'Unlink succeeds + requestId',
          unlinkOk && unlinkHasReqId,
          `Status: ${unlinkRes.status}, hasRequestId: ${unlinkHasReqId}`
        );
      }
    }

  } catch (err: any) {
    log('Authenticated tests', false, `Error: ${err.message}`);
  } finally {
    if (guardianId) {
      await supabase.from('profiles').delete().eq('id', guardianId);
      await supabase.auth.admin.deleteUser(guardianId);
    }
    if (studentId) {
      await supabase.from('profiles').delete().eq('id', studentId);
      await supabase.auth.admin.deleteUser(studentId);
    }
    console.log('  Cleaned up test users');
  }
}

function printSummary() {
  console.log('\n' + '='.repeat(50));
  console.log('📊 TEST SUMMARY\n');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  for (const result of results) {
    const icon = result.passed ? '✅' : '❌';
    console.log(`  ${icon} ${result.step}`);
  }

  console.log('\n' + '-'.repeat(50));
  console.log(`  Total: ${total} | Passed: ${passed} | Failed: ${failed}`);
  console.log('='.repeat(50));

  if (failed > 0) {
    console.log('\n❌ OVERALL: FAIL\n');
    process.exit(1);
  } else {
    console.log('\n✅ OVERALL: PASS\n');
    process.exit(0);
  }
}

async function main() {
  console.log('\n🧪 Guardian Smoke Test\n');
  console.log('='.repeat(50));
  console.log(`Base URL: ${BASE_URL}`);
  console.log('='.repeat(50));

  console.log('\n📋 Phase 1: Server Reachability\n');
  const serverUp = await testHealthz();
  
  if (!serverUp) {
    console.log('\n⚠️  Server not reachable, skipping remaining tests\n');
    printSummary();
    return;
  }

  console.log('\n📋 Phase 2: Unauthenticated Endpoint Tests\n');
  await testUnauthenticatedEndpoints();

  console.log('\n📋 Phase 3: Authenticated Tests (if credentials provided)\n');
  await testAuthenticatedMode();

  printSummary();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
