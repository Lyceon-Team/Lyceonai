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
| "A full diagnostic test and your diagnostic score estimate" | home pricing card; FAQ "What is free vs paid?" | answer 1; wording "diagnostic score estimate" confirmed by Karl, 2026-10-03 (approved) |
| "We don't sell student data." | home trust strip | approved (H8); matches Privacy Policy v4 |
| "Study Smarter, Score Higher" (slogan, visible copy only); titles stay "Lyceon \| SAT Prep" | home closing band, every public footer, /digital-sat hero | approved by Karl 2026-10-05 (F13, Step 0 decision 3), replacing answer 2's "Study smarter for the SAT"; on the counsel checklist (`README.md`) |
| College Board trademark notice | every public footer, /trust | answer 6 |
| Spaced-practice sentence | blog "quick-sat-study-routine" | answer 9: kept with CEPEDA_2006 |
| 400–1600 total, 200–800 per section | blog "digital-sat-scoring-explained" | answer 4: kept, cites CB_SCORES (text confirmed) |
| "A free SAT practice question every day — no account needed." | home QOTD slot; /sat-question-of-the-day hub and meta | plan R16 (anyone can answer, no login, ungated); wording approved by Karl 2026-10-05 (open item 4), "Digital" dropped per the keyword ruling |
| "{n}% answered correctly." (was "{n}% of students got this right."; new wording approved by Karl 2026-10-05: it states what was counted, answers, not who gave them; the old wording is on the banned list) | QOTD reveal; archive pages once a day has ≥ 5 attempts (qotd_archive() returns the counts, so the prerendered page and the API agree) | plan R17 ("approved and shown only once a day's question has at least 5 attempts"); hidden below 5 by the server (`qotdStat`, CI-tested) |
| "Every past question stays here with its answer and explanation" | archive pages; hub | plan R20a (the dated archive is the one public exposure of bank content) |

## F13 homepage rebuild (approved by Karl 2026-10-05)

**Approval:** every row below is approved by Karl 2026-10-05: the F13 brief ("All copy below is approved"), as amended by his Step 0 decisions the same day (1: "adapts" belongs to the paid study plan; 2: Variant B says "section and topic"; 3: "score higher" and "real progress" lifted from the banned list for these uses only). Clarified ruling: the homepage may name differentiators, including adaptive practice, at a high level; it never explains how anything works.

**Guard:** `shared/seo/banned-phrases.ts` `APPROVED_OUTCOME_PHRASES` lists the exact approved outcome sentences (X1, H34, H38, H40); any other outcome wording fails `tests/ci/public-copy-claims.contract.test.ts`, which also plants an unapproved claim to prove the scan reddens.

**Product facts checked (Step 0, 2026-10-05):** practice selection is random within the chosen filters for every plan (`select_practice_pool_random`, `ORDER BY random()`); only the paid study calendar weights weak domains (`calendar_v1.sql:721`), so every "adapts" claim is scoped to the paid plan. Free cap 40/day (`daily_quota_free`); paid has no daily cap (per-session cap 60). `questions.explanation` is NOT NULL. Guardians see the eight domains on five-segment meters, no skills (SCL-194). Privacy Policy v4 §5.4: "We Do Not Sell Personal Information".

