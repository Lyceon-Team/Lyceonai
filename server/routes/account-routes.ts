import { Request, Response, Router } from "express";
import { requireSupabaseAuth } from "../middleware/supabase-auth";
import { doubleCsrfProtection } from "../middleware/csrf-double-submit";
import {
  getAllAccountsForUser,
  getEntitlementForProfile,
  getDailyUsage,
} from "../lib/account";
import { logger } from "../logger";
import { defaultSuppressionTransport } from "../lib/notifications/transport";
import { recordEmailReconsent } from "../services/email-reconsent-audit";

const router = Router();

router.get(
  "/status",
  requireSupabaseAuth,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    const userId = req.user!.id;

    try {
      const accounts = await getAllAccountsForUser(userId);

      if (accounts.length === 0) {
        return res.json({
          hasAccount: false,
          accounts: [],
          selectedAccountId: null,
          entitlement: null,
          usage: null,
          accountSelectionEnabled: false,
          requestId,
        });
      }

      // Locked model: runtime account switching is disabled.
      const selectedAccountId = accounts[0].accountId;

      // profile_id = userId — read entitlement directly (no auto-create; null = free tier)
      const entitlement = await getEntitlementForProfile(userId);
      const usage = await getDailyUsage(selectedAccountId);

      logger.info("ACCOUNT", "status", "Account status retrieved", {
        userId,
        selectedAccountId,
        accountCount: accounts.length,
        requestId,
      });

      res.json({
        hasAccount: true,
        accounts,
        selectedAccountId,
        entitlement: {
          tier: entitlement?.tier ?? "free",
          plan: entitlement?.tier === "premium" ? "paid" : "free",
          status: entitlement?.status ?? "inactive",
          currentPeriodEnd: entitlement?.current_period_end ?? null,
        },
        usage: {
          practiceQuestionsUsed: usage?.practice_questions_used || 0,
          aiMessagesUsed: usage?.ai_messages_used || 0,
          day: new Date().toISOString().split("T")[0],
        },
        accountSelectionEnabled: false,
        requestId,
      });
    } catch (err: any) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      logger.error("ACCOUNT", "status", "Failed to get account status", {
        userId,
        error: errorMessage,
        requestId,
      });

      res.status(500).json({
        error: "Failed to get account status",
        requestId,
        debug: {
          userId,
          message: errorMessage,
        },
      });
    }
  },
);

router.post(
  "/select",
  requireSupabaseAuth,
  doubleCsrfProtection,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;

    logger.warn(
      "ACCOUNT",
      "select_blocked",
      "Account switching is disabled by runtime guardian model",
      {
        userId: req.user?.id,
        requestId,
      },
    );

    return res.status(409).json({
      error: "Account switching is disabled in the current guardian model",
      code: "ACCOUNT_SELECTION_DISABLED",
      requestId,
    });
  },
);

// @spec [SCL-090 PROPOSED as ruled 2026-09-17 ("keep the suppression, surface it, one click to
//        clear"); owner follow-up 2026-09-17 "Replace Bespoke Suppression With Resend's" §4;
//        contracts/notifications.contract.md §11A.4-§11A.6; lyceon-coding-standards §6.1
//        server-authoritative auth, §12.1 never log content] | @implemented [2026-09-17]
//
// plain English: WHY THIS SURFACE HAS TO EXIST. A do-not-contact request survives the deletion of
// the account it came from, because that is the promise. Resend applies its suppression list to
// every send the team makes — including the mail Supabase Auth sends through it — so a student who
// deleted with suppression and later signs up again cannot receive a password reset, not merely a
// product notification. Registration deliberately does not consult the list and deliberately does
// not clear it: signing up again is not unambiguous consent to be contacted, and the original
// request may have come from a parent. Without this surface, that person is locked out of account
// recovery with no way to find out why. So: show them, and let them lift it themselves.
//
// THE ADDRESS IS NEVER TAKEN FROM THE CLIENT. It comes from the authenticated session's profile.
// A body-supplied address would turn both routes into an oracle for "has this address ever been
// deleted with suppression", and the clear route into a way to un-suppress somebody else.
//
// ONLY A `manual` ENTRY IS OURS TO LIFT. Resend also suppresses on hard bounce and on spam
// complaint. Those are not do-not-contact requests and clearing them is not consent — a bounce
// means the mailbox rejected us and a complaint means somebody reported us, and re-sending to
// either harms deliverability for every other student. Those entries are reported honestly and
// routed to support instead. Ours are always `manual`.
router.get(
  "/email-suppression",
  requireSupabaseAuth,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    const userId = req.user!.id;
    const address = req.user!.email;

    const entry = await defaultSuppressionTransport().get(address);
    if (!entry.ok) {
      // No invented third state in the payload: if the provider cannot be asked, the surface
      // renders nothing rather than asserting "your email is on" when it may not be.
      logger.warn(
        "ACCOUNT",
        "email_suppression_read_failed",
        "Could not read the suppression list; the settings panel will not render",
        { userId, kind: entry.error.kind, status: entry.error.status, requestId },
      );
      return res.status(503).json({
        error: "Suppression status unavailable",
        requestId,
      });
    }

    const row = entry.value;
    return res.json({
      ok: true,
      suppressed: row !== null,
      origin: row?.origin ?? null,
      clearable: row?.origin === "manual",
      requestId,
    });
  },
);

// Lifting it. The removal at Resend is the act; the `audit_logs` row is the record that the
// subject — not an operator, not a script — asked to be contacted again. `deletion_request_log`
// is deliberately NOT written here: its `suppression_status` stays 'applied', which is the value
// the executor's retry sweep skips, so tonight's pass cannot silently re-suppress them. It also
// keeps this route out of the evidence universe entirely (plan v4 §2).
router.post(
  "/email-suppression/clear",
  requireSupabaseAuth,
  doubleCsrfProtection,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    const userId = req.user!.id;
    const address = req.user!.email;

    const existing = await defaultSuppressionTransport().get(address);
    if (!existing.ok) {
      return res.status(503).json({
        error: "Suppression status unavailable",
        requestId,
      });
    }
    if (existing.value === null) {
      // Nothing to lift. Not an error — the end state the caller wanted already holds.
      return res.json({ ok: true, cleared: false, requestId });
    }
    if (existing.value.origin !== "manual") {
      logger.warn(
        "ACCOUNT",
        "email_suppression_clear_refused",
        "Refused to clear a bounce/complaint suppression from the account surface",
        { userId, origin: existing.value.origin, requestId },
      );
      return res.status(409).json({
        error: "This suppression was not created by a do-not-contact request",
        code: "SUPPRESSION_NOT_CLEARABLE",
        requestId,
      });
    }

    const removed = await defaultSuppressionTransport().remove(address);
    if (!removed.ok) {
      logger.error(
        "ACCOUNT",
        "email_suppression_clear_failed",
        "Resend did not accept the suppression removal; the address stays suppressed",
        undefined,
        { userId, kind: removed.error.kind, status: removed.error.status, requestId },
      );
      return res.status(502).json({
        error: "Could not clear the suppression",
        requestId,
      });
    }

    // THE RE-CONSENT RECORD. Written after the removal succeeded, so the log never claims a
    // consent that did not take effect. It pages on failure rather than failing the response:
    // the suppression IS lifted by now, and telling the caller otherwise would invite a second
    // click on something that already worked.
    await recordEmailReconsent({
      profileId: userId,
      previousOrigin: "manual",
      ...(requestId !== undefined ? { requestId } : {}),
    });

    return res.json({ ok: true, cleared: true, requestId });
  },
);

export default router;
