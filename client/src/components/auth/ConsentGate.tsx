import { useState } from 'react';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ShieldCheck, AlertCircle, Mail } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function ConsentGate() {
  const { user, submitConsent, signOut } = useSupabaseAuth();
  const { toast } = useToast();
  const [guardianEmail, setGuardianEmail] = useState(user?.guardian_email ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmitConsent = async (consent: boolean) => {
    if (consent && !guardianEmail) {
      setError('Guardian email is required');
      return;
    }

    setError('');
    setIsSubmitting(true);

    try {
      await submitConsent(guardianEmail, consent);
      
      if (consent) {
        toast({
          title: 'Consent submitted!',
          description: 'Consent details were recorded for your account.',
        });
      } else {
        toast({
          title: 'Access restricted',
          description: 'You must be 13 or older, or have guardian consent to use this service.',
          variant: 'destructive',
        });
        await signOut();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to submit consent');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <CardTitle className="text-2xl">Guardian Consent Required</CardTitle>
          <CardDescription className="text-center">
            Users under 13 need guardian permission to use Lyceon
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              This requirement supports COPPA compliance and student data privacy.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="guardian-email">Guardian's Email Address</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="guardian-email"
                data-testid="input-guardian-email"
                type="email"
                placeholder="guardian@email.com"
                value={guardianEmail}
                onChange={(e) => setGuardianEmail(e.target.value)}
                className="pl-10"
                disabled={isSubmitting}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              This email is stored with the consent record for compliance.
            </p>
          </div>

          {error && (
            <Alert variant="destructive" data-testid="alert-error">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => handleSubmitConsent(false)}
              disabled={isSubmitting}
              data-testid="button-decline"
            >
              I Don't Consent
            </Button>
            <Button
              className="flex-1"
              onClick={() => handleSubmitConsent(true)}
              disabled={isSubmitting || !guardianEmail}
              data-testid="button-submit-consent"
            >
              {isSubmitting ? 'Submitting...' : 'Request Consent'}
            </Button>
          </div>

          <div className="text-center">
            <Button
              variant="link"
              onClick={signOut}
              className="text-sm text-muted-foreground"
              data-testid="button-signout"
            >
              Sign out instead
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
