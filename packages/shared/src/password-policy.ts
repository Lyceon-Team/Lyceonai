/**
 * @spec [contracts/auth-standard-flow.contract.md AS-1 (signup), AS-5 (recovery / set-new-password);
 *   Coding Standards §7.2 (single source of truth in packages/shared), §6.1 (server-authoritative)]
 * @implemented [2026-09-15]
 *
 * plain English: the ONE password policy every set/change surface reads — signup, the
 * set-new-password page, and the server routes that forward the password to GoTrue. The
 * numbers mirror the live GoTrue project config captured 2026-09-15 (min length 8, letters AND
 * digits required, leaked-password screening off). GoTrue is the authority: a password the
 * client says is fine but GoTrue refuses would surface as a generic "couldn't update" — so the
 * client rules exist to prevent that round-trip, not to replace the server's decision.
 *
 * Expected outcome: change a number here and every requirements list, every Zod parse, and the
 * per-rule met/unmet UI move together. Trade-offs, stated as deviations from NIST SP 800-63B-4:
 *   - Composition (letter + digit) is REQUIRED because GoTrue enforces it; 800-63B discourages
 *     composition rules. Mirroring GoTrue wins — the alternative is a client that accepts what
 *     the server rejects.
 *   - Max length is 72, GoTrue's bcrypt cap (it returns an error above 72, it does not truncate).
 *     800-63B asks for at least 64 to be accepted; 72 satisfies that. No client-side truncation
 *     is ever applied — over-length is shown as an unmet rule, never silently cut.
 *   - Letter/digit detection is ASCII-only, exactly as GoTrue's required-character classes are.
 *     A password of only non-ASCII letters plus digits does NOT satisfy the letter rule here or
 *     in GoTrue.
 *   - No leaked-password (blocklist) screening: the GoTrue feature is plan-gated and off. Recorded
 *     as a deviation; not something the client can honestly do without a server list.
 * Edge case: sign-in never applies this policy — accounts created under the earlier 6-character
 * minimum must still be able to sign in and be led to the update-password flow.
 */
import { z } from "zod";

export const PASSWORD_POLICY = {
  /** GoTrue `password_min_length`. */
  minLength: 8,
  /** GoTrue's bcrypt cap — it rejects (not truncates) longer passwords. */
  maxLength: 72,
  /** GoTrue `password_required_characters` includes the ASCII letter class. */
  requireLetter: true,
  /** GoTrue `password_required_characters` includes the digit class. */
  requireDigit: true,
} as const;

export type PasswordPolicy = {
  readonly minLength: number;
  readonly maxLength: number;
  readonly requireLetter: boolean;
  readonly requireDigit: boolean;
};

export const PASSWORD_RULE_IDS = [
  "min_length",
  "letter",
  "digit",
  "max_length",
] as const;
export type PasswordRuleId = (typeof PASSWORD_RULE_IDS)[number];

export type PasswordRule = {
  readonly id: PasswordRuleId;
  /** Plain-English requirement, shown BEFORE the user types (NIST 800-63B-4 §3.1.1.2). */
  readonly label: string;
  /**
   * `always` rules are listed up front; `on_violation` rules (the max) only appear once
   * breached, so an empty field never shows a "met" tick for a rule the user did nothing for.
   */
  readonly display: "always" | "on_violation";
  readonly test: (password: string) => boolean;
};

const ASCII_LETTER = /[A-Za-z]/;
const ASCII_DIGIT = /[0-9]/;

/** The rule list is DERIVED from the policy so a policy change is a rule-list change. */
export function passwordRules(policy: PasswordPolicy): readonly PasswordRule[] {
  const rules: PasswordRule[] = [
    {
      id: "min_length",
      label: `At least ${policy.minLength} characters`,
      display: "always",
      test: (password) => password.length >= policy.minLength,
    },
  ];
  if (policy.requireLetter) {
    rules.push({
      id: "letter",
      label: "At least one letter (a–z or A–Z)",
      display: "always",
      test: (password) => ASCII_LETTER.test(password),
    });
  }
  if (policy.requireDigit) {
    rules.push({
      id: "digit",
      label: "At least one number (0–9)",
      display: "always",
      test: (password) => ASCII_DIGIT.test(password),
    });
  }
  rules.push({
    id: "max_length",
    label: `No more than ${policy.maxLength} characters`,
    display: "on_violation",
    test: (password) => password.length <= policy.maxLength,
  });
  return rules;
}

export type PasswordRuleResult = {
  readonly id: PasswordRuleId;
  readonly label: string;
  readonly display: "always" | "on_violation";
  readonly met: boolean;
};

export type PasswordEvaluation = {
  readonly rules: readonly PasswordRuleResult[];
  readonly valid: boolean;
};

/** Pure, deterministic: same password + policy → same evaluation. Never logs the password. */
export function evaluatePassword(
  password: string,
  policy: PasswordPolicy,
): PasswordEvaluation {
  const rules = passwordRules(policy).map((rule) => ({
    id: rule.id,
    label: rule.label,
    display: rule.display,
    met: rule.test(password),
  }));
  return { rules, valid: rules.every((rule) => rule.met) };
}

/** Build the Zod schema for a policy — the server boundary parse (Coding Standards §7.1). */
export function passwordSchemaFor(policy: PasswordPolicy): z.ZodString {
  let schema = z
    .string()
    .min(policy.minLength, {
      message: `Password must be at least ${policy.minLength} characters`,
    })
    .max(policy.maxLength, {
      message: `Password must be no more than ${policy.maxLength} characters`,
    });
  if (policy.requireLetter) {
    schema = schema.regex(ASCII_LETTER, {
      message: "Password must include at least one letter",
    });
  }
  if (policy.requireDigit) {
    schema = schema.regex(ASCII_DIGIT, {
      message: "Password must include at least one number",
    });
  }
  return schema;
}

/** The canonical schema — what signup and update-password parse against. */
export const passwordSchema = passwordSchemaFor(PASSWORD_POLICY);
