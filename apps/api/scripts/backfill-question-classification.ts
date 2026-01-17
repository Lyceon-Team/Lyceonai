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

const MATH_DOMAINS = new Set(["Algebra", "Advanced Math", "Problem Solving & Data Analysis", "Geometry & Trigonometry"]);
const RW_DOMAINS = new Set(["Information and Ideas", "Craft and Structure", "Expression of Ideas", "Standard English Conventions"]);

function norm(s: string) {
  return s.trim().toLowerCase();
}

function parseTags(tags: any): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map(String).map(t => t.trim()).filter(Boolean);
  if (typeof tags === "string") {
    // JSON array string OR comma-separated string
    try {
      const j = JSON.parse(tags);
      if (Array.isArray(j)) return j.map(String).map(t => t.trim()).filter(Boolean);
    } catch {}
    return tags.split(",").map(t => t.trim()).filter(Boolean);
  }
  return [];
}

function parseClassification(classification: any): any | null {
  if (!classification) return null;
  if (typeof classification === "object") return classification;
  if (typeof classification === "string") {
    try {
      return JSON.parse(classification);
    } catch {
      return null;
    }
  }
  return null;
}

function mapRwDomainTag(raw: string): string | null {
  const d = norm(raw);
  if (d === "conventions") return "Standard English Conventions";
  if (d === "expression") return "Expression of Ideas";
  if (d === "craft") return "Craft and Structure";
  if (d === "information") return "Information and Ideas";
  return null;
}

