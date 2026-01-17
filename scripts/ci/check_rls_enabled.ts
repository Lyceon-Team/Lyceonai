#!/usr/bin/env tsx
/**
 * CI Guardrail: Verify RLS is enabled on all user/org tables
 * Fails the build if any critical table has rowsecurity = false
 */
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }
});

// Tables that MUST have RLS enabled
const REQUIRED_RLS_TABLES = [
  'users',
  'progress',
  'attempts',
  'practice_sessions',
  'exam_attempts',
  'notifications',
  'chat_messages',
  'orgs',
  'memberships',
  'courses',
  'sections',
  'items',
  'audit_logs',
  'system_event_logs'
];

async function checkRlsEnabled() {
  try {
    console.log('🔍 Checking RLS enforcement on critical tables...\n');

    const result = await pool.query(`
      SELECT tablename, rowsecurity
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = ANY($1)
      ORDER BY tablename
    `, [REQUIRED_RLS_TABLES]);

    const violations: string[] = [];
    const enabled: string[] = [];
    const missing: string[] = [];

    // Track which tables we found
    const foundTables = new Set(result.rows.map(r => r.tablename));

    // Check for missing tables
    for (const table of REQUIRED_RLS_TABLES) {
      if (!foundTables.has(table)) {
        missing.push(table);
      }
    }

    // Check RLS status
    for (const row of result.rows) {
      if (row.rowsecurity) {
        enabled.push(row.tablename);
      } else {
        violations.push(row.tablename);
      }
    }

    // Print results
    if (enabled.length > 0) {
      console.log('✅ RLS Enabled:');
      enabled.forEach(table => console.log(`   - ${table}`));
      console.log('');
    }

    if (missing.length > 0) {
      console.warn('⚠️  Missing Tables:');
      missing.forEach(table => console.log(`   - ${table}`));
      console.log('');
    }

    if (violations.length > 0) {
      console.error('❌ RLS NOT Enabled (VIOLATIONS):');
      violations.forEach(table => console.log(`   - ${table}`));
      console.log('');
      console.error('💥 FAIL: RLS must be enabled on all user/org tables!\n');
      console.error('To fix: Run migrations or enable RLS manually:\n');
      violations.forEach(table => {
        console.error(`  ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
      });
      console.log('');
      process.exit(1);
    }

    // Summary
    console.log('📊 Summary:');
    console.log(`   ✅ ${enabled.length} tables with RLS enabled`);
    console.log(`   ⚠️  ${missing.length} tables not found in database`);
    console.log(`   ❌ ${violations.length} violations\n`);

    if (violations.length === 0) {
      console.log('✅ PASS: All critical tables have RLS enabled!\n');
      process.exit(0);
    }
  } catch (error) {
    console.error('Error checking RLS:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

checkRlsEnabled();
