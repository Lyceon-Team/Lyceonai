import { getSupabaseAdmin } from "../lib/supabase-admin";
import type {
  MasteryDomainNode,
  MasterySection,
  MasterySkillNode,
} from "../../../../packages/shared/src/mastery-levels";
import type { MasteryLevelLabels } from "./mastery-levels-read";
import { canonicalDomainPairs } from "./skill-catalog-read";

// ---------------------------------------------------------------------------
// Row types — match actual student_skill_mastery / student_domain_mastery columns
// ---------------------------------------------------------------------------

export interface SkillMasteryRow {
  section: string;
  domain: string | null;
  skill: string;
  mastery_level: number | null;
  computed_at: string | null;
}

export interface WeaknessQuery {
  userId: string;
  section?: string;
  limit?: number;
}

export interface SkillWeakness {
  section: string;
  domain: string | null;
  skill: string;
  /** Non-null by construction: the query selects only measured rows (see fetchWeakestSkills). */
  mastery_score: number;
  /** Non-null by construction: the formula sets score and level together. */
  mastery_level: number;
}

// ---------------------------------------------------------------------------
// Fetchers — select only columns that exist on the actual tables
// ---------------------------------------------------------------------------

/**
 * @spec [Doc 05A §7.4 — student_skill_mastery student-readable grant: section, domain, skill,
 *   mastery_level, computed_at; owner ruling 2026-08-20 RULE 4 (event_count_total is never
 *   exposed)] | @implemented [2026-08-20]
 *
 * plain English: reads the student's per-skill mastery LEVELS for one domain (or all of
 * them). `event_count_total` is no longer selected at all: nothing downstream uses it, and
 * a column that is never fetched cannot be spread into a response by a later edit. That is
 * the chokepoint form of RULE 4 — anti-leak by projection rather than by remembering to
 * delete a field.
 *
 * Errors THROW. The previous `if (error || !data) return []` turned a failed read into
 * "this student has no measured skills", which the drill-down then renders as every skill
 * unmeasured — a broken query wearing the face of a new student. Empty and failed are
 * different answers.
 */
export async function fetchSkillMasteryRows(args: {
  userId: string;
  section?: string;
  domain?: string;
}): Promise<SkillMasteryRow[]> {
  const supabase = getSupabaseAdmin();
  let q = supabase
    .from("student_skill_mastery")
    .select("section, domain, skill, mastery_level, computed_at")
    .eq("student_id", args.userId);

  if (args.section) {
    q = q.eq("section", args.section);
  }
  if (args.domain) {
    q = q.eq("domain", args.domain);
  }

  const { data, error } = await q;
  if (error) {
    throw new Error(`skill_mastery_query_failed: ${error.message}`);
  }
  return (data ?? []) as SkillMasteryRow[];
}

export interface DomainMasteryRow {
  section: string;
  domain: string;
  mastery_level: number | null;
}

/**
 * @spec [Doc 05B §5.4 — student_domain_mastery (section, domain, mastery_level) student-readable] | @implemented [2026-06-23]
 * plain English: reads the per-domain canonical rollup level so the domain status badge can
 * use the same level→status logic as skills (MA-06), instead of a synthesized score bucket.
 * Selects ONLY student-grantable columns — never the admin-only mastery_score / mastery_pct /
 * event_count_total (Doc 05B §5.2/§6.5).
 */
export async function fetchDomainMasteryRows(args: {
  userId: string;
  section?: string;
}): Promise<DomainMasteryRow[]> {
  const supabase = getSupabaseAdmin();
  let q = supabase
    .from("student_domain_mastery")
    .select("section, domain, mastery_level")
    .eq("student_id", args.userId);

  if (args.section) {
    q = q.eq("section", args.section);
  }

  const { data, error } = await q;
  if (error) {
    // Same reasoning as fetchSkillMasteryRows: a swallowed error renders as a student
    // with no domain mastery, which is indistinguishable from a real new student.
    throw new Error(`domain_mastery_query_failed: ${error.message}`);
  }
  return (data ?? []) as DomainMasteryRow[];
}

