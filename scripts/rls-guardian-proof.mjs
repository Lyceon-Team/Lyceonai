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
  // 1) Read the linked student
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, email, guardian_email, guardian_profile_id")
    .eq("email", STUDENT_EMAIL)
    .limit(1);

  if (error) {
    console.error("Linked student read failed:", error);
    process.exit(2);
  }

  console.log("Linked student read:", data);

  // 2) Negative test: guardian must NOT read other students
  const { data: otherStudents, error: otherErr } = await supabase
    .from("profiles")
    .select("id, role, email")
    .eq("role", "student")
    .neq("email", STUDENT_EMAIL)
    .limit(5);

  console.log("Other students read attempt:", { otherStudents, otherErr });
};

main().catch((e) => {
  console.error(e);
  process.exit(3);
});
