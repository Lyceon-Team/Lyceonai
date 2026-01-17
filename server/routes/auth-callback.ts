import { Router, Request, Response } from 'express';
import { logger } from '../logger.js';

const router = Router();

/**
 * GET /auth/callback
 * Google OAuth callback handler
 * Receives auth code from Google, exchanges for session, sets cookies, redirects to app
 */
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, error, error_description } = req.query;

    // Handle OAuth errors
    if (error) {
      logger.error('AUTH', 'oauth_callback_error', 'OAuth callback received error', {
        error,
        description: error_description
      });
      return res.redirect(`/?error=${encodeURIComponent(error as string)}`);
    }

    if (!code) {
      logger.error('AUTH', 'oauth_callback_error', 'No authorization code received');
      return res.redirect('/?error=no_code');
    }

    // Supabase automatically handles the code exchange via PKCE
    // The session is already set in the URL hash, we just need to redirect
    // The frontend will extract tokens from the URL hash

    logger.info('AUTH', 'oauth_callback_success', 'OAuth callback successful, redirecting to app');

    // Redirect to home page - frontend will handle token extraction
    res.redirect('/');
  } catch (error) {
    logger.error('AUTH', 'oauth_callback_error', 'OAuth callback handler error', error);
    res.redirect('/?error=callback_failed');
  }
});

export default router;
