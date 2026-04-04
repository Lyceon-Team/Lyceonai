import { Request, Response, Router } from 'express';
import { getSupabaseAdmin } from '../middleware/supabase-auth';
import { getUncachableStripeClient } from '../lib/stripeClient';
import { logger } from '../logger';
import { createGuardianLink, ensureAccountForUser } from '../lib/account';
import { sendEmail } from '../lib/email';

const router = Router();

/**
 * GET /api/consent/request/:id
 * Fetch details of a consent request for the verification UI
 */
router.get('/request/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const admin = getSupabaseAdmin();

  try {
    const { data: request, error: requestError } = await admin
      .from('guardian_consent_requests')
      .select('*, profiles:child_id(display_name, email)')
      .eq('id', id)
      .single();

    if (requestError || !request) {
      return res.status(404).json({ error: 'Consent request not found' });
    }

    if (new Date(request.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Consent request has expired' });
    }

    res.json({
      id: request.id,
      childName: (request.profiles as any)?.display_name || (request.profiles as any)?.email,
      guardianEmail: request.guardian_email,
      status: request.status
    });
  } catch (err) {
    logger.error('CONSENT', 'fetch_request_error', 'Failed to fetch consent request', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/consent/create-checkout-session
 * Create a Stripe Checkout Session for $0.50 identity verification
 */
router.post('/create-checkout-session', async (req: Request, res: Response) => {
  const { requestId } = req.body;
  const admin = getSupabaseAdmin();

  try {
    const { data: request, error: requestError } = await admin
      .from('guardian_consent_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (requestError || !request) {
      return res.status(404).json({ error: 'Consent request not found' });
    }

    const stripe = await getUncachableStripeClient();
    const siteUrl = process.env.PUBLIC_SITE_URL || `${req.protocol}://${req.get('host')}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Guardian Identity Verification',
            description: 'One-time $0.50 charge for COPPA compliance verification (immediately voided/refunded).'
          },
          unit_amount: 50, // $0.50
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${siteUrl}/guardian/verify-consent?requestId=${requestId}&sessionId={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/guardian/verify-consent?requestId=${requestId}&canceled=true`,
      metadata: {
        requestId: request.id,
        guardianEmail: request.guardian_email,
        childId: request.child_id,
        purpose: 'guardian_consent_verification'
      },
      payment_intent_data: {
        capture_method: 'manual', // Authorize only
        metadata: {
          requestId: request.id,
          guardianEmail: request.guardian_email,
          childId: request.child_id
        }
      }
    });

    res.json({ url: session.url });
  } catch (err) {
    logger.error('CONSENT', 'create_session_error', 'Failed to create checkout session', err);
    res.status(500).json({ error: 'Failed to initialize verification' });
  }
});

/**
 * POST /api/consent/verify-session
 * Verify that the checkout session was successful and approve consent
 */
router.post('/verify-session', async (req: Request, res: Response) => {
  const { requestId, sessionId } = req.body;
  const admin = getSupabaseAdmin();

  try {
    const stripe = await getUncachableStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent']
    });

    const pi = session.payment_intent as any;
    const isAuthorized = session.payment_status === 'paid' ||
      session.payment_status === 'no_payment_required' ||
      (pi && pi.status === 'requires_capture');

    if (!isAuthorized) {
      logger.warn('CONSENT', 'payment_not_completed', 'Stripe session payment not completed', {
        sessionId,
        paymentStatus: session.payment_status,
        piStatus: pi?.status
      });
      return res.status(400).json({ error: 'Payment not completed or authorized' });
    }

    const { data: request, error: requestError } = await admin
      .from('guardian_consent_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (requestError || !request) {
      return res.status(404).json({ error: 'Consent request not found' });
    }

    if (request.status === 'approved') {
      return res.json({ success: true, message: 'Already approved' });
    }

    // 1. Approve the consent request
    await admin
      .from('guardian_consent_requests')
      .update({ status: 'approved' })
      .eq('id', requestId);

    // 2. Update child's profile
    await admin
      .from('profiles')
      .update({ guardian_consent: true, consent_given_at: new Date().toISOString() })
      .eq('id', request.child_id);

    const siteUrl = process.env.PUBLIC_SITE_URL || `${req.protocol}://${req.get('host')}`;
    const childName = (request.profiles as any)?.display_name || 'your child';

    // 3. Find or Create Guardian User
    let guardianId: string;
    const { data: existingGuardian, error: findError } = await admin
      .from('profiles')
      .select('id')
      .eq('email', request.guardian_email)
      .single();

    if (existingGuardian) {
      guardianId = existingGuardian.id;

      // Link notification for existing guardian
      await sendEmail({
        to: request.guardian_email,
        subject: `Verification Successful: Your child ${childName} is ready`,
        html: `
          <h1>Verification Complete</h1>
          <p>You have successfully verified your identity and granted consent for <strong>${childName}</strong> to use Lyceon.</p>
          <p>The student account is now active. You can now monitor their progress from your guardian dashboard.</p>
          <p><a href="${siteUrl}/login">Sign in to your dashboard</a></p>
        `
      });
    } else {
      // Generate invitation link for new guardian
      const { data: inviteData, error: inviteError } = await admin.auth.admin.generateLink({
        type: 'invite',
        email: request.guardian_email,
        options: {
          data: { role: 'guardian' },
          redirectTo: `${siteUrl}/profile/complete`
        }
      });

      if (inviteError || !inviteData.properties?.action_link) {
        logger.error('CONSENT', 'guardian_invite_failed', 'Failed to generate guardian invitation link', inviteError);
        throw new Error('Guardian invitation failed');
      }

      guardianId = (inviteData as any).user.id;

      // Send invitation email via Resend
      await sendEmail({
        to: request.guardian_email,
        subject: "Welcome to Lyceon: Set up your guardian account",
        html: `
          <h1>Verification Successful</h1>
          <p>Thank you for verifying your identity. You have successfully granted consent for <strong>${childName}</strong> to use Lyceon.</p>
          <p>A parent account has been created for you. Please click the link below to set your password and access your dashboard:</p>
          <p><a href="${inviteData.properties.action_link}">${inviteData.properties.action_link}</a></p>
          <p>After setting your password, you will be able to monitor ${childName}'s progress and manage their learning experience.</p>
        `
      });
    }

    // 4. Link Parent and Student
    // Ensure both have accounts
    const studentAccountId = await ensureAccountForUser(admin, request.child_id, 'student');
    await ensureAccountForUser(admin, guardianId, 'guardian');

    await createGuardianLink(guardianId, request.child_id, studentAccountId);

    // 5. Removed legacy write to child profile.guardian_profile_id (guardian_links is now canonical truth)
    // 6. Void the Stripe charge if it was an auth
    if (session.payment_intent) {
      const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent.id;
      await stripe.paymentIntents.cancel(piId).catch(err => {
        logger.warn('CONSENT', 'void_failed', 'Failed to void verification charge (might be already voided)', { piId, error: err.message });
      });
    }

    logger.info('CONSENT', 'verification_success', 'Guardian consent verified and linked', {
      requestId,
      childId: request.child_id,
      guardianId
    });

    res.json({ success: true, message: 'Consent verified successfully' });
  } catch (err) {
    logger.error('CONSENT', 'verify_session_error', 'Failed to verify checkout session', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

export default router;
