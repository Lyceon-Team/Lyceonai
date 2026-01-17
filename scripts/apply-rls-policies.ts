/**
 * Apply RLS Policies to PostgreSQL Database
 * 
 * This script applies Row Level Security policies to the Neon PostgreSQL database.
 * Run with: npx tsx scripts/apply-rls-policies.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { getRawClient } from '../apps/api/src/db/client';

async function applyRLSPolicies() {
  try {
    console.log('🔐 Applying RLS policies to PostgreSQL database...\n');

    const client = getRawClient();
    
    // Read the RLS migration SQL
    const sqlPath = join(process.cwd(), 'database', 'postgresql-rls-policies.sql');
    const rlsSQL = readFileSync(sqlPath, 'utf-8');
    
    // Split SQL into individual statements (split by semicolon, but be careful with function definitions)
    const statements = rlsSQL
      .split(/;(?=\s*(?:--|$|\n\n))/g) // Split by ; followed by comment or empty line
      .map(stmt => stmt.trim())
      .filter(stmt => 
        stmt.length > 0 && 
        !stmt.startsWith('--') && 
        !stmt.match(/^={5,}/)
      );

    console.log(`📝 Found ${statements.length} SQL statements to execute\n`);

    let successCount = 0;
    let skipCount = 0;

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      // Skip empty statements and pure comments
      if (!statement || statement.trim().length === 0) {
        skipCount++;
        continue;
      }

      try {
        // Extract a description from the statement for logging
        const firstLine = statement.split('\n')[0].substring(0, 80);
        const statementType = statement.trim().split(/\s+/)[0].toUpperCase();
        
        console.log(`[${i + 1}/${statements.length}] Executing: ${statementType} ${firstLine}...`);
        
        await client(statement);
        successCount++;
        console.log(`  ✅ Success\n`);
      } catch (error: any) {
        // Check if it's a "already exists" error (non-fatal)
        if (
          error.message?.includes('already exists') ||
          error.message?.includes('duplicate')
        ) {
          console.log(`  ℹ️  Already exists (skipping)\n`);
          skipCount++;
        } else {
          console.error(`  ❌ Error: ${error.message}\n`);
          throw error;
        }
      }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ RLS Policies Applied Successfully!');
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    console.log(`📊 Summary:`);
    console.log(`   - Statements executed: ${successCount}`);
    console.log(`   - Statements skipped: ${skipCount}`);
    console.log(`   - Total statements: ${statements.length}\n`);

    // Verify RLS is enabled
    console.log('🔍 Verifying RLS is enabled on tables...\n');
    
    const verifyQuery = `
      SELECT tablename, rowsecurity 
      FROM pg_tables 
      WHERE schemaname = 'public' 
        AND rowsecurity = true
      ORDER BY tablename;
    `;
    
    const result: any = await client(verifyQuery);
    
    if (result?.rows && result.rows.length > 0) {
      console.log('✅ RLS enabled on the following tables:');
      result.rows.forEach((row: any) => {
        console.log(`   - ${row.tablename}`);
      });
    } else if (Array.isArray(result) && result.length > 0) {
      console.log('✅ RLS enabled on the following tables:');
      result.forEach((row: any) => {
        console.log(`   - ${row.tablename}`);
      });
    } else {
      console.log('⚠️  No tables with RLS enabled found');
    }

    console.log('\n✅ RLS setup complete!\n');
    console.log('Next steps:');
    console.log('  1. Run RLS tests: npm run test -- tests/specs/rls-auth-enforcement.spec.ts');
    console.log('  2. Verify in production: Review database/RLS_SETUP.md\n');

  } catch (error) {
    console.error('\n❌ Failed to apply RLS policies:', error);
    process.exit(1);
  }
}

// Run the script
applyRLSPolicies();
