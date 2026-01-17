#!/usr/bin/env ts-node

/**
 * Migration Runner for Supabase PostgreSQL
 * 
 * Applies SQL migrations in order from database/migrations/
 * Supports rollback via --down flag (non-production only)
 * 
 * Usage:
 *   npm run db:migrate:supabase
 *   npm run db:migrate:supabase -- --down 1  (rollback last migration)
 */

import pg from 'pg';
const { Client } = pg;
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const MIGRATIONS_DIR = join(process.cwd(), 'database', 'migrations');
const SEEDS_DIR = join(process.cwd(), 'database', 'seeds');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function createMigrationsTable(client: Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    );
  `);
}

async function getAppliedMigrations(client: Client): Promise<string[]> {
  const result = await client.query(
    'SELECT filename FROM _migrations ORDER BY id'
  );
  return result.rows.map(row => row.filename);
}

async function markMigrationApplied(client: Client, filename: string) {
  await client.query(
    'INSERT INTO _migrations (filename) VALUES ($1)',
    [filename]
  );
}

async function unmarkMigration(client: Client, filename: string) {
  await client.query(
    'DELETE FROM _migrations WHERE filename = $1',
    [filename]
  );
}

async function applyMigration(client: Client, filepath: string, filename: string) {
  log(`\n📄 Applying: ${filename}`, 'cyan');
  
  const sql = readFileSync(filepath, 'utf-8');
  
  try {
    // Execute the migration
    await client.query(sql);
    
    // Mark as applied
    await markMigrationApplied(client, filename);
    
    log(`✅ Success: ${filename}`, 'green');
  } catch (error: any) {
    log(`❌ Failed: ${filename}`, 'red');
    log(`Error: ${error.message}`, 'red');
    
    // Show more error details
    if (error.position) {
      const position = parseInt(error.position);
      const snippet = sql.substring(Math.max(0, position - 100), Math.min(sql.length, position + 100));
      log(`\nSQL near error:`, 'yellow');
      log(snippet, 'yellow');
    }
    
    if (error.detail) {
      log(`\nDetail: ${error.detail}`, 'yellow');
    }
    
    if (error.hint) {
      log(`Hint: ${error.hint}`, 'yellow');
    }
    
    throw error;
  }
}

async function rollbackMigration(client: Client, filename: string) {
  log(`\n⏪ Rolling back: ${filename}`, 'yellow');
  
  // For now, rollback is manual (DROP statements in DOWN sections)
  // Future: support paired migration/rollback files
  
  log(`⚠️  Manual rollback required for: ${filename}`, 'yellow');
  log(`   Create a DOWN section in your migration or a rollback file`, 'yellow');
  
  // Unmark the migration
  await unmarkMigration(client, filename);
  
  log(`✅ Unmarked: ${filename}`, 'green');
}

async function main() {
  const args = process.argv.slice(2);
  const rollbackMode = args.includes('--down');
  const rollbackCount = rollbackMode 
    ? parseInt(args[args.indexOf('--down') + 1] || '1', 10)
    : 0;

  if (!SUPABASE_DB_URL) {
    log('❌ Error: SUPABASE_DB_URL not set', 'red');
    log('   Set SUPABASE_DB_URL in Replit Secrets', 'red');
    process.exit(1);
  }

  // Security check: don't allow rollback in production
  if (rollbackMode && process.env.NODE_ENV === 'production') {
    log('❌ Error: Rollback not allowed in production', 'red');
    log('   Production rollbacks require manual review', 'red');
    process.exit(1);
  }

  log('\n🚀 Supabase Migration Runner', 'blue');
  log('================================\n', 'blue');

  const client = new Client({ connectionString: SUPABASE_DB_URL });
  
  try {
    await client.connect();
    log('✅ Connected to Supabase PostgreSQL', 'green');

    // Create migrations tracking table
    await createMigrationsTable(client);

    // Get applied migrations
    const applied = await getAppliedMigrations(client);
    log(`\n📊 Applied migrations: ${applied.length}`, 'cyan');

    if (rollbackMode) {
      // Rollback mode
      log(`\n⏪ Rolling back last ${rollbackCount} migration(s)`, 'yellow');
      
      if (applied.length === 0) {
        log('⚠️  No migrations to rollback', 'yellow');
        return;
      }

      const toRollback = applied.slice(-rollbackCount).reverse();
      
      for (const filename of toRollback) {
        await rollbackMigration(client, filename);
      }
      
      log(`\n✅ Rollback complete`, 'green');
      return;
    }

    // Forward migration mode
    // Get all migration files
    const migrationFiles = readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const pending = migrationFiles.filter(f => !applied.includes(f));

    if (pending.length === 0) {
      log('✅ All migrations already applied', 'green');
    } else {
      log(`\n📝 Pending migrations: ${pending.length}`, 'cyan');
      
      for (const filename of pending) {
        const filepath = join(MIGRATIONS_DIR, filename);
        await applyMigration(client, filepath, filename);
      }
    }

    // Apply seeds if migrations were successful
    const seedFiles = readdirSync(SEEDS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (seedFiles.length > 0) {
      log(`\n🌱 Applying seeds`, 'cyan');
      
      for (const filename of seedFiles) {
        const filepath = join(SEEDS_DIR, filename);
        log(`\n📄 Seeding: ${filename}`, 'cyan');
        
        const sql = readFileSync(filepath, 'utf-8');
        
        try {
          await client.query(sql);
          log(`✅ Success: ${filename}`, 'green');
        } catch (error: any) {
          // Seeds are idempotent, so errors might be expected (e.g., data already exists)
          log(`⚠️  Seed warning: ${filename} - ${error.message}`, 'yellow');
        }
      }
    }

    log('\n✅ Migration complete!', 'green');
    log('================================\n', 'green');

  } catch (error: any) {
    log('\n❌ Migration failed!', 'red');
    log(`Error: ${error.message}`, 'red');
    log('================================\n', 'red');
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