/**
 * @spec [Doc 05A §7.4 — mastery_score is the canonical DB-computed weakness signal, admin-only;
 *   Doc 05A §6.2 / Doc 05 Parent §6.6 — NULL score IS the insufficient-evidence signal]
 * | @implemented [2026-08-20]
 *
 * plain English: returns the student's measured weakest skills, ascending by the canonical
 * mastery_score. "Measured" is not a count this function decides — it is whatever the formula
 * decided when it wrote the row.
 *
 * WHY THE FILTER IS `mastery_score IS NOT NULL` AND NOT AN EVENT COUNT.
 *   The previous version filtered `event_count_total >= minAttempts` with minAttempts defaulting
 *   to 2 or 3, while MIN_EVENTS_FOR_MASTERY is 5. Rows with 2-4 events clear that filter but are
 *   deliberately unscored (Doc 05A §6.2: below the threshold the row is written with
 *   mastery_score = NULL, mastery_pct = NULL, mastery_level = NULL). `Number(null) || 0` then
 *   turned each one into 0.0 and ascending order floated them to the top — so the surface told a
 *   student their LEAST-PRACTICED skills were their WORST skills. In production that was 18 of
 *   46 skill rows.
 *
 *   Re-deriving the threshold in TypeScript is what created the drift, so this does not read
 *   MIN_EVENTS_FOR_MASTERY either. It filters on the formula's own output: a non-NULL score
 *   exists if and only if the formula judged the evidence sufficient. One decision, one place,
 *   no second copy to fall out of step. `minAttempts` is gone from the query contract entirely
 *   — a caller (including a client query string) can no longer choose the evidence bar.
 *
 * ANTI-LEAK BOUNDARY: mastery_score is DUAL-USE. This fetch reads the ALREADY-COMPUTED
 * mastery_score column directly (thin-read-surface — no recomputation from raw counts) and keeps
 * it for server-side consumers (adaptiveSelector, planner). The /weakest and /skills routes strip
 * it at serialization — the score never crosses to the client.
 *
 * Errors THROW. There is no failOnError opt-out: a query failure returning [] renders as "this
 * student has no weaknesses," which is the same fail-open shape as the NULL-to-zero coercion
 * above — an error collapsing into a legitimate-looking empty value.
 */
export async function fetchWeakestSkills(
  query: WeaknessQuery,
): Promise<SkillWeakness[]> {
  const supabase = getSupabaseAdmin();
  const limit = query.limit || 10;

  let q = supabase
    .from("student_skill_mastery")
    .select("section, domain, skill, mastery_score, mastery_level")
    .eq("student_id", query.userId)
    .not("mastery_score", "is", null)
    .order("mastery_score", { ascending: true })
    .limit(limit);

  if (query.section) {
    q = q.eq("section", query.section);
  }

  const { data, error } = await q;
  if (error) {
    throw new Error(`weakest_skills_query_failed: ${error.message}`);
  }

  return (data || []).map((row) => {
    const score = Number(row.mastery_score);
    const level = row.mastery_level;
    // Belt-and-braces on the contract the filter above establishes. If either value is
    // absent here the row is not what the formula promises, and that is a defect to
    // surface — never a zero to render.
    if (!Number.isFinite(score) || level === null || level === undefined) {
      throw new Error(
        `weakest_skills_unmeasured_row: ${row.section}/${row.domain ?? "unknown"}/${row.skill} ` +
          `passed the measured filter but carries score=${String(row.mastery_score)} ` +
          `level=${String(row.mastery_level)}`,
      );
    }
    return {
      section: row.section as string,
      domain: (row.domain as string | null) ?? null,
      skill: row.skill as string,
      mastery_score: score,
      mastery_level: Number(level),
    };
  });
}

