#!/usr/bin/env node

/**
 * COMPREHENSIVE DATABASE CONSISTENCY TESTS
 * 
 * Task F: Tests that FAIL for DB mismatch or invisible data
 * 
 * These tests are designed to catch:
 * 1. Database connection mismatches between components
 * 2. Data invisibility between ingest and student APIs  
 * 3. Authentication bypass vulnerabilities
 * 4. Transactional integrity failures
 * 5. Enhanced metrics accuracy issues
 */

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:5000';
const ADMIN_TOKEN = 'admin-dev-token-2024';

// Test utilities
const adminHeaders = {
  'Authorization': `Bearer ${ADMIN_TOKEN}`,
  'Content-Type': 'application/json'
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Track test state
let testResults = {
  passed: 0,
  failed: 0,
  errors: []
};

function logTest(name, passed, details = '') {
  const icon = passed ? '✅' : '❌';
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`${icon} [${status}] ${name}${details ? ': ' + details : ''}`);
  
  if (passed) {
    testResults.passed++;
  } else {
    testResults.failed++;
    testResults.errors.push(`${name}: ${details}`);
  }
}

// Test helper functions
async function apiCall(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  try {
    const response = await fetch(url, options);
    const data = await response.json();
    return { status: response.status, data, ok: response.ok };
  } catch (error) {
    return { status: 0, error: error.message, ok: false };
  }
}

async function adminApiCall(endpoint, options = {}) {
  return apiCall(endpoint, {
    ...options,
    headers: { ...adminHeaders, ...options.headers }
  });
}

/**
 * TEST 1: AUTHENTICATION ENFORCEMENT
 * Verifies ALL ingest endpoints require admin authentication
 */
async function testAuthenticationEnforcement() {
  console.log('\n🔒 TEST 1: Authentication Enforcement');
  
  const protectedEndpoints = [
    { method: 'GET', path: '/api/ingest/jobs' },
    { method: 'POST', path: '/api/ingest/start' },
    { method: 'POST', path: '/api/ingest/run' },
    { method: 'POST', path: '/api/documents/process-and-ingest' }
  ];
  
  for (const endpoint of protectedEndpoints) {
    // Test without auth - should fail
    const withoutAuth = await apiCall(endpoint.path, {
      method: endpoint.method,
      headers: { 'Content-Type': 'application/json' },
      body: endpoint.method === 'POST' ? JSON.stringify({}) : undefined
    });
    
    const shouldBeBlocked = withoutAuth.status === 401 || 
                           (withoutAuth.data && withoutAuth.data.error === 'Admin authentication required');
    
    logTest(
      `${endpoint.method} ${endpoint.path} blocks unauthenticated access`,
      shouldBeBlocked,
      shouldBeBlocked ? 'Properly blocked' : `Got status ${withoutAuth.status}`
    );
    
    // Test with valid auth - should work (at least not be auth-blocked)
    if (endpoint.path !== '/api/documents/process-and-ingest') { // Skip file upload for this test
      const withAuth = await adminApiCall(endpoint.path, {
        method: endpoint.method,
        body: endpoint.method === 'POST' ? JSON.stringify({}) : undefined
      });
      
      const authWorked = withAuth.status !== 401 && 
                        !(withAuth.data && withAuth.data.error === 'Admin authentication required');
      
      logTest(
        `${endpoint.method} ${endpoint.path} accepts valid admin token`,
        authWorked,
        authWorked ? 'Auth accepted' : `Auth failed: ${withAuth.data?.error || withAuth.status}`
      );
    }
  }
}

/**
 * TEST 2: DATABASE CONSISTENCY CHECK
 * Ingests test data and verifies it's visible across all APIs
 */
