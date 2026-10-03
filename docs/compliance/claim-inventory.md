# Claim inventory (internal)

**Internal register: never linked from the product, a public page, the sitemap or any email** (Public Disclosure Doctrine rule 4; `docs/compliance/README.md`).

**Filled by:** plan row F6 (`docs/plans/seo/seo-marketing-vertical.md` §5), SEO Wave 1B, 2026-10-03.

**Audited:** `origin/seo` @ `533c2607` (before); branch `claude/seo-wave1b` (after).

**Approval:** Karl approved every replacement below in the Wave 1B session on 2026-10-03 ("Approved: all proposed replacements (X1–X7 and every section table)"), together with answers 1–11. Those answers are quoted where they decide a row.

**Guard:** `tests/ci/public-copy-claims.contract.test.ts` renders every public page the way the build does. It fails if a removed phrasing comes back in a page body, the head, Open Graph or JSON-LD, or in the OG image's text.

## Categories

| | Meaning | Doctrine rule |
|---|---|---|
| a | generic, industry-standard wording | 1 |
| b | contradicts the product or a ruling | — |
| c | describes a mechanism | 2 |
| d | unsourced general fact | 3 |
| e | Lyceon-specific or outcome claim; needs Karl's approval | 5 |

**Product facts the copy is checked against:**
- **Free:** 40 practice questions per day (`practice_runtime_config.daily_quota_free`), a worked explanation after each answer, the diagnostic, and review.
- **Paid:** the AI tutor, full-length practice tests, the skill-level breakdown, and the study plan/calendar.
- **Guardian view:** requires an active link AND the student's paid plan, and is read-only.
- **Adaptivity:** only through the paid study plan (R15).

## Sources

Each source was fetched on 2026-10-03 and its text read for the facts the copy states. Page links are rendered from `shared/seo/sources.ts`.

| Key | URL | Facts relied on |
|---|---|---|
| CB_STRUCTURE | https://satsuite.collegeboard.org/sat/whats-on-the-test/structure | Reading and Writing: 64 min / 54 questions. Math: 70 min / 44 questions. Two equal-length modules per section; the second module is more or less difficult depending on the first. Total 2 h 14 min / 98 questions. |
| CB_READING_WRITING | https://satsuite.collegeboard.org/sat/whats-on-the-test/reading-writing | Passages of 25–150 words, each followed by a single question. Four domains: Information and Ideas; Craft and Structure; Expression of Ideas; Standard English Conventions. |
| CB_MATH | https://satsuite.collegeboard.org/sat/whats-on-the-test/math | Four domains: Algebra; Advanced Math; Problem-Solving and Data Analysis; Geometry and Trigonometry. |
| CB_CALCULATOR | https://satsuite.collegeboard.org/sat/what-to-bring-do/calculator-policy | A calculator may be used at any point in the Math section, and a Desmos graphing calculator is built into Bluebook. |
| CB_SCORES | https://satsuite.collegeboard.org/sat/scores/understanding-scores | Total score 400–1600; section scores 200–800. |
| CEPEDA_2006 | https://doi.org/10.1037/0033-2909.132.3.354 | Spaced practice is retained better than massed practice. Cepeda, Pashler, Vul, Wixted & Rohrer (2006), *Psychological Bulletin* 132(3), 354–380. Metadata verified via Crossref. |

## Lyceon-specific claims kept (category e, approved)

| Claim | Where | Approval |
|---|---|---|
| "40 practice questions per day" (free) | home pricing card; FAQ "What is free vs paid?" | owner ruling 2026-09-03; parity pinned by `tests/ci/homepage-pricing.contract.test.ts` |
| "No daily limit on practice questions" (paid) | home pricing card; /digital-sat | answer 3, 2026-10-03 |
| "Built-in Desmos calculator on every Math question" (Lyceon practice) | FAQ "Can I use a calculator…" | answer 4: a true product claim approved by Karl, no citation; the SAT fact beside it cites CB_CALCULATOR |
| "A full diagnostic test with your score estimate" | home pricing card; FAQ | answer 1: "score estimate" (**Karl to confirm the final wording**) |
| "We don't sell student data." | home trust strip | approved (H8); matches Privacy Policy v4 |
| "Study smarter for the SAT" (tagline); titles "Lyceon \| SAT Prep" | home, footer, /digital-sat hero | answer 2 |
| College Board trademark notice | every public footer, /trust | answer 6 |
| Spaced-practice sentence | blog "quick-sat-study-routine" | answer 9: kept with CEPEDA_2006 |
| 400–1600 total, 200–800 per section | blog "digital-sat-scoring-explained" | answer 4: kept, cites CB_SCORES (text confirmed) |

