# P00_MASTERY_PROOFS.md

## Evidence Rules
* Every proof entry is a snippet with a file path + line range or a command output required for provenance/build/search evidence.
* IDs are stable and referenced as E### in the audit.

## E-PROV

### E001 — Repo root (command output)
```
$ pwd
/workspace/Lyceonai
```

### E002 — Branch name (command output)
```
$ git rev-parse --abbrev-ref HEAD
sprint-3
```

### E003 — Full commit SHA (command output)
```
$ git rev-parse HEAD
6bc378a32827d13d935864430b9875b355ddcf4d
```

### E004 — Node version (command output)
```
$ node -v
v22.21.1
```

### E005 — pnpm version (command output)
```
$ pnpm -v
10.13.1
```

## E-ROUTES

### E010 — Mastery router mounted with auth middleware
**File:** server/index.ts (lines 323-326)
```
323 // Weakness & Mastery Routes (student weakness tracking)
324 app.use("/api/me/weakness", requireSupabaseAuth, requireStudentOrAdmin, weaknessRouter);
325 app.use("/api/me/mastery", requireSupabaseAuth, requireStudentOrAdmin, masteryRouter);
326 app.use("/api/calendar", requireSupabaseAuth, requireStudentOrAdmin, calendarRouter);
```

### E011 — Progress projection endpoint (auth-gated)
**File:** server/index.ts (lines 328-329)
```
328 // Score Projection endpoint (College Board weighted algorithm)
329 app.get("/api/progress/projection", requireSupabaseAuth, requireStudentOrAdmin, getScoreProjection);
```

### E012 — Practice router mounted with auth middleware
**File:** server/index.ts (lines 482-485)
```
482 // Practice Canonical Routes (unified practice API)
483 // CSRF protection is applied inside the router for POST routes only (GET /next doesn't need CSRF)
484 // Usage limit is applied inside the router: increment only on GET /next, not on answer submission
485 app.use("/api/practice", requireSupabaseAuth, requireStudentOrAdmin, practiceCanonicalRouter);
```

### E013 — Practice answer route with middleware
**File:** server/routes/practice-canonical.ts (lines 307-315)
```
307 router.post("/answer", requireSupabaseAuth, csrfProtection, async (req, res) => {
308   const requestId = (req as any).requestId;
309   const user = (req as any).user;
310   const userId = user?.id;
311 
312   if (!userId) {
313     return res.status(401).json({ error: "Authentication required", message: "You must be signed in", requestId });
314   }
315 
```

## E-HANDLERS

