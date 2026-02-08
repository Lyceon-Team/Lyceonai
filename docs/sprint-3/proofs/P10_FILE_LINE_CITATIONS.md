File: client/src/App.tsx
Lines: 97-97
Excerpt:
  <Route path="/mastery" component={() => <RequireRole allow={['student', 'admin']}><MasteryPage /></RequireRole>} />
Why it matters: client

File: client/src/pages/mastery.tsx
Lines: 62-64
Excerpt:
  const { data, isLoading, error } = useQuery<MasteryResponse>({
    queryKey: ['/api/me/mastery/skills'],
    retry: 1,
Why it matters: client

File: server/index.ts
Lines: 323-325
Excerpt:
  // Weakness & Mastery Routes (student weakness tracking)
  app.use("/api/me/weakness", requireSupabaseAuth, requireStudentOrAdmin, weaknessRouter);
  app.use("/api/me/mastery", requireSupabaseAuth, requireStudentOrAdmin, masteryRouter);
Why it matters: route

File: apps/api/src/routes/mastery.ts
Lines: 153-155
Excerpt:
  const section = req.query.section as string | undefined;

  const summary = await getMasterySummary(req.user.id, section);
Why it matters: route

File: apps/api/src/routes/mastery.ts
Lines: 176-178
Excerpt:
  const { data: masteryData, error } = await supabase
    .from("student_skill_mastery")
    .select("section, domain, skill, attempts, correct, accuracy, mastery_score")
Why it matters: route

File: apps/api/src/routes/mastery.ts
Lines: 267-269
Excerpt:
  const weakest = await getWeakestSkills({
    userId,
    limit,
Why it matters: route

File: apps/api/src/services/studentMastery.ts
Lines: 37-39
Excerpt:
  const { error: insertError } = await supabase
    .from("student_question_attempts")
    .insert({
Why it matters: write

File: apps/api/src/services/studentMastery.ts
Lines: 67-69
Excerpt:
  const { error: skillError } = await supabase.rpc("upsert_skill_mastery", {
    p_user_id: input.userId,
    p_section: input.metadata.section,
Why it matters: write

File: apps/api/src/services/studentMastery.ts
Lines: 89-91
Excerpt:
  const { error: clusterError } = await supabase.rpc("upsert_cluster_mastery", {
    p_user_id: input.userId,
    p_structure_cluster_id: input.metadata.structure_cluster_id,
Why it matters: write

File: server/routes/practice-canonical.ts
Lines: 430-432
Excerpt:
    const metadata = await getQuestionMetadataForAttempt(questionId);
    if (metadata.canonicalId) {
      await logAttemptAndUpdateMastery({
Why it matters: write

File: apps/api/src/services/studentMastery.ts
Lines: 191-193
Excerpt:
  let q = supabase
    .from("student_skill_mastery")
    .select("section, domain, skill, attempts, correct, accuracy, mastery_score")
Why it matters: read

File: apps/api/src/services/studentMastery.ts
Lines: 253-255
Excerpt:
  let q = supabase
    .from("student_skill_mastery")
    .select("section, domain, attempts, correct, accuracy")
Why it matters: read

File: apps/api/src/routes/progress.ts
Lines: 445-447
Excerpt:
  const { data: masteryRows, error: masteryError } = await supabaseServer
    .from('student_skill_mastery')
    .select('section, domain, skill, mastery_score, attempts, updated_at')
Why it matters: read

File: supabase/migrations/20251222_student_mastery_tables.sql
Lines: 44-46
Excerpt:
  CREATE TABLE IF NOT EXISTS public.student_skill_mastery (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
Why it matters: schema

File: supabase/migrations/20251222_student_mastery_tables.sql
Lines: 136-138
Excerpt:
  CREATE OR REPLACE FUNCTION public.upsert_skill_mastery(
    p_user_id UUID,
    p_section VARCHAR(32),
Why it matters: schema

File: supabase/migrations/20251222_student_mastery_tables.sql
Lines: 152-154
Excerpt:
  INSERT INTO public.student_skill_mastery (user_id, section, domain, skill, attempts, correct, accuracy, mastery_score, last_attempt_at, updated_at)
  VALUES (p_user_id, p_section, COALESCE(p_domain, 'unknown'), p_skill, 1, CASE WHEN p_is_correct THEN 1 ELSE 0 END, CASE WHEN p_is_correct THEN 1.0 ELSE 0.0 END, CASE WHEN p_is_correct THEN 1.0 ELSE 0.0 END, NOW(), NOW())
  ON CONFLICT (user_id, section, domain, skill) DO UPDATE SET
Why it matters: schema
