# G0-2 owner run steps (Windows PowerShell, or Cloud Shell)

For Karl. These steps:

1. import the real cases into `tutor_eval_cases`: the three G0-2 seeds, plus the four cases from the analysis team's Nov 3-5 review;
2. run the baseline on `lisa-default-v3`, `lisa-default-v4` and `lisa-default-v5`, 5 runs per case.

Nothing is deployed. The case list, what each case tests, and its rubric are in `Real_Case_Import_2026-11-08.md`.

- **Student text stays in production.** It goes from one production table to another and never touches git, the terminal or a log. The scripts print ids, counts, verdicts and cost only.
- **The scripts run on Windows.** Both use the `pathToFileURL` entry check (closure row R-16); with the old check they would exit silently there.
- **SQL steps against shell steps.** Steps 1, 2 and 5 are SQL in the Supabase SQL editor, the same either way. Steps 0, 3 and 4 are shell commands: PowerShell below, with a Cloud Shell (bash) variant at the end.
- **Run from `lisa`.** The import must run from a checkout of `lisa` that includes the W4-15 and W4-16 fixes. Those fixes bound friction and memory at each case's cut-off, so a replay never sees what happened after it.

## 0. Once per machine

```powershell
# From a checkout of lisa (the eval scripts and both fixes are on lisa)
git fetch origin
git checkout lisa
git pull origin lisa
pnpm install

# Vertex access for the replay and the judge: Application Default Credentials.
gcloud auth application-default login
gcloud auth application-default set-quota-project replit-cop
```

The harness uses ADC whenever no `HTTPS_PROXY` is set. Make sure none is:

```powershell
Remove-Item Env:HTTPS_PROXY, Env:HTTP_PROXY -ErrorAction SilentlyContinue
```

## 1. Confirm the eval tables exist

The migration `supabase/migrations/20261120000000_tutor_eval_cases.sql` is owner-run (retention ruled, SCL-251). Production reported 0 rows in both tables on 2026-11-05, so they exist. Confirm from the catalog in the SQL editor:

```sql
SELECT to_regclass('public.tutor_eval_cases')                          AS cases,
       to_regclass('public.tutor_eval_runs')                           AS runs,
       to_regprocedure('public.sweep_tutor_eval_retention(boolean)')   AS sweep,
       (SELECT count(*) FROM pg_policy p
          WHERE p.polrelid IN ('public.tutor_eval_cases'::regclass,
                               'public.tutor_eval_runs'::regclass))   AS policies;  -- expect 0
```

## 2. Find each case's conversation and cut-off message (SQL editor, read-only)

Run `docs/eval/lisa/real-case-finders.sql`. It holds one query per case and prints ids, times and counts, never student text. Its last two queries are per conversation:

- one lists a candidate's messages, so you can confirm it is the one the analysis team reviewed;
- the other shows whether the student has memory from before the cut-off.

Record each case's conversation id and cut-off message id in the table in `Real_Case_Import_2026-11-08.md`. The cut-off must be a **student** message with a tutor reply after it; the import refuses anything else.

## 3. Import (PowerShell; server environment, service role)

The service-role key comes from the Supabase dashboard (Project Settings → API). Paste it into the shell only, never into a chat or a file.

**Check first.** Run each import line below with `--check` added at the end, for example:

```powershell
pnpm exec tsx tests/eval/teaching-quality/import-case.ts --case G0-2-01 --conversation <conversation_id> --cutoff <student message id> --check
```

`--check` does every read, parses every row and builds the request, then stops before the write. It prints the same line as the import, starting `checked, not written`. When every case prints that line, drop `--check` and import. A row that does not parse prints the table and the field that failed, never its value.

```powershell
$env:SUPABASE_URL = "https://<project-ref>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service role key>"

pnpm exec tsx tests/eval/teaching-quality/import-case.ts --case G0-2-01 --conversation <conversation_id> --cutoff <student message id>
pnpm exec tsx tests/eval/teaching-quality/import-case.ts --case G0-2-02 --conversation <conversation_id> --cutoff <student message id>
pnpm exec tsx tests/eval/teaching-quality/import-case.ts --case G0-2-03 --conversation <conversation_id> --cutoff <student message id> --owner-case
pnpm exec tsx tests/eval/teaching-quality/import-case.ts --case G0-2-04 --conversation <conversation_id> --cutoff <student message id>
pnpm exec tsx tests/eval/teaching-quality/import-case.ts --case G0-2-05 --conversation <conversation_id> --cutoff <student message id>
pnpm exec tsx tests/eval/teaching-quality/import-case.ts --case G0-2-06 --conversation <conversation_id> --cutoff <student message id>
pnpm exec tsx tests/eval/teaching-quality/import-case.ts --case G0-2-07 --conversation <conversation_id> --cutoff <student message id>
```

Each prints one line:

- the number of messages in the window;
- pre- or post-submit;
- whether the scan key is set;
- how many memory summaries were kept, and how many were dropped as written after the cut-off.

Anything else is an error, and nothing was written.

## 4. Baseline: v3, v4 and v5 (5 runs each)

