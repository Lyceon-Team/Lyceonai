import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_ANON_KEY env vars.");
  process.exit(1);
}

const email = process.env.GUARDIAN_EMAIL;
const password = process.env.GUARDIAN_PASSWORD;

if (!email || !password) {
  console.error("Missing GUARDIAN_EMAIL / GUARDIAN_PASSWORD env vars.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const main = async () => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error("Login failed:", error);
    process.exit(2);
  }
  console.log("access_token:", data.session.access_token);
  console.log("user:", data.user.email);
};

main().catch((e) => {
  console.error(e);
  process.exit(3);
});