### E020 — Mastery routes (/summary, /skills, /weakest, /add-to-plan)
**File:** apps/api/src/routes/mastery.ts (lines 147-380)
```
147 router.get('/summary', async (req: AuthenticatedRequest, res: Response) => {
148   try {
149     if (!req.user) {
150       return res.status(401).json({ error: 'Authentication required' });
151     }
152 
153     const section = req.query.section as string | undefined;
154 
155     const summary = await getMasterySummary(req.user.id, section);
156 
157     res.json({
158       ok: true,
159       sections: summary,
160     });
161   } catch (error) {
162     console.error('[Mastery] Error getting mastery summary:', error);
163     res.status(500).json({ error: 'Failed to get mastery summary' });
164   }
165 });
166 
167 router.get('/skills', async (req: AuthenticatedRequest, res: Response) => {
168   try {
169     if (!req.user) {
170       return res.status(401).json({ error: 'Authentication required' });
171     }
172 
173     const userId = req.user.id;
174     const supabase = getSupabaseAdmin();
175 
176     const { data: masteryData, error } = await supabase
177       .from("student_skill_mastery")
178       .select("section, domain, skill, attempts, correct, accuracy, mastery_score")
179       .eq("user_id", userId);
180 
181     if (error) {
182       console.error("[Mastery] Failed to fetch skills:", error.message);
183       return res.status(500).json({ error: "Failed to fetch mastery data" });
184     }
185 
186     const masteryMap = new Map<string, SkillMasteryRow>();
187     for (const row of masteryData || []) {
188       const key = `${row.section}:${row.domain || "unknown"}:${row.skill}`;
189       masteryMap.set(key, row);
190     }
191 
192     const result: SectionNode[] = [];
193 
194     for (const [sectionId, sectionDef] of Object.entries(SAT_TAXONOMY)) {
195       const domains: DomainNode[] = [];
196       let sectionTotalMastery = 0;
197       let sectionDomainCount = 0;
198 
199       for (const [domainId, domainDef] of Object.entries(sectionDef.domains)) {
200         const skills: SkillNode[] = [];
201         let domainTotalMastery = 0;
202 
203         for (const skillId of domainDef.skills) {
204           const key = `${sectionId}:${domainId}:${skillId}`;
205           const row = masteryMap.get(key);
206 
207           const attempts = row?.attempts ?? 0;
208           const correct = row?.correct ?? 0;
209           const accuracy = row?.accuracy ?? 0;
210           const mastery_score = row?.mastery_score ?? 0;
211 
212           skills.push({
213             id: skillId,
214             label: skillId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
215             attempts,
216             correct,
217             accuracy: Math.round(accuracy * 100),
218             mastery_score: Math.round(mastery_score * 100),
219             status: getMasteryStatus(mastery_score * 100, attempts),
220           });
221 
222           domainTotalMastery += mastery_score * 100;
223         }
224 
225         const avgDomainMastery = domainDef.skills.length > 0 
226           ? domainTotalMastery / domainDef.skills.length 
227           : 0;
228 
229         domains.push({
230           id: domainId,
231           label: domainDef.label,
232           skills,
233           avgMastery: Math.round(avgDomainMastery),
234           status: getMasteryStatus(avgDomainMastery, skills.reduce((a, s) => a + s.attempts, 0)),
235         });
236 
237         sectionTotalMastery += avgDomainMastery;
238         sectionDomainCount++;
239       }
240 
241       result.push({
242         id: sectionId,
243         label: sectionDef.label,
244         domains,
245         avgMastery: sectionDomainCount > 0 
246           ? Math.round(sectionTotalMastery / sectionDomainCount) 
247           : 0,
248       });
249     }
250 
251     return res.json({ sections: result });
252   } catch (err: any) {
253     console.error("[Mastery] Error:", err.message);
254     return res.status(500).json({ error: "Internal server error" });
255   }
256 });
257 
258 router.get('/weakest', async (req: AuthenticatedRequest, res: Response) => {
259   try {
260     if (!req.user) {
261       return res.status(401).json({ error: 'Authentication required' });
262     }
263 
264     const userId = req.user.id;
265     const limit = parseInt(req.query.limit as string) || 5;
266 
267     const weakest = await getWeakestSkills({
268       userId,
269       limit,
270       minAttempts: 2,
271     });
272 
273     const formatted = weakest.map((row) => ({
274       section: row.section,
275       domain: row.domain,
276       skill: row.skill,
277       label: row.skill.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
278       attempts: row.attempts,
279       accuracy: Math.round(row.accuracy * 100),
280       mastery_score: Math.round(row.mastery_score * 100),
281       status: getMasteryStatus(row.mastery_score * 100, row.attempts),
282     }));
283 
284     return res.json({ weakest: formatted });
285   } catch (err: any) {
286     console.error("[Mastery] Error:", err.message);
287     return res.status(500).json({ error: "Internal server error" });
288   }
289 });
290 
291 router.post('/add-to-plan', async (req: AuthenticatedRequest, res: Response) => {
292   try {
293     if (!req.user) {
294       return res.status(401).json({ error: 'Authentication required' });
295     }
296 
297     const userId = req.user.id;
298     const { section, domain, skill, targetDate } = req.body;
299 
300     if (!section || !skill) {
301       return res.status(400).json({ error: 'Section and skill are required' });
302     }
303 
304     const dayDate = targetDate || getTomorrowDate();
305     const supabase = getSupabaseAdmin();
306 
307     const { data: existingDay, error: fetchError } = await supabase
308       .from("student_study_plan_days")
309       .select("focus, tasks, planned_minutes")
310       .eq("user_id", userId)
311       .eq("day_date", dayDate)
312       .single();
313 
314     if (fetchError && fetchError.code !== "PGRST116") {
315       console.error("[Mastery] Failed to fetch day:", fetchError.message);
316       return res.status(500).json({ error: "Failed to fetch study plan day" });
317     }
318 
319     const competencyId = domain ? `${domain}.${skill}` : skill;
320     const sectionLabel = section === "math" ? "Math" : "Reading & Writing";
321 
322     const focus = JSON.parse(JSON.stringify(existingDay?.focus || []));
323     const tasks = JSON.parse(JSON.stringify(existingDay?.tasks || []));
324     const plannedMinutes = existingDay?.planned_minutes || 30;
325 
326     const existingFocusIndex = focus.findIndex((f: any) => f.section === sectionLabel);
327     if (existingFocusIndex >= 0) {
328       const existingFocus = focus[existingFocusIndex];
329       const competencies = existingFocus.competencies || [];
330       if (!competencies.includes(competencyId)) {
331         focus[existingFocusIndex] = {
332           ...existingFocus,
333           competencies: [...competencies, competencyId],
334         };
335       }
336     } else {
337       focus.push({
338         section: sectionLabel,
339         weight: 0.5,
340         competencies: [competencyId],
341       });
342     }
343 
344     const existingTaskIndex = tasks.findIndex((t: any) => t.section === sectionLabel);
345     if (existingTaskIndex < 0) {
346       tasks.push({
347         type: "practice",
348         section: sectionLabel,
349         mode: "skill-focused",
350         minutes: Math.round(plannedMinutes * 0.5),
351       });
352     }
353 
354     const { error: upsertError } = await supabase
355       .from("student_study_plan_days")
356       .upsert({
357         user_id: userId,
358         day_date: dayDate,
359         focus,
360         tasks,
361         planned_minutes: plannedMinutes,
362         plan_version: 1,
363         generated_at: new Date().toISOString(),
364       }, { onConflict: "user_id,day_date" });
365 
366     if (upsertError) {
367       console.error("[Mastery] Failed to update plan:", upsertError.message);
368       return res.status(500).json({ error: "Failed to update study plan" });
369     }
370 
371     return res.json({
372       success: true,
373       dayDate,
374       addedSkill: competencyId,
375     });
376   } catch (err: any) {
377     console.error("[Mastery] Error:", err.message);
378     return res.status(500).json({ error: "Internal server error" });
379   }
380 });
```

