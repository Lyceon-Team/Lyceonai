import { useMemo, useState } from "react";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { Button, LYC_INLINE_LINK } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, Lock, User } from "lucide-react";
import { BareCardHeader } from "@/components/layout/BareCardShell";
import { Notice } from "@/components/student-ui/Notice";
import { useToast } from "@/hooks/use-toast";
import { resolveAuthErrorMessage } from "@/lib/auth-error-messages";
import { PasswordField } from "@/components/auth/PasswordField";
import {
  PASSWORD_POLICY,
  evaluatePassword,
} from "@lyceon/shared/password-policy";
import {
  parseAuthEntryMode,
  type AuthEntryMode,
  type SignupRoleIntent,
} from "@lyceon/shared/auth-entry";

type AuthMode = AuthEntryMode | "reset";

/**
 * @spec [owner brief "Entry-aware sign-in / sign-up" (Karl, 2026-10-10) rule 4] | the card's
 * title per mode. Sign Up and Sign In name what the person came to do; reset keeps its own.
 */
const MODE_TITLES: Readonly<Record<AuthMode, string>> = {
  signin: "Welcome back",
  signup: "Create your Lyceon account",
  reset: "Reset Password",
};

const FIELD_ICON =
  "pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-lyc-muted";
/** A real inline link in the sign-in notice (`LYC_INLINE_LINK`). */
const INLINE_LINK = LYC_INLINE_LINK;

/**
 * @spec [SCL-222; contracts/auth-standard-flow.contract.md AS-1] | @implemented [2026-10-09]
 * plain English (owner ruling 2026-10-09): no checkbox at sign-in. "Continue with Google" comes
 * first, full width, filled and never disabled; then an "or" divider and the email Sign In / Sign Up
 * tabs, whose submit buttons are outline. Under the buttons sits the standard notice, "By
 * continuing, you agree to Lyceon's Terms of Use and Privacy Policy", linked to the current
 * versions. Acceptance is recorded by the server when the account is created (email signup, or
 * the Google callback that creates it); a returning user's sign-in records nothing.
 *
 * @spec [contracts/auth-standard-flow.contract.md AS-3] | @implemented 2026-06-20
 * plain English: the email/password + Google auth form. Every error catch routes through
 * resolveAuthErrorMessage so the UI shows a human, recoverable, NON-ENUMERABLE message — never a raw
 * server/exception string. Client-side validation (enter-email, the password policy) is shown directly.
 *
 * @spec [student-UI register UI-3A, UI-59; DESIGN.md §1, §2 "Bare card" (login, signup)] |
 *       @implemented [2026-10-03]
 * UI-59: drawn with the student tokens only, inside the Bare card /login renders. Copy, test ids,
 * consent capture and every call are unchanged (the behaviour is AS-1..AS-3 and UI-S4..S9's).
 * Each mode has one filled action: "Continue with Google" on Sign In and Sign Up (SCL-222, owner
 * ruling 2026-10-09; the email buttons are outline), Send Reset Link on reset. "Back to Sign In"
 * is quiet, "Forgot password?" a text link. Errors are danger Notices (role="alert", as the
 * shadcn Alerts were); the verification message is an info Notice (a polite status, where the
 * Alert was role="alert"). The email and name inputs gain `autocomplete` tokens (email, name)
 * beside PasswordField's own.
 */