## Before and after

`IDs` match the Step 0 inventory. "Source / approval" names the College Board or research source for a category-d fact, or the approval for everything else ("approved" means the 2026-10-03 approval above).

### Cross-cutting

| ID | Before | Cat | After | Source / approval |
|---|---|---|---|---|
| X1 | "Study Smarter, Score Higher" (home ×2, footer, titles, og:title, og:image:alt) | e | "Study smarter for the SAT"; titles "Lyceon \| SAT Prep" | answer 2 |
| X2 | "adaptive practice / question flow / difficulty / flow" (home, meta, /digital-sat, math page, blog) | b | "SAT-style practice"; where a plan is meant, "a study plan that focuses on your weak areas (paid plans)" | approved; R15 |
| X3 | "Question difficulty adjusts as you improve"; "Question selection adjusts by performance…" | b, c | "Study plan" / "A study plan that focuses on your weak areas (paid plans)" | approved |
| X4 | Tutor described by its grounding ("Grounded in SAT-style questions", "References current question context", "Analyzing question...") | c, e | "AI tutor for step-by-step help (paid plans)" | approved |
| X5 | Paid features beside free CTAs without saying they are paid | b | "(paid plans)" added, or reworded | approved |
| X6 | "expanded guardian visibility", "entitlement-gated for paid guardian access", "planning signals" | b, c | "Parents and guardians can link to a student's account and see a read-only progress summary while the student is on a paid plan." / "Read-only progress view for a linked parent or guardian" | approved |
| X7 | "Master the Digital SAT / Math / Reading and Writing…" (meta), "help you master the Digital SAT" (/blog hero) | e | "Prepare for…" (meta); /blog hero = the M23 wording | approved (the /blog hero is the same claim as M23 and takes its approved wording) |

### Homepage (`client/src/pages/home.tsx`)

