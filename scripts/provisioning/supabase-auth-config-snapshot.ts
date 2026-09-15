/**
 * @spec [Coding Standards §7.2 (one shared password policy), §12.1 (never log secrets);
 *   contracts/auth-standard-flow.contract.md AS-1/AS-5] | @implemented [2026-09-15]
 *
 * plain English: prod-verify for the AUTH CONFIG, not the database. Pulls the live GoTrue config
 * for the project from the Supabase Management API (`GET /v1/projects/{ref}/config/auth`) and
 * prints ONE row per checked field: field | live value | expected | verdict. Expected outcome:
 * every row PASS when the shared `PASSWORD_POLICY` still mirrors what GoTrue enforces; exit 1 on
 * any FAIL so drift is loud. Trade-offs: the Management API needs a PERSONAL ACCESS TOKEN
 * (`sbp_…`, from https://supabase.com/dashboard/account/tokens) — it is NOT the service-role key
 * and NOT the anon key, and it is never committed: it is read from `SUPABASE_ACCESS_TOKEN` at run
 * time only. The response also carries provider secrets (SMTP password, OAuth client secrets, hook
 * secrets); this script prints an ALLOWLIST of fields and never the raw body. Edge case: GoTrue's
 * 72-character bcrypt cap is a code constant, not a config field — it is recorded as
 * "not exposed" with a PASS-by-construction note, not asserted against the API. A negative
 * control runs first: the verdict function is fed a deliberately wrong config and must FAIL,
 * proving the checker can fail before the live config is judged.
 *
 * Run:  SUPABASE_ACCESS_TOKEN=sbp_… SUPABASE_PROJECT_REF=<ref> pnpm -s exec tsx scripts/provisioning/supabase-auth-config-snapshot.ts
 */
/* eslint-disable no-console -- operator CLI; console is the output channel (same as rag-corpus-create.ts) */
import { z } from "zod";
import {
  PASSWORD_POLICY,
  type PasswordPolicy,
} from "../../packages/shared/src/password-policy";

const MANAGEMENT_API = "https://api.supabase.com";

// Only these fields are ever printed. Everything else in the response (smtp_pass, external_*_secret,
// hook_*_secrets, jwt settings) stays in memory and is dropped.
const authConfigSchema = z
  .object({
    password_min_length: z.number().int().optional(),
    password_required_characters: z.string().optional(),
    password_hibp_enabled: z.boolean().optional(),
    mailer_autoconfirm: z.boolean().optional(),
    mailer_secure_email_change_enabled: z.boolean().optional(),
    mailer_otp_exp: z.number().int().optional(),
    mailer_otp_length: z.number().int().optional(),
    security_refresh_token_rotation_enabled: z.boolean().optional(),
    security_update_password_require_reauthentication: z.boolean().optional(),
    disable_signup: z.boolean().optional(),
    external_email_enabled: z.boolean().optional(),
    external_google_enabled: z.boolean().optional(),
    site_url: z.string().optional(),
    uri_allow_list: z.string().optional(),
  })
  .passthrough();
type AuthConfig = z.infer<typeof authConfigSchema>;

type Row = {
  field: string;
  live: string;
  expected: string;
  verdict: "PASS" | "FAIL" | "INFO";
};

const ASCII_LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ASCII_DIGITS = "0123456789";

/** GoTrue encodes required classes as colon-separated character sets. */
function requiredClasses(raw: string | undefined): {
  letters: boolean;
  digits: boolean;
} {
  const classes = (raw ?? "").split(":").filter((c) => c.length > 0);
  return {
    letters: classes.some((c) => c === ASCII_LETTERS),
    digits: classes.some((c) => c === ASCII_DIGITS),
  };
}

