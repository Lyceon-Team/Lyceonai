/**
 * STEP 2.3: Backfill script for existing SAT math questions
 * Updates questions with missing canonical_id, exam, test_code, section_code
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

interface Question {
  id: string;
  stem: string;
  section: string | null;
  exam: string | null;
  test_code: string | null;
  section_code: string | null;
  canonical_id: string | null;
}

/**
 * Extract Question ID from stem and generate canonical ID
 */
function deriveCanonicalIdFromStem(stem: string | undefined): string | null {
  if (!stem) return null;
  
  const match = stem.match(/Question\s+ID\s*[:\-]?\s*([a-fA-F0-9]{6,10})/i);
  if (match && match[1]) {
    const hexId = match[1].toUpperCase();
    return `SATM1-${hexId}`;
  }
  
  return null;
}

/**
 * Check if stem indicates SAT content
 */
function isSatContent(stem: string): boolean {
  return /Assessment\s+SAT|SAT\s+Suite|Question\s+ID\s+[a-f0-9]/i.test(stem);
}

async function fetchQuestionsToBackfill(): Promise<Question[]> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/questions`);
  url.searchParams.set('select', 'id,stem,section,exam,test_code,section_code,canonical_id');
  url.searchParams.set('order', 'created_at.desc');
  url.searchParams.set('limit', '500');
  
  const orConditions = [
    'canonical_id.is.null',
    'exam.is.null',
    'test_code.is.null',
    'section_code.is.null'
  ].join(',');
  url.searchParams.set('or', `(${orConditions})`);
  
  const response = await fetch(url.toString(), {
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY!,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch questions: ${response.status} ${await response.text()}`);
  }
  
  return response.json();
}

async function updateQuestion(id: string, updates: Partial<Question>): Promise<boolean> {
  const url = `${SUPABASE_URL}/rest/v1/questions?id=eq.${id}`;
  
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY!,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(updates)
  });
  
  return response.ok;
}

async function main() {
  console.log('🔄 Starting metadata backfill...\n');
  
  const questions = await fetchQuestionsToBackfill();
  console.log(`📊 Found ${questions.length} questions with incomplete metadata\n`);
  
  let updated = 0;
  let skipped = 0;
  const samples: Array<{ id: string; updates: Record<string, any> }> = [];
  
  for (const q of questions) {
    const updates: Partial<Question> = {};
    
    const isSat = isSatContent(q.stem) || q.section?.toLowerCase() === 'math';
    
    if (!q.canonical_id) {
      const derived = deriveCanonicalIdFromStem(q.stem);
      if (derived) {
        updates.canonical_id = derived;
      }
    }
    
    if (!q.exam && isSat) {
      updates.exam = 'SAT';
    }
    
    if (!q.test_code && isSat) {
      updates.test_code = 'SAT';
    }
    
    if (!q.section_code) {
      const section = q.section?.toLowerCase() || '';
      if (section.includes('math')) {
        updates.section_code = 'M';
      } else if (section.includes('reading') || section.includes('writing')) {
        updates.section_code = 'RW';
      } else if (isSat) {
        updates.section_code = 'M';
      }
    }
    
    if (Object.keys(updates).length > 0) {
      const success = await updateQuestion(q.id, updates);
      if (success) {
        updated++;
        if (samples.length < 5) {
          samples.push({ id: q.id, updates });
        }
      }
    } else {
      skipped++;
    }
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 Backfill Summary:');
  console.log(`   Scanned: ${questions.length}`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Skipped: ${skipped}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  if (samples.length > 0) {
    console.log('📝 Sample updates:');
    for (const s of samples) {
      console.log(`   ${s.id}: ${JSON.stringify(s.updates)}`);
    }
  }
  
  console.log('\n✅ Backfill complete');
}

main().catch(err => {
  console.error('❌ Backfill failed:', err.message);
  process.exit(1);
});