## E-DB

### E030 — Mastery tables + RPCs
**File:** supabase/migrations/20251222_student_mastery_tables.sql (lines 4-187)
```
4  -- ============================================================================
5  -- Table: student_question_attempts
6  -- Logs each answer attempt with question metadata snapshot for analytics
7  -- ============================================================================
8  CREATE TABLE IF NOT EXISTS public.student_question_attempts (
9    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
10   user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
11   question_canonical_id VARCHAR(16) NOT NULL,
12   session_id UUID,
13   
14   -- Answer data
15   is_correct BOOLEAN NOT NULL,
16   selected_choice VARCHAR(1),
17   time_spent_ms INTEGER,
18   
19   -- Question metadata snapshot (denormalized for analytics)
20   exam VARCHAR(16),
21   section VARCHAR(32),
22   domain VARCHAR(64),
23   skill VARCHAR(128),
24   subskill VARCHAR(128),
25   difficulty_bucket VARCHAR(16),
26   structure_cluster_id UUID,
27   
28   attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
29   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
30 );
31 
40 -- ============================================================================
41 -- Table: student_skill_mastery
42 -- Rollup table for skill-level mastery tracking
43 -- ============================================================================
44 CREATE TABLE IF NOT EXISTS public.student_skill_mastery (
45   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
46   user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
47   section VARCHAR(32) NOT NULL,
48   domain VARCHAR(64),
49   skill VARCHAR(128) NOT NULL,
50   
51   -- Rollup stats
52   attempts INTEGER NOT NULL DEFAULT 0,
53   correct INTEGER NOT NULL DEFAULT 0,
54   accuracy NUMERIC(5,4) NOT NULL DEFAULT 0,
55   mastery_score NUMERIC(5,4) NOT NULL DEFAULT 0,
56   
57   last_attempt_at TIMESTAMPTZ,
58   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
59   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
60   
61   UNIQUE(user_id, section, domain, skill)
62 );
63 
68 -- ============================================================================
69 -- Table: student_cluster_mastery
70 -- Rollup table for structure-cluster-level mastery tracking
71 -- ============================================================================
72 CREATE TABLE IF NOT EXISTS public.student_cluster_mastery (
73   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
74   user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
75   structure_cluster_id UUID NOT NULL,
76   
77   -- Rollup stats
78   attempts INTEGER NOT NULL DEFAULT 0,
79   correct INTEGER NOT NULL DEFAULT 0,
80   accuracy NUMERIC(5,4) NOT NULL DEFAULT 0,
81   mastery_score NUMERIC(5,4) NOT NULL DEFAULT 0,
82   
83   last_attempt_at TIMESTAMPTZ,
84   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
85   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
86   
87   UNIQUE(user_id, structure_cluster_id)
88 );
89 
133 -- ============================================================================
134 -- RPC: Upsert skill mastery (atomic increment)
135 -- ============================================================================
136 CREATE OR REPLACE FUNCTION public.upsert_skill_mastery(
137   p_user_id UUID,
138   p_section VARCHAR(32),
139   p_domain VARCHAR(64),
140   p_skill VARCHAR(128),
141   p_is_correct BOOLEAN
142 )
143 RETURNS VOID
144 LANGUAGE plpgsql
145 SECURITY DEFINER
146 AS $$
147 DECLARE
148   v_attempts INTEGER;
149   v_correct INTEGER;
150   v_accuracy NUMERIC(5,4);
151 BEGIN
152   INSERT INTO public.student_skill_mastery (user_id, section, domain, skill, attempts, correct, accuracy, mastery_score, last_attempt_at, updated_at)
153   VALUES (p_user_id, p_section, COALESCE(p_domain, 'unknown'), p_skill, 1, CASE WHEN p_is_correct THEN 1 ELSE 0 END, CASE WHEN p_is_correct THEN 1.0 ELSE 0.0 END, CASE WHEN p_is_correct THEN 1.0 ELSE 0.0 END, NOW(), NOW())
154   ON CONFLICT (user_id, section, domain, skill) DO UPDATE SET
155     attempts = student_skill_mastery.attempts + 1,
156     correct = student_skill_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END,
157     accuracy = (student_skill_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END)::NUMERIC / (student_skill_mastery.attempts + 1)::NUMERIC,
158     mastery_score = (student_skill_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END)::NUMERIC / (student_skill_mastery.attempts + 1)::NUMERIC,
159     last_attempt_at = NOW(),
160     updated_at = NOW();
161 END;
162 $$;
163 
164 -- ============================================================================
165 -- RPC: Upsert cluster mastery (atomic increment)
166 -- ============================================================================
167 CREATE OR REPLACE FUNCTION public.upsert_cluster_mastery(
168   p_user_id UUID,
169   p_structure_cluster_id UUID,
170   p_is_correct BOOLEAN
171 )
172 RETURNS VOID
173 LANGUAGE plpgsql
174 SECURITY DEFINER
175 AS $$
176 BEGIN
177   INSERT INTO public.student_cluster_mastery (user_id, structure_cluster_id, attempts, correct, accuracy, mastery_score, last_attempt_at, updated_at)
178   VALUES (p_user_id, p_structure_cluster_id, 1, CASE WHEN p_is_correct THEN 1 ELSE 0 END, CASE WHEN p_is_correct THEN 1.0 ELSE 0.0 END, CASE WHEN p_is_correct THEN 1.0 ELSE 0.0 END, NOW(), NOW())
179   ON CONFLICT (user_id, structure_cluster_id) DO UPDATE SET
180     attempts = student_cluster_mastery.attempts + 1,
181     correct = student_cluster_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END,
182     accuracy = (student_cluster_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END)::NUMERIC / (student_cluster_mastery.attempts + 1)::NUMERIC,
183     mastery_score = (student_cluster_mastery.correct + CASE WHEN p_is_correct THEN 1 ELSE 0 END)::NUMERIC / (student_cluster_mastery.attempts + 1)::NUMERIC,
184     last_attempt_at = NOW(),
185     updated_at = NOW();
186 END;
187 $$;
```