export function SupabaseAuthForm({
  initialMode = "signin",
  initialRole = null,
}: {
  /** The tab the page opens on (`?mode=`, parsed by the shared allowlist). */
  initialMode?: AuthEntryMode;
  /** The account type the entry point asked for (`?role=`), or null: a student. */
  initialRole?: SignupRoleIntent | null;
} = {}) {
  const { signIn, signUp, signInWithGoogle, isLoading, resetPassword } =
    useSupabaseAuth();
  const { toast } = useToast();

  // @spec [owner brief "Entry-aware sign-in / sign-up" (Karl, 2026-10-10) rules 1, 2, 4] |
  // @implemented [2026-10-10] | plain English: the page opens on the tab the link asked for, and
  // a guardian entry keeps its role intent for BOTH ways of creating the account (the email
  // form and "Continue with Google"), until the person says "I'm a student". The intent is sent
  // only while it is on screen (Sign Up, where the guardian line is drawn): a press of Google
  // from the Sign In tab names no role, so no account is ever re-roled by an intent the page
  // was not showing (spec audit 2026-10-10). Such an account still opens onboarding on Guardian
  // through `next=/guardian`, which the parent link also carries (F13). The tabs and the
  // Google button stay available in every mode. After a failed email sign-in the card offers
  // "No account yet? Create one", which opens Sign Up with the typed email kept (the email is
  // one field across both tabs); the error copy itself is unchanged and non-enumerating.
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [roleIntent, setRoleIntent] = useState<SignupRoleIntent | null>(
    initialRole,
  );
  const [signInFailed, setSignInFailed] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
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
    return null;
  }, [email, signupPasswordValid]);
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
    setSignInFailed(false);

    try {
      if (mode === "signin") {
        await signIn(email, password);
        toast({
          title: "Welcome back!",
          description: "You have been signed in successfully.",
        });
        return;
      }

      const signupResult = await signUp(
        email,
        password,
        { consentSource: "email_signup_form" },
        displayName,
        roleIntent,
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
      if (mode === "signin") setSignInFailed(true);
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
      await signInWithGoogle(
        { consentSource: "google_continue_click" },
        mode === "signup" ? roleIntent : null,
      );
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
        title={MODE_TITLES[mode]}
        description={
          mode === "reset"
            ? "Enter your email to receive a password reset link"
            : mode === "signin"
              ? "Sign in to continue your SAT prep journey"
              : undefined
        }
      />
      {mode === "signup" && roleIntent === "guardian" ? (
        <p
          className="m-0 mb-5 text-lyc-body text-lyc-muted"
          data-testid="signup-role-guardian"
        >
          Signing up as a parent or guardian.{" "}
          <Button
            type="button"
            variant="lyc-link"
            onClick={() => setRoleIntent("student")}
            data-testid="button-signup-as-student"
          >
            I&apos;m a student
          </Button>
        </p>
      ) : null}
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
          <Button
            variant="lyc-primary"
            className="w-full"
            onClick={handleGoogleSignIn}
            disabled={isLoading}
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

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-lyc-rule" aria-hidden="true" />
            <span className="text-lyc-meta uppercase tracking-[0.06em] text-lyc-muted">
              or
            </span>
            <span className="h-px flex-1 bg-lyc-rule" aria-hidden="true" />
          </div>

          <Tabs
            value={mode}
            onValueChange={(v) => {
              setMode(parseAuthEntryMode(v));
              setVerificationState(null);
              setSignInFailed(false);
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
                  variant="lyc-outline"
                  className="w-full"
                  disabled={isLoading}
                  data-testid="button-signin"
                >
                  {isLoading ? "Signing in..." : "Sign In"}
                </Button>
                {signInFailed ? (
                  <p
                    className="m-0 text-center text-lyc-meta-lg text-lyc-muted"
                    data-testid="signin-create-account"
                  >
                    No account yet?{" "}
                    <Button
                      type="button"
                      variant="lyc-link"
                      className="text-lyc-meta-lg"
                      onClick={() => {
                        setMode("signup");
                        setError("");
                        setSignInFailed(false);
                      }}
                      data-testid="button-create-account"
                    >
                      Create one
                    </Button>
                  </p>
                ) : null}
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
                    variant="lyc-outline"
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

          <p
            className="mt-6 mb-0 text-center text-lyc-meta-lg text-lyc-muted"
            data-testid="signin-legal-notice"
          >
            By continuing, you agree to Lyceon&apos;s{" "}
            <a href="/legal/student-terms" className={INLINE_LINK}>
              Terms of Use
            </a>{" "}
            and{" "}
            <a href="/legal/privacy-policy" className={INLINE_LINK}>
              Privacy Policy
            </a>
            .
          </p>
        </>
      )}
    </div>
  );
}
