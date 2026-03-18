import { Response, Router } from 'express';
import { type AuthenticatedRequest, requireRequestUser } from '../../../../server/middleware/supabase-auth';
import { getWeakestClusters } from '../services/studentMastery';
import { buildWeaknessSkillsView } from '../services/weakness-view';

const router = Router();

router.get('/skills', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const section = req.query.section as string | undefined;
    const limit = parseInt(req.query.limit as string) || 10;
    const minAttempts = parseInt(req.query.minAttempts as string) || 3;

    const view = await buildWeaknessSkillsView({
      userId: user.id,
      section,
      limit,
      minAttempts,
    });

    res.json(view);
  } catch (error) {
    console.error('[Weakness] Error getting weakest skills:', error);
    res.status(500).json({ error: 'Failed to get weakness data' });
  }
});

router.get('/clusters', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = requireRequestUser(req, res);
    if (!user) {
      return;
    }

    const limit = parseInt(req.query.limit as string) || 10;
    const minAttempts = parseInt(req.query.minAttempts as string) || 3;

    const clusters = await getWeakestClusters({
      userId: user.id,
      limit,
      minAttempts,
      failOnError: true,
    });

    res.json({
      ok: true,
      count: clusters.length,
      clusters,
    });
  } catch (error) {
    console.error('[Weakness] Error getting weakest clusters:', error);
    res.status(500).json({ error: 'Failed to get weakness data' });
  }
});

export const weaknessRouter = router;