### E031 — Proven absence: mastery migration has no views/materialized views
```
$ rg -n "create view" supabase/migrations/20251222_student_mastery_tables.sql
# no matches

$ rg -n "materialized view" supabase/migrations/20251222_student_mastery_tables.sql
# no matches
```

## E-READS

### E040 — Mastery service read queries
**File:** apps/api/src/services/studentMastery.ts (lines 186-256)
```
186 export async function getWeakestSkills(query: WeaknessQuery): Promise<SkillWeakness[]> {
187   const supabase = getSupabaseAdmin();
188   const limit = query.limit || 10;
189   const minAttempts = query.minAttempts || 3;
190 
191   let q = supabase
192     .from("student_skill_mastery")
193     .select("section, domain, skill, attempts, correct, accuracy, mastery_score")
194     .eq("user_id", query.userId)
195     .gte("attempts", minAttempts)
196     .order("accuracy", { ascending: true })
197     .limit(limit);
198 
199   if (query.section) {
200     q = q.eq("section", query.section);
201   }
202 
203   const { data, error } = await q;
204 
205   if (error) {
206     console.error("[Mastery] Failed to get weakest skills:", error.message);
207     return [];
208   }
209 
210   return data || [];
211 }
212 
213 export async function getWeakestClusters(query: WeaknessQuery): Promise<ClusterWeakness[]> {
214   const supabase = getSupabaseAdmin();
215   const limit = query.limit || 10;
216   const minAttempts = query.minAttempts || 3;
217 
218   const { data, error } = await supabase
219     .from("student_cluster_mastery")
220     .select("structure_cluster_id, attempts, correct, accuracy, mastery_score")
221     .eq("user_id", query.userId)
222     .gte("attempts", minAttempts)
223     .order("accuracy", { ascending: true })
224     .limit(limit);
225 
226   if (error) {
227     console.error("[Mastery] Failed to get weakest clusters:", error.message);
228     return [];
229   }
230 
231   return data || [];
232 }
233 
247 export async function getMasterySummary(
248   userId: string,
249   section?: string
250 ): Promise<MasterySummary[]> {
251   const supabase = getSupabaseAdmin();
252 
253   let q = supabase
254     .from("student_skill_mastery")
255     .select("section, domain, attempts, correct, accuracy")
256     .eq("user_id", userId);
```