| ID | Before | Cat | After | Source / approval |
|---|---|---|---|---|
| H1 | "Digital SAT prep built for real progress" | e | "Digital SAT prep, one step at a time" | approved |
| H2 | "Use quick daily sessions, full-length exams, and tutor guidance in one place." | b, e | "Daily practice with worked explanations. Full-length practice tests, an AI tutor and a study plan on paid plans." | approved |
| H3 | "Adaptive practice" / "Question difficulty adjusts as you improve" | b, c | X3 | approved |
| H4 | "Full-length exams" / "Timed 98-question SAT simulation" | d, e | "Practice tests" / "Timed full-length practice tests (paid plans)" | approved |
| H5 | "Topic and skill-level progress visibility" | a | "Track your progress by section and skill" | approved |
| H6 | Scripted tutor demo panel | b, c, e | Removed | answer 11 |
| H7 | "Tutor support" / "Grounded in SAT-style questions" | c, e | Removed with H6 | answer 11 |
| H7a | "Grounded in SAT-style practice content" (trust strip) | c | "SAT-style practice questions" | approved (X4) |
| H8 | "Privacy first - no data selling" | e | "We don't sell student data." | approved |
| H9 | "Tutor chat with step-by-step SAT-focused explanations" | e, b | "AI tutor for step-by-step help (paid plans)" | approved |
| H10 | "Diagnose in minutes" / "Take a quick diagnostic to identify strengths and weak spots." | e | "Start with a diagnostic" / "Take a diagnostic test to see where you stand." | approved |
| H11 | "Use adaptive question flow and tutor guidance to understand mistakes and next steps." | b, c | "Answer SAT-style questions and review a worked explanation for each one." | approved |
| H12 | "Track and improve" / "Monitor progress and validate readiness with full-length SAT exam sessions." | e | "Track your progress" / "See your progress by section, and take full-length practice tests on paid plans." | approved |
| H13 | "Tutor guidance, grounded in context" plus three mechanism bullets | c, e | "AI tutor (paid plans)" / "Ask follow-up questions and get step-by-step help." | approved |
| H14 | "15-60 minute sessions that adapt to your schedule." / "Quick 15-min drills" | b, e | "Practice for as long or as short as you like." (bullet removed) | approved |
| H15 | "Pause and resume anytime" | e | "Pause and pick up where you left off" | approved |
| H16 | "Progress visibility for families" / "Clear progress snapshots and next-step priorities…" | e, c | "Progress for parents and guardians" / X6 | approved |
| H17 | "Topic and skill breakdowns" / "Linked guardian summary view" / "Calendar planning access" | b | "Skill-level progress (paid plans)" / X6 short form / "Study plan (paid plans)" | approved |
| H18 | "Session count, time spent, and recent accuracy trends." | e | "Your practice history and accuracy over time." | approved |
| H19 | "Skill and domain status across Math and Reading & Writing." | b | "Skill-level detail on paid plans." | approved |
| H20 | "Full-length exam outcomes" / "Module-level results and score estimate data…" | e | "Full-length practice test results (paid plans)" / "A score report after each practice test." | approved |
| H21 | "…adaptive question flow, tutor chat, review cycles, and full-length test readiness." | b, c | "Build a daily SAT routine with practice, review and worked explanations. Upgrade for full-length practice tests, an AI tutor and a study plan." | approved |
| H22 | "…monitor progress summaries and planning signals, with expanded visibility on paid plans." | b, c | X6 | approved |
| H23 | "Full diagnostic test and your overall score estimate" | e | "A full diagnostic test with your score estimate" | answer 1 |
| H24 | "Unlock everything" | e | "Everything in Free, plus:" | approved |
| H25 | "**Unlimited** practice questions" | e | "No daily limit on practice questions" | answer 3 |
| H26 | "**Unlimited** tutor chat messages" | b | "AI tutor for step-by-step help" | approved |
| H27 | "Full-length SAT exams, with review and score reports" / "Complete mastery breakdown and study calendar" | e | "Full-length practice tests with score reports" / "Skill-level progress and a study plan that focuses on your weak areas" | approved |
| H28 | "Expanded guardian summary and calendar visibility" | b | "Read-only progress view for a linked parent or guardian" | approved |
| H29 | "Priority feature access as plans roll out" | b | Removed | approved |
| H30 | Closing band: X1 + "Build momentum with adaptive practice, tutor chat, and full-length SAT simulations." | e, b | X1 + "Start with free daily practice. Upgrade any time for full-length practice tests and an AI tutor." | approved |

### Shared SEO copy (`shared/seo/public-meta.ts`: page body, `<head>` and FAQPage JSON-LD)

