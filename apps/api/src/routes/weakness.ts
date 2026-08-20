import { Response, Router } from "express";
import {
  type AuthenticatedRequest,
  requireRequestUser,
} from "../../../../server/middleware/supabase-auth";
import { buildWeaknessSkillsView } from "../services/weakness-view";

const router = Router();

router.get("/skills", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const section = req.query.section as string | undefined;
    const limit = parseInt(req.query.limit as string) || 10;
    // `minAttempts` is deliberately NOT read from the query string. The evidence
    // threshold belongs to the mastery formula, not to a caller — a client that could
    // lower it would resurface unmeasured skills as the student's weakest.

    const view = await buildWeaknessSkillsView({
      userId: user.id,
      section,
      limit,
    });

    res.json(view);
  } catch (error) {
    console.error("[Weakness] Error getting weakest skills:", error);
    res.status(500).json({ error: "Failed to get weakness data" });
  }
});

export const weaknessRouter = router;
