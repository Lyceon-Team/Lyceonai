import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!SERVICE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

console.log("[Verify] SUPABASE_URL:", SUPABASE_URL);

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function main() {
  const { data: headRows, error: headErr } = await supabase
    .from("questions")
    .select("id, section, unit_tag, classification")
    .limit(5);

  if (headErr) throw headErr;

  console.log("[Verify] first 5 ids:", headRows?.map(r => r.id));

  // Count domain set via client-side scan (small table so ok)
  const { data: all, error: allErr } = await supabase
    .from("questions")
    .select("id, classification");

  if (allErr) throw allErr;

  let domainSet = 0;
  let skillIsAlgebra = 0;

  for (const r of all ?? []) {
    let c: any = null;
    if (typeof r.classification === "string") {
      try { c = JSON.parse(r.classification); } catch {}
    } else if (typeof r.classification === "object" && r.classification) {
      c = r.classification;
    }
    const dom = c?.domain ?? null;
    const skill = c?.skill ?? null;
    if (dom) domainSet++;
    if (skill === "Algebra") skillIsAlgebra++;
  }

  console.log("[Verify] total:", all?.length ?? 0);
  console.log("[Verify] classification.domain set:", domainSet);
  console.log('[Verify] classification.skill == "Algebra":', skillIsAlgebra);
}

main().catch((e) => {
  console.error("[Verify] Failed:", e?.message || e);
  process.exit(1);
});