| ID | Claim | Where | Cat | Note |
|---|---|---|---|---|
| H31 | "SAT prep for families" | hero eyebrow | a | |
| H32 | "SAT prep that adapts to you." | hero H1, Control A (prerendered) | e | adaptivity is the paid plan's; H33 scopes it (R15) |
| H33 | "An always-available alternative to private tutoring: free daily practice with a worked explanation for every question, and on paid plans a study plan that adapts to your weak areas, LISA your AI tutor, full-length practice tests and a progress view for parents." | hero sub, Control A | e | comparison ("alternative to private tutoring") approved; Step 0 decision 1 rewrite |
| H34 | "See real SAT progress before test day." | hero H1, Variant B (experiment `homepage-hero`, after consent only) | e | outcome sentence, approved |
| H35 | "Your student practices every day. You see a read-only progress summary by section and topic while they are on a paid plan, without scheduling a single session." | hero sub, Variant B | e | "topic", not "skill": guardians see no skills (Step 0 decision 2) |
| H36 | "No credit card required · We don't sell student data" | under the hero buttons | e | H8; Privacy Policy v4 |
| H37 | "Free daily practice" · "Worked explanation for every question" · "No credit card required" · "We don't sell student data" | trust strip | e | explanation NOT NULL; free tier |
| H38 | Cards: "Find the gaps" / "Start with a free diagnostic to see where you stand in every SAT section."; "Practice what matters" / "Daily practice with a worked explanation after every question, and on paid plans a study calendar that adapts as you improve."; "Get help when you're stuck" / "Ask LISA, your AI tutor, follow-up questions and get step-by-step help. On paid plans."; "See real progress" / "Track progress by section and skill, and take timed full-length practice tests with a score report after each. On paid plans." | See how it works | e | diagnostic covers all eight domains, free; card 2 per decision 1; "See real progress" approved outcome heading |
| H39 | "Try 40 more questions free" | QOTD, after the reveal | e | reads the same constant as the free card (40/day) |
| H40 | Parents card sentence (X6's approved wording); example view, two sections ("Reading & Writing", "Math": the product's own section labels, `shared/section-display.ts`) on five-segment meters; "Example view. Real progress comes from the student's account." | Who Lyceon is for | e | example data, labelled; label approved; "Reading & Writing" approved by Karl 2026-10-05 |
| H41 | "Build a daily SAT routine with practice, review and worked explanations. Upgrade for a study plan that adapts as you improve, full-length practice tests and an AI tutor."; example "Today" list (Practice block · Linear equations in one variable; Review missed questions; Ask LISA when you're stuck); "Example view. Your plan comes from your own practice." | Who Lyceon is for | e | decision 1 rewrite; "Linear equations in one variable" is a College Board Math skill name filling the design's [SKILL] placeholder |
| H42 | "Pro · personalized SAT prep"; "Everything in Free, plus:" / "A study plan that adapts and focuses on your weak areas" / "LISA, your AI tutor, for step-by-step help" / "Full-length practice tests with score reports" / "Skill-level progress, plus a read-only view for a linked parent or guardian" / "No daily limit on practice questions" | pricing, paid card (price live from Stripe) | e | |
| H43 | "Study Smarter, Score Higher." / "Start with the free diagnostic. No credit card required." | closing band | e | X1 |
| H44 | "Practice, review and the parent view." / "Screens from the product, with example data." | See how it works, under the heading / the product visual | a | captions not in the brief (the design's "A short walkthrough…" described the future video); approved by Karl 2026-10-05, with H41's "Linear equations in one variable" |

**Product screenshots** (`client/public/images/home/`, `scripts/marketing/capture-product-shots.mjs`): captured from the built app with test fixtures only (an original fixture question, the guardian test-harness scenario); no question-bank content. The parent view omits the score strip (projected score, target) and the latest full-length test card (score and change): a score shown on the homepage would be a Lyceon-specific performance claim, not approved. Open item 5.

## SEO Wave 3 content pages (approved by Karl 2026-10-05)

**Pages:** the 23 pages in `shared/content/pages` (P2 practice-question hub, two section pages and eight domain pages; P3 good-score page and five score pages; P5 free practice test; P6 three parent pages; P7 online SAT prep; P8 how to study).

**Approval:** Karl, 2026-10-05, on the Wave 3 Step 0 report: "Copy: approved as drafted", plus decisions 1–6. Quoted where they decide a row: decision 1 ("No skill pages. Domain pages only … Each domain page shows up to 2 archived QOTD questions from that domain and links to the archive"); decision 2 ("All 5 score pages (1100–1500): approved"); decision 3 (the three `/digital-sat*` 301s); decision 4 (`/lyceon-vs-sat-tutor`: live Stripe price; "clean and respectful toward tutors. Never negative about them"; the nine-row table; "Varies by tutor"); decision 5 (`/is-sat-tutoring-worth-it` "approved in writing by Karl", with the range opening and the standard CTA); decision 6 (byline "Lyceon Team" as a JSON-LD Organization). The free-practice-test addition ("Lyceon Pro also includes full-length practice tests with a score report after each.") is his wording. This approval is approval 1 of 3 toward the automation dial (R21). The C4 blog rewrites (W20–W24, below) are approval 2 of 3.

**Guard:** the publish gate (`shared/seo/content-gate.ts`), run by the prerender over every content page; the build fails on any problem. Every block of text must cite a source below or a row below; every cited source URL must appear in a Sources table in this file; every cited row ID must exist here; the page must carry `approved: { by: "Karl", date }` dated on or after its last change. `tests/ci/content-publish-gate.test.ts` plants each defect.

**Sources (Wave 3).** Each page was fetched on 2026-10-05 and the quoted text found on the page itself. Retail prices change: the two price sources are shown "as viewed" with that date and are re-checked on every price change.

| Key | URL | Quoted / relied on |
|---|---|---|
| CB_CONTENT_DOMAINS | https://satsuite.collegeboard.org/practice/content-domains | The description of each of the eight domains, e.g. Algebra "Measures the ability to analyze, fluently solve, and create linear equations and inequalities, as well as analyze and fluently solve equations and systems of equations using multiple techniques." "After you take a practice test in Bluebook, you'll see progress bars representing your performance in each domain". |
| CB_MATH_OVERVIEW | https://satsuite.collegeboard.org/sat/whats-on-the-test/math/overview | "Algebra 13–15 / Advanced Math 13–15 / Problem-Solving and Data Analysis 5–7 / Geometry and Trigonometry 5–7"; "Questions from all four categories appear in each test module." |
| CB_READING_WRITING (re-read 2026-10-05) | https://satsuite.collegeboard.org/sat/whats-on-the-test/reading-writing | "each of which includes questions from all four different domains"; "questions that test similar skills and knowledge are grouped together and arranged from easiest to hardest". |
| CB_PRACTICE | https://satsuite.collegeboard.org/practice | "Take a free, full-length practice test on Bluebook, or try a few sample questions in the test preview." |
| CB_BLUEBOOK_PRACTICE_TESTS | https://satsuite.collegeboard.org/practice/practice-tests/bluebook | "These tests are timed like a real test…"; "Full-length practice tests are scored." |
| CB_BLUEBOOK_HOW_TO | https://satsuite.collegeboard.org/practice/bluebook | "The practice tests use the same multistage adaptive model". Confirms "adaptive" on /free-sat-practice-test (Karl's condition, 2026-10-05). |
| CB_KHAN | https://satsuite.collegeboard.org/practice/khan-academy | "…The course content is developed in partnership with College Board… Best of all, it's free!" |
| CB_PERCENTILES | https://research.collegeboard.org/reports/sat-suite/understanding-scores/sat | Total-score table (nationally representative / user group): 1600 99+/99+, 1500 99/97, 1400 97/93, 1300 91/85, 1200 81/75, 1100 67/62, 1000 48/47. User group = "students that graduated in the past three school years". A percentile is "the percentage of students with scores equal to or lower than their score". The page names no edition; cited as viewed 2026-10-05. |
| CB_GOOD_SCORE | https://satsuite.collegeboard.org/scores/what-scores-mean/what-is-good-score | "a good SAT score is one that helps you get admitted to a college you want to go to!"; "Each school has its own score expectations, and a score that may be average at a highly selective school might be in the top percentiles at another."; "Your grades, application essay, and extracurricular activities also shape…"; BigFuture lists "the average SAT scores for admitted first-year students at thousands of different colleges". Its rounded lines ("around 1050", "1350 or higher … top 10%") are never quoted. |
| CB_ANNUAL_REPORT_2026 | https://reports.collegeboard.org/media/pdf/2026-total-group-sat-suite-of-assessments-annual-report-ada.pdf | p. 8: "Total 1,954,833 1045 528 517 42% …": class of 2026 mean 1045 (RW 528, Math 517); 42% met both benchmarks. |
| CB_UNDERSTANDING_SCORES_PDF | https://satsuite.collegeboard.org/media/pdf/sat-understanding-scores.pdf | p. 6: benchmarks Reading and Writing 480, Math 530; "predict a 75% likelihood of achieving a C or higher in related first semester, credit-bearing college courses." |
| CB_PRACTICE_TEST_STUDY_2025 | https://research.collegeboard.org/media/pdf/DigitalSATPracticeTests_052025.pdf | "Students who completed 1, 2, and 3 or more full-length digital SAT practice tests scored approximately 25, 45 and 60 points higher, respectively, than similar SAT takers who did not complete any"; caveat "Estimates are not causal" (always quoted with it). |
| CARE_TUTOR_COST | https://www.care.com/c/how-much-does-a-tutor-cost/ | "Test prep tutors $100/hr"; "*Based on average posted starting rates from tutors listed on Care.com, as of September 22, 2025."; cost depends on location, tutor's experience, private vs center/agency. |
| TPR_TUTORING | https://www.princetonreview.com/college/sat-tutoring-course | "SAT Targeted Tutoring 10-hour package … $2,000"; "SAT Comprehensive Tutoring 18-hour package … $3,150". |
| BRIGGS_2009 | https://files.eric.ed.gov/fulltext/ED505529.pdf | "average gains are more in the neighborhood of 30 points"; claims "of large increases of 100 points or more"; math effect larger than critical reading; "few published studies have been conducted on students taking admission tests since 2000"; "if marginal college admission decisions are made on the basis of very small differences in test scores, a small coaching effect might be practically significant after all." |
| ACT_R1743_2019 | https://www.act.org/content/dam/act/unsecured/documents/R1743-test-prep-retest-scores-2019-07.pdf | "Test preparation improved students' retest scores…"; "Among specific test prep activities, only the number of hours using a private tutor resulted in increased score gains above the overall effect of test prep." (ACT, not SAT.) |

Not cited, because the page could not be read or does not say it: Kaplan, Wyzant, Thumbtack and BLS tutor rates (blocked automated reads); The Princeton Review course prices (drawn by script, not confirmed on the visible page); the number of Bluebook practice tests (no current College Board page states it).

| ID | Claim | Where | Cat | Approval / note |
|---|---|---|---|---|
| W1 | Free: "40 practice questions a day", "A worked explanation after every question", "A full diagnostic test"; the moved FAQ "What is free vs paid?" | /online-sat-prep | e | owner ruling 2026-09-03 (40/day), F6; pinned to the homepage free card by `tests/ci/homepage-pricing.contract.test.ts` |
| W2 | Pro: "No daily limit on practice", "Full-length practice tests", "A study plan built around your weak areas", "An AI tutor for step-by-step help", "A read-only progress view for a linked parent"; moved FAQs on full-length tests and progress | /online-sat-prep; /sat-tutor-cost | e | H42; Wave 3 "approved as drafted" |
| W3 | "Lyceon Pro also includes full-length practice tests with a score report after each."; "Yes, on the paid plan. They follow the structure of the digital SAT. They are written by Lyceon, not the College Board." | /free-sat-practice-test | e | Karl's addition, 2026-10-05 |
| W4 | "Lyceon's free diagnostic is not a full-length test and not an official one. It covers both sections and every content area. When you finish, you see where you are strong and where to start. It's free, with no credit card."; "Lyceon's free diagnostic shows your strengths by section." | /free-sat-practice-test; score pages | e | the diagnostic draws from all eight domains and is free (H38) |
| W5 | "Each day we post one free SAT-style question with a full explanation. Past questions stay up in the archive, sorted by date."; "Each one links to its answer and worked explanation." | hub; section and domain pages | e | plan R16, R20a; QOTD copy approved 2026-10-05 |
| W6 | "No. They are written in the style of the digital SAT and sorted by the same content areas. Real test questions are not published for practice." | hub FAQ | e | approved as drafted |
| W7 | "Lyceon is a monthly subscription…"; the live price cell ("{price} a month for Pro, with a free plan", or "Monthly subscription for Pro" with no number) | /sat-tutor-cost; /lyceon-vs-sat-tutor | e | decision 4; price from Stripe at runtime only (owner ruling 2026-09-03) |
| W8 | The Lyceon column of the nine-row table: "Practice any time"; "Your student, with a study plan based on their results (Pro)"; "Yes, a worked explanation after every question"; "Yes, on Pro, with a score report after each"; AI tutor "Yes, on Pro"; study plan "Yes, on Pro, built around your student's weak areas"; parents "Yes, on Pro, a read-only view for a linked parent"; in-person accountability "No" | /lyceon-vs-sat-tutor | e | decision 4 (comparison: Karl's written approval) |
| W9 | The tutor column: "Varies by tutor" where it varies; "Sessions you book with the tutor"; "No, the tutor is a person"; "Yes, a person working with your student"; cost "Varies by tutor. Published rates include $100 an hour (Care.com…) and $2,000 for 10 hours (The Princeton Review)." | /lyceon-vs-sat-tutor | a, d | decision 4; figures cite CARE_TUTOR_COST, TPR_TUTORING |
| W10 | "They do different jobs, and some families use both."; "When a tutor makes more sense" and "When Lyceon makes more sense" paragraphs | /lyceon-vs-sat-tutor | e | decision 4 ("When a tutor makes more sense" stays); respectful toward tutors |
| W11 | "Studies of SAT prep find average gains from about 30 points (coaching, in older studies) up to about 60 points (students who took three or more official practice tests, in a 2025 College Board study, which notes this is a link, not proof of cause)." | /is-sat-tutoring-worth-it opening | d, e | decision 5, Karl's wording, approved in writing; cites BRIGGS_2009 and CB_PRACTICE_TEST_STUDY_2025 |
| W12 | General study advice: start with a Bluebook practice test; study the content areas you miss most; short spread-out sessions ("Twenty minutes a day beats three hours on Sunday."); review every miss; practise in the real format; the four "What to ask before you pay" questions; "Take a free official practice test in Bluebook so you know where you start…" | /how-to-study-for-the-sat; parent pages | a | approved as drafted; the SAT and research facts beside them cite their sources |
| W13 | Copy moved unchanged from /digital-sat/math and /digital-sat/reading-writing: the three common Math mistakes, "How to practice" (without "Practise at the right level", which implied adaptivity), the short-passage strategies, the six grammar rules, and their FAQs (incl. "Lyceon practice includes a built-in Desmos calculator on every Math question" and "How does Lyceon support math review?") | section pages | a, e | F6 (2026-10-03, answer 4 for the calculator line); moved with decision 3 |
| W14 | Score-page reading: "{verdict}" ("It's above the national average." 1100 / "It's well above the national average." 1200 / "Yes, by national measures." 1300 / "Yes, by any national measure." 1400 / "Yes. It's near the top of the scale." 1500); "That depends on the schools on your list… At schools where admitted students average {score} or less, you're at or above the typical score. At more selective schools, a {score} can be below average."; the good-score intro | P3 pages | a | decision 2; "average", not the draft's "middle 50%", because CB_GOOD_SCORE speaks of the average (sourcing correction; approved by Karl 2026-10-05) |
| W15 | "Start with the free diagnostic. No credit card required." / "Start the free diagnostic" (every content page) | every content page | e | H43; decision 5 |
| W16 | "Practice is easier to plan when you can see those areas and pick the one you need." | hub intro | a | approved as drafted |
| W17 | "Lyceon is SAT prep you do online, on your own schedule. It's not a class with set times. You practice when you can, and the work is tracked for you." | /online-sat-prep | e | approved as drafted; Lyceon is never called a course or a class |
| W18 | "Free official practice also helps. In a College Board study, students who took one, two, or three or more Bluebook practice tests scored about 25, 45 and 60 points higher than similar students who took none. The College Board notes this shows a link, not proof that the tests caused the gains." | /free-sat-practice-test | d, e | approved as drafted; College Board's finding, with its caveat; listed in `APPROVED_OUTCOME_PHRASES` |
| W19 | Domain pages: "{Domain} is one of the four content areas in SAT {section}."; "The College Board says {Domain} measures {its published description}."; Math: "The Math section has {n} {Domain} questions out of 44, and questions from all four Math content areas appear in each module."; RW: "Each Reading and Writing module has questions from all four content areas. Questions that test similar skills are grouped together and run from easiest to hardest." | eight domain pages | a, d | decision 1 (domain pages, no skills); the descriptions and counts are the College Board's (CB_CONTENT_DOMAINS, CB_MATH_OVERVIEW, CB_READING_WRITING); pattern approval, the per-domain sentences listed in the PR for Karl's eye |
| W20 | /blog/is-digital-sat-harder: "It isn't harder or easier. It's a different test…"; the three prep paragraphs (take a Bluebook practice test; don't try to read your second module; learn the calculator before test day) | C4 blog rewrite | a | approved by Karl as drafted, 2026-10-05 (C4, approval 2 of 3); facts beside it cite CB_STRUCTURE, CB_READING_WRITING, CB_CALCULATOR, CB_PRACTICE, CB_BLUEBOOK_PRACTICE_TESTS |
| W21 | /blog/digital-sat-scoring-explained: "The College Board doesn't publish how raw answers convert to a score, so be wary of anyone who claims to know the formula." | C4 blog rewrite | a, d | approved by Karl as drafted, 2026-10-05; the F6 rule (no unpublished scoring) stated to the reader; the scale, percentiles, mean and benchmarks cite CB_SCORES, CB_PERCENTILES, CB_ANNUAL_REPORT_2026, CB_UNDERSTANDING_SCORES_PDF |
| W22 | /blog/quick-sat-study-routine: the 15-minute routine, "A short routine you keep beats a long one you skip.", "15 minutes a day for 8 weeks adds up to 14 hours", the simple week, start with a Bluebook baseline | C4 blog rewrite | a | approved by Karl as drafted, 2026-10-05; spacing cites CEPEDA_2006 |
| W23 | /blog/sat-question-bank-practice: "Twenty questions with careful review beat a hundred done in a rush."; attempt, review, log; the burnout signs; "The College Board offers free practice through Bluebook and its Student Question Bank." | C4 blog rewrite | a | approved by Karl as drafted, 2026-10-05; "Practise at the right level" removed (it implied adaptive practice, R15); the Student Question Bank is named on CB_PRACTICE ("Access the Student Question Bank"); the QOTD line is W5 |
| W24 | /blog/common-sat-math-algebra-mistakes: the six mistakes and fixes (carried from the F6-approved post, shortened) | C4 blog rewrite | a | approved by Karl as drafted, 2026-10-05; "13 to 15 of the section's 44 questions" cites CB_MATH_OVERVIEW and CB_STRUCTURE; the calculator line cites CB_CALCULATOR |

**C4 blog rewrites (approved by Karl 2026-10-05, approval 2 of 3 toward the automation dial).** The five posts were approved as drafted with one addition: each ends with the standard "Start the free diagnostic" CTA (W15). They are content pages in the Wave 3 schema (`shared/content/blog.ts`) and pass the same publish gate. Byline "Lyceon Team" (a JSON-LD Organization, decision 6); `published` keeps each post's original date, and the shown and sitemap date is the rewrite date, 2026-10-05. URLs are unchanged. Four titles changed with the rewrite: "How Digital SAT Scores Work", "A Quick SAT Study Routine (15 Minutes a Day)", "How to Use an SAT Question Bank Without Burning Out", and the algebra post drops "Digital" ("Common SAT Algebra Mistakes (And How to Fix Them)").

**Also approved by Karl 2026-10-05:** "average" in place of the draft's "middle 50%" on the score pages (W14), and the public nav and footer link changes (nav "SAT Practice" → the hub; footer lists the new pages).


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
| H23 | "Full diagnostic test and your overall score estimate" | e | "A full diagnostic test and your diagnostic score estimate" | answer 1; wording confirmed by Karl, 2026-10-03 |
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
| M9 | Free-vs-paid answer | e, b | "Free includes 40 practice questions per day, a worked explanation after every question, review of your past answers, and a full diagnostic test and your diagnostic score estimate. The AI tutor, full-length practice tests, skill-level progress, the study plan and the parent/guardian progress view are on paid plans." | approved; answer 1 |
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
2. ~~**"score estimate"** (H23/M9)~~: closed. Karl confirmed "diagnostic score estimate" on 2026-10-03; applied to the homepage pricing card and the free-vs-paid FAQ (page and JSON-LD).
3. **Blog dates and author** (B22): unchanged until the C4 rewrite (answer 5). Wave 3 decision 6 (2026-10-05): the byline stays "Lyceon Team", now a JSON-LD Organization (done); the rewrites were approved on 2026-10-05 and the posts now show that date (W20–W24). Closed.
5. ~~**Score figures in the homepage product visual (F13, 2026-10-05).**~~ Closed: Karl approved the screenshot with its score strip and latest-test card hidden (2026-10-05). Showing them (a projected score band, a target, a test score and its change) would still need his written approval under Doctrine rule 5.
4. ~~**Question of the Day copy (Wave 2, 2026-10-05).**~~ Closed: approved by Karl on 2026-10-05 with one change: "Digital" is dropped everywhere in the QOTD copy, per the keyword ruling. The approved strings are the hub title "SAT Question of the Day – Free Daily SAT Practice | Lyceon", the archive description "An SAT {topic} practice question from {label}, with the correct answer and a worked explanation.", and the homepage and hub line "A free SAT practice question every day — no account needed." The hub's SAT facts reuse M5, M10, M15 and M16 with their sources; on the QOTD hub, M5 reads "The SAT is shorter, it is taken on a computer, and each section adapts at the module level." Nothing describes how a day's question is chosen (doctrine §0.2, pinned by `tests/seo.qotd-pages.test.ts`).