async function testDatabaseConsistency() {
  console.log('\n🗄️ TEST 2: Database Consistency & Cross-API Visibility');
  
  // Step 1: Get initial state
  const initialJobs = await adminApiCall('/api/ingest/jobs');
  const initialQuestions = await apiCall('/api/questions/count');
  
  logTest(
    'Initial state retrieval',
    initialJobs.ok && initialQuestions.ok,
    `Jobs API: ${initialJobs.ok}, Questions API: ${initialQuestions.ok}`
  );
  
  const initialJobCount = initialJobs.ok ? initialJobs.data.length : 0;
  const initialQuestionCount = initialQuestions.ok ? initialQuestions.data.count : 0;
  
  console.log(`   📊 Initial state: ${initialJobCount} jobs, ${initialQuestionCount} questions`);
  
  // Step 2: Create test job
  const startResult = await adminApiCall('/api/ingest/start', {
    method: 'POST'
  });
  
  logTest(
    'Test job creation',
    startResult.ok && startResult.data.jobId,
    startResult.ok ? `Job ID: ${startResult.data.jobId}` : startResult.data?.error
  );
  
  if (!startResult.ok) return false;
  
  const testJobId = startResult.data.jobId;
  
  // Step 3: Ingest test questions with unique IDs (properly formatted for qaSchema)
  const timestamp = Date.now();
  const now = new Date().toISOString();
  const testQuestions = [
    {
      id: `test-consistency-${timestamp}-1`,
      rawId: `raw-${timestamp}-1`,
      stem: "Test consistency question 1 - What is 2 + 2?",
      options: [
        { key: "A", text: "2" },
        { key: "B", text: "3" },
        { key: "C", text: "4" },
        { key: "D", text: "5" }
      ],
      answer: "C",
      explanation: "2 + 2 equals 4, which is option C.",
      section: "Math",
      source: { path: "test-consistency.pdf", page: 1 },
      tags: ["arithmetic", "addition", "test"],
      version: 1,
      createdAt: now,
      updatedAt: now
    },
    {
      id: `test-consistency-${timestamp}-2`, 
      rawId: `raw-${timestamp}-2`,
      stem: "Test consistency question 2 - What is 3 * 4?",
      options: [
        { key: "A", text: "10" },
        { key: "B", text: "11" },
        { key: "C", text: "12" },
        { key: "D", text: "13" }
      ],
      answer: "C", 
      explanation: "3 * 4 equals 12, which is option C.",
      section: "Math",
      source: { path: "test-consistency.pdf", page: 2 },
      tags: ["arithmetic", "multiplication", "test"],
      version: 1,
      createdAt: now,
      updatedAt: now
    }
  ];
  
  const ingestResult = await adminApiCall('/api/ingest/run', {
    method: 'POST',
    body: JSON.stringify({
      jobId: testJobId,
      items: testQuestions
    })
  });
  
  logTest(
    'Test data ingestion',
    ingestResult.ok,
    ingestResult.ok ? `Inserted ${ingestResult.data.insertedCount || 'unknown'} questions` : ingestResult.data?.error
  );
  
  if (!ingestResult.ok) return false;
  
  // Step 4: Verify job was updated with metrics
  await sleep(100); // Brief pause for database consistency
  
  const jobStatus = await adminApiCall(`/api/ingest/status/${testJobId}`);
  logTest(
    'Job status retrieval after ingest',
    jobStatus.ok,
    jobStatus.ok ? `Status: ${jobStatus.data.status}` : jobStatus.data?.error
  );
  
  if (jobStatus.ok && jobStatus.data.status === 'done') {
    const metrics = jobStatus.data;
    const expectedInserted = 2;
    const metricsAccurate = metrics.insertedCount === expectedInserted && 
                           metrics.totalProcessed === expectedInserted;
    
    logTest(
      'Enhanced metrics accuracy',
      metricsAccurate,
      `Inserted: ${metrics.insertedCount}/${expectedInserted}, Processed: ${metrics.totalProcessed}/${expectedInserted}`
    );
  }
  
  // Step 5: CRITICAL TEST - Verify visibility in student API
  await sleep(200); // Allow for any async operations
  
  const updatedQuestions = await apiCall('/api/questions/count');
  logTest(
    'Student API question count retrieval',
    updatedQuestions.ok,
    updatedQuestions.ok ? `Count: ${updatedQuestions.data.count}` : updatedQuestions.data?.error
  );
  
  if (updatedQuestions.ok) {
    const newQuestionCount = updatedQuestions.data.count;
    const expectedIncrease = ingestResult.data.insertedCount || 2;
    const actualIncrease = newQuestionCount - initialQuestionCount;
    
    const visibilityWorking = actualIncrease === expectedIncrease;
    
    logTest(
      'Cross-API data visibility (CRITICAL)',
      visibilityWorking,
      `Expected increase: ${expectedIncrease}, Actual increase: ${actualIncrease} (${initialQuestionCount} → ${newQuestionCount})`
    );
  }
  
  // Step 6: Verify actual question retrieval
  const questionsResult = await apiCall('/api/questions/random?limit=10');
  logTest(
    'Student API question retrieval',
    questionsResult.ok,
    questionsResult.ok ? `Retrieved ${questionsResult.data.length} questions` : questionsResult.data?.error
  );
  
  if (questionsResult.ok && questionsResult.data.length > 0) {
    // Check if our test questions are in the results
    const ourQuestions = questionsResult.data.filter(q => 
      q.id && q.id.includes(`test-consistency-${timestamp}`)
    );
    
    logTest(
      'Test questions visible in student API results',
      ourQuestions.length > 0,
      `Found ${ourQuestions.length}/2 test questions in random sample`
    );
  }
  
  return true;
}

