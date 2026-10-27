# G0-2 owner run steps (Windows, PowerShell)

For Karl. These steps import the three seed conversations into `tutor_eval_cases`, then run the baseline on `lisa-default-v3` and on `lisa-default-v4`, 5 runs per case. Nothing is deployed.

- Student text goes from one production table to another. It never touches git, the terminal or a log: the scripts print ids, counts, verdicts and cost only.
- Both scripts use the `pathToFileURL` entry check (closure row R-16), so they run on Windows. With the old check they would exit silently there.

## 0. Once per machine

```powershell
# From a checkout of the PR branch
git fetch origin
git checkout claude/lisa-g0-2-teaching-quality-design
pnpm install

# Vertex access for the replay and the judge: Application Default Credentials.
gcloud auth application-default login
gcloud auth application-default set-quota-project replit-cop
```

The harness uses ADC whenever no `HTTPS_PROXY` is set. Make sure none is:

```powershell
Remove-Item Env:HTTPS_PROXY, Env:HTTP_PROXY -ErrorAction SilentlyContinue
```

## 1. Apply the migration

Apply `supabase/migrations/20261118000000_tutor_eval_cases.sql` the usual way (owner-run; retention ruled, SCL-251). Then confirm it from the catalog in the SQL editor:

```sql
SELECT to_regclass('public.tutor_eval_cases')                          AS cases,
       to_regclass('public.tutor_eval_runs')                           AS runs,
       to_regprocedure('public.sweep_tutor_eval_retention(boolean)')   AS sweep,
       (SELECT count(*) FROM pg_policy p
          WHERE p.polrelid IN ('public.tutor_eval_cases'::regclass,
                               'public.tutor_eval_runs'::regclass))   AS policies;  -- expect 0
```

## 2. Find each case's conversation and cut-off message (SQL editor, read-only)

```sql
-- G0-2-01 / G0-2-02: by student and day (the name stays in the SQL editor).
SELECT c.id AS conversation_id, c.entry_mode, c.source_surface, c.source_question_canonical_id
FROM public.tutor_conversations c
JOIN public.profiles p ON p.id = c.student_id
WHERE p.display_name = '<student display name>'
  AND c.created_at >= '<YYYY-MM-DD>' AND c.created_at < '<YYYY-MM-DD +1>';

-- G0-2-03: your own test on SATM2UYVX9I.
SELECT DISTINCT m.conversation_id
FROM public.tutor_messages m
WHERE m.source_question_canonical_id = 'SATM2UYVX9I'
  AND m.created_at BETWEEN '2026-10-27 04:07:00+00' AND '2026-10-27 04:10:59+00';

-- Then, per conversation: pick the STUDENT message that asks for Desmos (the cut-off).
SELECT m.id, m.role, m.created_at, left(m.message, 80) AS starts
FROM public.tutor_messages m
WHERE m.conversation_id = '<conversation_id>'
ORDER BY m.created_at;
```

## 3. Import (PowerShell; server environment, service role)

The service-role key comes from the Supabase dashboard (Project Settings → API). Paste it into the shell only, never into a chat or a file.

```powershell
$env:SUPABASE_URL = "https://<project-ref>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service role key>"

pnpm exec tsx tests/eval/teaching-quality/import-case.ts --case G0-2-01 --conversation <conversation_id> --cutoff <student message id>
pnpm exec tsx tests/eval/teaching-quality/import-case.ts --case G0-2-02 --conversation <conversation_id> --cutoff <student message id>
pnpm exec tsx tests/eval/teaching-quality/import-case.ts --case G0-2-03 --conversation <conversation_id> --cutoff <student message id> --owner-case
```

Each prints one line: the number of messages in the window, pre- or post-submit, and whether the scan key is set. Anything else is an error, and nothing was written.

## 4. Baseline: v3, then v4 (5 runs each)

Use the **Session pooler** connection string: Dashboard → Connect → Session pooler. The direct `db.<project-ref>.supabase.co` host is IPv6-only and fails on an IPv4 connection.

- The user is `postgres.<project-ref>`.
- URL-encode any special character in the password.
- `sslmode=no-verify` encrypts the connection without checking the pooler's certificate chain, which node-postgres does not carry.

```powershell
$env:DATABASE_URL = "postgresql://postgres.<project-ref>:<db password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=no-verify"

pnpm exec tsx tests/eval/teaching-quality/run-baseline.ts --runs 5 --prompt-version lisa-default-v3
pnpm exec tsx tests/eval/teaching-quality/run-baseline.ts --runs 5 --prompt-version lisa-default-v4
```

Each run prints:

- the batch id;
- per-case verdict counts, leak and tool-request flags, and measured cost;
- judge-vs-Karl agreement.

Expect about $0.25 per prompt version (measured on the synthetic set). Re-running with the same `--batch <id>` fills gaps without duplicating runs.

## 5. Read and grade (SQL editor)

```sql
-- The v4 replies, in full (use the v4 batch id from step 4).
SELECT case_id, run_index, verdict, record->>'visible_reply' AS reply
FROM public.tutor_eval_runs
WHERE batch_id = '<v4 batch id>'
ORDER BY case_id, run_index;

-- Your grade for one run (pass / fail / review_needed), before looking at the judge's verdict.
UPDATE public.tutor_eval_runs
   SET owner_grade = '<pass|fail|review_needed>', owner_graded_at = now()
 WHERE run_id = '<run_id>';
```

Then, without replaying anything:

```powershell
pnpm exec tsx tests/eval/teaching-quality/run-baseline.ts --report
```

It prints pass rates per prompt version and case, and judge-vs-Karl agreement over every graded run.

## Retention

Cases are kept 90 days from import (SCL-251); a re-import restarts the clock. The existing 90d retention job deletes them, and their runs, after that.
