import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env';

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }

    supabaseClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    console.log('✅ Supabase client initialized');
  }

  return supabaseClient;
}

// Initialize Supabase vector table if needed
// NOTE: This function checks if the table exists. If not, you need to manually create it
// using the SQL script in database/supabase-vector-setup.sql
export async function initializeVectorTable(): Promise<void> {
  const supabase = getSupabaseClient();

  try {
    // Check if question_embeddings table exists
    const { data, error } = await supabase
      .from('question_embeddings')
      .select('id')
      .limit(1);

    if (error && error.code === '42P01') {
      // Table doesn't exist
      console.warn('⚠️ question_embeddings table does not exist in Supabase');
      console.warn('⚠️ Please run the SQL setup script: database/supabase-vector-setup.sql');
      console.warn('⚠️ Vector search will not be available until the table is created');
    } else if (!error) {
      console.log('✅ question_embeddings table exists');
      
      // Check if match_questions function exists by trying to call it
      const { error: funcError } = await supabase.rpc('match_questions', {
        query_embedding: Array(1536).fill(0),
        match_threshold: 0.7,
        match_count: 1,
      });

      if (funcError && funcError.message.includes('function')) {
        console.warn('⚠️ match_questions() function does not exist');
        console.warn('⚠️ Please run the SQL setup script: database/supabase-vector-setup.sql');
      } else {
        console.log('✅ match_questions() function is available');
      }
    } else {
      console.warn('⚠️ Error checking vector table:', error.message);
    }
  } catch (err) {
    console.warn('⚠️ Vector table initialization check failed:', err);
  }
}

export interface QuestionEmbedding {
  id: string;
  question_id: string;
  embedding: number[];
  stem: string;
  section: string;
  metadata?: Record<string, any>;
  created_at?: string;
}

// Store question embedding in Supabase
export async function storeQuestionEmbedding(
  questionId: string,
  embedding: number[],
  stem: string,
  section: string,
  metadata?: Record<string, any>
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('question_embeddings')
    .upsert({
      id: questionId,
      question_id: questionId,
      embedding,
      stem,
      section,
      metadata,
    }, {
      onConflict: 'question_id'
    });

  if (error) {
    console.error('Error storing question embedding:', error);
    throw new Error(`Failed to store embedding: ${error.message}`);
  }
}

// Search for similar questions using vector similarity
export async function searchSimilarQuestions(
  queryEmbedding: number[],
  limit: number = 10,
  section?: string
): Promise<Array<QuestionEmbedding & { similarity: number }>> {
  const supabase = getSupabaseClient();

  try {
    // Use Supabase's RPC for vector similarity search
    let query = supabase.rpc('match_questions', {
      query_embedding: queryEmbedding,
      match_threshold: 0.7,
      match_count: limit,
    });

    if (section) {
      query = query.eq('section', section);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Vector search error:', error);
      throw new Error(`Vector search failed: ${error.message}`);
    }

    return data || [];
  } catch (err) {
    console.error('Search similar questions error:', err);
    return [];
  }
}