// ---------------------------------------------------------------------------
// Level + display-name builders (owner ruling 2026-08-20 RULE 1/5/6)
//
// These replace buildMasterySkillTreeFromRows, which joined student rows against the
// hardcoded SAT_TAXONOMY. That join could never match: the taxonomy invented slugs
// (`math`/`advanced_math`/`linear_equations`) while the tables hold the canonical
// strings (`M`/`Advanced Math`/`Linear Equations in One Variable`), so every node
// resolved to NULL and the page rendered "no data" for every student regardless of
// what they had actually answered.
//
// Both builders are pure and driven from the CANONICAL side, not from the student's
// rows: a domain or skill the student has never touched still appears, carrying the
// `unmeasured` label. A missing entity is therefore visible as unmeasured rather than
// silently absent.
// ---------------------------------------------------------------------------

/**
 * @spec [Doc 05B §5.4 — student_domain_mastery is the canonical domain grain;
 *   owner ruling 2026-08-20 RULE 5 (domain first), RULE 6 (NULL is its own state)]
 * | @implemented [2026-08-20]
 *
 * plain English: one card per canonical (section, domain) pair — all eight, or the four
 * in one section — each labelled with the name of the level the formula computed. A
 * student with no events at all gets eight cards reading "Not enough answers yet",
 * which is the honest picture; returning zero cards would say the domains do not exist.
 *
 * edge cases: `mastery_level` NULL is passed to `labels.forLevel(null)` and resolves to
 * the `unmeasured` ROW. There is no `?? 0`, and no branch that could grow one.
 */
export function buildDomainLevelView(
  domainRows: DomainMasteryRow[],
  labels: MasteryLevelLabels,
  args: { section?: MasterySection } = {},
): MasteryDomainNode[] {
  const byPair = new Map<string, DomainMasteryRow>();
  for (const row of domainRows) {
    byPair.set(`${row.section}:${row.domain}`, row);
  }

  const pairs = canonicalDomainPairs().filter(
    (pair) => !args.section || pair.section === args.section,
  );

  return pairs.map((pair) => {
    const row = byPair.get(`${pair.section}:${pair.domain}`);
    const level = row?.mastery_level ?? null;
    const label = labels.forLevel(level);
    return {
      section: pair.section,
      domain: pair.domain,
      levelKey: label.levelKey,
      level: label.level,
      displayName: label.displayName,
    };
  });
}

/**
 * @spec [Doc 05A §7.4 — student_skill_mastery grain; owner ruling 2026-08-20 RULE 5
 *   (then skills), RULE 6, build question 2 answer (skill names render verbatim)]
 * | @implemented [2026-08-20]
 *
 * plain English: the skill panel for one domain. Every skill the question bank publishes
 * for that domain is present, whether or not the student has answered any of it — an
 * unmeasured skill carries the `unmeasured` label rather than being omitted, because
 * "we have not measured this yet" is information and an absent row is not.
 *
 * WHY THE UNION.
 *   The list is the catalog's skills PLUS any skill the student already has a mastery
 *   row for. Those two sets are normally identical, but they can diverge — the last
 *   published question for a skill can be retired after a student has practised it. In
 *   that case the catalog no longer lists the skill while the student's measured result
 *   still exists, and dropping it would delete evidence from their own record.
 *
 * edge cases: an empty catalog yields an empty array here; the ROUTE, not this builder,
 * is what distinguishes that from a failed read (`catalogEmpty`).
 */
export function buildSkillLevelView(
  catalogSkills: readonly string[],
  skillRows: SkillMasteryRow[],
  labels: MasteryLevelLabels,
): MasterySkillNode[] {
  const bySkill = new Map<string, SkillMasteryRow>();
  for (const row of skillRows) {
    bySkill.set(row.skill, row);
  }

  const names = new Set<string>(catalogSkills);
  for (const row of skillRows) {
    names.add(row.skill);
  }

  return [...names]
    .sort((a, b) => a.localeCompare(b, "en"))
    .map((skill) => {
      const level = bySkill.get(skill)?.mastery_level ?? null;
      const label = labels.forLevel(level);
      return {
        skill,
        levelKey: label.levelKey,
        level: label.level,
        displayName: label.displayName,
      };
    });
}
