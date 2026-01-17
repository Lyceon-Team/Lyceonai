import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!url || !anon) {
  console.error("Missing SUPABASE_URL / SUPABASE_ANON_KEY env vars.");
  process.exit(1);
}

const supabase = createClient(url, anon);

const ts = Date.now();
const email = `guardian.test+${ts}@gmail.com`; // unique every run
const password = `TempPass!${ts}`;            // unique every run

const main = async () => {
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    console.error("SIGNUP_FAILED:", error);
    process.exit(2);
  }

  console.log("SIGNUP_OK");
  console.log("email:", email);
  console.log("user_id:", data?.user?.id || null);
  console.log("session_present:", Boolean(data?.session));
  console.log("needs_email_confirm:", Boolean(data?.user && !data?.session));
};

main().catch((e) => {
  console.error(e);
  process.exit(3);
});
