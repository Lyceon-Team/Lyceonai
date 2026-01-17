/**
 * Centralized Configuration Management
 * Reads and validates environment variables at boot time
 * Fails fast if critical secrets are missing
 */

import { z } from 'zod';

const envSchema = z.object({
  // Core
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: z.coerce.number().default(3001),
  
  // Database - Supabase only (no Neon/DATABASE_URL)
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  SUPABASE_DB_URL: z.string().url('SUPABASE_DB_URL must be a valid URL').optional(),
  
  // AI Services - Gemini only
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required for embeddings and LLM'),

  
  // GCP Infrastructure
  GCP_PROJECT_ID: z.string().min(1, 'GCP_PROJECT_ID is required'),
  GCS_BUCKET_NAME: z.string().min(1, 'GCS_BUCKET_NAME is required'),
  PUBSUB_TOPIC: z.string().default('sat-pdf-finalized'),
  
  // RAG Configuration - Gemini only
  TOP_K: z.coerce.number().int().min(1).max(50).default(8),
  
  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000), // 1 minute
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
});

export type Config = z.infer<typeof envSchema>;

class ConfigManager {
  private static instance: Config | null = null;

  static load(): Config {
    if (this.instance) {
      return this.instance;
    }

    try {
      const parsed = envSchema.parse(process.env);
      this.instance = parsed;
      
      console.log('✅ [CONFIG] Environment configuration validated successfully');
      console.log(`🔧 [CONFIG] Environment: ${parsed.NODE_ENV}`);
      console.log(`🔧 [CONFIG] Embed Provider: Gemini (only)`);
      console.log(`🔧 [CONFIG] RAG Top-K: ${parsed.TOP_K}`);
      console.log(`🔧 [CONFIG] GCP Project: ${parsed.GCP_PROJECT_ID}`);
      console.log(`🔧 [CONFIG] GCS Bucket: ${parsed.GCS_BUCKET_NAME}`);
      console.log(`🔧 [CONFIG] PubSub Topic: ${parsed.PUBSUB_TOPIC}`);
      
      return parsed;
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error('❌ [CONFIG] Environment validation failed:');
        error.errors.forEach((err) => {
          console.error(`  - ${err.path.join('.')}: ${err.message}`);
        });
        process.exit(1);
      }
      throw error;
    }
  }

  static get(): Config {
    if (!this.instance) {
      throw new Error('Configuration not loaded. Call ConfigManager.load() first.');
    }
    return this.instance;
  }
}

export const config = ConfigManager;
