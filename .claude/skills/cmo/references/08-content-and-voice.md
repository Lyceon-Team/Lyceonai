# 08: Content and voice

How Lyceon sounds, how content gets made outside the blog pipeline, and how each channel works. Channels, cadence, calls to action and "free" follow Karl's content rulings of 2026-11-02 (`02` §10a), which supersede Doc 10B where they conflict (SCL-264).

## Contents
1. Voice
1a. Video scripts and voice
1b. Positioning: students who want to grind
2. Words and patterns to avoid
3. The content workflow (outside the blog pipeline)
4. Channel playbooks
4a. Calls to action and "free"
5. Copy checklist (run before anything goes to Quinn)

---

## 1. Voice

- **Clear, warm and plain.** Written by a person for one parent or one student. Short sentences. Concrete words. Verbs over adjectives. "Help", not "facilitate"; "start", not "commence".
- **Honest about limits.** Say what Lyceon isn't when it helps the reader decide. LISA's SAT-only scope can be a light joke.
- **One-to-one.** "You", never "you guys" or "parents everywhere".
- **Specific, not superlative.** A true detail beats "best", "revolutionary", "game-changing".
- **No pressure.** Lay out the problem plainly; let the reader decide.
- **Parents (credibility register):** calm, informed, respectful of their skepticism; proof and visibility; no hype; no "AI" up front.
- **Students 13+ (attention register):** quicker, lighter, can be funny; never mock a struggling student; never manufacture anxiety.
- **Slogan:** "Study Smarter, Score Higher."
- **Brand vs product line:** the slogan says what Lyceon believes; the headline says what the product does. Don't make either do the other's job.

## 1a. Video scripts and voice (Karl, 2026-11-02)

Applies to every voiced video: worked examples, QOTD breakdowns, the rotation posts.

- **No burned-in word-by-word captions.** The on-screen handwriting and graphs carry the content. Karl may switch on TikTok's own auto-captions when posting.
- **The voice never reads the on-screen text verbatim.** The screen shows the question; the voice talks about it.
- **Script flow:**
  1. A spoken hook, as a question or challenge to the viewer: "Think you can solve this in ten seconds?", never the label "Solve this in 10 seconds".
  2. A one-sentence setup in plain talk.
  3. The key move, and why.
  4. The trap ("here's where people slip").
  5. The answer and a quick check.
  6. The call to action (§4a).
- **Tone:** contractions, short sentences, "you/we", varied rhythm, small natural beats ("Okay.", "Go."). No textbook phrasing.
- **Reference script** (Nov 11): "Think you can do this one in ten seconds? Go. … Okay. Take fourteen off both sides, and you get negative five x is at least twenty-five. Now here's where people slip: you're dividing by a negative, so the sign flips. x is less than or equal to negative five. Did you flip it? Follow, there's one of these every day."
- **Voice (Karl, 2026-11-11):** worked examples are voiced in Chirp 3 HD **Charon** (Google Cloud Text-to-Speech), the pick from the blind bake-off, voiced and cached by the weekly run. `am_michael` (Kokoro-82M) remains the voice of the local tools and the pilots.
- **Pronunciation:** "Lyceon" is said "lye-see-on" (/ˈlaɪsiɑn/: LYE, see, ON; stress on the first syllable).
- **Outro and end card:** no "lyceon.ai" spoken or shown; the end card reads "Lyceon SAT Prep".
- **Loudness:** voice lines are normalised (around −14 LUFS, true peak ≤ −1 dB) so nothing clips.
- **QOTD breakdowns** use authored scripts, not the question read aloud.
- **Screen demos** are scripted Playwright recordings, not OpenScreen (archived).

## 1c. Weekly worked examples (Karl, 2026-11-11, SCL-277)

- **Seven a week, all Hard** (difficulty 3): 2 **shortcut** slots in the "graphing method vs by hand" format (never name Desmos until Desmos replies), 2 **geometry** slots with drawn figures (similar triangles, triangle theorem, Pythagorean theorem, cylinders, cones), 3 **trap** slots (algebra, advanced math, problem-solving). QOTD breakdowns stay paused.
- **Format** (from the competitor research, 23 top videos): the question on screen in frame 1; the spoken hook a dare or a shortcut promise ("Most people get this wrong", "There's a faster way"); 30-60 s; one problem; the answer near the end; one CTA. A second CTA to test: "Comment GRIND and I'll send you 10 more hard ones" (Karl sends them by hand). §1a's script rules still apply.
- **Geometry figures:** the opening draws the figure stroke by stroke in the notepad style with only what the question gives (the side lengths, radius and height it states); anything worked out (a volume, a missing side) is drawn in at the step that finds it, never in the opening. The solution then builds on the same drawing.
- **Delivery:** one weekly message in #social, "Week <n> ready", with a link to each video and its captions file (private storage, links expire in 14 days). Karl posts by hand. The daily per-video drop ends once the first weekly batch works.

## 1b. Positioning: students who want to grind (Karl, 2026-11-03)

