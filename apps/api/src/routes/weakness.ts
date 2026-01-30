import { Request, Response, Router } from 'express';

import { 
  getWeakestSkills, 
  getWeakestClusters, 
  getMasterySummary 
} from '../services/studentMastery';

const router = Router();

router.get('/skills', async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const section = req.query.section as string | undefined;
    const limit = parseInt(req.query.limit as string) || 10;
    const minAttempts = parseInt(req.query.minAttempts as string) || 3;

    const skills = await getWeakestSkills({
      userId: user.id,
      section,
      limit,
      minAttempts,
    });

    res.json({
      ok: true,
      count: skills.length,
      skills,
    });
  } catch (error) {
    console.error('[Weakness] Error getting weakest skills:', error);
    res.status(500).json({ error: 'Failed to get weakness data' });
  }
});

router.get('/clusters', async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const limit = parseInt(req.query.limit as string) || 10;
    const minAttempts = parseInt(req.query.minAttempts as string) || 3;

    const clusters = await getWeakestClusters({
      userId: user.id,
      limit,
      minAttempts,
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
