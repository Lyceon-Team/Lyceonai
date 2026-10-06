import { useMemo, useState } from "react";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { Button, LYC_INLINE_LINK } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, Lock, User } from "lucide-react";
import { BareCardHeader } from "@/components/layout/BareCardShell";
import { Notice } from "@/components/student-ui";
import { useToast } from "@/hooks/use-toast";
import { resolveAuthErrorMessage } from "@/lib/auth-error-messages";
import { PasswordField } from "@/components/auth/PasswordField";
import {
  PASSWORD_POLICY,
  evaluatePassword,
} from "@lyceon/shared/password-policy";

type AuthMode = "signin" | "signup" | "reset";

const FIELD_ICON =
  "pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-lyc-muted";
const CONSENT_LABEL = "text-lyc-meta-lg font-normal leading-snug text-lyc-ink";
/** A real inline link in the consent sentences (`LYC_INLINE_LINK`). */
const INLINE_LINK = LYC_INLINE_LINK;

/**
 * @spec [contracts/auth-standard-flow.contract.md AS-3] | @implemented 2026-06-20
 * plain English: the email/password + Google auth form. Every error catch routes through
 * resolveAuthErrorMessage so the UI shows a human, recoverable, NON-ENUMERABLE message — never a raw
 * server/exception string. Client-side validation (accept-terms, enter-email) is shown directly.
 *
 * @spec [student-UI register UI-3A, UI-59; DESIGN.md §1, §2 "Bare card" (login, signup)] |
 *       @implemented [2026-10-03]
 * UI-59: drawn with the student tokens only, inside the Bare card /login renders. Copy, test ids,
 * consent capture and every call are unchanged (the behaviour is AS-1..AS-3 and UI-S4..S9's).
 * Each mode has one filled action (Sign In, Sign Up, Send Reset Link); Google is outline, "Back to
 * Sign In" quiet, "Forgot password?" a text link. Errors are danger Notices (role="alert", as the
 * shadcn Alerts were); the verification message is an info Notice (a polite status, where the
 * Alert was role="alert"). The email and name inputs gain `autocomplete` tokens (email, name)
 * beside PasswordField's own.
 */
