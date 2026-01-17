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

const main = async () => {
  // 0) Resolve student id via profiles (guardian should be allowed for linked student)
  const { data: p, error: pErr } = await supabase
    .from("profiles")
    .select("id,email,role,guardian_profile_id")
    .eq("email", STUDENT_EMAIL)
    .limit(1);

  if (pErr) {
    console.error("Profile lookup failed:", pErr);
    process.exit(2);
  }
  const student = p?.[0];
  if (!student) {
    console.error("Student profile not found via RLS.");
    process.exit(2);
  }
  console.log("Linked student profile:", student);

  const studentId = student.id;

  // 1) progress: linked student rows
  const { data: prog, error: progErr } = await supabase
    .from("progress")
    .select("id,user_id,pct,is_correct,attempted_at")
    .eq("user_id", studentId)
    .limit(10);

  console.log("Progress linked student:", { rows: prog?.length ?? 0, progErr });

  // Negative: any other students' progress
  const { data: progOther, error: progOtherErr } = await supabase
    .from("progress")
    .select("id,user_id,attempted_at")
    .neq("user_id", studentId)
    .limit(5);

  console.log("Progress other students attempt:", { rows: progOther?.length ?? 0, progOtherErr });

  // 2) practice_sessions: linked student rows
  const { data: ps, error: psErr } = await supabase
    .from("practice_sessions")
    .select("id,user_id,mode,status,started_at,finished_at")
    .eq("user_id", studentId)
    .limit(10);

  console.log("Practice sessions linked student:", { rows: ps?.length ?? 0, psErr });

  // Negative: any other students' practice sessions
  const { data: psOther, error: psOtherErr } = await supabase
    .from("practice_sessions")
    .select("id,user_id,started_at")
    .neq("user_id", studentId)
    .limit(5);

  console.log("Practice sessions other students attempt:", { rows: psOther?.length ?? 0, psOtherErr });
};

main().catch((e) => {
  console.error(e);
  process.exit(3);
});