export function judge(config: AuthConfig, policy: PasswordPolicy): Row[] {
  const classes = requiredClasses(config.password_required_characters);
  const rows: Row[] = [
    {
      field: "password_min_length",
      live: String(config.password_min_length ?? "(absent)"),
      expected: String(policy.minLength),
      verdict:
        config.password_min_length === policy.minLength ? "PASS" : "FAIL",
    },
    {
      field: "password_required_characters → letters",
      live: String(classes.letters),
      expected: String(policy.requireLetter),
      verdict: classes.letters === policy.requireLetter ? "PASS" : "FAIL",
    },
    {
      field: "password_required_characters → digits",
      live: String(classes.digits),
      expected: String(policy.requireDigit),
      verdict: classes.digits === policy.requireDigit ? "PASS" : "FAIL",
    },
    {
      field: "password max length",
      live: "not exposed (GoTrue bcrypt cap = 72, code constant)",
      expected: String(policy.maxLength),
      verdict: policy.maxLength === 72 ? "PASS" : "FAIL",
    },
    {
      field: "password_hibp_enabled (leaked-password screening)",
      live: String(config.password_hibp_enabled ?? "(absent)"),
      expected:
        "recorded only — plan-gated; deviation from NIST 800-63B-4 noted in brief",
      verdict: "INFO",
    },
    {
      field: "mailer_otp_exp (email link lifetime, seconds)",
      live: String(config.mailer_otp_exp ?? "(absent)"),
      expected: "recorded only",
      verdict: "INFO",
    },
    {
      field: "mailer_autoconfirm",
      live: String(config.mailer_autoconfirm ?? "(absent)"),
      expected: "recorded only",
      verdict: "INFO",
    },
    {
      field: "mailer_secure_email_change_enabled",
      live: String(config.mailer_secure_email_change_enabled ?? "(absent)"),
      expected: "recorded only",
      verdict: "INFO",
    },
    {
      field: "security_refresh_token_rotation_enabled",
      live: String(
        config.security_refresh_token_rotation_enabled ?? "(absent)",
      ),
      expected: "recorded only",
      verdict: "INFO",
    },
    {
      field: "security_update_password_require_reauthentication",
      live: String(
        config.security_update_password_require_reauthentication ?? "(absent)",
      ),
      expected: "recorded only",
      verdict: "INFO",
    },
    {
      field:
        "disable_signup / external_email_enabled / external_google_enabled",
      live: `${String(config.disable_signup)} / ${String(config.external_email_enabled)} / ${String(config.external_google_enabled)}`,
      expected: "recorded only",
      verdict: "INFO",
    },
    {
      field: "site_url",
      live: config.site_url ?? "(absent)",
      expected: "recorded only",
      verdict: "INFO",
    },
    {
      field: "uri_allow_list",
      live: config.uri_allow_list ?? "(absent)",
      expected: "recorded only",
      verdict: "INFO",
    },
  ];
  return rows;
}

/** The checker must be able to FAIL. A config that contradicts the policy on every axis → 3+ FAILs. */
function negativeControl(): void {
  const wrong: AuthConfig = {
    password_min_length: PASSWORD_POLICY.minLength + 1,
    password_required_characters: "",
  };
  const fails = judge(wrong, PASSWORD_POLICY).filter(
    (r) => r.verdict === "FAIL",
  ).length;
  if (fails < 3) {
    throw new Error(
      `negative control did not fail (${fails} FAIL rows) — checker is not trustworthy`,
    );
  }
  console.log(
    `negative control: ${fails} FAIL rows on a contradicting config ✔`,
  );
}

function printTable(rows: Row[]): void {
  const w = {
    field: Math.max(...rows.map((r) => r.field.length), 5),
    live: Math.max(...rows.map((r) => r.live.length), 4),
    expected: Math.max(...rows.map((r) => r.expected.length), 8),
  };
  const line = (r: Row) =>
    `${r.field.padEnd(w.field)} | ${r.live.padEnd(w.live)} | ${r.expected.padEnd(w.expected)} | ${r.verdict}`;
  console.log(
    line({
      field: "field",
      live: "live",
      expected: "expected",
      verdict: "INFO",
    }).replace(/INFO$/, "verdict"),
  );
  console.log("-".repeat(w.field + w.live + w.expected + 16));
  for (const r of rows) console.log(line(r));
}

async function main(): Promise<void> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) {
    console.error(
      "SUPABASE_ACCESS_TOKEN (Management API personal access token, sbp_…) and SUPABASE_PROJECT_REF are required.",
    );
    process.exit(2);
  }
  if (!token.startsWith("sbp_")) {
    console.error(
      "SUPABASE_ACCESS_TOKEN does not look like a Management API personal access token (expected sbp_… — NOT the service-role or anon key).",
    );
    process.exit(2);
  }

  negativeControl();

  const res = await fetch(`${MANAGEMENT_API}/v1/projects/${ref}/config/auth`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    // Status only — the body may echo request details; never print it.
    console.error(`Management API returned HTTP ${res.status}`);
    process.exit(3);
  }
  const parsed = authConfigSchema.safeParse(await res.json());
  if (!parsed.success) {
    console.error("Management API response did not match the expected shape");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(3);
  }

  console.log(`snapshot: project ${ref} at ${new Date().toISOString()}`);
  const rows = judge(parsed.data, PASSWORD_POLICY);
  printTable(rows);

  const failed = rows.filter((r) => r.verdict === "FAIL");
  if (failed.length > 0) {
    console.error(
      `${failed.length} FAIL row(s): the shared PASSWORD_POLICY no longer mirrors the live GoTrue config.`,
    );
    process.exit(1);
  }
  console.log(
    "verdict: PASS — shared PASSWORD_POLICY mirrors the live GoTrue config",
  );
}

// tsx runs this file as the entry point; the `judge` export keeps the checker unit-testable.
const isEntry =
  typeof process.argv[1] === "string" &&
  process.argv[1].endsWith("supabase-auth-config-snapshot.ts");
if (isEntry) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
