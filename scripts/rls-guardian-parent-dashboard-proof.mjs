import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const ACCESS_TOKEN = process.env.GUARDIAN_ACCESS_TOKEN;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_ANON_KEY env vars.");
  process.exit(1);
}
if (!ACCESS_TOKEN) {
  console.error("Missing GUARDIAN_ACCESS_TOKEN env var.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } },
});

const STUDENT_EMAIL = "nevesamanda98@gmail.com";

function summarizeErr(err) {
  if (!err) return null;
  return {
    message: err.message ?? null,
    code: err.code ?? null,
    details: err.details ?? null,
    hint: err.hint ?? null,
    status: err.status ?? null,
  };
}

const COL = {
  progress: "id",
  practice_sessions: "id",
  answer_attempts: "id",
  attempts: "id",
  competency_events: "id",
  exam_attempts: "id",
  student_question_attempts: "id",
  student_skill_mastery: "user_id",
  student_cluster_mastery: "user_id",
  student_study_plan_days: "id",
  student_study_profile: "user_id",
};

async function countRows(table, ownerCol, studentId) {
  const selectCol = COL[table] || "id";
  const resp = await supabase
    .from(table)
    .select(selectCol, { count: "exact", head: true })
    .eq(ownerCol, studentId);

  return { rowCount: resp.count ?? 0, err: resp.error ?? null, resp };
}

async function countOtherRows(table, ownerCol, studentId) {
  const selectCol = COL[table] || "id";
  const resp = await supabase
    .from(table)
    .select(selectCol, { count: "exact", head: true })
    .neq(ownerCol, studentId);

  return { rowCount: resp.count ?? 0, err: resp.error ?? null, resp };
}

const main = async () => {
  const prof = await supabase
    .from("profiles")
    .select("id,email,role,guardian_profile_id")
    .eq("email", STUDENT_EMAIL)
    .limit(1);

  if (prof.error) {
    console.error("Profile lookup failed:", prof.error);
    process.exit(2);
  }

  const student = prof.data?.[0];
  if (!student) {
    console.error("Student profile not found via RLS.");
    process.exit(2);
  }

  console.log("Linked student profile:", student);
  const studentId = student.id;

  const tables = [
    ["progress", "user_id"],
    ["practice_sessions", "user_id"],
    ["answer_attempts", "user_id"],
    ["attempts", "user_id"],
    ["competency_events", "user_id"],
    ["exam_attempts", "user_id"],
    ["student_question_attempts", "user_id"],
    ["student_skill_mastery", "user_id"],
    ["student_cluster_mastery", "user_id"],
    ["student_study_plan_days", "user_id"],
    ["student_study_profile", "user_id"],
  ];

  for (const [t, ownerCol] of tables) {
    const linked = await countRows(t, ownerCol, studentId);
    const other = await countOtherRows(t, ownerCol, studentId);

    console.log(
      `${t}: linked_count=${linked.rowCount} linked_err=${JSON.stringify(summarizeErr(linked.err))} | ` +
      `other_count=${other.rowCount} other_err=${JSON.stringify(summarizeErr(other.err))}`
    );

    if (["student_skill_mastery","student_cluster_mastery","student_study_profile"].includes(t)) {
      console.log(`${t} raw linked status:`, linked.resp.status, linked.resp.statusText);
      console.log(`${t} raw other  status:`, other.resp.status, other.resp.statusText);
    }
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(3);
});