| ID | Before | Cat | After | Source / approval |
|---|---|---|---|---|
| M1 | Q "How is tutor chat different from a generic chatbot?" (2 paragraphs) | c, e | Q "What does the AI tutor do?" A "On paid plans, the AI tutor answers questions about SAT practice problems with step-by-step explanations." | approved |
| M2 | "…entitlement-gated for paid guardian access." | b, c | X6 | approved |
| M3 | "…daily adaptive practice and full-length timed SAT exams…" | b, e | "Yes. Daily practice is free. Full-length timed practice tests are on paid plans." | approved |
| M4 | "The Digital SAT is the computer-adaptive SAT format. It is about 2 hours long…" | d | Two sections; 2 h 14 min; two modules per section, the second easier or harder depending on the first | CB_STRUCTURE |
| M5 | "…adaptive by module, calculator-allowed across all Math questions…" | d | "It is shorter, it is taken on a computer, and each section adapts at the module level." | CB_STRUCTURE |
| M6 | "…alongside daily adaptive practice and review." | b | "Yes, on paid plans. Daily practice and review are free." | approved |
| M7 | Q "How does progress tracking work…" | a | Q "Can I track my progress?" A "Yes. You can see your progress by section, with skill-level detail on paid plans." | approved |
| M8 | Q "How does Lisa work?" | c, e | Removed | approved |
| M9 | Free-vs-paid answer | e, b | "Free includes 40 practice questions per day, a worked explanation after every question, review of your past answers, and a full diagnostic test with your score estimate. The AI tutor, full-length practice tests, skill-level progress, the study plan and the parent/guardian progress view are on paid plans." | approved; answer 1 |
| M10 | Math domains | d | Kept | CB_MATH |
| M11 | "…calculator use for the entire Math section, including Bluebook Desmos support." | d | "Yes. You can use a calculator at any point in the Math section, and a Desmos calculator is built into Bluebook, the College Board's testing app." plus the Lyceon line (see the kept-claims table) | CB_CALCULATOR; answer 4 |
| M12 | "44 total Math questions split into two 22-question modules, with 70 minutes total." | d | "The Math section has 44 questions in two equal-length modules, with 70 minutes in total." | CB_STRUCTURE |
| M13 | "Common misses include…" | a/d | "Common slips include…" (study advice) | approved |
| M14 | "…adaptive practice plus step-by-step tutor guidance…" | b, e | "Every practice question comes with a worked explanation. On paid plans, the AI tutor can walk through a problem step by step." | approved |
| M15 | Reading and Writing domains | d | Kept | CB_READING_WRITING |
| M16 | "…shorter passages with one question per passage…" | d | "Each Reading and Writing question has its own short passage of 25 to 150 words." | CB_READING_WRITING |
| M17 | "54 total questions split into two 27-question modules with 64 minutes total." | d | "The Reading and Writing section has 54 questions in two equal-length modules, with 64 minutes in total." | CB_STRUCTURE |
| M18 | Vocabulary and reading-speed advice | a/d | Kept (generic study advice) | approved |
| M19 | Home title/description "…adaptive practice, full-length exams, progress tracking, tutor guidance, and guardian visibility." | b | "Lyceon \| SAT Prep" / "Digital SAT practice with worked explanations and progress tracking. Full-length practice tests, an AI tutor and a study plan on paid plans." | answer 2; approved |
| M20 | /digital-sat title and description ("Master… adaptive…") | e, b | "Digital SAT Prep \| Lyceon" / "Prepare for the Digital SAT: how the test is structured, what each section covers, and SAT-style practice." | approved |
| M21 | /digital-sat/math description | b, e | "Prepare for Digital SAT Math: the four content areas, common mistakes, and practice with worked explanations." | approved |
| M22 | /digital-sat/reading-writing description | b, e | "Prepare for Digital SAT Reading and Writing: the four content areas, grammar rules, and practice with worked explanations." | approved |
| M23 | /blog "Expert SAT prep tips… improve your score…" | e | "SAT study tips and guides for the Digital SAT." | approved |
| M24 | /trust/evidence title and description | c | Removed with the page (F14) | answer 7 |

### Digital SAT pages

| ID | Before | Cat | After | Source / approval |
|---|---|---|---|---|
| D1 | "Build consistency with adaptive SAT-style practice, full-length test simulation…" | b | "Build a steady routine with SAT-style practice and progress tracking. Full-length practice tests on paid plans." | approved |
| D2 | "Algebra, geometry, data analysis, and advanced math with adaptive difficulty." | b, c | The four CB Math domains (the card links to the Math page, which cites CB_MATH) | CB_MATH |
| D3 | "Adaptive Practice" / "Question selection adjusts by performance…" | b, c | "Study Plan" / X3 | approved |
| D4 | "Full-Length Exam Simulation" / "…validate pacing and readiness." | b | "Full-Length Practice Tests (paid plans)" / "Take timed practice tests in the same structure as the Digital SAT." | approved |
| D5 | "Tutor Guidance" / "…tied to SAT-style question context." | c, b | "AI Tutor (paid plans)" / "AI tutor for step-by-step help." | approved |
| D6 | "Digital SAT scoring explanation and adaptive module behavior" | e, c | Removed | approved |
| D7 | Tracking / guardian / calendar list items | b | "Progress by section (skill-level detail on paid plans)" / guardian short form "(paid plans)" / "A study plan that focuses on your weak areas (paid plans)" | approved |
| D7a | "Daily limits on free plan with paid unlimited usage" | b | "Free daily practice, with no daily limit on paid plans" | answer 3 |
| D8 | "Trust and policy pages with implementation-backed language" | e | Removed | approved |
| D9 | "…upgrade only when you need unlimited usage." | b | "Start free. Upgrade for full-length practice tests, the AI tutor and a study plan." | approved |
| D10 | Math intro "…With calculator access on all questions…" | d | "The Digital SAT Math section covers Algebra, Advanced Math, Problem-Solving and Data Analysis, and Geometry and Trigonometry." | CB_MATH |
| D11 | Math topics table with per-skill counts ("~13-15 questions", "Typical Coverage") | d | The four CB domains, no counts | CB_MATH |
| D12 | "Practice adaptively so question difficulty stays close to your current level." | b | "Practise at the right level: questions that challenge you without overwhelming you." | approved |
| D13 | "Start math practice with adaptive flow and guided review." | b | "Start math practice with worked explanations." | approved |
| D14 | "Many students solve for x when…" | a/d | "It's easy to solve for x when…" | approved |
| D15 | Reading and Writing intro | d | "Each Reading and Writing question has its own short passage of 25 to 150 words, across four content areas." | CB_READING_WRITING |
| D16 | Reading and Writing question-type table with per-type counts ("Frequency") | d | The four CB domains, no counts | CB_READING_WRITING |
| D17 | "Common Grammar Rules Tested" | d | "Grammar Rules Worth Reviewing" (cards kept as study advice) | approved |
| D18 | Math and RW cross-links "Master algebra, geometry, and data analysis…"; "…with guided review." | e | The four CB Math domains; "…with worked explanations." | approved (X7) |