function titleish(s: string) {
  const t = s.trim();
  if (!t) return t;
  // keep dot-paths as-is (rw.conventions.boundaries)
  if (t.includes(".")) return t;
  return t
    .split(/\s+/)
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function deriveDeterministic(opts: {
  section: string | null;
  unit_tag: string | null;
  tags: string[];
  existing: any | null;
}): { domain: string | null; skill: string | null; subskill: string | null; source: string } {
  const { section, unit_tag, tags, existing } = opts;

  // Keep existing valid domain
  const existingDomain = existing?.domain ? String(existing.domain).trim() : null;
  const existingSkill = existing?.skill ? String(existing.skill).trim() : null;
  const existingSubskill = existing?.subskill ? String(existing.subskill).trim() : null;

  if (existingDomain && (MATH_DOMAINS.has(existingDomain) || RW_DOMAINS.has(existingDomain))) {
    return { domain: existingDomain, skill: existingSkill ?? null, subskill: existingSubskill ?? null, source: "keep-existing" };
  }

  // Tags: domain:*, skill:*, subskill:*
  const domainTag = tags.find(t => norm(t).startsWith("domain:"));
  const skillTag = tags.find(t => norm(t).startsWith("skill:"));
  const subskillTag = tags.find(t => norm(t).startsWith("subskill:"));

  const rawDomain = domainTag ? domainTag.split(":").slice(1).join(":").trim() : null;
  const rawSkill = skillTag ? skillTag.split(":").slice(1).join(":").trim() : null;
  const rawSubskill = subskillTag ? subskillTag.split(":").slice(1).join(":").trim() : null;

  if (rawDomain) {
    const mapped = mapRwDomainTag(rawDomain);
    if (mapped) {
      return {
        domain: mapped,
        skill: rawSkill ? titleish(rawSkill) : null,
        subskill: rawSubskill ? titleish(rawSubskill) : null,
        source: "tags",
      };
    }
  }

  const ut = (unit_tag || "").trim();
  const utNorm = norm(ut);
  const sec = section ? norm(section) : "";

  // If unit_tag is just a domain label, treat it as domain-only (not a skill)
  if (sec === "math") {
    if (ut === "Algebra") return { domain: "Algebra", skill: null, subskill: null, source: "unit_tag:domain-only" };
    if (ut === "Advanced Math") return { domain: "Advanced Math", skill: null, subskill: null, source: "unit_tag:domain-only" };
    if (ut === "Problem Solving & Data Analysis") return { domain: "Problem Solving & Data Analysis", skill: null, subskill: null, source: "unit_tag:domain-only" };
    if (ut === "Geometry & Trigonometry") return { domain: "Geometry & Trigonometry", skill: null, subskill: null, source: "unit_tag:domain-only" };
  }

  // If unit_tag looks like "Domain: Skill"
  if (ut.includes(":")) {
    const [left, ...rest] = ut.split(":");
    const leftNorm = norm(left);
    const right = rest.join(":").trim() || null;

    const mappedMath =
      leftNorm.includes("algebra") ? "Algebra" :
      leftNorm.includes("advanced") ? "Advanced Math" :
      (leftNorm.includes("problem solving") || leftNorm.includes("data analysis")) ? "Problem Solving & Data Analysis" :
      (leftNorm.includes("geometry") || leftNorm.includes("trigonometry")) ? "Geometry & Trigonometry" :
      null;

    if (mappedMath) return { domain: mappedMath, skill: right ? right : null, subskill: null, source: "unit_tag:colon" };
  }

  // Section Math: keyword mapping on unit_tag
  if (sec === "math") {
    const mapped =
      utNorm.includes("algebra") ? "Algebra" :
      utNorm.includes("advanced") || utNorm.includes("quadratic") || utNorm.includes("polynomial") || utNorm.includes("function") ? "Advanced Math" :
      utNorm.includes("problem solving") || utNorm.includes("data analysis") || utNorm.includes("probability") || utNorm.includes("interpretation") ? "Problem Solving & Data Analysis" :
      utNorm.includes("geometry") || utNorm.includes("trigonometry") || utNorm.includes("circle") || utNorm.includes("triangle") ? "Geometry & Trigonometry" :
      null;

    if (mapped) {
      const skillCandidate = ut && ut !== mapped ? ut : null;
      return { domain: mapped, skill: skillCandidate, subskill: null, source: "unit_tag:math-keywords" };
    }
    return { domain: null, skill: ut || null, subskill: null, source: "math-unknown-domain" };
  }

  // Section Reading: without explicit tags we can't confidently map to the 4 RW domains yet.
  if (sec === "reading") {
    return { domain: null, skill: ut || null, subskill: null, source: "reading-unknown-domain" };
  }

  return { domain: null, skill: ut || null, subskill: null, source: "unknown" };
}

async function main() {
  console.log(`[Backfill] apply=${APPLY} limit=${LIMIT} batch=${BATCH}`);

  // Pull candidates
  const { data, error } = await supabase
    .from("questions")
    .select("id, section, unit_tag, tags, classification")
    .limit(LIMIT);

  if (error) throw error;
  if (!data || data.length === 0) {
    console.log("[Backfill] No questions found.");
    return;
  }

  let updates = 0;
  let domainFilled = 0;
  let skillFilled = 0;

  const payload: { id: string; classification: string }[] = [];

  for (const row of data as any[]) {
    const tags = parseTags(row.tags);
    const existing = parseClassification(row.classification);

    const derived = deriveDeterministic({
      section: row.section,
      unit_tag: row.unit_tag,
      tags,
      existing,
    });

    const next = {
      ...(existing || {}),
      domain: derived.domain ?? (existing?.domain ?? null),
      skill: derived.skill ?? (existing?.skill ?? null),
      subskill: derived.subskill ?? (existing?.subskill ?? null),
      source: derived.source,
      updated_by: "backfill-question-classification",
      updated_at: new Date().toISOString(),
    };

    const beforeDomain = existing?.domain ?? null;
    const beforeSkill = existing?.skill ?? null;
    const beforeSubskill = existing?.subskill ?? null;

    const changed =
      (beforeDomain ?? null) !== (next.domain ?? null) ||
      (beforeSkill ?? null) !== (next.skill ?? null) ||
      (beforeSubskill ?? null) !== (next.subskill ?? null);

    if (!changed) continue;

    updates++;
    if (!beforeDomain && next.domain) domainFilled++;
    if (!beforeSkill && next.skill) skillFilled++;

    payload.push({ id: row.id, classification: JSON.stringify(next) });
  }

  console.log(`[Backfill] rows=${data.length} updates=${updates} domainFilled=${domainFilled} skillFilled=${skillFilled}`);
  console.log("[Backfill] sample:", payload.slice(0, 5));

  if (!APPLY) {
    console.log("[Backfill] Dry-run only. Re-run with --apply to write.");
    return;
  }

  for (let i = 0; i < payload.length; i += BATCH) {
    const chunk = payload.slice(i, i + BATCH);
    for (const item of chunk) {
      const { error: upErr } = await supabase
        .from("questions")
        .update({ classification: item.classification })
        .eq("id", item.id);
      if (upErr) throw upErr;
    }
    console.log(`[Backfill] wrote ${Math.min(i + BATCH, payload.length)}/${payload.length}`);
  }

  console.log("[Backfill] Done.");
}

main().catch((e) => {
  console.error("[Backfill] Failed:", e?.message || e);
  process.exit(1);
});
