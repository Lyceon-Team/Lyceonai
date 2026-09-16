import { Router, Request, Response } from "express";
import { getSupabaseAdmin } from "../../apps/api/src/lib/supabase-admin.js";
import {
  requireRequestUser,
  type AuthenticatedRequest,
} from "../middleware/supabase-auth";
import { recordLegalAcceptances } from "../lib/legal-acceptance";
import { resolveLegalVersion } from "../lib/legal-registry.js";
import type { ResolvedLegalVersion } from "../lib/legal-registry-types.js";
import { requiredLegalDocsForUse } from "../../shared/legal-consent.js";
import { logger } from "../logger";

export const legalRouter = Router();

/**
 * POST /api/legal/accept
 * Deprecated after auth-flow cutover.
 *
 * Legal acceptance is now captured only at canonical auth entry points
 * (email signup and explicit Google pre-oauth consent).
 */
legalRouter.post("/accept", (_req: Request, res: Response) => {
  return res.status(404).json({ success: false, error: "Not found" });
});

/**
 * POST /api/legal/reaccept — the blocking re-consent modal's one action.
 *
 * @spec [LYCEON consent capture §6]
 * @implemented 2026-09-16
 *
 * plain English: writes a fresh acceptance for every required document this
 * user does not hold at its currently published version. Takes NO body: the
 * client does not say which documents, or which versions — it would be
 * asserting what it was shown. The server recomputes both from `legal/` and
 * from this user's own rows.
 *
 * expected outcome: after a 200 the outstanding set is empty and the prompt
 * does not reappear. Nothing is written for a user who is already
 * current, and the response says so rather than pretending work happened.
 *
 * trade-offs / edge cases:
 *  - OLD ROWS ARE NEVER TOUCHED. The unique constraint is
 *    (user_id, doc_key, doc_version, actor_type), so a new version writes a NEW
 *    row and December's acceptance stays exactly as it was. It accurately
 *    records an acceptance of text we no longer hold; rewriting it would assert
 *    somebody agreed to something they never saw.
 *  - Re-posting when nothing is outstanding is a no-op 200, not an error. A
 *    double-submit from a modal is not a failure.
 */
legalRouter.post("/reaccept", async (req: Request, res: Response) => {
  // `requireRequestUser`, the house helper, rather than `(req as any).user`.
  // The two `as any` casts elsewhere in this file predate it; a third would
  // have been a new one, and the identity of the person whose consent this
  // writes is the last place to reach around the type system.
  const user = requireRequestUser(req as AuthenticatedRequest, res);
  if (!user) return;
  const userId = user.id;

  try {
    const admin = getSupabaseAdmin();

    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    const { data: existing, error: readErr } = await admin
      .from("legal_acceptances")
      .select("doc_key, doc_version")
      .eq("user_id", userId);
    if (readErr) {
      return res
        .status(500)
        .json({ success: false, error: "Could not read your acceptances" });
    }

    const rows = existing ?? [];
    // A CONSENT LOOKUP NEVER FAILS THE REQUEST. This filter used to call
    // resolveLegalVersion bare, so an unresolvable document 500'd the accept
    // action — the same defect that took /api/profile down, one route over. A
    // document we cannot resolve is logged and skipped: we will not write a row
    // we cannot stamp with a real version and hash, and the prompt asks again.
    const outstanding: Array<{
      docKey: string;
      current: ResolvedLegalVersion;
    }> = [];
    for (const doc of requiredLegalDocsForUse()) {
      let current: ResolvedLegalVersion;
      try {
        current = resolveLegalVersion(doc.slug);
      } catch (resolveErr: unknown) {
        logger.error(
          "LEGAL",
          "legal_resolution_failed",
          "Could not resolve a document during re-accept; skipping it",
          {
            slug: doc.slug,
            error: resolveErr instanceof Error ? resolveErr.message : "unknown",
          },
        );
        continue;
      }
      const alreadyHeld = rows.some(
        (r) => r.doc_key === doc.docKey && r.doc_version === current.version,
      );
      if (!alreadyHeld) outstanding.push({ docKey: doc.docKey, current });
    }

    if (outstanding.length === 0) {
      return res.json({ success: true, recorded: 0 });
    }

    await recordLegalAcceptances(admin, {
      userId,
      consentSource: "reconsent_prompt",
      userAgent: req.get("user-agent") ?? null,
      ipAddress: req.ip ?? null,
      // RESOLVED ONCE, ABOVE. This used to call resolveLegalVersion again here —
      // a second throw site on the same request, surviving only because the
      // registry caches. Carrying the value forward removes the site entirely.
      acceptances: outstanding.map(({ docKey, current }) => {
        return {
          docKey,
          docSlug: current.slug,
          docVersion: current.version,
          contentHash: current.contentHash,
          actorType:
            profile?.role === "guardian"
              ? ("parent" as const)
              : ("student" as const),
          minor: false,
        };
      }),
    });

    return res.json({ success: true, recorded: outstanding.length });
  } catch (e: unknown) {
    logger.error("LEGAL", "reaccept", "Could not record re-consent", {
      error: e instanceof Error ? e.message : "unknown",
    });
    return res
      .status(500)
      .json({ success: false, error: "Could not record your agreement" });
  }
});

/**
 * GET /api/legal/acceptances
 * Returns acceptances for the authenticated user.
 */
legalRouter.get("/acceptances", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId)
      return res
        .status(401)
        .json({ acceptances: [], error: "Not authenticated" });

    const admin = getSupabaseAdmin();

    const { data, error } = await admin
      .from("legal_acceptances")
      .select("doc_key, doc_version, accepted_at, actor_type")
      .eq("user_id", userId);

    if (error)
      return res.status(500).json({ acceptances: [], error: error.message });

    return res.json({ acceptances: data || [] });
  } catch (e: any) {
    return res
      .status(500)
      .json({ acceptances: [], error: e?.message || "Unknown error" });
  }
});