| Version | Role in this run                                                                                                                                |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| v3      | Production today                                                                                                                                |
| v4      | Adds the Desmos block                                                                                                                           |
| v5      | Adds the data boundary to v4. It is also the line that renders memory (W4-16), so the memory fix is evaluated here, never as a separate default |

Use the **Session pooler** connection string: Dashboard → Connect → Session pooler. The direct `db.<project-ref>.supabase.co` host is IPv6-only and fails on an IPv4 connection.

- The user is `postgres.<project-ref>`.
- URL-encode any special character in the password.
- `sslmode=no-verify` encrypts the connection without checking the pooler's certificate chain, which node-postgres does not carry.

```powershell
$env:DATABASE_URL = "postgresql://postgres.<project-ref>:<db password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=no-verify"

pnpm exec tsx tests/eval/teaching-quality/run-baseline.ts --runs 5 --prompt-version lisa-default-v3
pnpm exec tsx tests/eval/teaching-quality/run-baseline.ts --runs 5 --prompt-version lisa-default-v4
pnpm exec tsx tests/eval/teaching-quality/run-baseline.ts --runs 5 --prompt-version lisa-default-v5
```

Each run prints:

- the batch id;
- per-case verdict counts, leak and tool-request flags, and measured cost;
- judge-vs-Karl agreement.

The old estimate was about $0.25 per prompt version for 3 cases. With 7 cases, expect about $0.60 per version, about $1.80 for all three. Re-running with the same `--batch <id>` fills gaps without duplicating runs.

## 5. Read and grade (SQL editor)

```sql
-- One version's replies, in full (use that version's batch id from step 4).
SELECT case_id, run_index, verdict, record->>'visible_reply' AS reply
FROM public.tutor_eval_runs
WHERE batch_id = '<batch id>'
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

It prints:

- pass rates per prompt version and case;
- judge-vs-Karl agreement over every graded run.

## Retention

- Cases are kept 90 days from import (SCL-251).
- A re-import restarts the clock.
- The existing 90d retention job deletes them, and their runs, after that.

## Cloud Shell variant (bash)

[Cloud Shell](https://shell.cloud.google.com) already has `gcloud` signed in as you, and has no proxy, so the harness takes its ADC path. Run it from a fresh clone of `lisa`.

```bash
# 0. Once per Cloud Shell session
gh auth login        # or use an HTTPS token; the repository is private
git clone --branch lisa https://github.com/Lyceon-Team/Lyceonai.git
cd Lyceonai
nvm install 22 && nvm use 22                 # the repo pins Node 22
corepack enable                              # pnpm 10.33.0, from package.json's packageManager
pnpm install

gcloud config set project replit-cop
gcloud auth application-default print-access-token > /dev/null \
  || gcloud auth application-default login
gcloud auth application-default set-quota-project replit-cop
unset HTTPS_PROXY HTTP_PROXY                 # normally unset already; ADC needs it unset

# 3. Import (service-role key from Project Settings → API; type it, do not paste it into chat)
export SUPABASE_URL="https://<project-ref>.supabase.co"
read -rs SUPABASE_SERVICE_ROLE_KEY && export SUPABASE_SERVICE_ROLE_KEY
# Check first: run each line below with --check at the end; import once every case prints "checked, not written".
pnpm exec tsx tests/eval/teaching-quality/import-case.ts --case G0-2-01 --conversation <conversation_id> --cutoff <student message id>
pnpm exec tsx tests/eval/teaching-quality/import-case.ts --case G0-2-02 --conversation <conversation_id> --cutoff <student message id>
pnpm exec tsx tests/eval/teaching-quality/import-case.ts --case G0-2-03 --conversation <conversation_id> --cutoff <student message id> --owner-case
pnpm exec tsx tests/eval/teaching-quality/import-case.ts --case G0-2-04 --conversation <conversation_id> --cutoff <student message id>
pnpm exec tsx tests/eval/teaching-quality/import-case.ts --case G0-2-05 --conversation <conversation_id> --cutoff <student message id>
pnpm exec tsx tests/eval/teaching-quality/import-case.ts --case G0-2-06 --conversation <conversation_id> --cutoff <student message id>
pnpm exec tsx tests/eval/teaching-quality/import-case.ts --case G0-2-07 --conversation <conversation_id> --cutoff <student message id>

# 4. Baseline, Session pooler (the direct db.<project-ref> host fails on IPv4)
read -rs DB_PASSWORD
export DATABASE_URL="postgresql://postgres.<project-ref>:${DB_PASSWORD}@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=no-verify"
pnpm exec tsx tests/eval/teaching-quality/run-baseline.ts --runs 5 --prompt-version lisa-default-v3
pnpm exec tsx tests/eval/teaching-quality/run-baseline.ts --runs 5 --prompt-version lisa-default-v4
pnpm exec tsx tests/eval/teaching-quality/run-baseline.ts --runs 5 --prompt-version lisa-default-v5

# After grading in the SQL editor (step 5)
pnpm exec tsx tests/eval/teaching-quality/run-baseline.ts --report
```

`read -rs` keeps the key and the password out of the screen and the shell history. A password with special characters must be URL-encoded inside `DATABASE_URL`.