Lyceon is for serious, hardworking students: the ones who want to put in the work.

- **Student line:** "Lyceon is for students who want to grind."
- **Parent line:** "For students who are serious about their score." (Parents get the credibility register, §1; "grind" is the student word.)
- **Grind-style hooks and calls to action are allowed**, within each channel's rules (§4a). For example, "Follow if you're grinding for Dec 5", or on Instagram "Comment GRIND for the link".
- **Guardrail: "grind" means effort, never burnout.**
  - Never glorify all-nighters, skipping sleep, or studying through exhaustion.
  - Never shame students who aren't grinding, or imply they're behind or lazy.
  - The fear and pressure bans (§2) still apply.
  - The audience is 15–18, and parents pay.
- Positioning is not the slogan: "Study Smarter, Score Higher." stays the slogan (§1).

## 2. Words and patterns to avoid

- AI-tell phrasing: "delve", "in today's fast-paced world", "unlock your potential", "elevate", "seamless", "game-changer", "revolutionize", "harness", "navigate the landscape", rule-of-three lists for their own sake, listicle filler.
- "AI" in headlines; any mention of models, automation or how content was made (LISA as a feature excepted).
- Score promises ("raise your score 200 points"), "guaranteed", "better than a tutor".
- Fear lines aimed at teens ("you'll fall behind", "don't ruin your future").
- Normalizing the problem as pressure in student-facing copy ("most students procrastinate", "everyone else has already started").
- **Exception: "Most people…" hooks are allowed** (Karl, 2026-11-02; replaces the earlier ban). A hook may open with "Most people…" ("Most people think it's $64…?"). Only the opening is exempt: the rest of the hook is held to every other rule, and the fear and pressure bans above still apply. The worked-example check is PR #1395 (`shared/worked-examples/rules.ts`, H2; SCL-265).
- The Desmos interface, logo or the word "Desmos" in on-screen text or captions, until Desmos replies to Karl's permission request (Karl, 2026-11-02). Say "graphing calculator"; draw graphs in Lyceon's own rendering (Manim).
- Fake urgency ("only today!", "spots filling fast" when untrue).
- Any internal metric, mechanism or architecture detail.

## 3. The content workflow (outside the blog pipeline)

Blog posts and the monthly content plan go through content-ops (Doc 10B). Everything else (pages, emails, ads, social posts, video scripts, Reddit drafts, outreach) follows this:

1. **Idea.** Two or three concrete angles, each with its audience, register, awareness stage and the search intent or channel it serves.
2. **Gate check.** Is the channel's gate open (`05`)? If not, say what's missing.
3. **Brief** (`06` §9), including any Lyceon-specific claims needing approval.
4. **Draft.** In the repo's content model where one exists; as an action file (`07` §4) for anything external.
5. **Review.** Quinn, then Codex for anything public.
6. **Approval.** Karl merges or says "approved". Lyceon-specific claims approved once go to `product-facts.md` and the claim inventory.
7. **Measure.** The success metric and run length were set in the brief; the weekly memo reports them.

## 4. Channel playbooks

### Reddit (founder-led, manual only)
- Karl, by hand, in his own voice. The CMO drafts and suggests; never posts (Karl, 2026-11-02).
- What Karl does there: replies, DMs to people who ask, and at most one promo post per subreddit per week, following each subreddit's rules. Each subreddit's rules come first; many restrict self-promotion. Lead with genuine help; mention Lyceon only when relevant.
- No links in public comments. No cross-posting Lyceon's own content (QOTD, worked examples, videos). No new subreddits or accounts.
- The Reddit Question of the Day is discontinued: the subreddit that carried it was banned by Reddit (Karl, 2026-10-30).
- The DM link carries UTM tags (`lyceon.ai/login?utm_source=reddit&utm_medium=dm`); a link in a promo post, where the subreddit's rules allow one, gets `utm_medium=post` and a campaign name.
- Risk to watch: dependence on one channel run by one person's time; a moderation change could cut it off (the QOTD subreddit already was). Build the social channels while this one works.

### Question of the Day
- A ready-made premise: one question, answerable in seconds, works without knowing the brand.
- Only quick-to-read questions: mostly Math multiple choice plus short Reading and Writing; no grid-ins, no long or paired passages.
- "% got this right" only after 5 entries, and only the real number.
- Daily, to TikTok (carousel), Instagram and the Facebook Page, by hand from `#social` (`docs/runbooks/qotd-slack.md`). Not on Reddit (discontinued 2026-10-30).
- Judge each place it's posted on its own numbers.

