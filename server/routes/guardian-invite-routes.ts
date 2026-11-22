/**
 * The guardian's invites to their teen: list, start, resend, copy a new link, cancel.
 *
 * @spec [owner rulings 2026-11-21 (counsel-approved) 1, 2, 5; SCL-282; Doc 01 V8 §36.1 (the
 *        guardian-initiated path), §36.2 (10 a day per guardian, 3 a day per address);
 *        supabase/migrations/20261206000000_guardian_invites.sql] | @implemented [2026-11-22]
 *
 * plain English: mounted at /api/guardian/invites behind Supabase auth, CSRF and the guardian
 * role. Every operation acts only on the CALLER's own open invite (the SQL functions check
 * ownership; anything else is a 404). Every new link replaces the previous one, lasts 14 days,
 * and is returned to the guardian once in the response; the server keeps only its hash.
 *   GET    /             the caller's open invites (expired ones too, so they can be renewed)
 *   POST   /             start an invite: email it, or (no email) just return the link
 *   POST   /:id/resend   a new link, emailed to the address given
 *   POST   /:id/link     a new link, nothing sent (Copy link)
 *   DELETE /:id          cancel: the link stops working
 * Starting an invite requires an adult guardian (18+, date of birth on file) and records the
 * guardian's acceptance of the Parent / Guardian Terms, as link-code redemption does. Every new
 * link counts against 10 a day per guardian; every email also against 3 a day per (guardian,
 * address). A guardian may have at most 3 open invites.
 *
 * The response is the same whether or not an address has an account: no address is ever looked
 * up. The raw token appears only in the returned link and in the email; it is never logged.
 */
import { Request, Response, Router } from "express";
import { z } from "zod";
import { requireGuardianRole } from "../middleware/guardian-role";
import { applyGuardianTeenInviteRateLimit } from "../middleware/guardian-link-rate-limit";
import {
  GuardianInviteLimitError,
  cancelGuardianInvite,
  hashGuardianInviteEmail,
  issueGuardianInvite,
  listOpenGuardianInvites,
  lookupGuardianInvite,
  newGuardianInviteToken,
  toGuardianInviteView,
  type GuardianInviteRow,
} from "../lib/guardian-invites";
import { checkGuardianIsAdult } from "../lib/guardian-age";
import { sendGuardianTeenInviteEmail } from "../lib/notifications/direct-sends";
import { siteUrlFromEnv } from "../lib/notifications/templates";
import { recordLegalAcceptances } from "../lib/legal-acceptance";
import { resolveLegalVersion } from "../lib/legal-registry.js";
import { GUARDIAN_LINK_LEGAL_DOC } from "../../shared/legal-consent.js";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import {
  issueGuardianInviteRequestSchema,
  joinPath,
  resendGuardianInviteRequestSchema,
  type GuardianInviteLinkResponse,
  type GuardianInvitesResponse,
} from "../../packages/shared/src/guardian-invite-schema";

const router = Router();

router.use(
  requireGuardianRole({
    message: "You do not have permission to access guardian resources",
  }),
);

const inviteIdSchema = z.string().uuid();

function notFound(res: Response, requestId: string | undefined): void {
  res.status(404).json({
    error: { code: "GUARDIAN_INVITE_NOT_FOUND", message: "Invite not found." },
    requestId,
  });
}

function invalidInput(
  res: Response,
  error: z.ZodError,
  requestId: string | undefined,
): void {
  res.status(400).json({
    error: { message: "Invalid input", details: error.flatten() },
    requestId,
  });
}

function limitReached(res: Response, requestId: string | undefined): void {
  res.status(409).json({
    error: {
      code: "GUARDIAN_INVITE_LIMIT",
      message: "You have 3 open invites. Cancel one before starting another.",
    },
    requestId,
  });
}

function failure(
  res: Response,
  action: string,
  err: unknown,
  requestId: string | undefined,
): void {
  logger.error("GUARDIAN_INVITE", action, "Invite operation failed", {
    error: err instanceof Error ? err.message : "unknown",
    requestId,
  });
  res.status(500).json({ error: "Internal server error", requestId });
}

