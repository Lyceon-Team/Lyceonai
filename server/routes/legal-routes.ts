import { Router, Request, Response } from "express";
import { getSupabaseAdmin } from "../../apps/api/src/lib/supabase-admin.js";

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
 * GET /api/legal/acceptances
 * Returns acceptances for the authenticated user.
 */
legalRouter.get("/acceptances", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ acceptances: [], error: "Not authenticated" });

    const admin = getSupabaseAdmin();

    const { data, error } = await admin
      .from("legal_acceptances")
      .select("doc_key, doc_version, accepted_at, actor_type")
      .eq("user_id", userId);

    if (error) return res.status(500).json({ acceptances: [], error: error.message });

    return res.json({ acceptances: data || [] });
  } catch (e: any) {
    return res.status(500).json({ acceptances: [], error: e?.message || "Unknown error" });
  }
});
