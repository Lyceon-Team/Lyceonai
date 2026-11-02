#!/usr/bin/env bash
# ============================================================================
# Mutation harness for the QOTD breakdown pilot (owner brief "QOTD breakdown pilot, 2 weeks",
# Karl, 2026-11-02, Part C: "Plant a mutation that uses the original order or the canonical
# letter, and show it red"; SCL-266; re-planted 2026-11-02 for Karl's rulings on #1398: authored
# scripts approved by merge, the script's order and letter equal to the stored row at render, the
# worked examples' rules reused, am_michael, the pilot dates, the owner-run schedule export)
# ============================================================================
# @spec [owner brief "QOTD breakdown pilot, 2 weeks" (Karl, 2026-11-02), Part C; SCL-266; Karl's
#   rulings on #1398, 2026-11-02] | @implemented [2026-11-02, authored scripts 2026-11-02]
#
# plain English: each plant puts one defect into the breakdown, runs its test file and requires
# it to go RED on a NAMED assertion. The rules of the other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#            The line the plant lands on is printed (CLAUDE.md "a plant must mutate the call site
#            under test": by line number, not by pattern).
#   RULE 2 — NAMED RED. The check must fail AND its output must contain the declared substring.
#   RULE 3 — GREEN BASELINE + RESTORE. The tests are green before the plants and the files are
#            restored after each one (and on exit).
# The SQL plant (B16) edits the owner-run export, which gate Q-11 in scripts/ci/qotd-schema-gates.sql
# runs against a fresh database built from the whole migration pipeline; it is skipped (and said so)
# when no Postgres is reachable. The baseline also parses the export's real output with the Zod
# schema the authoring check reads it with.
set -uo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/qotd-breakdown-mut.XXXX)"

FILES=(
  "shared/qotd/breakdown.ts"
  "scripts/qotd-social/breakdown.ts"
  "scripts/qotd-social/check-breakdown-scripts.ts"
  "scripts/qotd-social/breakdown-schedule.sql"
  ".github/workflows/qotd-social.yml"
)
for f in "${FILES[@]}"; do mkdir -p "$BACKUPS/$(dirname "$f")"; cp "$f" "$BACKUPS/$f"; done
restore() { for f in "${FILES[@]}"; do cp "$BACKUPS/$f" "$f"; done; }
trap 'restore; rm -rf "$BACKUPS"' EXIT

ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

# plant <file> <old> <new>  — exactly one occurrence, or STALE (exit 9). Prints file:line.
plant() {
  python3 - "$1" "$2" "$3" <<'PY'
import io, sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(p, encoding="utf-8").read()
n = s.count(old)
if n != 1:
    sys.stderr.write("STALE: target found %d times in %s (expected exactly 1)\n" % (n, p))
    sys.exit(9)
print("        planted at %s:%d" % (p, s[: s.index(old)].count("\n") + 1))
io.open(p, "w", encoding="utf-8").write(s.replace(old, new))
PY
}

TEST=tests/ci/qotd-breakdown.test.ts
ts_check() { pnpm exec vitest run "$TEST" 2>&1; }

# expect_red <name> <expected substring> <output> <rc>
expect_red() {
  if [ "$4" = 0 ]; then bad "$1: check stayed GREEN (the plant was not caught)"; return; fi
  case "$3" in
    *"$2"*) ok "$1: red on \"$2\"" ;;
    *) bad "$1: red, but not on \"$2\""; echo "$3" | tail -25 ;;
  esac
}

# ts_plant <name> <file> <old> <new> <expected>
ts_plant() {
  plant "$2" "$3" "$4" || { bad "$1 STALE"; restore; return; }
  OUT="$(ts_check)"; RC=$?
  expect_red "$1" "$5" "$OUT" "$RC"
  restore
}