/**
 * The adult-guardian rule, before any link is handed out: the guardian is the caller here.
 * Returns true when the response has been written.
 */
async function refuseUnlessAdult(
  res: Response,
  guardianId: string,
  requestId: string | undefined,
): Promise<boolean> {
  const check = await checkGuardianIsAdult(guardianId);
  if (check.ok) return false;
  logger.warn("GUARDIAN_INVITE", "age", "Guardian age rule refused invite", {
    code: check.refusal.code,
    requestId,
  });
  res.status(403).json({
    error: { code: check.refusal.code, message: check.refusal.message },
    requestId,
  });
  return true;
}

/**
 * The guardian's acceptance of the Parent / Guardian Terms, recorded when they start an invite.
 * Fail-open, exactly as at link-code redemption (owner ruling 2026-09-16): an unrecorded
 * acceptance is logged at ERROR and collected by the re-consent prompt; the user is never
 * refused over a consent we failed to record.
 */
async function recordParentTermsAcceptance(
  req: Request,
  guardianId: string,
): Promise<void> {
  try {
    const parentTerms = resolveLegalVersion(GUARDIAN_LINK_LEGAL_DOC.slug);
    await recordLegalAcceptances(supabaseServer, {
      userId: guardianId,
      consentSource: "guardian_invite_issue",
      userAgent: req.get("user-agent") ?? null,
      ipAddress: req.ip ?? null,
      acceptances: [
        {
          docKey: GUARDIAN_LINK_LEGAL_DOC.docKey,
          docSlug: parentTerms.slug,
          docVersion: parentTerms.version,
          contentHash: parentTerms.contentHash,
          actorType: "parent",
          minor: false,
        },
      ],
    });
  } catch (consentErr: unknown) {
    logger.error(
      "GUARDIAN_INVITE",
      "issue",
      "Parent / Guardian Terms consent could not be recorded; the invite proceeds and the prompt will ask again",
      {
        error: consentErr instanceof Error ? consentErr.message : "unknown",
        requestId: req.requestId,
      },
    );
  }
}

/**
 * Email the link. The guardian's first name comes from the same SQL helper /join uses, through
 * the lookup of the token just issued. A failed send is not an error: the link is still in the
 * response and can be copied.
 */
async function emailInvite(input: {
  row: GuardianInviteRow;
  token: string;
  toEmail: string;
  guardianId: string;
  requestId: string | undefined;
}): Promise<boolean> {
  const lookup = await lookupGuardianInvite(input.token);
  const guardianFirstName =
    lookup.state === "open" ? lookup.guardian_first_name : "";
  const sent = await sendGuardianTeenInviteEmail({
    inviteId: input.row.id,
    guardianProfileId: input.guardianId,
    guardianFirstName,
    token: input.token,
    tokenIssuedAt: input.row.token_issued_at,
    expiresAt: input.row.expires_at,
    toEmail: input.toEmail,
    ...(input.requestId ? { requestId: input.requestId } : {}),
  });
  return sent.ok;
}

function linkResponse(
  row: GuardianInviteRow,
  token: string,
  emailed: boolean,
): GuardianInviteLinkResponse {
  return {
    data: {
      invite: toGuardianInviteView(row, Date.now()),
      url: `${siteUrlFromEnv()}${joinPath(token)}`,
      emailed,
    },
  };
}

/** GET /api/guardian/invites */
router.get("/", async (req: Request, res: Response) => {
  const requestId = req.requestId;
  try {
    const rows = await listOpenGuardianInvites(req.user!.id);
    const now = Date.now();
    const body: GuardianInvitesResponse = {
      data: { invites: rows.map((r) => toGuardianInviteView(r, now)) },
    };
    return res.json(body);
  } catch (err: unknown) {
    return failure(res, "list", err, requestId);
  }
});