export function SupabaseAuthForm() {
  const { signIn, signUp, signInWithGoogle, isLoading, resetPassword } =
    useSupabaseAuth();
  const { toast } = useToast();

  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [signupLegalAccepted, setSignupLegalAccepted] = useState(false);
  const [googleLegalAccepted, setGoogleLegalAccepted] = useState(false);
  const [error, setError] = useState("");
  const [verificationState, setVerificationState] = useState<{
    email: string;
    message: string;
  } | null>(null);

  // AS-1 + shared password policy: the signup button is disabled until every precondition holds,
  // and the FIRST unmet one is written next to the button — a disabled control never goes
  // unexplained. Sign-in is deliberately NOT gated on the policy (older 6-char accounts).
  const signupPasswordValid = useMemo(
    () => evaluatePassword(password, PASSWORD_POLICY).valid,
    [password],
  );
  const signupDisabledReason = useMemo(() => {
    if (!email) return "Enter your email address to continue.";
    if (!signupPasswordValid) {
      return "Choose a password that meets every requirement above.";
    }
    if (!signupLegalAccepted) {
      return "Accept the Terms and Privacy Policy to create your account.";
    }
    return null;
  }, [email, signupPasswordValid, signupLegalAccepted]);
  const canSubmitSignup = signupDisabledReason === null;

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setVerificationState(null);

    if (!email) {
      setError("Please enter your email address");
      return;
    }

    try {
      await resetPassword(email);
      toast({
        title: "Check your email",
        description: "Password reset instructions have been sent.",
      });
      setMode("signin");
    } catch (err) {
      setError(resolveAuthErrorMessage(err));
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setVerificationState(null);

    try {
      if (mode === "signin") {
        await signIn(email, password);
        toast({
          title: "Welcome back!",
          description: "You have been signed in successfully.",
        });
        return;
      }

      if (!signupLegalAccepted) {
        setError("You must accept Terms and Privacy to create an account");
        return;
      }

      const signupResult = await signUp(
        email,
        password,
        {
          studentTermsAccepted: true,
          privacyPolicyAccepted: true,
          consentSource: "email_signup_form",
        },
        displayName,
      );

      if (signupResult.outcome === "verification_required") {
        const msg =
          signupResult.message || "Please verify your email before continuing.";
        setVerificationState({
          email,
          message: msg,
        });
        toast({
          title: "Verification required",
          description: msg,
        });
        return;
      }

      toast({
        title: "Account created",
        description: "Welcome to Lyceon.",
      });
    } catch (err) {
      const errorMsg = resolveAuthErrorMessage(err);
      setError(errorMsg);
      toast({
        title: mode === "signin" ? "Sign In Failed" : "Sign Up Failed",
        description: errorMsg,
      });
    }
  };

  const handleGoogleSignIn = async () => {
    setError("");
    setVerificationState(null);

    try {
      if (!googleLegalAccepted) {
        setError("Accept Terms and Privacy before continuing with Google");
        return;
      }

      await signInWithGoogle({
        studentTermsAccepted: true,
        privacyPolicyAccepted: true,
        consentSource: "google_continue_pre_oauth",
      });
      toast({
        title: "Redirecting to Google...",
        description: "Continue in Google to finish sign-in.",
      });
    } catch (err) {
      const errorMsg = resolveAuthErrorMessage(err);
      setError(errorMsg);
      toast({
        title: "Google Sign-In Failed",
        description: errorMsg,
      });
    }
  };

  return (
    <div data-testid="auth-form">
      <BareCardHeader
        title={mode === "reset" ? "Reset Password" : "Lyceon"}
        description={
          mode === "reset"
            ? "Enter your email to receive a password reset link"
            : "Sign in to continue your SAT prep journey"
        }
      />
      {mode === "reset" ? (
        <form onSubmit={handleResetPassword} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label variant="lyc" htmlFor="reset-email">
              Email
            </Label>
            <div className="relative">
              <Mail className={FIELD_ICON} aria-hidden="true" />
              <Input
                id="reset-email"
                variant="lyc"
                type="email"
                autoComplete="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10"
                required
              />
            </div>
          </div>

          {error && (
            <Notice tone="danger" title={error} data-testid="alert-error" />
          )}

          {verificationState && (
            <Notice
              tone="info"
              title={verificationState.message}
              data-testid="alert-verification-required"
            />
          )}

          <div className="flex flex-col gap-2">
            <Button
              type="submit"
              variant="lyc-primary"
              disabled={isLoading}
              className="w-full"
              data-testid="button-reset"
            >
              {isLoading ? "Sending..." : "Send Reset Link"}
            </Button>
            <Button
              type="button"
              variant="lyc-quiet"
              onClick={() => {
                setMode("signin");
                setError("");
              }}
              className="w-full"
            >
              Back to Sign In
            </Button>
          </div>
        </form>
      ) : (
        <>
          <Tabs
            value={mode}
            onValueChange={(v) => {
              setMode(v as AuthMode);
              setVerificationState(null);
            }}
          >
            <TabsList variant="lyc">
              <TabsTrigger value="signin" data-testid="tab-signin">
                Sign In
              </TabsTrigger>
              <TabsTrigger value="signup" data-testid="tab-signup">
                Sign Up
              </TabsTrigger>
            </TabsList>

            <TabsContent variant="lyc" value="signin">
              <form onSubmit={handleEmailAuth} className="flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  <Label variant="lyc" htmlFor="signin-email">
                    Email
                  </Label>
                  <div className="relative">
                    <Mail className={FIELD_ICON} aria-hidden="true" />
                    <Input
                      id="signin-email"
                      variant="lyc"
                      data-testid="input-signin-email"
                      type="email"
                      autoComplete="email"
                      placeholder="your@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10"
                      required
                    />
                  </div>
                </div>

                <PasswordField
                  id="signin-password"
                  testId="input-signin-password"
                  label="Password"
                  value={password}
                  onChange={setPassword}
                  autoComplete="current-password"
                  showRequirements={false}
                  leadingIcon={<Lock className="h-4 w-4" />}
                  required
                  labelAccessory={
                    <Button
                      type="button"
                      variant="lyc-link"
                      className="text-lyc-meta-lg"
                      onClick={(e) => {
                        e.preventDefault();
                        setMode("reset");
                        setError("");
                      }}
                    >
                      Forgot password?
                    </Button>
                  }
                />

                {error && (
                  <Notice
                    tone="danger"
                    title={error}
                    data-testid="alert-error"
                  />
                )}

                <Button
                  type="submit"
                  variant="lyc-primary"
                  className="w-full"
                  disabled={isLoading}
                  data-testid="button-signin"
                >
                  {isLoading ? "Signing in..." : "Sign In"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent variant="lyc" value="signup">
              <form onSubmit={handleEmailAuth} className="flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  <Label variant="lyc" htmlFor="signup-name">
                    Display Name
                  </Label>
                  <div className="relative">
                    <User className={FIELD_ICON} aria-hidden="true" />
                    <Input
                      id="signup-name"
                      variant="lyc"
                      data-testid="input-signup-name"
                      type="text"
                      autoComplete="name"
                      placeholder="Your Name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="pl-10"
                      required
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label variant="lyc" htmlFor="signup-email">
                    Email
                  </Label>
                  <div className="relative">
                    <Mail className={FIELD_ICON} aria-hidden="true" />
                    <Input
                      id="signup-email"
                      variant="lyc"
                      data-testid="input-signup-email"
                      type="email"
                      autoComplete="email"
                      placeholder="your@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10"
                      required
                    />
                  </div>
                </div>

                <PasswordField
                  id="signup-password"
                  testId="input-signup-password"
                  label="Password"
                  value={password}
                  onChange={setPassword}
                  autoComplete="new-password"
                  showRequirements
                  leadingIcon={<Lock className="h-4 w-4" />}
                  required
                />

                <div className="flex items-start gap-3">
                  <Checkbox
                    id="signup-legal-consent"
                    variant="lyc"
                    className="mt-0.5"
                    data-testid="checkbox-signup-legal"
                    checked={signupLegalAccepted}
                    onCheckedChange={(checked) =>
                      setSignupLegalAccepted(Boolean(checked))
                    }
                  />
                  <Label
                    htmlFor="signup-legal-consent"
                    className={CONSENT_LABEL}
                  >
                    I agree to the{" "}
                    <a href="/legal/student-terms" className={INLINE_LINK}>
                      Student Terms
                    </a>{" "}
                    and{" "}
                    <a href="/legal/privacy-policy" className={INLINE_LINK}>
                      Privacy Policy
                    </a>
                    .
                  </Label>
                </div>

                {verificationState && (
                  <Notice
                    tone="info"
                    title={`${verificationState.message} (${verificationState.email})`}
                    data-testid="alert-verification-required"
                  />
                )}

                {error && (
                  <Notice
                    tone="danger"
                    title={error}
                    data-testid="alert-error"
                  />
                )}

                <div className="flex flex-col gap-2">
                  <Button
                    type="submit"
                    variant="lyc-primary"
                    className="w-full"
                    disabled={isLoading || !canSubmitSignup}
                    data-testid="button-signup"
                    aria-describedby={
                      signupDisabledReason ? "signup-submit-reason" : undefined
                    }
                  >
                    {isLoading ? "Creating account..." : "Sign Up"}
                  </Button>
                  {signupDisabledReason ? (
                    <p
                      id="signup-submit-reason"
                      data-testid="signup-submit-reason"
                      aria-live="polite"
                      className="m-0 text-lyc-meta-lg text-lyc-muted"
                    >
                      {signupDisabledReason}
                    </p>
                  ) : null}
                </div>
              </form>
            </TabsContent>
          </Tabs>

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-lyc-rule" aria-hidden="true" />
            <span className="text-lyc-meta uppercase tracking-[0.06em] text-lyc-muted">
              Or continue with
            </span>
            <span className="h-px flex-1 bg-lyc-rule" aria-hidden="true" />
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <Checkbox
                id="google-legal-consent"
                variant="lyc"
                className="mt-0.5"
                data-testid="checkbox-google-legal"
                checked={googleLegalAccepted}
                onCheckedChange={(checked) =>
                  setGoogleLegalAccepted(Boolean(checked))
                }
              />
              <Label htmlFor="google-legal-consent" className={CONSENT_LABEL}>
                By continuing with Google, I agree to the{" "}
                <a href="/legal/student-terms" className={INLINE_LINK}>
                  Student Terms
                </a>{" "}
                and{" "}
                <a href="/legal/privacy-policy" className={INLINE_LINK}>
                  Privacy Policy
                </a>
                .
              </Label>
            </div>

            <Button
              variant="lyc-outline"
              className="w-full"
              onClick={handleGoogleSignIn}
              disabled={isLoading || !googleLegalAccepted}
              data-testid="button-google-signin"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