### Blog and SEO
- Content-ops runs it: 3 posts a week, calendar-aware (days to the next test, deadlines, score releases).
- Judge SEO on non-branded search only; branded search is Reddit's echo.
- Useful beyond any existing Lyceon page (Ogilvy's Guinness principle): worth reading even if the reader never signs up.

### Email (Resend)
- Few, clear, recognizable. Each email has one job.
- Segments: opted-in guardians and students 13+; never manual imports.
- Sender name per type; QOTD subject starts with "SAT".
- UTM-tag every link. Click tracking only once the policy update covering it is live.
- The founding-cohort sequence and its lapse plan are the most important emails of the next two months.

### Social and short video (TikTok, Instagram Reels, YouTube Shorts, Facebook Page, X)
- **Channels (Karl, 2026-11-02):** TikTok, Instagram Reels, YouTube Shorts and a Facebook Page. Student register on TikTok, Instagram and Shorts; parent register on the Facebook Page (parent-leaning). X is founder / build-in-public only, in Karl's voice, and not tracked against targets.
- **Cadence (a starting shape that changes with the data):** QOTD daily. Worked examples Mon/Wed/Fri, plus more if quality holds. Other days rotate graphing-calculator/trap, product moments, test-date/myth and parent posts. "Graphing method vs by hand" content draws its graphs in Lyceon's own rendering (Manim) and never names or shows Desmos until Desmos replies (§2).
- Faceless videos for now. Open inside the product or the problem in the first seconds; one premise; a new beat before attention drops.
- **Video tools:** Hyperframes is the core. Pilots: Manim with manim-voiceover (math visuals), Kokoro-82M (voice, `am_michael`), Chatterbox (D3, for naturalness against `am_michael`). Screen demos are scripted Playwright recordings, not OpenScreen (archived), and never of the Desmos interface for now. Scripts and voice follow §1a. Rejected: Remotion (licence), stock-footage generators, AI video/avatar models.
- **TikTok keywords:** Karl adds them via TikTok's Manage keywords, from the `#social` keyword block (SCL-262).
- **YouTube Shorts:** the same vertical videos as TikTok and Reels; the walkthrough video stays on the channel.
- **Facebook Page:** parent-leaning; QOTD, worked examples and parent posts; end with a genuine question (§4a).
- **Measure:** the Monday analytics pull (`03` §2); judge a video at 72 hours on retention, saves per 1,000 views and share of views from search; each test has an experiment ID. Numbers go in the private Drive tracker, never in the repo.
- Karl applies platform AI labels at publish time; the content never mentions how it was made.
- Delivered to Slack #social for Karl's approval; posted by hand. No scheduler for now (Karl, 2026-11-02; replaces SCL-243's Buffer/Blotato plan). Reddit never.

### Landing pages and the homepage
- Order by the Hierarchy of Skepticism for parents: who we are and is it safe, then can it help, will my kid use it, then price.
- One angle per page or hero variant; test only where traffic supports it (`03` §7).
- Fix friction before adding persuasion: watch replays for hesitation and dead ends.

### Paid ads (when G1 opens)
- One ad set per angle; hook, one-line solution, call to action.
- UTM links plus PostHog; no pixels without a policy update.
- Never to under-13s. Parent and student audiences separated.

### Outreach (schools, partners, creators, press)
- Only when the gate is open; every message is an action file Karl approves.
- Research what they need before writing; lead with their problem, not Lyceon.

## 4a. Calls to action and "free" (Karl, 2026-11-02)

| Channel | Call to action |
|---|---|
| TikTok | No links, no promo lines. The follow line "Follow for daily SAT questions 👆" is allowed: a follow ask, not promo (Karl, 2026-11-02). The bio link is set once. |
| Instagram | "Comment SAT and I'll send you the link". "Comment GRIND for the link" is also allowed (Karl, 2026-11-03; §1b). |
| Facebook Page | A genuine question ("How would you solve it?"). No link, no "comment a word". |
| Reddit | No links in public comments; a link only by DM to someone who asked. |

**"Free"** only ever refers to the diagnostic, daily practice (40 questions a day) or the Question of the Day. The study calendar, the parent view, LISA (the tutor) and full-length tests are always presented as Pro. LISA is never promoted as free.

## 5. Copy checklist (run before anything goes to Quinn)

- [ ] One promise, stated plainly.
- [ ] Audience, register and awareness stage match the channel.
- [ ] Every SAT fact cites a source; dates from the official source.
- [ ] Every Lyceon claim is in `product-facts.md` or flagged for approval.
- [ ] Nothing explains how the product works inside.
- [ ] No "AI" in the headline; no mention of how the content was made.
- [ ] No score promises, guarantees, or "better than a tutor".
- [ ] No fake urgency or scarcity; any deadline is real.
- [ ] No fear aimed at teens; no normalizing the problem as pressure ("Most people…" hooks are fine).
- [ ] Any "grind" line means effort, never burnout: no all-nighters or skipped sleep, no shaming students who aren't grinding (§1b).
- [ ] "Free" only for the diagnostic, daily practice or the QOTD; calendar, parent view, LISA and full-length tests shown as Pro.
- [ ] The channel's call to action (§4a); no Desmos name, logo or interface.
- [ ] Written to one person; plain words; no AI-tell phrases.
- [ ] Links carry UTM tags; the success metric and run length are set.
- [ ] Passes the ethical test: would the reader be glad if they knew how we persuaded them?