# The SQL check: a fresh database from the whole pipeline, then the QOTD gates (Q-11 runs the
# export as written). With $1 set, the export's JSON is also written to that file.
DB=qotd_breakdown_mutations
HAVE_PG=1
if ! pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null; then HAVE_PG=0; fi
sql_check() {
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null 2>&1 || return 2
  psql -v ON_ERROR_STOP=1 -q -d "$DB" >/dev/null 2>&1 <<'SQL' || return 2
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
SQL
  for f in supabase/migrations/*.sql; do
    psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null 2>&1 || { echo "pipeline failed at $f"; return 2; }
  done
  if [ -n "${1:-}" ]; then
    psql -v ON_ERROR_STOP=1 -v breakdown_export_out="$1" -d "$DB" -f scripts/ci/qotd-schema-gates.sql 2>&1
  else
    psql -v ON_ERROR_STOP=1 -d "$DB" -f scripts/ci/qotd-schema-gates.sql 2>&1
  fi
}

# sql_plant <name> <old> <new> <expected>  (the file is the export)
sql_plant() {
  if [ "$HAVE_PG" = 0 ]; then echo "  SKIP  $1 (no Postgres)"; return; fi
  plant scripts/qotd-social/breakdown-schedule.sql "$2" "$3" || { bad "$1 STALE"; restore; return; }
  OUT="$(sql_check)"; RC=$?
  expect_red "$1" "$4" "$OUT" "$RC"
  restore
}

echo "=== (0) GREEN BASELINE ==="
OUT="$(ts_check)"; RC=$?
[ "$RC" = 0 ] && ok "breakdown tests green" || { bad "breakdown tests not green"; echo "$OUT" | tail -30; }
if [ "$HAVE_PG" = 1 ]; then
  EXPORT_JSON="$BACKUPS/export.json"
  OUT="$(sql_check "$EXPORT_JSON")"; RC=$?
  [ "$RC" = 0 ] && ok "QOTD gates green (Q-11 runs the export)" || { bad "QOTD gates not green"; echo "$OUT" | tail -30; }
  # Real output through the Zod schema the authoring check parses it with.
  OUT="$(pnpm exec tsx -e '
    import { readFileSync } from "node:fs";
    import { qotdBreakdownScheduleSchema } from "./packages/shared/src/qotd-breakdown-schema";
    const rows = qotdBreakdownScheduleSchema.parse(JSON.parse(readFileSync(process.argv[1] ?? "", "utf8")));
    if (rows.length < 5) throw new Error(`only ${rows.length} rows`);
    console.log(`export parsed: ${rows.length} rows`);
  ' "$EXPORT_JSON" 2>&1)"; RC=$?
  [ "$RC" = 0 ] && ok "the export's real output parses with qotdBreakdownScheduleSchema ($OUT)" || { bad "the export's output does not parse"; echo "$OUT" | tail -20; }
else
  echo "  SKIP  SQL baseline (no Postgres at $PGHOST:$PGPORT)"
fi
if [ "$FAIL" -gt 0 ]; then echo "QOTD BREAKDOWN MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

echo "=== the hard rule: the stored order and the stored letter ==="
ts_plant "B1 the question's original (canonical) order instead of the stored one" shared/qotd/breakdown.ts \
  "    const option = q.options[k];" \
  "    const option = [...q.options].sort((x, y) => x.id.localeCompare(y.id))[k];" \
  "letters the choices by the stored order and keys the answer on the stored letter"
ts_plant "B2 the canonical letter instead of the stored display letter" shared/qotd/breakdown.ts \
  "      correct_answer: stored," \
  "      correct_answer: q.correct_option_id ?? stored," \
  "letters the choices by the stored order and keys the answer on the stored letter"
ts_plant "B3 the stored-letter check dropped (a mismatched day rendered)" shared/qotd/breakdown.ts \
  "    shown !== stored" "    false" \
  "refuses a day whose stored letter is not where the correct choice is shown"
ts_plant "B5 the script's order not compared with the stored row" shared/qotd/breakdown.ts \
  '  if (script.option_order.join(",") !== question.option_order.join(","))' "  if (false)" \
  "the approved script names the stored row"
ts_plant "B6 the script's letter not compared with the stored row" shared/qotd/breakdown.ts \
  "  if (script.correct_display_letter !== question.correct_answer)" "  if (false)" \
  "the approved script names the stored row"
ts_plant "B7 the render ignores the hard rule" scripts/qotd-social/breakdown.ts \
  '  if (order) return skipped(date, postedOn, "order_mismatch", [order]);' "" \
  "at render, a script whose order or letter differs from the stored row is order_mismatch"

echo "=== anti-leak: today refused; the export ==="
ts_plant "B4 today's QOTD accepted (the past-day check skipped)" scripts/qotd-social/breakdown.ts \
  "  const problem = pastDateProblem(date, now);" "  const problem: string | null = null;" \
  "today's QOTD is refused"
ts_plant "B8 the export read from inside the repository" scripts/qotd-social/check-breakdown-scripts.ts \
  "  if (inside !== null)" "  if (false)" \
  "refuses to read the export from inside a checkout"
ts_plant "B9 an export value printed in a mismatch" scripts/qotd-social/check-breakdown-scripts.ts \
  '        out.push("option_order differs from the schedule export");' \
  '        out.push(`option_order differs from the schedule export (${row.option_order.join(",")})`);' \
  "a script that differs from the export is named by field only"
sql_plant "B16 the export reaches past the 7 days (or today)" \
  "   AND s.qotd_date <= public.qotd_today() + 7" "   AND s.qotd_date <= public.qotd_today() + 30" \
  "Q-11 the export holds"
sql_plant "B17 the export carries the canonical key" \
  "             'correct_display_letter', s.correct_display_letter," \
  "             'correct_display_letter', s.correct_display_letter, 'correct_answer', q.correct_answer," \
  "Q-11 an export row carries other keys than the five"

echo "=== the authored script: approval, rules, voice ==="
ts_plant "B10 no approval asked (any script on social renders)" scripts/qotd-social/breakdown.ts \
  "  if (!approved.ok)" "  if (false)" \
  "a script Karl did not merge is no_approved_script"
ts_plant "B11 the worked examples' script rules not run at render" scripts/qotd-social/breakdown.ts \
  "  const content = scriptProblems(script, question);" "  const content: string[] = [];" \
  "a setup that reads the question aloud is content_rules (S1)"
ts_plant "B12 the committed voice not checked against its text (result discarded)" scripts/qotd-social/check-breakdown-scripts.ts \
  "    problems.push(
      ...voiceProblems(entry.script, manifest, kit, (file) =>" \
  "    problems.concat(
      ...voiceProblems(entry.script, manifest, kit, (file) =>" \
  "the committed voice: am_michael, and every line voiced from the text it has now"
ts_plant "B13 a voice other than am_michael accepted" scripts/qotd-social/check-breakdown-scripts.ts \
  "    if (manifest.voice !== QOTD_BREAKDOWN_VOICE_PROFILE)" "    if (false)" \
  "the committed voice: am_michael, and every line voiced from the text it has now"
ts_plant "B14 a grid-in let through (rule c)" shared/qotd/breakdown.ts \
  '  if (unreadable === "not_multiple_choice") return "grid_in";' "" \
  "a grid-in, a long passage, a paired passage"

echo "=== captions, window, workflow ==="
ts_plant "B15 the music credit dropped from the TikTok caption (CC BY 4.0)" shared/qotd/breakdown.ts \
  "  const caption = socialTiktokCaption(headline, test, section, [musicCredit]);" \
  "  const caption = socialTiktokCaption(headline, test, section, []);" \
  "each caption is the canonical builder's output with the credit last"
ts_plant "B18 the pilot dates moved off Karl's ruling" shared/qotd/breakdown.ts \
  '  qotdBreakdownPilotSchema.parse({ start: "2026-11-09", end: "2026-11-22" });' \
  '  qotdBreakdownPilotSchema.parse({ start: "2026-11-08", end: "2026-11-21" });' \
  "is set to Karl's dates, posting days, 14 inclusive"
ts_plant "B19 the pilot never ends" shared/qotd/breakdown.ts \
  '  if (postedOn > pilot.end) return "ended";' "" \
  "is set to Karl's dates, posting days, 14 inclusive"
ts_plant "B20 the breakdown blocks the QOTD (inside its job)" .github/workflows/qotd-social.yml \
  "    needs: assets"$'\n'"    if: always()" "    needs: assets" \
  "runs after the QOTD job, whatever its result"
ts_plant "B21 voicing back in CI" .github/workflows/qotd-social.yml \
  "      # Yesterday's answer slide (the carousel's slide 3) for the fallback, from the QOTD run." \
  "      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: \"3.11\"

      # Yesterday's answer slide (the carousel's slide 3) for the fallback, from the QOTD run." \
  "no voicing at render: no Python, no pip, no voice models, no clone"

echo
echo "qotd-breakdown mutations: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then echo "QOTD BREAKDOWN MUTATIONS: FAIL"; exit 1; fi
echo "QOTD BREAKDOWN MUTATIONS: PASS"