/**
 * TEST 3: TRANSACTIONAL INTEGRITY
 * Tests that failed ingests don't partially corrupt the database
 */
async function testTransactionalIntegrity() {
  console.log('\n⚡ TEST 3: Transactional Integrity');
  
  // Get initial count
  const initialCount = await apiCall('/api/questions/count');
  if (!initialCount.ok) {
    logTest('Initial count retrieval for integrity test', false, 'Could not get initial count');
    return false;
  }
  
  const startCount = initialCount.data.count;
  
  // Create job for integrity test
  const jobResult = await adminApiCall('/api/ingest/start', { method: 'POST' });
  if (!jobResult.ok) {
    logTest('Job creation for integrity test', false, 'Could not create test job');
    return false;
  }
  
  const testJobId = jobResult.data.jobId;
  
  // Try to ingest a mix of valid and invalid questions
  const testNow = new Date().toISOString();
  const mixedQuestions = [
    {
      id: `integrity-test-${Date.now()}-valid`,
      rawId: `raw-integrity-valid`,
      stem: "Valid question for integrity test",
      options: [
        { key: "A", text: "Option A" },
        { key: "B", text: "Option B" },
        { key: "C", text: "Option C" },
        { key: "D", text: "Option D" }
      ],
      answer: "A",
      explanation: "This is a valid test question.",
      section: "Math",
      source: { path: "integrity-test.pdf", page: 1 },
      tags: ["test", "integrity"],
      version: 1,
      createdAt: testNow,
      updatedAt: testNow
    },
    {
      id: `integrity-test-${Date.now()}-invalid`,
      // Missing required fields intentionally (no options, explanation, source, tags, etc.)
      stem: "Invalid question missing required fields",
      answer: "A",
      section: "Math"
    }
  ];
  
  const mixedResult = await adminApiCall('/api/ingest/run', {
    method: 'POST',
    body: JSON.stringify({
      jobId: testJobId,
      items: mixedQuestions
    })
  });
  
  // Should succeed with partial processing
  logTest(
    'Mixed valid/invalid ingest allows partial success',
    mixedResult.ok,
    mixedResult.ok ? 'Partial success allowed' : `Failed: ${mixedResult.data?.error}`
  );
  
  if (mixedResult.ok) {
    // Check that only valid questions were inserted
    const finalCount = await apiCall('/api/questions/count');
    if (finalCount.ok) {
      const actualIncrease = finalCount.data.count - startCount;
      const expectedIncrease = 1; // Only the valid question
      
      logTest(
        'Invalid questions properly rejected in partial success',
        actualIncrease === expectedIncrease,
        `Expected increase: ${expectedIncrease}, Actual: ${actualIncrease}`
      );
    }
    
    // Check job metrics reflect partial success
    const jobStatus = await adminApiCall(`/api/ingest/status/${testJobId}`);
    if (jobStatus.ok && jobStatus.data.status === 'done') {
      const hasValidationSkipped = jobStatus.data.validationSkipped > 0;
      logTest(
        'Validation errors tracked in job metrics',
        hasValidationSkipped,
        `validationSkipped: ${jobStatus.data.validationSkipped || 0}`
      );
    }
  }
  
  return true;
}

/**
 * TEST 4: SCALE VERIFICATION
 * Tests that large batches don't hit SQLite parameter limits
 */
