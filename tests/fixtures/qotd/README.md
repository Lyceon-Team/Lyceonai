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
# pin "today" (a scratch database only):
psql -d <scratch_db> -c "CREATE OR REPLACE FUNCTION public.qotd_today() RETURNS date LANGUAGE sql STABLE AS \$\$ SELECT DATE '2026-10-05' \$\$"
psql -v ON_ERROR_STOP=1 -d <scratch_db> -f tests/fixtures/qotd/seed.sql
psql -d <scratch_db> -tAc "select json_build_object('generated_on', public.qotd_today(),
  'archive', (select coalesce(json_agg(t), '[]'::json) from public.qotd_archive() t),
  'today',   (select coalesce(json_agg(t), '[]'::json) from public.qotd_question_for(NULL) t))" \
  | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin), indent=2))" \
  > tests/fixtures/qotd/rows.json
```

Since SCL-258 (2026-10-28) each row also carries `option_order` and `correct_display_letter`,
written by `qotd_schedule_insert` from the seeded shuffle. The seed days come out as
`{B,C,A,D}` (answer B shown as A), `{C,B,D,A}` (answer C shown as A), a grid-in (`{}`), and
`{D,B,C,A}` (answer C shown as C), so the fixture has shuffled days whose letter moved and one
whose letter happens to stay put.
