import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getSupabaseAdmin } from '../middleware/supabase-auth';

const router = Router();

// Profile completion schema - matches client validation
const profileCompletionSchema = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  phoneNumber: z.string().regex(/^\+?[1-9]\d{1,14}$/).optional().or(z.literal('')),
  dateOfBirth: z.string().min(1),
  address: z.object({
    street: z.string().optional(),
    city: z.string().min(1),
    state: z.string().min(1),
    zipCode: z.string().min(1),
    country: z.string().min(1)
  }),
  timeZone: z.string().min(1),
  preferredLanguage: z.string().default('en'),
  marketingOptIn: z.boolean().default(false),
});

/**
 * PATCH /api/profile
 * Complete user profile with additional information
 * Requires authentication
 */
router.patch('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Validate request body
    const validation = profileCompletionSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid profile data',
        details: validation.error.errors 
      });
    }

    const data = validation.data;
    const supabase = getSupabaseAdmin();

    // Update profiles table with profile completion data
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        first_name: data.firstName,
        last_name: data.lastName,
        phone_number: data.phoneNumber || null,
        date_of_birth: data.dateOfBirth,
        address: data.address,
        time_zone: data.timeZone,
        preferred_language: data.preferredLanguage,
        marketing_opt_in: data.marketingOptIn,
        profile_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      console.error('[PROFILE] Error updating profile:', updateError);
      return res.status(500).json({ error: 'Failed to update profile' });
    }

    // Fetch updated profile
    const { data: profile, error: fetchError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (fetchError || !profile) {
      console.error('[PROFILE] Error fetching updated profile:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch updated profile' });
    }

    return res.json({ 
      success: true, 
      profile: {
        id: profile.id,
        email: profile.email,
        firstName: profile.first_name,
        lastName: profile.last_name,
        displayName: profile.display_name,
        phoneNumber: profile.phone_number,
        dateOfBirth: profile.date_of_birth,
        address: profile.address,
        timeZone: profile.time_zone,
        preferredLanguage: profile.preferred_language,
        marketingOptIn: profile.marketing_opt_in,
        profileCompletedAt: profile.profile_completed_at,
        role: profile.role
      }
    });
  } catch (error: any) {
    console.error('[PROFILE] Unexpected error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