async function testScaleVerification() {
  console.log('\n📈 TEST 4: Scale Verification (SQLite Parameter Limits)');
  
  // Create a larger batch to test chunking (but not too large for test performance)
  const batchSize = 50; // Smaller than 999 but large enough to test chunking logic
  const timestamp = Date.now();
  
  const scaleTestNow = new Date().toISOString();
  const largeBatch = Array.from({ length: batchSize }, (_, i) => ({
    id: `scale-test-${timestamp}-${i}`,
    rawId: `raw-scale-${timestamp}-${i}`,
    stem: `Scale test question ${i + 1}: What is ${i} + 1?`,
    options: [
      { key: "A", text: `${i}` },
      { key: "B", text: `${i + 1}` },
      { key: "C", text: `${i + 2}` },
      { key: "D", text: `${i + 3}` }
    ],
    answer: "B",
    explanation: `${i} + 1 equals ${i + 1}, which is option B.`,
    section: "Math",
    source: { path: "scale-test.pdf", page: Math.floor(i / 10) + 1 },
    tags: ["arithmetic", "addition", "scale-test"],
    version: 1,
    createdAt: scaleTestNow,
    updatedAt: scaleTestNow
  }));
  
  // Create job
  const jobResult = await adminApiCall('/api/ingest/start', { method: 'POST' });
  if (!jobResult.ok) {
    logTest('Scale test job creation', false, 'Could not create test job');
    return false;
  }
  
  const testJobId = jobResult.data.jobId;
  
  // Ingest large batch
  const startTime = Date.now();
  const batchResult = await adminApiCall('/api/ingest/run', {
    method: 'POST',
    body: JSON.stringify({
      jobId: testJobId,
      items: largeBatch
    })
  });
  const endTime = Date.now();
  
  logTest(
    `Large batch ingest (${batchSize} items)`,
    batchResult.ok,
    batchResult.ok ? `Completed in ${endTime - startTime}ms` : batchResult.data?.error
  );
  
  if (batchResult.ok) {
    // Verify all items were processed
    const expectedCount = batchSize;
    const actualInserted = batchResult.data.insertedCount || 0;
    
    logTest(
      'Large batch verification success',
      actualInserted === expectedCount,
      `Expected: ${expectedCount}, Inserted: ${actualInserted}`
    );
    
    // Check job metrics
    const jobStatus = await adminApiCall(`/api/ingest/status/${testJobId}`);
    if (jobStatus.ok && jobStatus.data.status === 'done') {
      logTest(
        'Scale test job completed successfully',
        true,
        `Processed: ${jobStatus.data.totalProcessed}, Inserted: ${jobStatus.data.insertedCount}`
      );
    }
  }
  
  return true;
}

/**
 * MAIN TEST RUNNER
 */
async function runAllTests() {
  console.log('🧪 DATABASE CONSISTENCY TEST SUITE');
  console.log('=====================================');
  console.log('These tests are designed to FAIL if database connections');
  console.log('are inconsistent or data is invisible between components.\n');
  
  try {
    // Check if server is running
    const healthCheck = await apiCall('/api/questions/count');
    if (!healthCheck.ok) {
      console.log('❌ Server health check failed. Is the application running on port 5000?');
      process.exit(1);
    }
    
    logTest('Server health check', true, `Server responding`);
    
    // Run all test suites
    await testAuthenticationEnforcement();
    await testDatabaseConsistency();
    await testTransactionalIntegrity();
    await testScaleVerification();
    
    // Summary
    console.log('\n📊 TEST SUMMARY');
    console.log('================');
    console.log(`✅ Passed: ${testResults.passed}`);
    console.log(`❌ Failed: ${testResults.failed}`);
    console.log(`📈 Total: ${testResults.passed + testResults.failed}`);
    
    if (testResults.failed > 0) {
      console.log('\n🚨 FAILURES DETECTED:');
      testResults.errors.forEach(error => console.log(`   • ${error}`));
      console.log('\nThese failures indicate database consistency or security issues!');
      process.exit(1);
    } else {
      console.log('\n🎉 ALL TESTS PASSED!');
      console.log('Database consistency and cross-API visibility verified.');
      process.exit(0);
    }
    
  } catch (error) {
    console.error('\n💥 Test suite crashed:', error);
    process.exit(1);
  }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests();
}

export { runAllTests };