/** POST /api/guardian/invites — start an invite. */
router.post("/", async (req: Request, res: Response) => {
  const requestId = req.requestId;
  const guardianId = req.user!.id;
  const parsed = issueGuardianInviteRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) return invalidInput(res, parsed.error, requestId);
  const toEmail = parsed.data.email ?? null;
  try {
    if (await refuseUnlessAdult(res, guardianId, requestId)) return;
    if (
      await applyGuardianTeenInviteRateLimit(
        res,
        guardianId,
        toEmail,
        requestId,
      )
    ) {
      return;
    }
    await recordParentTermsAcceptance(req, guardianId);

    const { token, tokenHash } = newGuardianInviteToken();
    const row = await issueGuardianInvite({
      guardianProfileId: guardianId,
      tokenHash,
      emailHash: toEmail === null ? null : hashGuardianInviteEmail(toEmail),
      inviteId: null,
      ...(requestId ? { requestId } : {}),
    });
    if (!row) throw new Error("issue returned no row for a new invite");

    const emailed =
      toEmail === null
        ? false
        : await emailInvite({ row, token, toEmail, guardianId, requestId });
    return res.status(201).json(linkResponse(row, token, emailed));
  } catch (err: unknown) {
    if (err instanceof GuardianInviteLimitError) {
      return limitReached(res, requestId);
    }
    return failure(res, "issue", err, requestId);
  }
});

/** POST /api/guardian/invites/:id/resend — a new link, emailed. */
router.post("/:id/resend", async (req: Request, res: Response) => {
  const requestId = req.requestId;
  const guardianId = req.user!.id;
  const inviteId = inviteIdSchema.safeParse(req.params.id);
  if (!inviteId.success) return notFound(res, requestId);
  const parsed = resendGuardianInviteRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) return invalidInput(res, parsed.error, requestId);
  try {
    if (await refuseUnlessAdult(res, guardianId, requestId)) return;
    if (
      await applyGuardianTeenInviteRateLimit(
        res,
        guardianId,
        parsed.data.email,
        requestId,
      )
    ) {
      return;
    }
    const { token, tokenHash } = newGuardianInviteToken();
    const row = await issueGuardianInvite({
      guardianProfileId: guardianId,
      tokenHash,
      emailHash: hashGuardianInviteEmail(parsed.data.email),
      inviteId: inviteId.data,
      ...(requestId ? { requestId } : {}),
    });
    if (!row) return notFound(res, requestId);
    const emailed = await emailInvite({
      row,
      token,
      toEmail: parsed.data.email,
      guardianId,
      requestId,
    });
    return res.json(linkResponse(row, token, emailed));
  } catch (err: unknown) {
    if (err instanceof GuardianInviteLimitError) {
      return limitReached(res, requestId);
    }
    return failure(res, "resend", err, requestId);
  }
});

/** POST /api/guardian/invites/:id/link — Copy link: a new link, nothing sent. */
router.post("/:id/link", async (req: Request, res: Response) => {
  const requestId = req.requestId;
  const guardianId = req.user!.id;
  const inviteId = inviteIdSchema.safeParse(req.params.id);
  if (!inviteId.success) return notFound(res, requestId);
  try {
    if (await refuseUnlessAdult(res, guardianId, requestId)) return;
    if (
      await applyGuardianTeenInviteRateLimit(res, guardianId, null, requestId)
    ) {
      return;
    }
    const { token, tokenHash } = newGuardianInviteToken();
    const row = await issueGuardianInvite({
      guardianProfileId: guardianId,
      tokenHash,
      emailHash: null,
      inviteId: inviteId.data,
      ...(requestId ? { requestId } : {}),
    });
    if (!row) return notFound(res, requestId);
    return res.json(linkResponse(row, token, false));
  } catch (err: unknown) {
    if (err instanceof GuardianInviteLimitError) {
      return limitReached(res, requestId);
    }
    return failure(res, "link", err, requestId);
  }
});

/** DELETE /api/guardian/invites/:id — Cancel: the link stops working. */
router.delete("/:id", async (req: Request, res: Response) => {
  const requestId = req.requestId;
  const inviteId = inviteIdSchema.safeParse(req.params.id);
  if (!inviteId.success) return notFound(res, requestId);
  try {
    const row = await cancelGuardianInvite({
      guardianProfileId: req.user!.id,
      inviteId: inviteId.data,
      ...(requestId ? { requestId } : {}),
    });
    if (!row) return notFound(res, requestId);
    return res.status(204).end();
  } catch (err: unknown) {
    return failure(res, "cancel", err, requestId);
  }
});

export default router;
