# User Migration Guide: PostgreSQL → Supabase Auth

This guide explains how to migrate existing users from the legacy PostgreSQL `users` table to Supabase Auth.

## Prerequisites

1. **Environment Variables**: Ensure these are set in your `.env` file:
   ```bash
   SUPABASE_URL=your_supabase_project_url
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   DATABASE_URL=your_postgresql_connection_string
   ```

2. **Backup**: Create a database backup before running the migration:
   ```bash
   pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql
   ```

3. **Supabase Setup**: Ensure the Supabase database schema is deployed:
   ```bash
   # Run the Supabase schema migration
   psql $SUPABASE_DATABASE_URL < database/supabase-auth-only.sql
   ```

## Migration Process

The migration script (`migrate-users-to-supabase.ts`) performs the following steps for each user:

1. **Fetch Users**: Retrieves all users from the legacy `users` table
2. **Check Existence**: Verifies if the user already exists in Supabase Auth
3. **Create Auth User**: Creates user in Supabase Auth (`auth.users` table)
4. **Create Profile**: Creates corresponding entry in `profiles` table
5. **Report**: Generates a detailed migration report

## Usage

### 1. Dry Run (Preview Only)

Preview the migration without making any changes:

```bash
tsx scripts/migrate-users-to-supabase.ts --dry-run
```

This will show you:
- Total number of users to migrate
- Which users would be created
- Which users would be skipped (already exist, no email, etc.)

### 2. Interactive Migration

Run the migration with confirmation prompt:

```bash
tsx scripts/migrate-users-to-supabase.ts
```

You'll be asked to confirm before proceeding.

### 3. Force Migration

Run without confirmation prompts (use with caution):

```bash
tsx scripts/migrate-users-to-supabase.ts --force
```

## Migration Report

After running, you'll see a summary like this:

```
📈 MIGRATION SUMMARY
============================================================
Total users:     21
✅ Success:      18
⏭️  Skipped:      2
❌ Errors:       1
============================================================
```

### Success
Users successfully migrated to Supabase Auth with profiles created.

### Skipped
Users that were not migrated, typically because:
- User already exists in Supabase Auth
- User has no email address
- User is a test/system account

### Errors
Users that failed to migrate. Check the error details for specific reasons:
- Invalid email format
- Duplicate email
- Database connection issues
- Permission errors

## Password Handling

⚠️ **IMPORTANT: Password Reset Required**

Due to incompatible password hashing between the legacy system (bcrypt) and Supabase Auth, migrated password-based users **cannot use their old passwords**. The migration script handles this as follows:

- **Password-based users**: 
  - A random temporary password is generated during migration
  - User metadata is flagged with `requires_password_reset: true`
  - Users must reset their password on first login using "Forgot Password"
  - Email with password reset link should be sent to all migrated users
  
- **Google OAuth users**: 
  - Linked to their Google account via `google_id` metadata
  - Can login immediately using "Sign in with Google"
  - No password reset required
  
- **Mixed auth users**: 
  - Users with both password and Google ID are prioritized for Google OAuth
  - Can login using "Sign in with Google" or reset password

## Post-Migration Steps

1. **Verify Migration**: Check Supabase dashboard to confirm users were created
   ```bash
   # Count users in Supabase Auth
   psql $SUPABASE_DATABASE_URL -c "SELECT COUNT(*) FROM auth.users;"
   
   # Count profiles
   psql $SUPABASE_DATABASE_URL -c "SELECT COUNT(*) FROM public.profiles;"
   ```

2. **Send Password Reset Emails**: All password-based users need to reset their passwords
   ```bash
   # Use Supabase dashboard or API to send password reset emails
   # Or create a script to send reset links to all migrated users
   ```

3. **Test Authentication**: 
   - Try logging in as a Google OAuth user (should work immediately)
   - Try password reset flow for password-based users
   - Verify admin users have correct role/permissions

4. **Update Frontend**: Ensure the frontend is using Supabase Auth endpoints

5. **Disable Legacy Auth**: Once migration is complete and verified, disable old auth routes

6. **Archive Legacy Table**: After successful migration and testing:
   ```sql
   -- Rename the old table (don't drop yet!)
   ALTER TABLE users RENAME TO users_legacy_backup;
   ```

## Rollback

If something goes wrong:

1. **Restore Database Backup**:
   ```bash
   psql $DATABASE_URL < backup_YYYYMMDD_HHMMSS.sql
   ```

2. **Delete Supabase Users** (if needed):
   ```sql
   -- Connect to Supabase
   DELETE FROM auth.users WHERE created_at > 'YYYY-MM-DD HH:MM:SS';
   ```

3. **Re-enable Legacy Auth**: Revert any code changes that disabled old auth

## Troubleshooting

### "User already exists" errors
This is normal if you've run the migration before. The script skips existing users.

### "No email address" errors
Some users might not have email addresses. Decide if these users should be migrated manually or archived.

### Permission denied errors
Ensure your `SUPABASE_SERVICE_ROLE_KEY` has admin permissions.

### Database connection errors
Verify your `SUPABASE_URL` and `DATABASE_URL` environment variables are correct.

## Support

For issues or questions about the migration:
1. Check the migration report for specific error messages
2. Review the Supabase Auth logs
3. Check the application logs for authentication errors
4. Contact the development team for assistance

## Safety Notes

- ⚠️ **Always run a dry-run first** to preview the migration
- ⚠️ **Always backup the database** before running the migration
- ⚠️ **Test with a few users first** before migrating all users
- ⚠️ **Don't delete legacy data immediately** - keep it for at least 30 days after migration
- ⚠️ **Verify authentication works** before disabling legacy auth system
