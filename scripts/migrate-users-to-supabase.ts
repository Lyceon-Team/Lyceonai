#!/usr/bin/env tsx
/**
 * User Migration Script: PostgreSQL Users → Supabase Auth
 * 
 * This script migrates existing users from the legacy `users` table to Supabase Auth.
 * 
 * Migration Process:
 * 1. Fetch all users from the `users` table
 * 2. For each user:
 *    a. Create user in Supabase Auth (auth.users)
 *    b. Create corresponding profile in user_profiles table
 *    c. Handle password hashing for password-based auth
 *    d. Link Google OAuth accounts
 * 3. Generate migration report
 * 
 * Usage:
 *   tsx scripts/migrate-users-to-supabase.ts [--dry-run] [--force]
 * 
 * Options:
 *   --dry-run: Preview migration without making changes
 *   --force: Skip confirmation prompts
 */

import { createClient } from '@supabase/supabase-js';
import { db } from '../apps/api/src/db/client';
import { users as usersTable } from '../shared/schema';
import { eq } from 'drizzle-orm';

// Environment validation
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Error: Missing required environment variables');
  console.error('   Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Create Supabase Admin client (bypasses RLS)
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

interface MigrationResult {
  userId: string;
  email: string;
  status: 'success' | 'skipped' | 'error';
  reason?: string;
  supabaseUserId?: string;
}

interface MigrationStats {
  total: number;
  success: number;
  skipped: number;
  errors: number;
  results: MigrationResult[];
}

/**
 * Check if user already exists in Supabase Auth by email
 */
async function checkUserExistsByEmail(email: string): Promise<{ exists: boolean; userId?: string }> {
  try {
    // Use listUsers with email filter for accurate existence check
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1
    });
    
    if (error) {
      console.warn(`Failed to check user existence for ${email}: ${error.message}`);
      return { exists: false };
    }

    // Search through all users (with pagination if needed)
    let page = 1;
    const perPage = 100;
    let allUsers: any[] = [];
    
    while (true) {
      const { data: pageData, error: pageError } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage
      });
      
      if (pageError) break;
      if (!pageData?.users || pageData.users.length === 0) break;
      
      allUsers = allUsers.concat(pageData.users);
      
      if (pageData.users.length < perPage) break;
      page++;
    }
    
    const existingUser = allUsers.find(u => u.email?.toLowerCase() === email.toLowerCase());
    
    return {
      exists: !!existingUser,
      userId: existingUser?.id
    };
  } catch (error) {
    console.warn(`Error checking user existence: ${error}`);
    return { exists: false };
  }
}

/**
 * Migrate a single user to Supabase Auth
 */
async function migrateUser(user: any, dryRun: boolean): Promise<MigrationResult> {
  const result: MigrationResult = {
    userId: user.id,
    email: user.email || '',
    status: 'error'
  };

  try {
    // Skip users without email
    if (!user.email) {
      result.status = 'skipped';
      result.reason = 'No email address';
      return result;
    }

    // Check if user already exists in Supabase Auth
    const existenceCheck = await checkUserExistsByEmail(user.email);
    
    if (existenceCheck.exists) {
      result.status = 'skipped';
      result.reason = 'User already exists in Supabase Auth';
      result.supabaseUserId = existenceCheck.userId;
      return result;
    }

    if (dryRun) {
      result.status = 'success';
      result.reason = 'Dry run - would create user';
      return result;
    }

    // Create user in Supabase Auth
    const authData: any = {
      email: user.email,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        avatar_url: user.avatarUrl,
        username: user.username,
        is_admin: user.isAdmin || false,
        first_name: user.firstName,
        last_name: user.lastName,
        phone_number: user.phoneNumber,
        migration_source: 'legacy_postgresql', // Track migration origin
        requires_password_reset: !user.googleId // Flag password users for reset
      }
    };

    // Handle password-based users
    // NOTE: Legacy passwords are bcrypt hashes. Supabase will hash them again if we pass them.
    // Instead, we generate a random temporary password and require reset on first login.
    if (user.password && !user.googleId) {
      // Generate a random temporary password (user must reset)
      const tempPassword = `Temp${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}!`;
      authData.password = tempPassword;
      authData.user_metadata.requires_password_reset = true;
      console.log(`  🔑 User ${user.email} will need to reset password on first login`);
    }

    // Handle Google OAuth users
    if (user.googleId) {
      authData.app_metadata = {
        provider: 'google',
        providers: ['google'],
        google_id: user.googleId
      };
      authData.user_metadata.requires_password_reset = false;
    }

    // Create user in Supabase Auth
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser(authData);

    if (createError) {
      result.status = 'error';
      result.reason = createError.message;
      return result;
    }

    result.supabaseUserId = newUser.user?.id;

    // Update user profile in Supabase profiles table
    // NOTE: The profile is auto-created by Supabase's handle_new_user trigger
    // We just need to update it with the correct role and metadata
    const profileUpdates = {
      display_name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || null,
      role: user.isAdmin ? 'admin' : 'student',
      is_under_13: false, // Default to false, can be updated later
      guardian_consent: false,
      guardian_email: null,
      consent_given_at: null,
      updated_at: new Date().toISOString(),
      last_login_at: user.lastLoginAt?.toISOString() || null,
    };

    // Wait a moment for the trigger to create the profile
    await new Promise(resolve => setTimeout(resolve, 500));

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update(profileUpdates)
      .eq('id', newUser.user!.id);

    if (profileError) {
      console.warn(`  ⚠️  Failed to update profile for ${user.email}: ${profileError.message}`);
      // Don't fail the migration if profile update fails - the user still exists in Auth
    }

    result.status = 'success';
    result.reason = 'User migrated successfully';
    
    console.log(`  ✅ Migrated: ${user.email} (${result.supabaseUserId})`);
    
    return result;

  } catch (error) {
    result.status = 'error';
    result.reason = error instanceof Error ? error.message : 'Unknown error';
    console.error(`  ❌ Failed: ${user.email} - ${result.reason}`);
    return result;
  }
}