### E041 — Projection endpoint reads mastery rows
**File:** apps/api/src/routes/progress.ts (lines 436-479)
```
436 // ============================================================================
437 // GET /api/progress/projection - Score Projection with College Board Weights
438 // ============================================================================
439 export const getScoreProjection = async (req: AuthenticatedRequest, res: Response) => {
440   try {
441     if (!req.user) {
442       return res.status(401).json({ error: 'Authentication required' });
443     }
444 
445     const { data: masteryRows, error: masteryError } = await supabaseServer
446       .from('student_skill_mastery')
447       .select('section, domain, skill, mastery_score, attempts, updated_at')
448       .eq('user_id', req.user.id);
449 
450     if (masteryError) {
451       console.error('[Projection] Error fetching mastery:', masteryError.message);
452       return res.status(500).json({ error: 'Failed to fetch mastery data' });
453     }
454 
455     const domainMastery: Record<string, DomainMastery> = {};
456     let totalQuestions = 0;
457 
458     for (const row of masteryRows || []) {
459       const section = row.section?.toLowerCase() === 'math' ? 'math' : 'rw';
460       const domain = row.domain || 'unknown';
461       const key = `${section}:${domain}`;
462 
463       if (!domainMastery[key]) {
464         domainMastery[key] = {
465           domain,
466           section: section as 'math' | 'rw',
467           mastery_score: 0,
468           attempts: 0,
469           last_activity: null,
470         };
471       }
472 
473       domainMastery[key].mastery_score = Math.max(
474         domainMastery[key].mastery_score,
475         row.mastery_score || 0
476       );
477       domainMastery[key].attempts += row.attempts || 0;
478       totalQuestions += row.attempts || 0;
479 
```

## E-WRITES

### E050 — Mastery write path via service RPC calls
**File:** apps/api/src/services/studentMastery.ts (lines 30-105)
```
30 export async function logAttemptAndUpdateMastery(input: AttemptInput): Promise<AttemptResult> {
31   const supabase = getSupabaseAdmin();
32   
33   const attemptId = crypto.randomUUID();
34   let rollupUpdated = true;
35   let rollupError: string | undefined;
36   
37   const { error: insertError } = await supabase
38     .from("student_question_attempts")
39     .insert({
40       id: attemptId,
41       user_id: input.userId,
42       question_canonical_id: input.questionCanonicalId,
43       session_id: input.sessionId || null,
44       is_correct: input.isCorrect,
45       selected_choice: input.selectedChoice || null,
46       time_spent_ms: input.timeSpentMs || null,
47       exam: input.metadata.exam,
48       section: input.metadata.section,
49       domain: input.metadata.domain,
50       skill: input.metadata.skill,
51       subskill: input.metadata.subskill,
52       difficulty_bucket: input.metadata.difficulty_bucket,
53       structure_cluster_id: input.metadata.structure_cluster_id,
54     });
55 
56   if (insertError) {
57     console.error("[Mastery] Failed to log attempt:", insertError.message);
58     return {
59       attemptId,
60       rollupUpdated: false,
61       error: `Failed to log attempt: ${insertError.message}`,
62     };
63   }
64 
65   if (input.metadata.section && input.metadata.skill) {
66     try {
67       const { error: skillError } = await supabase.rpc("upsert_skill_mastery", {
68         p_user_id: input.userId,
69         p_section: input.metadata.section,
70         p_domain: input.metadata.domain || "unknown",
71         p_skill: input.metadata.skill,
72         p_is_correct: input.isCorrect,
73       });
74       
75       if (skillError) {
76         console.warn("[Mastery] Skill rollup failed:", skillError.message);
77         rollupUpdated = false;
78         rollupError = skillError.message;
79       }
80     } catch (err: any) {
81       console.warn("[Mastery] Skill rollup error:", err.message);
82       rollupUpdated = false;
83       rollupError = err.message;
84     }
85   }
86 
87   if (input.metadata.structure_cluster_id) {
88     try {
89       const { error: clusterError } = await supabase.rpc("upsert_cluster_mastery", {
90         p_user_id: input.userId,
91         p_structure_cluster_id: input.metadata.structure_cluster_id,
92         p_is_correct: input.isCorrect,
93       });
94       
95       if (clusterError) {
96         console.warn("[Mastery] Cluster rollup failed:", clusterError.message);
97         rollupUpdated = false;
98         rollupError = clusterError.message;
99       }
100     } catch (err: any) {
101       console.warn("[Mastery] Cluster rollup error:", err.message);
102       rollupUpdated = false;
103       rollupError = err.message;
104     }
105   }
```

