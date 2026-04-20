import { useMemo, useState } from 'react';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle, Mail, Lock, User } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { csrfFetch } from '@/lib/csrf';

type AuthMode = 'signin' | 'signup' | 'reset';

export function SupabaseAuthForm() {
  const { signIn, signUp, signInWithGoogle, isLoading, resetPassword } = useSupabaseAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [signupLegalAccepted, setSignupLegalAccepted] = useState(false);
  const [googleLegalAccepted, setGoogleLegalAccepted] = useState(false);
  const [error, setError] = useState('');
  const [verificationState, setVerificationState] = useState<{
    email: string;
    message: string;
  } | null>(null);

  const canSubmitSignup = useMemo(() => {
    return Boolean(signupLegalAccepted && email && password);
  }, [signupLegalAccepted, email, password]);

  const resolvePostAuthPath = async (): Promise<string> => {
    try {
      const response = await csrfFetch('/api/profile', { credentials: 'include' });
      if (!response.ok) return '/dashboard';

      const data = await response.json();
      const role = data?.user?.role;
      const profileCompletedAt = data?.user?.profileCompletedAt;
      const requiredProfileComplete = data?.user?.requiredProfileComplete;
      const requiredConsentsComplete = data?.user?.requiredConsentsComplete;
      const guardianConsentRequired = data?.user?.guardianConsentRequired;

      if (!requiredConsentsComplete || guardianConsentRequired || !requiredProfileComplete || !profileCompletedAt) {
        return '/profile/complete';
      }
      return role === 'guardian' ? '/guardian' : '/dashboard';
    } catch {
      return '/dashboard';
    }

    const data = await response.json();
    const role = data?.user?.role;
    return role === 'guardian' ? '/guardian' : '/dashboard';
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setVerificationState(null);

    if (!email) {
      setError('Please enter your email address');
      return;
    }

    try {
      await resetPassword(email);
      toast({
        title: 'Check your email',
        description: 'Password reset instructions have been sent.',
      });
      setMode('signin');
    } catch (err: any) {
      setError(err.message || 'Failed to send reset email');
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setVerificationState(null);

    try {
      if (mode === 'signin') {
        await signIn(email, password);
        toast({
          title: 'Welcome back!',
          description: 'You have been signed in successfully.',
        });
        setLocation(await resolvePostAuthPath());
        return;
      }

      if (!signupLegalAccepted) {
        throw new Error('You must accept Terms and Privacy to create an account');
      }

      const signupResult = await signUp(
        email,
        password,
        {
          studentTermsAccepted: true,
          privacyPolicyAccepted: true,
          consentSource: 'email_signup_form',
        },
        displayName,
      );

      if (signupResult.outcome === 'verification_required') {
        const msg = signupResult.message || 'Please verify your email before continuing.';
        setVerificationState({
          email,
          message: msg,
        });
        toast({
          title: 'Verification required',
          description: msg,
        });
        return;
      }

      toast({
        title: 'Account created',
        description: 'Welcome to Lyceon.',
      });
      setLocation(signupResult.nextPath || (await resolvePostAuthPath()));
    } catch (err: any) {
      const errorMsg = err.message || 'Authentication failed';
      setError(errorMsg);
      toast({
        title: mode === 'signin' ? 'Sign In Failed' : 'Sign Up Failed',
        description: errorMsg,
      });
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setVerificationState(null);

    try {
      if (!googleLegalAccepted) {
        throw new Error('Accept Terms and Privacy before continuing with Google');
      }

      await signInWithGoogle({
        studentTermsAccepted: true,
        privacyPolicyAccepted: true,
        consentSource: 'google_continue_pre_oauth',
      });
      toast({
        title: 'Redirecting to Google...',
        description: 'Continue in Google to finish sign-in.',
      });
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to sign in with Google';
      setError(errorMsg);
      toast({
        title: 'Google Sign-In Failed',
        description: errorMsg,
      });
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="text-2xl">
          {mode === 'reset' ? 'Reset Password' : 'Lyceon'}
        </CardTitle>
        <CardDescription>
          {mode === 'reset'
            ? 'Enter your email to receive a password reset link'
            : 'Sign in to continue your SAT prep journey'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {mode === 'reset' ? (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reset-email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="reset-email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
            </div>

            {error && (
              <Alert className="border-amber-200 bg-amber-50" data-testid="alert-error">
                <AlertCircle className="h-4 w-4 text-amber-700" />
                <AlertDescription className="text-amber-800">{error}</AlertDescription>
              </Alert>
            )}

            {verificationNotice && (
              <Alert data-testid="alert-verification-required">
                <Mail className="h-4 w-4" />
                <AlertDescription>{verificationNotice}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col space-y-2 mt-4">
              <Button type="submit" disabled={isLoading} className="w-full" data-testid="button-reset">
                {isLoading ? 'Sending...' : 'Send Reset Link'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => { setMode('signin'); setError(''); }}
                className="w-full"
              >
                Back to Sign In
              </Button>
            </div>
          </form>
        ) : (
          <>
            <Tabs value={mode} onValueChange={(v) => { setMode(v as AuthMode); setVerificationState(null); }}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin" data-testid="tab-signin">Sign In</TabsTrigger>
                <TabsTrigger value="signup" data-testid="tab-signup">Sign Up</TabsTrigger>
              </TabsList>

              <TabsContent value="signin" className="space-y-4 mt-4">
                <form onSubmit={handleEmailAuth} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signin-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signin-email"
                        data-testid="input-signin-email"
                        type="email"
                        placeholder="your@email.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="signin-password">Password</Label>
                      <Button
                        variant="link"
                        className="p-0 h-auto text-xs text-muted-foreground font-normal"
                        onClick={(e) => { e.preventDefault(); setMode('reset'); setError(''); }}
                      >
                        Forgot password?
                      </Button>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signin-password"
                        data-testid="input-signin-password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-10"
                        required
                      />
                    </div>
                  </div>

                  {error && (
                    <Alert className="border-amber-200 bg-amber-50" data-testid="alert-error">
                      <AlertCircle className="h-4 w-4 text-amber-700" />
                      <AlertDescription className="text-amber-800">{error}</AlertDescription>
                    </Alert>
                  )}

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isLoading}
                    data-testid="button-signin"
                  >
                    {isLoading ? 'Signing in...' : 'Sign In'}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup" className="space-y-4 mt-4">
                <form onSubmit={handleEmailAuth} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-name">Display Name</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signup-name"
                        data-testid="input-signup-name"
                        type="text"
                        placeholder="Your Name"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="pl-10"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signup-email"
                        data-testid="input-signup-email"
                        type="email"
                        placeholder="your@email.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signup-password"
                        data-testid="input-signup-password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-10"
                        required
                        minLength={6}
                      />
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="signup-legal-consent"
                      data-testid="checkbox-signup-legal"
                      checked={signupLegalAccepted}
                      onCheckedChange={(checked) => setSignupLegalAccepted(Boolean(checked))}
                    />
                    <Label htmlFor="signup-legal-consent" className="text-sm font-normal">
                      I agree to the <a href="/legal/student-terms" className="underline hover:no-underline">Student Terms</a> and <a href="/legal/privacy-policy" className="underline hover:no-underline">Privacy Policy</a>.
                    </Label>
                  </div>

                  {verificationState && (
                    <Alert data-testid="alert-verification-required">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        {verificationState.message} ({verificationState.email})
                      </AlertDescription>
                    </Alert>
                  )}

                  {error && (
                    <Alert className="border-amber-200 bg-amber-50" data-testid="alert-error">
                      <AlertCircle className="h-4 w-4 text-amber-700" />
                      <AlertDescription className="text-amber-800">{error}</AlertDescription>
                    </Alert>
                  )}

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isLoading || !canSubmitSignup}
                    data-testid="button-signup"
                  >
                    {isLoading ? 'Creating account...' : 'Sign Up'}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-start space-x-2">
                <Checkbox
                  id="google-legal-consent"
                  data-testid="checkbox-google-legal"
                  checked={googleLegalAccepted}
                  onCheckedChange={(checked) => setGoogleLegalAccepted(Boolean(checked))}
                />
                <Label htmlFor="google-legal-consent" className="text-xs text-muted-foreground leading-5">
                  By continuing with Google, I agree to the <a href="/legal/student-terms" className="underline hover:no-underline">Student Terms</a> and <a href="/legal/privacy-policy" className="underline hover:no-underline">Privacy Policy</a>.
                </Label>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={handleGoogleSignIn}
                disabled={isLoading || !googleLegalAccepted}
                data-testid="button-google-signin"
              >
                <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
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
      </CardContent>
      <CardFooter className="flex justify-center text-sm text-muted-foreground">
        Authentication and legal consent are handled in one standard flow.
      </CardFooter>
    </Card>
  );
}