### Blog (`shared/content/blog.ts`; titles and descriptions also go to `<head>` and Article JSON-LD)

| ID | Before | Cat | After | Source / approval |
|---|---|---|---|---|
| B1 | "The Digital SAT is not harder than the paper SAT… Most students find the digital format more manageable…" | d | "The Digital SAT is a different test from the paper SAT, not simply an easier or harder one." | approved |
| B2 | "…shorter (2 hours vs 3 hours)…allows calculators for all math questions… generally work in students' favor." | d | "The Digital SAT takes 2 hours and 14 minutes, adapts at the module level, and uses short passages with one question each." | CB_STRUCTURE, CB_READING_WRITING |
| B3 | "Adaptive testing… this is how you unlock higher scores." | d | "Each section has two modules. The second module is easier or harder depending on how you did on the first." | CB_STRUCTURE |
| B4 | "…25-150 words… compared to 500-750 word passages with 10+ questions on the paper test." | d | First half kept; paper-test numbers removed | CB_READING_WRITING |
| B5 | "Calculator access for all math questions…" | d | Removed | approved |
| B6 | "Students who practice with the digital format typically prefer it." | d, e | Removed | approved |
| B7 | Scoring post: "exactly how it works", easier-module score cap, raw-score conversion, "Module 1 matters most", "Every question counts equally" | d | Rewritten to verified facts: two equal-length modules, the second adapts; 200–800 per section, 400–1600 total. Unpublished scoring claims and the unsourced guessing-penalty line removed. Title "How Digital SAT Scores Work (Sections and Modules Explained)" (slug unchanged). | CB_STRUCTURE, CB_SCORES; answer 4 |
| B8 | "Consistency beats marathon study sessions." / "…more effective than occasional marathon sessions." | d | "Short, regular practice is easier to keep up than occasional long sessions." | approved |
| B9 | "Spaced repetition beats cramming for long-term memory." | d | "Research on spaced practice finds that spreading study out over time is remembered better than cramming it into one session (Cepeda et al., 2006)." | CEPEDA_2006; answer 9 |
| B10 | "(morning or right after school works best)" | d | "(pick a time that works for you)" | approved |
| B11 | "The tutor is designed for quick study sessions with personalized questions and instant explanations." | b, c, e | "Every practice question comes with a worked explanation." | approved |
| B12 | "…for maximum score improvement without exhausting yourself." | e | "…without burning out." | approved |
| B13 | "Having access to thousands of SAT practice questions…" | c, e | "A question bank is only useful if you know how to use it." | approved |
| B14 | "Use Adaptive Practice" / "…Our unlimited practice questions adapt to your level automatically." | b, c, e | "Practise at the Right Level" / "Mix in harder questions as easier ones start to feel routine." | approved |
| B15 | "For most students, 50-100 quality questions per week… more effective than 300 rushed questions." | d | "A smaller number of questions with careful review beats a large number done in a rush." | approved |
| B16 | "Most Common Digital SAT Math Algebra Mistakes…" / "…fixes that lead to score improvement." | d, e | "Common Digital SAT Algebra Mistakes (And How to Fix Them)" / "Six algebra mistakes that are easy to make, and how to avoid them." (slug unchanged) | approved |
| B17 | "Algebra questions make up nearly 35%… the mistakes we see students make most often" | d, e | "Algebra is one of the four content areas on the Digital SAT Math section. Here are six mistakes that are easy to make…" | CB_MATH |
| B18 | "The Digital SAT allows calculators for all math questions." / "The best way to catch these mistakes is immediate feedback." | d | First removed; "Checking each answer as you go helps you catch these mistakes." | approved |
| B19 | /blog CTA "…adaptive SAT practice and guided review." | b | "Put these tips into practice with SAT-style questions and worked explanations." | approved |
| B20 | Post CTA "…our comprehensive guides." | e | "…our Digital SAT guides." | approved |
| B21 | `content/blog/*.json` (5 orphaned older copies) | b, c | Deleted | approved |
| B22 | Post dates and author | — | Unchanged; they change with the C4 rewrite | answer 5 |