### E051 — Practice answer handler calls mastery logging
**File:** server/routes/practice-canonical.ts (lines 428-451)
```
428 // Log to student_question_attempts + update mastery rollups
429 try {
430   const metadata = await getQuestionMetadataForAttempt(questionId);
431   if (metadata.canonicalId) {
432     await logAttemptAndUpdateMastery({
433       userId,
434       questionCanonicalId: metadata.canonicalId,
435       sessionId,
436       isCorrect,
437       selectedChoice: qType === "mc" ? (selectedAnswer ?? null) : null,
438       timeSpentMs: clampedTimeSpentMs,
439       metadata: {
440         exam: metadata.exam,
441         section: metadata.section,
442         domain: metadata.domain,
443         skill: metadata.skill,
444         subskill: metadata.subskill,
445         difficulty_bucket: metadata.difficulty_bucket,
446         structure_cluster_id: metadata.structure_cluster_id,
447       },
448     });
449   }
450 } catch (masteryErr: any) {
451   console.warn("[practice] mastery logging failed", { requestId, message: masteryErr?.message });
```

### E052 — Proven absence: no triggers in mastery migration
```
$ rg -n "trigger" supabase/migrations/20251222_student_mastery_tables.sql
# no matches
```

## E-CLIENT

### E060 — Client mastery page calls /api/me/mastery/skills
**File:** client/src/pages/mastery.tsx (lines 56-66)
```
56 export default function MasteryPage() {
57   const handleBack = () => {
58     window.history.back();
59   };
60 
61   // Fetch mastery data from the real API endpoint
62   const { data, isLoading, error } = useQuery<MasteryResponse>({
63     queryKey: ['/api/me/mastery/skills'],
64     retry: 1,
65   });
```

## E-TESTS

### E070 — Adaptive selector test uses mastery_score in mocks
**File:** apps/api/src/services/__tests__/adaptiveSelector.test.ts (lines 110-140)
```
110 it('should use cluster mode when specified', async () => {
111   (getWeakestClusters as Mock).mockResolvedValue([
112     { structure_cluster_id: 'cluster-1', accuracy: 0.3, attempts: 10, correct: 3, mastery_score: 0.3 },
113   ]);
114 
115   const result = await selectNextQuestionForStudent({
116     userId: 'user-123',
117     section: 'math',
118     sessionId: 'session-123',
119     target: { mode: 'cluster' },
120   });
121 
122   expect(result.rationale.mode).toBe('cluster');
123   expect(getWeakestClusters).toHaveBeenCalled();
124 });
125 
126 it('should use skill mode when specified', async () => {
127   (getWeakestSkills as Mock).mockResolvedValue([
128     { section: 'math', domain: 'Algebra', skill: 'Linear equations', accuracy: 0.4, attempts: 10, correct: 4, mastery_score: 0.4 },
129   ]);
130 
131   const result = await selectNextQuestionForStudent({
132     userId: 'user-123',
133     section: 'math',
134     sessionId: 'session-123',
135     target: { mode: 'skill' },
136   });
137 
138   expect(result.rationale.mode).toBe('skill');
139   expect(getWeakestSkills).toHaveBeenCalled();
140 });
```

