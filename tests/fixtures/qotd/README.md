# Question of the Day fixture

`rows.json` is real output of `public.qotd_archive()` and `public.qotd_question_for(NULL)`, read
from a database built from `supabase/migrations` and seeded with `seed.sql` (four original example
questions, not bank content) on 2026-10-05, America/Chicago. Tests that need a QOTD row read it
from here instead of hand-writing one (CLAUDE.md, "derive the fixture from real output");
`tests/lib/qotd-fixture.ts` loads it.

To regenerate, after a migration changes either function's columns, on a scratch database
with the migration pipeline applied and `qotd_today()` = 2026-10-05 (or adjust the dates in
`seed.sql`):

```bash
psql -v ON_ERROR_STOP=1 -d <scratch_db> -f tests/fixtures/qotd/seed.sql
psql -d <scratch_db> -tAc "select json_build_object('generated_on', public.qotd_today(),
  'archive', (select coalesce(json_agg(t), '[]'::json) from public.qotd_archive() t),
  'today',   (select coalesce(json_agg(t), '[]'::json) from public.qotd_question_for(NULL) t))" \
  | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin), indent=2))" \
  > tests/fixtures/qotd/rows.json
```
