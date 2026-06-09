import { Request, Response, Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "../middleware/supabase-auth";
import { getUncachableStripeClient } from "../lib/stripeClient";
import { logger } from "../logger";
import { createGuardianLink, ensureAccountForUser } from "../lib/account";
import { sendEmail } from "../lib/email";

const router = Router();

// @spec [GAP-ID-11 | docs/Spec/lyceon-coding-standards.md §12.1 (privacy/redaction)] | @implemented [2026-06-07]
// plain English: never log a raw bearer capability (the consent requestId) or a
// raw Stripe session id. Emit a non-reversible, truncated digest (first 8 hex of
// sha256) for forensic correlation only.
function digest8(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

// @spec [GAP-ID-11 | docs/Spec/lyceon-coding-standards.md §8.3 (429), §7.1 (Zod)] | @implemented [2026-06-07]
// plain English: the consent verify/checkout endpoints are unauthenticated by
// necessity (the Stripe post-checkout redirect lands on a public page and a new
// guardian's account does not exist until verify-session creates it). To bound
// abuse of these open endpoints we apply the same express-rate-limit primitive
// used by the auth routes (server/routes/supabase-auth-routes.ts:17). 429 on overflow.
const consentRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: "Too many verification attempts. Please try again later.",
    });
  },
});

const createCheckoutSchema = z.object({
  requestId: z.string().uuid(),
});

// requestId is OPTIONAL in the body: selection is driven by session.metadata
// (see verify-session). When present it is only used as a compare-and-reject
// guard, so it must be a UUID to be a meaningful comparison.
const verifySessionSchema = z.object({
  sessionId: z.string().min(1).max(255),
  requestId: z.string().uuid().optional(),
});

/**
 * GET /api/consent/request/:id
 * Fetch details of a consent request for the verification UI
 */
router.get("/request/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const admin = getSupabaseAdmin();

  try {
    const { data: request, error: requestError } = await admin
      .from("guardian_consent_requests")
      .select("*, profiles:child_id(display_name, email)")
      .eq("id", id)
      .single();

    if (requestError || !request) {
      return res.status(404).json({ error: "Consent request not found" });
    }

    if (new Date(request.expires_at) < new Date()) {
      return res.status(400).json({ error: "Consent request has expired" });
    }

    res.json({
      id: request.id,
      childName:
        (request.profiles as any)?.display_name ||
        (request.profiles as any)?.email,
      guardianEmail: request.guardian_email,
      status: request.status,
    });
  } catch (err) {
    logger.error(
      "CONSENT",
      "fetch_request_error",
      "Failed to fetch consent request",
      err,
    );
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/consent/create-checkout-session
 * Create a Stripe Checkout Session for $0.50 identity verification
 */
router.post(
  "/create-checkout-session",
  consentRateLimiter,
  async (req: Request, res: Response) => {
    // @spec [GAP-ID-11 | §7.1] | @implemented [2026-06-07]
    // plain English: Zod-parse the body; only a UUID requestId is accepted.
    const parsed = createCheckoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { message: "Invalid input", details: parsed.error.flatten() },
      });
    }
    const { requestId } = parsed.data;
    const admin = getSupabaseAdmin();

    try {
      const { data: request, error: requestError } = await admin
        .from("guardian_consent_requests")
        .select("*")
        .eq("id", requestId)
        .single();

      if (requestError || !request) {
        return res.status(404).json({ error: "Consent request not found" });
      }

      const stripe = await getUncachableStripeClient();
      const siteUrl =
        process.env.PUBLIC_SITE_URL || `${req.protocol}://${req.get("host")}`;

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        // @spec [GAP-ID-11.9 | owner ruling 2026-06-07] | @implemented [2026-06-07]
        // plain English: bind the payment identity to the intended recipient by
        // setting customer_email server-side from the stored guardian email — the
        // payer cannot type an arbitrary address. Any hijack attempt therefore
        // emits a Stripe receipt to the victim's inbox (detection, not just
        // prevention). guardian_email is NOT logged anywhere (PII, §12.1).
        customer_email: request.guardian_email,
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "Guardian Identity Verification",
                description:
                  "One-time $0.50 charge for COPPA compliance verification (immediately voided/refunded).",
              },
              unit_amount: 50, // $0.50
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: `${siteUrl}/guardian/verify-consent?requestId=${requestId}&sessionId={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteUrl}/guardian/verify-consent?requestId=${requestId}&canceled=true`,
        metadata: {
          requestId: request.id,
          guardianEmail: request.guardian_email,
          childId: request.child_id,
          purpose: "guardian_consent_verification",
        },
        payment_intent_data: {
          capture_method: "manual", // Authorize only
          metadata: {
            requestId: request.id,
            guardianEmail: request.guardian_email,
            childId: request.child_id,
          },
        },
      });

      res.json({ url: session.url });
    } catch (err) {
      logger.error(
        "CONSENT",
        "create_session_error",
        "Failed to create checkout session",
        err,
      );
      res.status(500).json({ error: "Failed to initialize verification" });
    }
  },
);