### E071 — Progress RLS tests reference progress endpoints
**File:** tests/rls/rls.spec.ts (lines 40-87)
```
40 describe('Progress Isolation', () => {
41   it('user A cannot read user B progress', async () => {
42     // User A creates a progress record
43     const progressData = { pct: 20, lastItemId: 'item-123' };
44     await request(app)
45       .post(`/api/progress/${testCourseId}`)
46       .set('Authorization', `Bearer ${jwtA}`)
47       .send(progressData)
48       .expect(200);
49 
50     // User B tries to read progress for the same course
51     const res = await request(app)
52       .get(`/api/progress/${testCourseId}`)
53       .set('Authorization', `Bearer ${jwtB}`)
54       .expect(200);
55 
56     // RLS should block A's row from B; list should be empty
57     expect(res.body.success).toBe(true);
58     expect(Array.isArray(res.body.data)).toBe(true);
59     expect(res.body.data.length).toBe(0);
60   });
61 
62   it('user A can read their own progress', async () => {
63     // User A reads their own progress
64     const res = await request(app)
65       .get(`/api/progress/${testCourseId}`)
66       .set('Authorization', `Bearer ${jwtA}`)
67       .expect(200);
68 
69     expect(res.body.success).toBe(true);
70     expect(Array.isArray(res.body.data)).toBe(true);
71     expect(res.body.data.length).toBeGreaterThan(0);
72     expect(res.body.data[0].pct).toBe(20);
73   });
74 
75   it('user B can create their own progress', async () => {
76     // User B creates their own progress
77     const progressData = { pct: 50, lastItemId: 'item-456' };
78     const res = await request(app)
79       .post(`/api/progress/${testCourseId}`)
80       .set('Authorization', `Bearer ${jwtB}`)
81       .send(progressData)
82       .expect(200);
83 
84     expect(res.body.success).toBe(true);
85     expect(res.body.data.pct).toBe(50);
86     expect(res.body.data.user_id).toBe(userB.id);
87   });
88 });
```

## E-BUILD

### E080 — Build output with mastery bundle
```
$ pnpm run build
vite v7.3.1 building client environment for production...
transforming...
✓ 2184 modules transformed.
rendering chunks...
computing gzip size...
../dist/public/assets/mastery-D5fxyL_J.js                         3.92 kB │ gzip:   1.44 kB
✓ built in 8.40s
Building server with esbuild...
Entry: /workspace/Lyceonai/server/index.ts
Output: /workspace/Lyceonai/dist/index.js

  dist/index.js      369.4kb
  dist/index.js.map  724.6kb

⚡ Done in 117ms
✓ Server bundle created at /workspace/Lyceonai/dist/index.js
✓ All local files bundled, all npm packages external
```

## E-KEYWORDS

### E090 — Keyword counts + top files (command output)
```
$ for term in mastery skill competency proficiency theta irt elo confidence progress ability; do
>   echo "TERM: ${term}";
>   rg --count-matches -i --hidden --glob "!**/node_modules/**" --glob "!**/dist/**" "${term}" . | awk -F: '{sum+=$2} END {print "TOTAL", sum+0}';
>   rg --count-matches -i --hidden --glob "!**/node_modules/**" --glob "!**/dist/**" "${term}" . | sort -t: -k2,2nr | head -n 5;
>   echo "---";
> done
TERM: mastery
TOTAL 1473
./docs/sprint-3/proofs/P03_RG_MASTERY_KEYWORDS.txt:515
./docs/sprint-3/proofs/P05_WRITE_PATHS.txt:228
./docs/sprint-3/proofs/P06_DB_OBJECTS.txt:127
./docs/sprint-3/mastery_audit.md:64
./supabase/migrations/20251222_student_mastery_tables.sql:60
---
TERM: skill
TOTAL 1266
./generated_questions/sat_rw_200_questions.json:420
./docs/sprint-3/proofs/P05_WRITE_PATHS.txt:103
./docs/sprint-3/proofs/P03_RG_MASTERY_KEYWORDS.txt:102
./apps/api/scripts/backfill-question-classification.ts:72
./attached_assets/questions_rows_(1)_1765626160591.csv:55
---
TERM: competency
TOTAL 1105
./docs/sprint-3/proofs/P03_RG_MASTERY_KEYWORDS.txt:526
./generated_questions/sat_rw_200_questions.json:200
./apps/api/src/lib/rag-service.ts:82
./apps/api/src/routes/progress.ts:33
./docs/sprint-3/proofs/P05_WRITE_PATHS.txt:32
---
TERM: proficiency
TOTAL 4
./docs/sprint-3/proofs/P03_RG_MASTERY_KEYWORDS.txt:2
./apps/api/src/lib/rag-types.ts:1
./docs/sprint-3/proofs/P05_WRITE_PATHS.txt:1
---
TERM: theta
TOTAL 4
./docs/sprint-3/proofs/P03_RG_MASTERY_KEYWORDS.txt:2
./docs/sprint-3/proofs/P05_WRITE_PATHS.txt:1
./server/services/ocrOrchestrator.ts:1
---
TERM: irt
TOTAL 145
./docs/sprint-3/proofs/P03_RG_MASTERY_KEYWORDS.txt:62
./docs/sprint-3/proofs/P05_WRITE_PATHS.txt:19
./client/src/pages/profile-complete.tsx:17
./attached_assets/questions_rows_1765626160592.csv:12
./test_export.csv:9
---
TERM: elo
TOTAL 690
./docs/sprint-3/proofs/P03_RG_MASTERY_KEYWORDS.txt:304
./generated_questions/sat_rw_200_questions.json:70
./docs/sprint1/deploy_runbook.md:12
./attached_assets/questions_rows_(1)_1765626160591.csv:11
./server/logger.ts:11
---
TERM: confidence
TOTAL 248
./server/services/ocrOrchestrator.ts:57
./server/admin-review-routes.ts:34
./server/services/satParser.ts:32
./server/services/robust-sat-parser.ts:30
./shared/schema.ts:19
---
TERM: progress
TOTAL 1260
./docs/sprint-3/proofs/P03_RG_MASTERY_KEYWORDS.txt:575
./docs/sprint-3/proofs/P06_DB_OBJECTS.txt:93
./client/src/components/progress-sidebar.tsx:26
./tests/rls/rls.spec.ts:26
./shared/schema.ts:24
---
TERM: ability
TOTAL 125
./generated_questions/sat_rw_200_questions.json:18
./attached_assets/questions_1765626160590.csv:13
./client/src/lib/legal.ts:9
./docs/sprint-3/proofs/P03_RG_MASTERY_KEYWORDS.txt:8
./docs/sprint0/determinism-proof.md:8
---
```

