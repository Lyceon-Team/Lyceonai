import { Router, Request, Response } from "express";
import { getSupabaseAdmin } from "../../apps/api/src/lib/supabase-admin.js";

export const legalRouter = Router();

/**
 * POST /api/legal/accept
 * Records acceptance for the authenticated user (server-only auth).
 */
legalRouter.post("/accept", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "Not authenticated" });

    const { docKey, docVersion, actorType, minor } = req.body ?? {};
    if (!docKey || !docVersion || !actorType || typeof minor !== "boolean") {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    if (actorType !== "student" && actorType !== "parent") {
      return res.status(400).json({ success: false, error: "actorType must be 'student' or 'parent'" });
    }

    const admin = getSupabaseAdmin();

    const { error } = await admin
      .from("legal_acceptances")
      .upsert(
        {
          user_id: userId,
          doc_key: docKey,
          doc_version: docVersion,
          actor_type: actorType,
          minor,
          user_agent: req.headers["user-agent"] || null,
          accepted_at: new Date().toISOString(),
        },
        { onConflict: "user_id,doc_key,doc_version,actor_type" }
      );

    if (error) return res.status(500).json({ success: false, error: error.message });

    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || "Unknown error" });
  }
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
