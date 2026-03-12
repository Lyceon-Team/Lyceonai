import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL (or VITE_SUPABASE_URL)");
if (!SERVICE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE)");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const APPLY = process.argv.includes("--apply");
const LIMIT = Number(process.env.BACKFILL_LIMIT || 5000);
const BATCH = Number(process.env.BACKFILL_BATCH || 200);

function parseTags(tags: unknown): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) {
    return tags.map(String).map((t) => t.trim()).filter(Boolean);
  }
  return [];
}

function parseTaggedValue(tags: string[], prefix: string): string | null {
  const hit = tags.find((t) => t.toLowerCase().startsWith(`${prefix.toLowerCase()}:`));
  if (!hit) return null;
  const value = hit.slice(prefix.length + 1).trim();
  return value.length > 0 ? value : null;
}

function toSkillCode(sectionCode: string | null, domain: string | null, skill: string | null): string | null {
  if (!sectionCode || !domain || !skill) return null;
  const section = sectionCode === "MATH" ? "MATH" : "RW";
  const left = domain.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  const right = skill.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  if (!left || !right) return null;
  return `${section}.${left}.${right}`;
}

async function main() {
  console.log(`[Backfill Taxonomy] apply=${APPLY} limit=${LIMIT} batch=${BATCH}`);

  const { data, error } = await supabase
    .from("questions")
    .select("id, section_code, domain, skill, subskill, skill_code, tags")
    .limit(LIMIT);

  if (error) throw error;
  if (!data || data.length === 0) {
    console.log("[Backfill Taxonomy] No questions found.");
    return;
  }

  const updates: Array<{ id: string; domain: string | null; skill: string | null; subskill: string | null; skill_code: string | null }> = [];

  for (const row of data as any[]) {
    const tags = parseTags(row.tags);

    const tagDomain = parseTaggedValue(tags, "domain");
    const tagSkill = parseTaggedValue(tags, "skill");
    const tagSubskill = parseTaggedValue(tags, "subskill");

    const domain = row.domain ?? tagDomain ?? null;
    const skill = row.skill ?? tagSkill ?? null;
    const subskill = row.subskill ?? tagSubskill ?? null;
    const skill_code = row.skill_code ?? toSkillCode(row.section_code ?? null, domain, skill);

    const changed =
      (row.domain ?? null) !== (domain ?? null) ||
      (row.skill ?? null) !== (skill ?? null) ||
      (row.subskill ?? null) !== (subskill ?? null) ||
      (row.skill_code ?? null) !== (skill_code ?? null);

    if (!changed) continue;

    updates.push({
      id: row.id,
      domain,
      skill,
      subskill,
      skill_code,
    });
  }

  console.log(`[Backfill Taxonomy] rows=${data.length} updates=${updates.length}`);
  console.log("[Backfill Taxonomy] sample:", updates.slice(0, 5));

  if (!APPLY) {
    console.log("[Backfill Taxonomy] Dry-run only. Re-run with --apply to write.");
    return;
  }

  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    for (const item of chunk) {
      const { error: upErr } = await supabase
        .from("questions")
        .update({
          domain: item.domain,
          skill: item.skill,
          subskill: item.subskill,
          skill_code: item.skill_code,
        })
        .eq("id", item.id);
      if (upErr) throw upErr;
    }
    console.log(`[Backfill Taxonomy] wrote ${Math.min(i + BATCH, updates.length)}/${updates.length}`);
  }

  console.log("[Backfill Taxonomy] Done.");
}

main().catch((e) => {
  console.error("[Backfill Taxonomy] Failed:", e?.message || e);
  process.exit(1);
});