### Trust, legal hub, 404, footer, OG image, auth form

| ID | Before | Cat | After | Source / approval |
|---|---|---|---|---|
| T1 | "Privacy, security, and academic integrity are built into every part of Lyceon…" | e | "Our approach to privacy, security and academic integrity. Read our policies below." | approved |
| T2 | "Students control learning actions and plans. Guardians have read-only visibility." | e | "Parents and guardians who link to a student's account get a read-only view." | approved |
| T3 | "Families can request deletion; de-identified aggregates may be retained…" | b | "You can ask us to delete your account. See the Privacy Policy for what we keep and why." | approved |
| T4 | "Lyceon aligns to SAT-style practice without claiming official SAT status." | a | The standard College Board trademark notice | answer 6 |
| T5 | "Trust Evidence" card | c | Removed | F14; answer 7 |
| T6 | "Tutor Transparency" card (linked to the signed-in /chat) | b | Removed | approved |
| T7 | /trust/evidence page | c | Removed: route, page, registry row, sitemap. Returns 404. Nothing folded into /trust. | F14; answer 7 |
| L1 | "Empowering students to learn with integrity in a technology-assisted world." | e | "Our policies and terms." | approved |
| L2 | "At Lyceon, we believe technology should strengthen learning…" | e | Removed | approved |
| L3 | "Academic Integrity First" / "We help students understand, not bypass learning" | e | "Academic integrity" / "See our Honor Code." | approved |
| L4 | "Responsible Technology" / "Transparent, supervised, and safety-aware" | b, e | Removed | approved |
| N1 | "404 Page Not Found" / "Did you forget to add the page to the router?" | c | "Page not found" / "Sorry, we couldn't find that page." + "Go to the homepage" | approved |
| F1 | Footer "Study Smarter, Score Higher." | e | "Study smarter for the SAT." | answer 2 |
| F2 | "{year} Lyceon. All rights reserved." | a | "© {year} Lyceon. All rights reserved." + the trademark notice | answer 6 |
| A1 | "Authentication and legal consent are handled in one standard flow." (/login) | c | Removed | approved |
| O1 | OG image "SAT Tutor at your Finger Tips." / "Practice smarter. Score higher." | b, e | "Digital SAT Prep" / "lyceon.ai". The duplicate top-left domain is dropped. | approved |

## Open items (owner)

1. **Billing Terms v2** (`legal/billing-terms/v2/en.md:29`) still reads "Premium unlocks unlimited practice, the LISA tutor, … the complete mastery breakdown … and expanded guardian visibility". This contradicts H25/H26/X6 above. Published legal text changes only as a new version proposed for counsel (Doctrine rule 6; G7), so Wave 1B does not edit it. The guard carries it as one pinned exception that fails once the wording is fixed.
2. **"score estimate"** (H23/M9): built as answer 1 directs; Karl to confirm the final wording.
3. **Blog dates and author** (B22): unchanged until the C4 rewrite (answer 5).
