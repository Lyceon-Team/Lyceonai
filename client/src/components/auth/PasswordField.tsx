import { useId, useState } from "react";
import { Check, Eye, EyeOff, X } from "lucide-react";
// Subpath import on purpose: the package index re-exports the server env schema, whose
// `*_SECRET` variable NAMES would land in the client bundle and trip scripts/check-no-secrets-in-bundle.js.
import {
  PASSWORD_POLICY,
  evaluatePassword,
} from "@lyceon/shared/password-policy";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * @spec [contracts/auth-standard-flow.contract.md AS-1 (signup), AS-3 (error UX), AS-5 (set new
 *   password); Coding Standards §7.2 (policy from packages/shared), §11.1 (no business logic in
 *   components)] | @implemented [2026-09-15]
 *
 * plain English: the ONE password input every auth surface uses. What it does: renders a
 * show/hide toggle, sets the right `autocomplete` token (`new-password` on create/reset so password
 * managers offer to generate; `current-password` on sign-in so they fill), and — on create/reset
 * surfaces only — lists the rules from the shared policy BEFORE the user types, then flips each
 * rule met/unmet live in an `aria-live="polite"` region. Expected outcome: a user never discovers a
 * rule from a rejected submit. Trade-offs: no strength meter (NIST SP 800-63B-4 §3.1.1.2 — meters
 * are not required and mislead); paste is never blocked and no `maxLength` attribute is set, so a
 * 64+ character manager-generated password arrives intact and an over-length one is SHOWN as unmet
 * rather than silently truncated. Edge case: sign-in passes `showRequirements={false}` — accounts
 * created under the earlier 6-character minimum must still sign in; the policy gates setting a
 * password, never using one.
 */
export type PasswordFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "new-password" | "current-password";
  /** Rule list + live met/unmet. True on every set/change surface; false on sign-in. */
  showRequirements: boolean;
  placeholder?: string;
  leadingIcon?: React.ReactNode;
  /** Rendered on the same row as the label (e.g. the "Forgot password?" link on sign-in). */
  labelAccessory?: React.ReactNode;
  testId?: string;
  required?: boolean;
  disabled?: boolean;
};

export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  showRequirements,
  placeholder = "••••••••",
  leadingIcon,
  labelAccessory,
  testId,
  required = false,
  disabled = false,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const requirementsId = useId();
  const evaluation = evaluatePassword(value, PASSWORD_POLICY);
  const showInvalid = showRequirements && value.length > 0 && !evaluation.valid;

  return (
    <div className="space-y-2">
      {labelAccessory ? (
        <div className="flex items-center justify-between">
          <Label htmlFor={id}>{label}</Label>
          {labelAccessory}
        </div>
      ) : (
        <Label htmlFor={id}>{label}</Label>
      )}
      <div className="relative">
        {leadingIcon ? (
          <span
            aria-hidden="true"
            className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"
          >
            {leadingIcon}
          </span>
        ) : null}
        <Input
          id={id}
          data-testid={testId}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(leadingIcon ? "pl-10" : undefined, "pr-11")}
          required={required}
          disabled={disabled}
          aria-invalid={showInvalid ? true : undefined}
          aria-describedby={showRequirements ? requirementsId : undefined}
        />
        <button
          type="button"
          data-testid={testId ? `${testId}-toggle` : undefined}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          aria-controls={id}
          disabled={disabled}
          className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-gray-800 disabled:opacity-50"
        >
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>

      {showRequirements ? (
        <ul
          id={requirementsId}
          aria-live="polite"
          aria-label="Password requirements"
          data-testid={
            testId ? `${testId}-requirements` : "password-requirements"
          }
          className="space-y-1 text-sm"
        >
          {evaluation.rules
            .filter((rule) => rule.display === "always" || !rule.met)
            .map((rule) => (
              <li
                key={rule.id}
                data-testid={`password-rule-${rule.id}`}
                data-met={rule.met ? "true" : "false"}
                className={cn(
                  "flex items-center gap-2",
                  rule.met ? "text-emerald-700" : "text-muted-foreground",
                )}
              >
                {rule.met ? (
                  <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                ) : (
                  <X className="h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                <span>{rule.label}</span>
                <span className="sr-only">
                  {rule.met ? "(met)" : "(not met)"}
                </span>
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}