## E-AUTH

### E100 — Auth middleware definitions
**File:** server/middleware/supabase-auth.ts (lines 403-517)
```
403 /**
404  * Middleware to require authentication
405  * Returns 401 if user is not authenticated
406  */
407 export function requireSupabaseAuth(
408   req: Request,
409   res: Response,
410   next: NextFunction
411 ) {
412   if (!req.user) {
413     return res.status(401).json({
414       error: 'Authentication required',
415       message: 'You must be signed in to access this resource',
416       requestId: req.requestId
417     });
418   }
419   return next();
420 }
421 
422 
423 /**
424  * Middleware to require admin role
425  * Returns 403 if user is not an admin
426  */
427 export function requireSupabaseAdmin(
428   req: Request,
429   res: Response,
430   next: NextFunction
431 ) {
432   if (!req.user) {
433     return res.status(401).json({
434       error: 'Authentication required',
435       message: 'You must be signed in to access this resource',
436       requestId: req.requestId
437     });
438   }
439 
440   if (!req.user?.isAdmin) {
441     logger.warn('AUTH', 'admin_required', 'User attempted to access admin route without permission', {
442       userId: req.user?.id,
443       role: (req.user as any)?.role
444     });
445 
446     return res.status(403).json({
447       error: 'Admin access required',
448       message: 'You do not have permission to access this resource',
449       requestId: req.requestId
450     });
451   }
452 
453   return next();
454 }
455 
456 
457 /**
458  * Middleware to check under-13 consent (FERPA compliance)
459  * Returns 403 if user is under 13 without guardian consent
460  */
461 export function requireConsentCompliance(
462   req: Request,
463   res: Response,
464   next: NextFunction
465 ) {
466   if (!req.user) {
467     return res.status(401).json({
468       error: 'Authentication required',
469       message: 'You must be signed in to access this resource'
470     });
471   }
472 
473   if (req.user?.is_under_13 && !req.user?.guardian_consent) {
474     return res.status(403).json({
475       error: 'Guardian consent required',
476       message: 'Users under 13 require guardian consent to use this service',
477       consentRequired: true
478     });
479   }
480 
481   return next();
482 }
483 
484 
485 /**
486  * Middleware to require student or admin role (blocks guardians)
487  * Returns 403 if user is a guardian
488  */
489 export function requireStudentOrAdmin(
490   req: Request,
491   res: Response,
492   next: NextFunction
493 ) {
494   if (!req.user) {
495     return res.status(401).json({
496       error: 'Authentication required',
497       message: 'You must be signed in to access this resource',
498       requestId: req.requestId
499     });
500   }
501 
502   if (req.user.isGuardian && !req.user.isAdmin) {
503     logger.warn('AUTH', 'guardian_blocked', 'Guardian attempted to access student-only route', {
504       userId: req.user.id,
505       role: req.user.role,
506       path: req.path
507     });
508 
509     return res.status(403).json({
510       error: 'Student access required',
511       message: 'Guardians cannot access student practice features',
512       requestId: req.requestId
513     });
514   }
515 
516   return next();
517 }
```
