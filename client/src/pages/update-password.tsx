import { useState } from "react";
import { useLocation } from "wouter";
import {
  PASSWORD_POLICY,
  evaluatePassword,
} from "@lyceon/shared/password-policy";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { resolveAuthErrorMessage } from "@/lib/auth-error-messages";
import { PasswordField } from "@/components/auth/PasswordField";

/**
 * @spec [contracts/auth-standard-flow.contract.md AS-3, AS-5; Coding Standards §7.2] |
 *   @implemented 2026-06-20 | @updated 2026-09-15 (shared password policy, PasswordField)
 * plain English: set-new-password page for the recovery flow (session from the recovery cookie). The
 * rules come from the ONE shared policy (min length, letter, digit, GoTrue cap) and are visible
 * before typing with live met/unmet feedback; submit stays disabled until every rule is met and the
 * confirmation matches, and the reason it is disabled is written next to the button. The error
 * catch routes through resolveAuthErrorMessage (human, recoverable, never a raw string); on success
 * it lands by role. Edge case: the `<form>` still guards on submit — the disabled button is UX,
 * the server's Zod parse is the enforcement.
 */
export default function UpdatePassword() {
  const [, setLocation] = useLocation();
  const { updatePassword, isLoading, isGuardian } = useSupabaseAuth();
  const { toast } = useToast();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  const policyValid = evaluatePassword(password, PASSWORD_POLICY).valid;
  const passwordsMatch =
    confirmPassword.length > 0 && password === confirmPassword;
  const disabledReason = isLoading
    ? null
    : !policyValid
      ? "Choose a password that meets every requirement above."
      : !passwordsMatch
        ? "Enter the same password in both fields."
        : null;
  const canSubmit = !isLoading && disabledReason === null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!policyValid) {
      setError("Your new password doesn't meet every requirement yet.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    try {
      await updatePassword(password);
      toast({
        title: "Password updated",
        description: "Your password has been successfully changed.",
      });
      setLocation(isGuardian ? "/guardian" : "/dashboard");
    } catch (err) {
      setError(resolveAuthErrorMessage(err));
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle className="text-2xl flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Update Password
          </CardTitle>
          <CardDescription>
            Please enter your new password below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <PasswordField
              id="new-password"
              testId="input-new-password"
              label="New Password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              showRequirements
              required
            />

            <PasswordField
              id="confirm-password"
              testId="input-confirm-password"
              label="Confirm Password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              showRequirements={false}
              required
            />

            {error && (
              <Alert className="border-amber-200 bg-amber-50">
                <AlertCircle className="h-4 w-4 text-amber-700" />
                <AlertDescription className="text-amber-800">
                  {error}
                </AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={!canSubmit}
              data-testid="button-update-password"
              aria-describedby={
                disabledReason ? "update-password-submit-reason" : undefined
              }
            >
              {isLoading ? "Updating..." : "Update Password"}
            </Button>
            {disabledReason ? (
              <p
                id="update-password-submit-reason"
                data-testid="update-password-submit-reason"
                aria-live="polite"
                className="text-sm text-muted-foreground"
              >
                {disabledReason}
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