/**
 * POST /api/consent/verify-session
 * Verify that the checkout session was successful and approve consent
 */
router.post(
  "/verify-session",
  consentRateLimiter,
  async (req: Request, res: Response) => {
    // @spec [GAP-ID-11 | docs/Spec/lyceon-coding-standards.md §7.1, §6 (server-authoritative)] | @implemented [2026-06-07]
    // plain English: this endpoint flips parental consent for a child, so it must
    // NOT trust the client's requestId for selection. We (1) Zod-parse the body,
    // (2) retrieve the Stripe session and verify payment, (3) DERIVE the request
    // id from session.metadata.requestId (set server-side at checkout creation),
    // (4) reject any body requestId that disagrees, (5) gate on expiry + pending
    // state, and (6) make approval idempotent. A forged body requestId or a paid
    // session created for a different request can no longer approve an arbitrary
    // child. Trade-off / residual: requestId remains an email-delivered bearer
    // capability (create-checkout is unauthenticated) — full guardian-identity
    // binding is deferred to WS-3 (GAP-ID-11 residual note in the registry).
    const parsed = verifySessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { message: "Invalid input", details: parsed.error.flatten() },
      });
    }
    const { sessionId, requestId: bodyRequestId } = parsed.data;
    const admin = getSupabaseAdmin();

    try {
      const stripe = await getUncachableStripeClient();
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent"],
      });

      // Narrow payment_intent without `any` (it is string | PaymentIntent | null).
      const pi =
        typeof session.payment_intent === "object"
          ? session.payment_intent
          : null;
      const isAuthorized =
        session.payment_status === "paid" ||
        session.payment_status === "no_payment_required" ||
        (pi !== null && pi.status === "requires_capture");

      if (!isAuthorized) {
        logger.warn(
          "CONSENT",
          "payment_not_completed",
          "Stripe session payment not completed",
          {
            sessionIdDigest: digest8(sessionId),
            paymentStatus: session.payment_status,
            piStatus: pi?.status,
          },
        );
        return res
          .status(400)
          .json({ error: "Payment not completed or authorized" });
      }

      // Server-authoritative selection: the request id comes ONLY from the Stripe
      // session's own metadata (set at checkout creation, line ~84). No fallback
      // to the body value.
      const metadataRequestId = session.metadata?.requestId;
      if (!metadataRequestId) {
        logger.warn(
          "CONSENT",
          "metadata_unbound",
          "Stripe session is not bound to a consent request",
          { sessionIdDigest: digest8(sessionId) },
        );
        return res
          .status(400)
          .json({ error: "Payment session is not bound to a consent request" });
      }

      // Compare-and-reject: if the client supplied a requestId it MUST match the
      // metadata-derived id. Mismatch => 400 with NO state change.
      if (bodyRequestId && bodyRequestId !== metadataRequestId) {
        logger.warn(
          "CONSENT",
          "request_id_mismatch",
          "Body requestId does not match Stripe session metadata",
          {
            sessionIdDigest: digest8(sessionId),
            metadataRequestIdDigest: digest8(metadataRequestId),
            bodyRequestIdDigest: digest8(bodyRequestId),
          },
        );
        return res
          .status(400)
          .json({ error: "Request does not match payment session" });
      }

      const { data: request, error: requestError } = await admin
        .from("guardian_consent_requests")
        .select("*")
        .eq("id", metadataRequestId)
        .single();

      if (requestError || !request) {
        return res.status(404).json({ error: "Consent request not found" });
      }

      // Idempotent: an already-approved request returns success without re-mutating
      // or re-linking (covers the post-redirect double-fire and replay).
      if (request.status === "approved") {
        return res.json({ success: true, message: "Already approved" });
      }

      // Expiry gate: stale emailed links must die. expires_at is NOT NULL on the table.
      if (new Date(request.expires_at) < new Date()) {
        logger.warn(
          "CONSENT",
          "request_expired",
          "Consent request has expired",
          { requestIdDigest: digest8(metadataRequestId) },
        );
        return res.status(400).json({ error: "Consent request has expired" });
      }

      // Approvable-state gate: only a pending request may be approved. A revoked
      // (or otherwise non-pending) request is never mutated.
      if (request.status !== "pending") {
        logger.warn(
          "CONSENT",
          "request_not_approvable",
          "Consent request is not in an approvable state",
          {
            requestIdDigest: digest8(metadataRequestId),
            status: request.status,
          },
        );
        return res
          .status(409)
          .json({ error: "Consent request is not in an approvable state" });
      }

      const requestId = metadataRequestId;

      // 1. Approve the consent request
      await admin
        .from("guardian_consent_requests")
        .update({ status: "approved" })
        .eq("id", requestId);

      // 2. Update child's profile
      await admin
        .from("profiles")
        .update({
          guardian_consent: true,
          consent_given_at: new Date().toISOString(),
        })
        .eq("id", request.child_id);

      const siteUrl =
        process.env.PUBLIC_SITE_URL || `${req.protocol}://${req.get("host")}`;
      const childName = (request.profiles as any)?.display_name || "your child";

      // 3. Find or Create Guardian User
      let guardianId: string;
      const { data: existingGuardian } = await admin
        .from("profiles")
        .select("id")
        .eq("email", request.guardian_email)
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
        `,
        });
      } else {
        // Generate invitation link for new guardian
        const { data: inviteData, error: inviteError } =
          await admin.auth.admin.generateLink({
            type: "invite",
            email: request.guardian_email,
            options: {
              data: { role: "guardian" },
              redirectTo: `${siteUrl}/profile/complete`,
            },
          });

        if (inviteError || !inviteData.properties?.action_link) {
          logger.error(
            "CONSENT",
            "guardian_invite_failed",
            "Failed to generate guardian invitation link",
            inviteError,
          );
          throw new Error("Guardian invitation failed");
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
        `,
        });
      }

      // 4. Link Parent and Student
      // Ensure both have accounts
      const studentAccountId = await ensureAccountForUser(
        admin,
        request.child_id,
        "student",
      );
      await ensureAccountForUser(admin, guardianId, "guardian");

      await createGuardianLink(guardianId, request.child_id, studentAccountId);

      // 5. Removed legacy write to child profile.guardian_profile_id (guardian_links is now canonical truth)
      // 6. Void the Stripe charge if it was an auth
      if (session.payment_intent) {
        const piId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent.id;
        await stripe.paymentIntents.cancel(piId).catch((err) => {
          logger.warn(
            "CONSENT",
            "void_failed",
            "Failed to void verification charge (might be already voided)",
            { piId, error: err.message },
          );
        });
      }

      logger.info(
        "CONSENT",
        "verification_success",
        "Guardian consent verified and linked",
        {
          requestIdDigest: digest8(requestId),
          childId: request.child_id,
          guardianId,
        },
      );

      res.json({ success: true, message: "Consent verified successfully" });
    } catch (err) {
      logger.error(
        "CONSENT",
        "verify_session_error",
        "Failed to verify checkout session",
        err,
      );
      res.status(500).json({ error: "Verification failed" });
    }
  },
);

export default router;