/**
 * Main migration function
 */
async function runMigration(dryRun: boolean = false): Promise<MigrationStats> {
  console.log('\n🚀 Starting user migration to Supabase Auth...\n');
  
  if (dryRun) {
    console.log('⚠️  DRY RUN MODE - No changes will be made\n');
  }

  const stats: MigrationStats = {
    total: 0,
    success: 0,
    skipped: 0,
    errors: 0,
    results: []
  };

  try {
    // Fetch all users from legacy table
    const existingUsers = await db.select().from(usersTable);
    stats.total = existingUsers.length;

    console.log(`📊 Found ${stats.total} users to migrate\n`);

    // Migrate each user
    for (const user of existingUsers) {
      const result = await migrateUser(user, dryRun);
      stats.results.push(result);

      if (result.status === 'success') stats.success++;
      else if (result.status === 'skipped') stats.skipped++;
      else stats.errors++;
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📈 MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total users:     ${stats.total}`);
    console.log(`✅ Success:      ${stats.success}`);
    console.log(`⏭️  Skipped:      ${stats.skipped}`);
    console.log(`❌ Errors:       ${stats.errors}`);
    console.log('='.repeat(60) + '\n');

    // Print detailed errors
    if (stats.errors > 0) {
      console.log('❌ ERRORS:\n');
      stats.results
        .filter(r => r.status === 'error')
        .forEach(r => {
          console.log(`  • ${r.email}: ${r.reason}`);
        });
      console.log('');
    }

    // Print skipped users
    if (stats.skipped > 0) {
      console.log('⏭️  SKIPPED:\n');
      stats.results
        .filter(r => r.status === 'skipped')
        .forEach(r => {
          console.log(`  • ${r.email}: ${r.reason}`);
        });
      console.log('');
    }

    return stats;

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    throw error;
  }
}

/**
 * Parse command-line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    help: args.includes('--help') || args.includes('-h')
  };
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
User Migration Script: PostgreSQL Users → Supabase Auth

Usage:
  tsx scripts/migrate-users-to-supabase.ts [options]

Options:
  --dry-run    Preview migration without making changes
  --force      Skip confirmation prompts
  --help, -h   Show this help message

Examples:
  tsx scripts/migrate-users-to-supabase.ts --dry-run
  tsx scripts/migrate-users-to-supabase.ts --force
`);
}

/**
 * Confirm migration with user
 */
async function confirmMigration(): Promise<boolean> {
  console.log('\n⚠️  WARNING: This will migrate users to Supabase Auth.');
  console.log('   Make sure you have a backup of your database before proceeding.\n');
  
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    readline.question('Do you want to continue? (yes/no): ', (answer: string) => {
      readline.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Main entry point
 */
async function main() {
  const { dryRun, force, help } = parseArgs();

  if (help) {
    showHelp();
    process.exit(0);
  }

  try {
    // Confirm migration unless force flag is set or dry-run
    if (!force && !dryRun) {
      const confirmed = await confirmMigration();
      if (!confirmed) {
        console.log('\n❌ Migration cancelled by user\n');
        process.exit(0);
      }
    }

    // Run migration
    const stats = await runMigration(dryRun);

    // Exit with error if there were any failures
    if (stats.errors > 0) {
      console.log('⚠️  Migration completed with errors\n');
      process.exit(1);
    }

    console.log('✅ Migration completed successfully\n');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
main();
