#!/usr/bin/env tsx
/**
 * Complete RLS Verification Script
 * - Checks RLS is enabled on tables
 * - Counts and displays all policies
 * - Verifies critical policies exist
 */
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function verifyRls() {
  try {
    console.log('🔐 RLS Verification Report');
    console.log('================================\n');

    // 1. Check RLS enabled tables
    const rlsTables = await pool.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public' AND rowsecurity = true
      ORDER BY tablename
    `);

    console.log(`🔒 RLS Enabled Tables (${rlsTables.rows.length}):`);
    rlsTables.rows.forEach(row => console.log(`   - ${row.tablename}`));
    console.log('');

    // 2. Count policies by table
    const policies = await pool.query(`
      SELECT schemaname, tablename, policyname, cmd, qual
      FROM pg_policies
      WHERE schemaname = 'public'
      ORDER BY tablename, policyname
    `);

    console.log(`📜 Security Policies (${policies.rows.length} total):\n`);
    
    const policiesByTable: Record<string, any[]> = {};
    policies.rows.forEach(row => {
      if (!policiesByTable[row.tablename]) {
        policiesByTable[row.tablename] = [];
      }
      policiesByTable[row.tablename].push(row);
    });

    Object.entries(policiesByTable).forEach(([table, tablePolicies]) => {
      console.log(`   ${table} (${tablePolicies.length} policies):`);
      tablePolicies.forEach(p => {
        console.log(`      - ${p.policyname} [${p.cmd || 'ALL'}]`);
      });
    });
    console.log('');

    // 3. Verify critical policies exist
    const criticalPolicies = [
      { table: 'users', policy: 'users_select_self' },
      { table: 'progress', policy: 'progress_select_own' },
      { table: 'attempts', policy: 'attempts_select_own' },
      { table: 'practice_sessions', policy: 'practice_sessions_select_own' },
    ];

    console.log('🎯 Critical Policy Check:\n');
    let missingCritical = 0;

    for (const { table, policy } of criticalPolicies) {
      const exists = policies.rows.some(
        p => p.tablename === table && p.policyname === policy
      );
      
      if (exists) {
        console.log(`   ✅ ${table}.${policy}`);
      } else {
        console.log(`   ❌ ${table}.${policy} - MISSING!`);
        missingCritical++;
      }
    }
    console.log('');

    // 4. Summary
    console.log('📊 Summary:');
    console.log(`   ✅ ${rlsTables.rows.length} tables with RLS enabled`);
    console.log(`   ✅ ${policies.rows.length} security policies active`);
    console.log(`   ${missingCritical > 0 ? '❌' : '✅'} ${missingCritical} critical policies missing\n`);

    if (missingCritical > 0) {
      console.error('💥 FAIL: Critical RLS policies are missing!');
      process.exit(1);
    }

    console.log('✅ PASS: RLS is fully configured!\n');
    console.log('================================');
    process.exit(0);

  } catch (error) {
    console.error('Error verifying RLS:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

verifyRls();
