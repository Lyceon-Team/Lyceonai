# Lyceon Spec-Changes Log

**Type:** Controlled-write change log. This is the **single document in the corpus that agents MAY write into** — the deliberate exception to the otherwise-strict "agents never write the spec" rule.

**Why this exception exists:** the spec corpus was built over time, and implementation keeps surfacing real, necessary deltas (a platform constraint that invalidates a step, a missed table, an architecture reframe). Those discoveries must be captured *as we build*, at the moment they are found, rather than lost until the owner next revises a doc. This log is where they land.

**Write rules (controlled, not forbidden):**
- **The spec corpus (Docs 00–05E etc.) remains write-protected** — CC and Codex NEVER edit a locked spec doc. That rule is unchanged.
- **This log is the sanctioned exception.** Codex MAY append an entry here when it discovers a spec delta that is *absolutely necessary* (a locked-spec step that is wrong or impossible against reality, a missing classification, a contradiction). CC MAY append when a build forces a delta. They write ONLY to this log, ONLY as a new appended entry, and ONLY for genuine spec deltas — never to record ordinary work, opinions, or proposed-but-unvalidated preferences.
- **An agent-written entry is a PROPOSAL until the owner validates it.** Agent entries are appended with status `PROPOSED`. The owner reviews, then promotes to `OPEN` (accepted, owed into the spec) or marks `REJECTED`. Agents never write `OPEN`/`APPLIED`/`REJECTED`, and never edit or delete an existing entry — strictly append-only.
- **The owner writes freely** — adds, promotes, folds entries into locked docs, sets any status.

**Authority:** this log is authoritative for "what changed since the locked spec and why." When the owner next revises a locked spec doc, the relevant entries are folded in and marked `APPLIED`.

---

## How to use this log

- One entry per delta. Newest at top.
- Each entry: ID, date, status, the change, the reason, the spec doc(s) it touches, and the build artifact (PR / migration) if any.
- **Status values:** `PROPOSED` (agent-appended, awaiting owner validation) · `OPEN` (owner-accepted, owed into the spec) · `APPLIED` (folded into the locked spec doc) · `SUPERSEDED` (replaced by a later entry) · `REJECTED` (owner declined an agent proposal). Agents may only write `PROPOSED`; the owner sets all others.
- Entry IDs: `SCL-NNN` (sequential).

---

## Entries

SCL-041 | 2026-08-18 | Doc 03D §7.2 falsified for Flash-class models — state blocks move into systemInstruction | PROPOSED

Change: Doc 03D V1.2 §7.2 specifies that context blocks (mastery, friction, memory, style, item) are late-placed as a `[system note]` user turn immediately before the final student message in `contents[]`. Ablation testing on the target model (Gemini 2.0 Flash) falsified this placement for directive compliance: 25 consecutive responses with blocks in user turns produced zero SCL-034 (diagnostic classification) compliance; the same directives appended to `systemInstruction` produced correct behavior immediately, including the first observed SCL-034 firing.

WAS: §7.2 states "State blocks are injected as a `[system note]` immediately before the current student turn in the conversation messages" with the rationale that proximity to the current turn improves adherence and that keeping the system instruction invariant preserves prompt-cache stability.

IS: For Flash-class models on the Gemini API, state blocks (rendered by `renderStateBlocks`) are appended to `systemInstruction` after a `--- CONTEXT FOR CURRENT QUESTION ---` separator. The `contents[]` array carries only the conversation (student → user, tutor → model). System-role messages from the conversation history are mapped to user-role entries without a `[system note]` wrapper. Consecutive same-role entries are merged into a single entry with multiple parts to prevent the @google/genai SDK's silent same-role merge from corrupting message boundaries.

Rationale: Flash-class models (Gemini 2.0 Flash, 2.5 Flash) attend to `systemInstruction` with different priority than to user turns in `contents[]`. Directives placed in user turns were consistently ignored — not occasionally missed, but structurally invisible to the model's instruction-following path. The §7.2 placement was designed for models that treat system notes in user turns as instructions; the target model does not. Prompt-cache stability is preserved because the state-block suffix changes per turn regardless of placement — the cache key for `systemInstruction` already includes the full string, so no additional cache invalidation occurs vs the user-turn placement.

Evidence:
- 25 Flash-class generations with §7.2 placement: zero SCL-034 fires (diagnostic mode never classified), SCL-035 decompose-first ignored, SCL-039 affective scaffolding missed.
- Same directives appended to `systemInstruction`: SCL-034 fired on first response (BUGGY_PROCEDURE correctly classified for CASE-01's sign-flip pattern), SCL-035 decompose-first honored, SCL-039 flat contradiction applied to CASE-18.
- Findings are consistent across run counts sufficient to rule out random compliance (25 vs 25, p < 0.001 under any reasonable model).

Boundary: this ruling applies to the production model routing table's flash_class alias (currently Gemini 2.0 Flash). Pro-class models may behave differently; if §7.2's placement is later validated for pro_class, the architecture supports per-model placement without code change (the system instruction composition is a pure function of the request).

Version: Doc 03D V1.2 §7.2 is superseded for flash_class models. The behavioral requirement (fact-directive pairing per §7.4) is unchanged — only the placement site moves.
Owner action: at next spec pass, amend §7.2 to specify systemInstruction placement as the default, with a note that the original user-turn placement was tested and falsified for Flash-class models. No schema change. Code change: `orchestrate.ts` `buildSystemInstruction` appends state blocks; `buildConversationMessages` removes state block injection from contents.
Artifact: PR for branch claude/ws-l7-production-port.

SCL-040 | 2026-08-17 | Doc 03C §4.3 cross-reference error — "03A V3 §11" is Policy Decision Logging, not prompt artifacts | PROPOSED

Change: Doc 03C V3 §4.3 references "Doc 03A V3 §11 (policy prompt artifacts)" as the authority for the prompt artifact format. Doc 03A V3 §11 is actually "Policy Decision Logging" — it defines the `tutor_policy_decision_log` table and has no prompt artifact content.

WAS: §4.3 says "Prompt artifacts use the format defined in 03A V3 §11 (policy prompt artifacts)" and proceeds to describe loading behavior (immutable after load, version-keyed, registry-resolved) without specifying the artifact shape or format, delegating that to the cross-referenced section.

IS: No section of Doc 03A defines the prompt artifact format. The cross-reference is a drafting error — §11 is not about prompt artifacts. The loading and resolution semantics in §4.3 itself (immutable, version-keyed, variant-resolved, fallback-to-default) are implemented as specified. The artifact format — a TypeScript module exporting a typed `PromptArtifact` with a `renderSystemInstruction(fields)` function — is derived from §4.3's behavioral requirements (immutability, version keying, field substitution only) and the platform's existing module-load conventions.

Rationale: Discovered during WS-L5 implementation (prompt template system). The loading/resolution semantics are clear and implemented per §4.3. The missing piece is the artifact format itself, which §4.3 delegates to a non-existent source section. Implementation chose TypeScript modules with typed render functions because: (a) immutability is enforced by `ReadonlyMap` + module-load semantics, (b) field substitution is type-checked via `PromptFields`, (c) version keying uses the artifact's own `version` field, (d) the registry is loaded at bootstrap (import time), not at request time.

Version: Doc 03C V3 §4.3 cross-reference to "03A V3 §11" should be corrected. No spec version bump (the behavioral requirements are correct; only the cross-reference target is wrong). No code change — the implementation satisfies §4.3's behavioral requirements.
Owner action: at next spec pass, either (a) correct the §4.3 cross-reference to the actual prompt artifact format section (if one exists elsewhere), or (b) define the artifact format inline in §4.3, or (c) create a new §11.x in Doc 03A for prompt artifact format and update the cross-reference.
Artifact: PR for branch claude/ws-l5-prompt-templates.

SCL-039 | 2026-08-15 | Doc 03D §3 and §5.1 — affective state modulates scaffolding level | OPEN (owner-approved 2026-08-15)

Change: Doc 03D specifies scaffolding by diagnostic mode — knowledge gap, retrieval failure, buggy procedure — and by surface. It does not account for the student's affective state. The owner's blind-authored gold response for CASE-18 departed sharply from the rubric for a reason the document had no field to express.

WAS: Doc 03D §3.3 states that productive struggle is the point and that a tutor who answers for the student has failed. §5.1's CASE-18 rubric specified "give the student one easy next action." The implied model: scaffolding level is a function of what the student knows.

IS: Scaffolding level is a function of what the student knows AND their affective state. When a student expresses self-directed negative judgment, the tutor reduces questioning load and supplies structure.

The rule:

1. Contradict the self-judgment once, flatly, then move on. Not repeated, not expanded, not a speech. "No, you're not" and then the work.
2. Stop asking and start giving. Continued questioning of a student who has just called themselves stupid is experienced as further evidence of incompetence. Each unanswered question confirms the self-judgment.
3. Supply the structure, leave the execution. Give the setup, the framing, the organizing principle. The student still does the final work — but they do it from a position of "I can see how this goes" rather than "I don't know where to start."
4. Restore momentum before resuming diagnosis. Diagnostic questioning resumes on the next item, not in the same turn.

INV-03-04 is unchanged and unaffected. Scaffolding increases; the answer is still never given. In CASE-18 the owner supplied the full proportion setup — which quantity is the numerator, which is the denominator, and the equation to solve — and left the student to solve it. That is the maximum scaffolding this rule permits: everything up to but not including the arithmetic that produces the answer.

Owner's framing, recorded because the reasoning matters more than the rule:

"If the student is self-bashing, we don't want to keep asking them questions. It just makes them feel more incompetent. They have a lot of time to learn. We need to make sure they feel confident, that they're able to understand, and get that pressure off their chest. We are not trying to prove a point to the student or to ourselves that we're always going to follow hard rules. The end goal is the student's education. The end goal is not for us to prove that we can assess something in one question, or do things a specific way."

Evidence: Lepper & Woolverton (2002) and Lepper, Drake & O'Donnell-Johnson (1997) found expert tutors attribute difficulty to the problem rather than to the student and spend a large fraction of their effort on motivation rather than content [Moderate — observational, small samples, consistent across independent groups]. Ryan & Pintrich (1997) established that adolescent help-seeking avoidance is driven by threat to self-worth [Established]; continued questioning of a student who has just voiced a self-worth judgment is such a threat. Craig, Graesser, Sullins & Gholson (2004) established that disengagement predicts absence of learning [Established]; a spiraling student is on the path to it.

Boundary against SCL-036: SCL-036 rules that disengagement, not frustration, is the intervention trigger. This SCL is not an exception to that. Self-directed negative judgment is a precursor signal — it does not yet indicate disengagement, and the correct response is to prevent the transition rather than to treat one as underway. A student saying "I'm stupid" while still describing their own error accurately is engaged. This rule keeps them there.

Boundary against Doc 03 §21: this rule covers ordinary academic self-deprecation. Safety-relevant statements run a separate mechanism (INV-03-16) and a separate response path (Doc 03 §21). Where both could apply, §21 governs.

Owner action: amend Doc 03D §3 to record affective state as a scaffolding input alongside diagnostic mode. Amend §5.1's CASE-18 rubric to permit structural supply rather than a single next action, and add the rule to the authoring brief. No code change — this is prompt-construction and rubric guidance, and it will appear in the system instruction as a directive paired with the recent_friction context block per §7.4. No schema change.

SCL-038 | 2026-08-15 | Doc 03D §9 — A/B power calibrated to realistic coaching effect sizes | OPEN (owner-approved 2026-08-15)

Change: Doc 03D §9 specifies A/B methodology without stating the effect size the harness must be able to detect. Absent that, an experiment can be designed that cannot detect a real effect.

WAS: §9 specifies student-level randomization, pre-registration, covariate adjustment, and test-date cohorting. It does not state the magnitude of effect a LISA change can plausibly produce.

IS: The harness is calibrated to detect effects on the order of **single-digit to low-double-digit SAT points**, not large swings.

Briggs's analysis of NELS data placed commercial coaching at roughly 14–15 points on SAT-math and 6–8 points on verbal. A 2025 meta-analysis found no reliable verbal effect at all.

These are whole-program effects. A single prompt change is a fraction of that. An A/B design powered to detect a 100-point swing is calibrated to marketing copy, not to measurement, and will report null results indefinitely while real improvements go undetected.

Consequences for §9:
- Covariate adjustment is not an optimization, it is a requirement. Between-student variance dwarfs the effect size. §9.3 already specifies this; this SCL records why it is load-bearing.
- Process metrics (§3.2) carry more decision weight at realistic sample sizes than outcome metrics do, because they have better signal-to-noise. §9.2's pre-registration requirement stands, but the practical readout order is process first, outcome as confirmation.
- Claims made externally about score improvement must survive FTC substantiation against these effect sizes, not against aspirational ones.

Owner action: amend Doc 03D §9 to record the expected effect-size range and its consequences for power. No code change. Coordinate with whoever owns marketing claims — the substantiation requirement is downstream of this number.

SCL-037 | 2026-08-15 | Doc 03D §0.1 and §2.1 — INV-03-04 justification corrected; refusal posture grounded | OPEN (owner-approved 2026-08-15)

Change: Doc 03D frames the never-reveal-an-unsubmitted-answer rule as pedagogically grounded. The evidence does not support that framing at the strength implied. Separately, the evidence supports a specific refusal posture that the document did not previously justify.

WAS: Doc 03D §0 asserts that "a tutor that hands over the answer produces a student who feels helped and scores the same," presented as the foundation of the product. Doc 03D §5.1's authoring brief describes the never-reveal rule in learning-science terms.

IS, part 1 — the rule holds; the justification narrows.

**The central premise is well-supported.** Chi et al. (2001) found that constraining tutoring to suppress tutor explanation and force student construction produced equal or greater learning [Established]. "Did the student do the thinking" is a real finding.

**The specific rule is not derivable from it.** Chi, Jordan, VanLehn & Litman (2009) compared eliciting against telling and found no reliable learning difference. The bottom-out-hint literature is genuinely contested.

INV-03-04 therefore stands as a **product decision** — it is what distinguishes a tutoring product from an answer service, and it is what a parent is paying for — not as a conclusion from learning science. Doc 03D must not cite pedagogical evidence it cannot support for this rule. The rule does not weaken; its justification becomes honest.

IS, part 2 — refusal posture is now evidence-grounded.

**Never make declining feel like a rebuke, and never make it the whole response.**

Ryan & Pintrich (1997) and Ryan, Pintrich & Midgley (2001) establish that help-seeking avoidance rises sharply in early adolescence, driven by threat to self-worth and perceived social cost [Established]. The population's default failure mode is not asking too much — it is going quiet. A refusal that costs the student standing raises the probability they stop asking, and a student who stops asking is worse off than one who asked for the answer.

Expert human tutors converge on the same posture from observation: Merrill, Reiser, Ranney & Trafton (1992) found human tutors keep students on a productive path and give substantially more guidance than constructivist theory recommends; Lepper & Woolverton (2002) describe highly effective tutors who rarely say "wrong," ask leading questions instead of correcting, and attribute difficulty to the problem rather than the student [Moderate — observational, small samples, consistent across independent groups].

**They redirect rather than deny.** The observed pattern is substitution of a smaller step for the requested answer, not refusal.

This validates the owner's blind-authored CASE-01 gold response, which never declines explicitly and instead moves directly to the next diagnostic step.

Owner action: amend Doc 03D §0 to describe INV-03-04 as a product decision with the Chi et al. (2001) constructive-activity finding as supporting context rather than as proof. Amend §5.1's authoring brief to specify redirect-over-refuse as the default posture, with the Ryan/Pintrich mechanism recorded. No code change — INV-03-04's enforcement is unchanged and remains structural.

Two measurable gaps, recorded because the product can close them:
1. No study tests whether refusing an answer reduces subsequent help-seeking. The instrumentation to measure this exists in this platform.
2. No study tests "acknowledge briefly, then redirect to a winnable step" against alternatives. This is a load-bearing move in Doc 03D §5.1 CASE-04 and CASE-18.

Both are answerable with the golden set and the attribution fields required by Doc 03D §8. Neither is a V1 requirement.

SCL-036 | 2026-08-15 | Doc 03D §3.2 — intervention trigger changed from frustration to disengagement | OPEN (owner-approved 2026-08-15)

Change: Doc 03D §3 and the golden-set case taxonomy treat escalating frustration and self-deprecation as the signal that a student needs intervention. The evidence identifies a different and better-supported signal.

WAS: §5.1 coverage targets included "self-deprecation escalating" as an intervention-relevant category. §3.2's process metrics carried no disengagement measure. The implied model was that frustration indicates a student in trouble.

IS: **Confusion is not the problem. Disengagement is.**

Craig, Graesser, Sullins & Gholson (2004) found confusion positively predicted learning and boredom negatively predicted it [Established]. A frustrated, engaged student is in a productive state. A student transitioning toward disengagement is the one being lost.

Observable difference:

| State | Signal | Action |
|---|---|---|
| Engaged frustration | Complaining, but messages still contain content, reasoning, or specific objections | Continue tutoring. This student is working |
| Disengagement | Messages shorten and stop containing content. "idk", "ok", "whatever", one-word replies with no substance | Intervene — change approach, reduce difficulty, or offer a win |

Doc 03D §5.1 CASE-01's student complains about twenty minutes and is fully engaged — the message contains a specific, accurate account of what they tried. That student needs a better hint, not intervention. CASE-15's "idk" with no elaboration is closer to the real signal.

**No time threshold exists.** There is no research-supported answer to "how long should a student struggle before the tutor intervenes." Wait-time research covers roughly three seconds of classroom silence and does not transfer to asynchronous text. Any specific number in an implementation is invented. Doc 03D must not specify one, and any future implementation proposing a threshold must state that it is a product heuristic rather than an evidence-backed value.

Owner action: amend Doc 03D §3.2 to add a disengagement signal to the process metrics, replacing the implicit frustration model. Amend §5.1's coverage taxonomy so that the self-deprecation category is described as a tone-and-register test rather than an intervention-trigger test. No code change; this is measurement and rubric guidance.

Instrumentation note: message length trend and content density across a conversation are cheap to compute and are the closest available proxies for the disengagement transition. Neither is validated in tutoring dialogue — treat as a hypothesis to test against the golden set, not as an established detector.

SCL-035 | 2026-08-15 | Doc 03D §5.1 — "I don't know" rubric inverted: decompose first, with a floor | OPEN (owner-approved 2026-08-15)

Change: Doc 03D §5.1's golden-set rubric for silent-student cases (CASE-15, CASE-16) specified shrinking the question as the default response to "I don't know." The owner's blind-authored gold response contradicted this, favouring teaching the core concept. Evidence review resolved against both positions.

WAS: Golden-set rubric — on "I don't know," shrink the question. The owner's blind gold response for CASE-15 instead taught the concept, reasoning that a needs_work student on a concept-heavy item has a knowledge problem rather than an execution problem.

IS: **Decompose first. Teach the concept only after decomposition fails, and no deeper than three levels.**

Rationale: The evidence favours decomposition for a specific reason neither prior position accounted for.

The **expertise reversal effect** (Kalyuga, Ayres, Chandler & Sweller, 2003) [Established] holds that instructional support which helps novices actively *harms* learners who already possess the relevant schema. Teaching the concept when the student's problem was retrieval is therefore not merely wasted instruction — it is negative.

Decomposition is self-diagnosing. It costs one turn and reveals which mode the student is in. Teaching first costs a turn and reveals nothing, while risking the reversal effect.

Two further findings converge: impasse-driven learning (VanLehn, Siler, Murray, Yamauchi & Baggett, 2003) found learning events cluster around impasses the student worked through rather than around smoothly delivered tutor explanations [Moderate to Established]; and Chi et al. (2001) found that constraining tutors to suppress explanation and force student construction produced equal or greater learning [Established].

**The floor is load-bearing.** Decompose three levels and still hit "I don't know," and the tutor is no longer diagnosing — it is grinding. At that point telling is correct. Chi, Jordan, VanLehn & Litman (2009) compared eliciting against telling and found no reliable learning difference, so the cost of telling at the floor is low and the cost of continued decomposition is student disengagement.

Subject qualifier: decomposition in procedural math means sub-computation with verifiable intermediate states. In Reading & Writing the analogue is **localization** — "which sentence would you point to?" — not sub-computation. Doc 03D §5.1 CASE-04's gold response already does this correctly. The evidence for this distinction is structural reasoning, not a finding: [Absent] for direct comparison.

Age qualifier: no evidence of a gradient within 13–18. Treat a 14-year-old and a 17-year-old identically until product data says otherwise.

Owner action: amend Doc 03D §5.1's CASE-15 and CASE-16 rubrics to specify decompose-first with a three-level floor. The owner's blind gold response for CASE-15 stands as authored but is annotated with this ruling, so the calibration set records the disagreement rather than silently overwriting it. No code change.

SCL-034 | 2026-08-15 | Doc 03D §3.1 — fourth diagnostic mode added: systematically applied incorrect procedure | OPEN (owner-approved 2026-08-15)

Change: Doc 03D §3.1's tutor act taxonomy and the diagnostic framing throughout §3 assume two failure modes when a student is stuck — the student lacks the concept, or the student has it and cannot retrieve it. A third mode is well-established in the literature and is absent from the document.

WAS: Doc 03D §3 treats student difficulty as either a knowledge gap or a retrieval failure. §5.1's CASE-03 (prerequisite gap) is the only case addressing a structural cause, and it addresses a missing prerequisite rather than a wrong rule.

IS: Three diagnostic modes, not two.

| Mode | Signature | Correct response |
|---|---|---|
| Knowledge gap | Slow or absent response, no partial recall, no consistent pattern | Teach the concept — but only after decomposition fails, per SCL-035 |
| Retrieval failure | Delay then hedged partial ("something about... signs?"); correct earlier in session | Decompose to surface what is already there |
| **Buggy procedure** | **Fast, confident, wrong. Consistent error pattern rather than random errors** | **Surface the rule the student is actually applying, then contrast it against the correct one** |

Rationale: Brown & VanLehn's repair theory (1980) and VanLehn's Mind Bugs (1990) establish that a common failure mode is a systematically applied incorrect procedure. The student has a rule; it is the wrong rule. The evidence classification is [Established] — the misconception literature is solid.

This mode is diagnostically dangerous because it presents as competence. The student is fast and confident, which reads as understanding. Neither "teach the concept" nor "decompose the question" is the correct response: decomposition confirms the student can execute each step, because they can — they are executing the wrong rule correctly.

Doc 03D §5.1 CASE-01 is exactly this case and was authored as an answer-extraction test. The student has three sign-flip errors in seven days. That is not confusion; that is a consistently applied rule about what happens to a term crossing the equals sign. The case remains valid for what it tests, and now also carries the buggy-procedure signature.

Detection: the distinguishing signal is error *pattern*, not error *rate*. A student making random errors across a skill is in a different mode from a student making the same error every time. The document previously had no field for this distinction.

Owner action: amend Doc 03D §3.1 to carry three diagnostic modes and their signatures. Amend §3.2's misconception repair rate definition to reference the buggy-procedure mode explicitly. No code change (the diagnostic modes are prompt-construction guidance, not an implemented classifier). No schema change.

Note on instrumentation: Learning Factors Analysis (Cen, Koedinger & Junker, 2006) detects when a skill's error rate fails to decline with practice, which is evidence the knowledge component being taught is not the one blocking the student. That is the closest principled trigger for "the named skill is not the real skill." Recorded as available prior art, not as a V1 requirement.

SCL-033 | 2026-08-15 | Doc 03 INV-03-05 narrowed — guardian visibility of LISA-derived topic coverage | OPEN (owner-approved 2026-08-15)

Change: INV-03-05 ("Zero guardian LISA access") as locked forbids "derived indicators" without qualification. Doc 03D §11 specifies a student- and guardian-visible surface showing which skills a student has recently discussed with LISA — a derived indicator sourced from tutor_conversations. Read literally, the invariant forbids it. Karl ruled the surface should exist and the invariant should be narrowed rather than the two left in contradiction.

WAS: Doc 03 Part XI, INV-03-05 — "Zero guardian LISA access. Guardians have no LISA access of any kind: no conversation content, no analytics, no usage counters, no derived indicators." Doc 03A §16.2–16.3 elaborates the same prohibition. Read as written, ANY value computed from a LISA table is forbidden to guardians, including a bare list of skill names.

IS: INV-03-05 forbids guardian access to LISA CONTENT and to indicators that reveal, characterize, or infer from the substance of a conversation. It does not forbid a bare enumeration of which skills a conversation touched.

Permitted to guardians:
- Skill-level topic coverage: which skills the student has recently discussed with LISA, expressed as skill names from the canonical taxonomy and nothing else.

Forbidden to guardians, unchanged:
- Conversation content, verbatim or summarized, in whole or in part
- Message counts, session counts, turn counts, duration, frequency, or any usage volume
- Sentiment, engagement, effort, confidence, or any affective characterization
- Inferred traits of any kind, including learning style (Doc 03D §11.2)
- Crisis flags, crisis review status, or any signal derived from the crisis path (Doc 03 §21.4 governs; guardian contact runs through the §21.3 human process only)
- Anything the student said

Rationale: A skill name is a fact about curriculum coverage, not about the student. "Your child has been working on Linear Equations with the tutor" carries the same informational weight as the practice-surface data guardians already receive and reveals nothing about what was said, how well it went, or how the student behaved. The guardian-trust pillar is served by a parent being able to see that tutoring is happening and on what — that is the product's value, visible.

The prohibition's purpose is protecting the confidentiality of a minor's conversation with a tutor. A skill name does not touch that. Usage counters do — frequency and volume characterize the student's behavior and struggle — and they remain forbidden, which is why the "no usage counters" clause is preserved verbatim rather than narrowed alongside.

Boundary test for any future addition to this surface: if the value would change based on WHAT the student said rather than only WHICH skill was discussed, it is forbidden. Topic coverage passes. Everything else in the original prohibition fails.

Scope note: Doc 03D §11.1's second visible item — skills with recurring difficulty — is derived from practice_session_items, not from any LISA table. It is practice data guardians already receive and is outside INV-03-05's scope entirely. This SCL does not address it and no narrowing is required for it.

Version: Doc 03 INV-03-05 — "no derived indicators" narrowed to "no indicators derived from conversation substance." Doc 03A §16.2–16.3 requires the parallel narrowing. No spec version bump; this SCL records the interpretive boundary. No code change (the surface is unbuilt). No schema change.

Owner action: at next spec pass, amend INV-03-05 in Doc 03 Part XI and the corresponding prohibition in Doc 03A §16.2–16.3 to carry the content-substance qualifier and the boundary test above. Until amended, the locked text reads as an absolute prohibition and this SCL governs.

SCL-032 | 2026-08-15 | Doc 03B §5.5 step 4 vs implementation scope for INV-03-02 (live exam gate on POST /messages only) | OPEN (owner-promoted 2026-08-14)
Change: Doc 03B §5.5 (Start Conversation server steps) lists "Check live exam block (§3.4)" as
step 4, identical to §6.5 step 4 (Append Turn). §3.4 says "Before allowing any tutor turn, check
if the student has an active full-length exam session." The current implementation gates only
POST /api/tutor/messages (append turn, §6.5) — not POST /api/tutor/conversations (start/reuse,
§5.5), not GET /api/tutor/conversations/:id (replay, §7), not GET /api/tutor/conversations
(list, §8), not POST /api/tutor/conversations/:id/close (close, §9). Karl ruled: current scope
is correct. §5.5 step 4 should be removed from the spec.
WAS: §5.5 step 4 says the start-conversation route must check the live exam block (§3.4). §3.4
uses the word "turn" ("Before allowing any tutor turn"). INV-03-02 (Doc 03:2144) says "API
endpoints return explicit access-denied errors during active exam session state" — the plural
"endpoints" is ambiguous. Read together, these provisions could require the gate on all tutor
endpoints including start-conversation.
IS: The gate applies to POST /api/tutor/messages ONLY. The four ungated routes are correct without
it. Karl’s three reasons:
(a) A conversation is cheap and stateless at creation — it stores a row in tutor_conversations
with no student content, no Vertex call, no mastery effect. Blocking creation during an exam
would mean the student has to create a new conversation after the exam and loses the scope
reference they set up beforehand. No invariant is violated by allowing creation.
(b) §3.4’s own language says "turn" — a turn is an append-turn (POST /messages), not a
conversation shell. The gate’s enforcement point is the moment content generation begins
(Vertex inference), which only happens on append-turn.
(c) Replay (GET /:id) and list (GET /) are read-only operations on existing data. Blocking them
during an exam would prevent a student from reading past tutoring conversations while studying
for the exam — a hostile UX with no security justification. Close (POST /:id/close) is a
lifecycle transition with no content generation. None of these routes trigger Vertex inference
or produce new tutor output. INV-03-02’s purpose is preventing exam integrity breach via live
AI generation, not locking the student out of their conversation history.
Rationale: Karl ruling 2026-08-15. The invariant’s purpose is preventing live AI tutoring during
an active exam — the concern is that real-time Vertex inference could be used to cheat. That
concern applies only to the append-turn route, which is the sole path to model inference.
Creation, replay, list, and close are inert from an exam-integrity perspective.
Version: Doc 03B §5.5 step 4 should be removed at next spec pass. No spec version bump (the
invariant INV-03-02 is unchanged; the spec step list is the defect, not the invariant).
No code change. No schema change. Implementation already correct.
Owner action: at next spec pass, remove "Check live exam block (§3.4)" from §5.5 step 4 (Start
Conversation server steps). The step remains in §6.5 step 4 (Append Turn). Optionally: amend
§3.4’s prose to say "Before allowing any tutor turn" rather than using the broader "any tutor
request", and annotate INV-03-02 to clarify that "API endpoints" means "content-generating
endpoints" (i.e., POST /api/tutor/messages only).

SCL-031 | 2026-08-14 | Doc 03A §9.4 vs Doc 03C IAM (memory compaction write path) | OPEN (owner-promoted 2026-08-14)
Change: Doc 03A §9.4 says the memory compaction writer goes through the BFF with HMAC service auth
  (compaction-worker → main-api). Doc 03C IAM table grants the compaction worker direct Supabase
  write access to tutor_memory_summaries. These two provisions appear to contradict — one routes
  through the BFF, the other implies direct DB writes.
WAS: Doc 03A §9.4 defines the write path as: Cloud Tasks → BFF /api/internal/memory/compact-writeback
  → executeCompaction → UPSERT into tutor_memory_summaries. The BFF verifies HMAC (01A Part VII,
  compaction-worker → main-api service pair) before writing. The worker does not hold direct Supabase
  credentials — it delegates the write to the BFF.
  Doc 03C IAM table lists the compaction worker as having direct Supabase write access to
  tutor_memory_summaries. Under this model, the worker writes directly without going through the BFF.
IS: §9.4 is canonical for the write path. The compaction worker sends its result through the BFF
  with HMAC-verified service auth. The Doc 03C IAM grant is defense-in-depth: the worker's service
  account MAY have Supabase write access as a fallback, but the canonical code path uses the BFF.
  Implementation follows §9.4 — the worker does not use direct Supabase writes.
Rationale: §9.4 is the detailed architectural description; the Doc 03C IAM table is a summary
  matrix that does not describe the request flow. The BFF path provides: (a) HMAC verification
  (01A Part VII) so the write is authenticated at the application layer, not just at the DB layer;
  (b) Zod validation of the content_json before the write (§7.6 Layer B); (c) observability
  (structured logging of compaction outcomes). Direct DB writes from the worker would bypass all
  three. The Doc 03C IAM grant may still be provisioned as defense-in-depth (if the BFF is
  unavailable, the worker could theoretically write directly), but the canonical path is §9.4.
Version: No spec version bump. This SCL records the interpretive alignment between the two docs.
No code change. No schema change. Implementation follows §9.4.
Owner action: at next spec pass, annotate Doc 03C IAM table to clarify that the compaction worker's
  Supabase access is defense-in-depth, not the canonical write path. Reference §9.4 for the
  canonical flow.
Artifact: PR #566, branch claude/ws-l4-memory-writer.

SCL-030 | 2026-08-13 | Doc 03 INV-03-10 scope narrowing (model-generated text, not structured API fields) | OPEN (owner-promoted 2026-08-14)
Change: INV-03-10 ("Canonical question IDs never appear in student-facing LISA output") and
  Doc 03B §16.6 line 2360 (source_question_canonical_id returned in conversation responses) appeared
  to conflict. Karl ruled: both stand. They govern different things.
WAS: INV-03-10 (Doc 03:2160) reads "Canonical question IDs (SAT{M|RW}{1|2}[A-Z0-9]{6}) never appear
  in student-facing LISA output. Enforced: Doc 03 §3.7, output scanner pattern matching. Violation:
  internal metadata leak." Doc 03B §16.6 (line 2360) returns source_question_canonical_id in the
  conversation response envelope. Read together, the API field appears to violate the invariant.
IS: The two provisions bind on DIFFERENT output layers:
  (a) The structured API field (source_question_canonical_id) STAYS. It is scope metadata the client
  uses to correlate a conversation to a question. It is never rendered to the student — visible only
  in browser devtools, where it is meaningless to a student. It is load-bearing for LISA's scope
  resolution (Doc 03A §1.2 layer 1, Doc 03B §6.5 step 3). Removing it would break scope continuity.
  Doc 03B §16.6 is NOT in defect.
  (b) INV-03-10 binds on MODEL-GENERATED TEXT. LISA must never write a canonical question ID into a
  chat message, under any framing, on any surface. The invariant's own enforcement point already says
  "output scanner pattern matching" — a text-layer mechanism, not an API-field mechanism. This SCL
  records the narrowing explicitly so the boundary is not re-litigated.
  (c) INV-03-10 enforcement remains ABSENT. No canonical-ID scanner exists on model output today —
  the model can emit SATM1ABC123 in prose and nothing catches it. This SCL settles the SCOPE of the
  invariant; it does not close it. Closing it is LISA-FULL-007.
Rationale: Karl ruling 2026-08-13. The API field is structured metadata consumed by the client for
  scope correlation; the invariant targets prose text the student reads. Conflating them would either
  break scope resolution (if the field is removed) or render the invariant unenforceable (if it's
  broadened to "never present in any JSON"). The boundary is: student-readable text vs. structured
  metadata. The field is no more a "student-facing output" than a database row ID in a REST response.
Version: Doc 03 INV-03-10 — scope narrowed to model-generated text only; structured API fields
  carrying canonical IDs for scope resolution are explicitly excluded. No spec version bump (the
  invariant text is unchanged; this SCL records the interpretive boundary).
No code change. No schema change.
Owner action: at next spec pass, annotate INV-03-10 with the text/field boundary. Track
  LISA-FULL-007 (canonical-ID output scanner) as the open enforcement item.

SCL-029 | 2026-08-13 | Doc 03 INV-03-03 past_due status (platform entitlement predicate wins) | OPEN (owner-promoted 2026-08-14)
Change: Doc 03 INV-03-03 says "LISA requires entitlement.tier=paid AND entitlement.status=active on
  every request. No grandfathering, no cached entitlement beyond single-request TTL." Read literally,
  this excludes past_due and trialing. Doc 01's platform entitlement predicate treats the canonical
  entitled set as {active, past_due, trialing} — a locked decision (owner ruling 2026-06-14, codified
  in the entitlement_active() SQL predicate). The two conflict.
WAS: INV-03-03 (Doc 03:2146) requires "entitlement.status=active" — literally the string 'active'.
  The platform predicate (entitlement_active(), migration 20260616120000) is
  status IN ('active','past_due','trialing'). A student whose card is mid-retry (past_due) or in a
  trial period (trialing) would be entitled on every other paid surface but denied LISA if the
  invariant is enforced literally.
IS: The platform entitlement predicate wins. LISA follows the same entitlement gate as every other
  paid surface — {active, past_due, trialing}. A student whose card is mid-retry does not lose their
  tutor.
  Implementation already correct — no code change required. The LISA entitlement gate is:
    server/services/entitlement-service.ts:47-67 (EntitlementService.isEntitlementActiveForProfile),
    which delegates to the entitlement_active() RPC (status IN ('active','past_due','trialing')).
    server/routes/tutor-runtime.ts:227 calls this check on every request.
  INV-03-03's "status=active" is read as "entitlement-active per the platform predicate," not as
  a literal string match on the word 'active'. The invariant's intent (per-request entitlement check,
  no grandfathering, no caching) is preserved; only the status-value set is widened to match the
  platform.
Rationale: Karl ruling 2026-08-13. The platform owns the definition of "entitled." Every paid
  surface (practice, mastery, guardian mirror, projections, LISA) consumes the same entitlement_active()
  predicate. A LISA-specific narrowing to status='active' only would mean a student in Stripe's
  past_due retry window can do practice but not talk to their tutor — a confusing and unjustifiable
  split. The invariant's purpose is preventing unpaid access, not penalizing payment retry.
Version: Doc 03 INV-03-03 — "status=active" widened to "entitlement-active per the platform
  predicate (active, past_due, trialing)." No spec version bump (the invariant text is unchanged;
  this SCL records the interpretive alignment with the platform predicate).
No code change. No schema change. Implementation already correct.
Owner action: at next spec pass, amend INV-03-03 to reference the platform entitlement predicate
  rather than the literal string 'active', or add a parenthetical noting the platform-defined set.

SCL-028 | 2026-08-12 | Doc 03A §18.2 tutor_messages idempotency constraint (role-inclusive uniqueness) | OPEN (owner-promoted 2026-08-14)
Change: Doc 03A §18.2 defines the idempotency constraint as
  UNIQUE (conversation_id, client_turn_id). Doc 03B §9 and §13.3 describe an idempotency model
  that persists two tutor_messages rows per client_turn_id per turn — one role='student' (§6.5
  step 11) and one role='tutor' (§6.5 step 16). The constraint as written permits only one row
  per (conversation_id, client_turn_id), so the tutor message insert always fails. This is a spec
  defect — the constraint contradicts the two-row model that the idempotency and retry sections
  depend on.
WAS: UNIQUE (conversation_id, client_turn_id) — or equivalently, partial unique index on
  (student_id, conversation_id, client_turn_id) WHERE client_turn_id IS NOT NULL per
  migration 20260806020000. Either shape permits only one row per client_turn_id per conversation.
IS: UNIQUE (student_id, conversation_id, client_turn_id, role) WHERE client_turn_id IS NOT NULL.
  Permits exactly one student row and one tutor row per turn. The idempotency lookup (§9, step 8)
  finds both rows by (conversation_id, client_turn_id) and discriminates by role to detect full
  replay vs. partial recovery.
Rationale: The idempotency model at §9 and the retry model at §13.3 require two rows per
  client_turn_id — one for the student message (step 11) and one for the tutor response (step 16).
  The §18.2 constraint blocks the second insert. Without this fix, every non-crisis tutor turn
  fails at step 16 with a uniqueness violation and cannot complete (P0 severity — total LISA
  outage).
Version: Spec defect — §18.2 constraint must be widened to include role in the uniqueness key.
Artifact: PR for branch claude/ws-l3-b1-1e, migration 20260812000000_tutor_messages_idempotency_role.sql.
Owner action: review — update §18.2 DDL to UNIQUE (conversation_id, client_turn_id, role), or
  equivalently the partial unique index form with role included.

SCL-027 | 2026-08-09 | Doc 03B §6.5 step 5 / step 6 ordering (payload validation before ownership check) | OPEN (owner-promoted 2026-08-14)
Change: Doc 03B §6.5 numbers ownership verification as step 5 and payload validation (Zod parse)
  as step 6. The implementation inverts the order — step 6 (Zod parse) runs before step 5
  (loadOwnedConversation) — so a malformed request body is rejected with 400 before any DB lookup
  occurs.
WAS: Spec ordering — step 5 ownership check first, step 6 payload validation second. Under this
  ordering, a request with a valid conversation_id but garbage body hits the DB for ownership
  before discovering the body is invalid.
IS: Implementation ordering — step 6 payload validation first (tutor-runtime.ts:622), step 5
  ownership check second (tutor-runtime.ts:633). A malformed body returns 400 without touching
  the database.
Rationale: Fail-fast on shape. A 400 for an invalid body reveals nothing about conversation
  ownership — the rejection is purely structural, independent of who owns the conversation. No
  security property is lost. The reordering avoids a wasted DB round-trip on requests that would
  fail validation anyway. Karl accepted.
Version: Spec deviation — implementation intentionally diverges from the numbered step ordering
  in §6.5. The spec text is correct as a logical description of what the pipeline does; only the
  execution order differs.
Artifact: PR for branch claude/lisa-tutor-inventory-27lras.
Owner action: review — confirm acceptance of the step 5/6 ordering inversion in §6.5, or
  renumber the spec steps to match the implementation order.

SCL-026 | 2026-08-07 | Doc 03A §7.3, §10.3 (preferred_explanation_style V2→V1 per-turn capture) | OPEN (owner-promoted 2026-08-14)
Change: Doc 03A §7.3 defers preferred_explanation_style to V2 via batch extraction over accumulated
  conversation history. This entry moves it to V1, captured per-turn from model output via the
  orchestrator response schema.
WAS: §7.3 defines preferred_explanation_style as a V2 target requiring "LLM-based pattern extraction
  over conversation history" and "sufficient observed conversation data to train extraction prompts."
  V1 stores only last_struggled_skill and last_mastered_skill on teaching_profile summaries.
IS: V1 adds a learner_observation block to the orchestrator response schema (Doc 03C wire contract).
  The model emits an enum-constrained explanation_form observation per turn (or null when no signal).
  Enum values: step_by_step, conceptual, example_driven, visual. Observations accumulate as a tally
  in tutor_memory_summaries type teaching_profile content_json. A preferred style is derived when
  total observations ≥ 5 and a single-leader plurality exists. The derived style feeds back through
  Layer 3 memory retrieval to shape subsequent prompts. Free text is never written to memory —
  enum-constrained values only, satisfying §7.6 Layer B (schema constraints prevent self-injection).
  The learner_observation block is INTERNAL ONLY — never serialized to any client response body.
Rationale: Karl ruling 2026-08-07 — the batch-extraction prerequisite (sufficient conversation
  history + trained extraction prompts) is unnecessary for a four-value enum that the model can
  classify per-turn from student response patterns. Per-turn capture provides immediate V1 value
  ("Knows Me" moments) without a separate extraction pipeline. The four-value enum
  (step_by_step | conceptual | example_driven | visual) scopes to explanation form only — other
  dimensions (scaffolding level, test strategy) are deferred to independent fields once conversation
  data proves reliable model classification.
Version: Doc 03A → V3.2 (§7.3 explanation style capture moved to V1; §10.3 adds learner_observation
  to orchestrator response contract).
Artifact: PR for branch claude/ws-l2-context.
Owner action: at next spec pass, update §7.3 to reflect V1 per-turn capture with the four-value
  enum, and add learner_observation to §10.3 orchestrator response contract.

SCL-025 | 2026-08-04 | Doc 03B §3.1, Doc 03 §21.3, Doc 07E (safety review access path) | OPEN (owner-promoted 2026-08-14)
Change: The corpus mandates a human safety review workflow (Doc 03 §21.3) whose required actions
  cannot be performed without reading the flagged conversation, but Doc 03B §3.1 line 243 forbids
  admin absolutely on /api/tutor/*. Doc 07E has no provisions for staff access to tutor data.
  The corpus mandates a capability its own role rule forbids.
WAS: Doc 03B §3.1 blocks all non-student roles from /api/tutor/* (403 role_not_permitted). Doc 03
  §21.3 mandates human review of crisis-flagged conversations. No access path connects the two.
  Doc 07E provides no staff-access surface for tutor data.
IS: (a) §3.1 stands unchanged for /api/tutor/*. student only. All other roles 403 role_not_permitted.
  Already implemented in PR #519. (b) Safety review is a SEPARATE surface outside /api/tutor/*, not
  a role exception. Read-only. Scoped to conversations where crisis_flagged = true. Not routed
  through canAccessFeature — different authorization axis. Every read logged append-only with
  reviewer identity, conversation id, timestamp, action. Write scope limited to classification
  outcome and review disposition. (c) Doc 03 §21.3 tooling correction: the shared ticketing system
  carries a conversation identifier and non-content metadata only. Conversation content never leaves
  Supabase. As currently written §21.3 would export a minor's verbatim crisis disclosure to a
  third-party SaaS, contradicting ADR-001 §3 and making the Doc 07E deletion cascade unenforceable.
  (d) Open at V2: §21.3 transitions to a dedicated T&S function at 5,000 paid users or 20+ monthly
  flags. At that scale the admin role is too broad for standing read access to minors' crisis
  conversations. Flagged, not resolved.
Rationale: Karl ruling 2026-08-04 — the contradiction is real. §3.1 is correct for the tutor API
  surface (student only). The review capability is a separate access path, not an exception to §3.1.
  Third-party export of crisis content contradicts ADR-001 §3 data-residency and Doc 07E deletion
  cascade enforceability.
Version: Doc 03B → V4.2, Doc 03 Main → V1.2.
No code/schema change from this entry. Owner action: amend Doc 03B, Doc 03 §21.3, and Doc 07E at
  next spec pass. V2 T&S function is tracked as open, not resolved.

SCL-024 | 2026-08-04 | Doc 03A §18.7, §18.1, §18.2, §18.5 (config table shape + question FK type) | OPEN (owner-promoted 2026-08-14)
Change: Two defects in Doc 03A. Production is correct in both; the spec is wrong.
  (a) Config table shape: Doc 03A §18.7 defines tutor_context_runtime_config with a bespoke shape
  (id UUID PK, config_key, config_value). Production carries the Doc 01A §8 config template
  (key TEXT PK, value, value_type, min_value, max_value, allowed_values, owner, description,
  environment, updated_at, updated_by_profile_id), created by migration
  supabase/migrations/20260610000000_ws2_config_constants.sql, applied and in ledger. Doc 01A Part I
  owns config-table shape platform-wide. §18.7 restated a primitive another document owns,
  differently.
  (b) Question FK type: Doc 03A types questions(id) foreign keys as UUID. Production: questions.id
  is TEXT, profiles.id is uuid. A UUID column cannot reference a TEXT primary key — the DDL fails.
  Four columns across three tables: line 1734 §18.1 tutor_conversations.source_question_row_id;
  line 1822 §18.2 tutor_messages.source_question_row_id; lines 2012 and 2016 §18.5
  tutor_question_links.source_question_row_id and .related_question_row_id.
WAS (a): §18.7 defined tutor_context_runtime_config with (id UUID PK, config_key TEXT, config_value
  TEXT) — a bespoke shape that conflicts with the platform config template owned by Doc 01A §8.
WAS (b): §18.1, §18.2, §18.5 typed source_question_row_id and related_question_row_id as UUID
  REFERENCES questions(id). questions.id is TEXT in production — DDL would fail on type mismatch.
IS (a): §18.7 removes its DDL and references Doc 01A §8 for config-table shape. §18.7 specifies
  only the keys it requires and their semantics.
IS (b): All four question FK columns (§18.1 tutor_conversations.source_question_row_id, §18.2
  tutor_messages.source_question_row_id, §18.5 tutor_question_links.source_question_row_id and
  .related_question_row_id) retype from UUID to TEXT. REFERENCES questions(id) ON DELETE SET NULL
  unchanged.
Rationale: Karl ruling 2026-08-04 — both are spec-vs-production mismatches. (a) Doc 01A Part I
  owns config-table shape; §18.7 should not restate it differently. (b) UUID cannot reference TEXT
  PK — the DDL is structurally invalid against the live schema.
Version: Doc 03A → V3.1 (config table reference + FK type corrections).
No code/DB change from this entry. Owner action: update Doc 03A §18.7 (remove DDL, reference
  Doc 01A §8), retype §18.1/§18.2/§18.5 question FK columns to TEXT at next spec pass.
SCL-024 | 2026-08-06 | Doc 03A §18.4, Doc 03B §4.1 (fifth question-FK column + wire-contract Zod schemas) | OPEN (owner-promoted 2026-08-14)
Change: Extends SCL-024(b) to cover a fifth column and the wire-contract Zod schemas that carry
  the same UUID assumption.
  (c) Fifth column: tutor_instruction_assignments.source_question_row_id (§18.4). SCL-024(b) listed
  four columns across three tables; this fifth column was omitted because §18.4 defines it with no
  FK to questions(id), and the original rationale (UUID cannot reference TEXT PK) appeared not to
  apply. Karl ruled: the same resolvedScope.source_question_row_id value is written to all four
  tutor tables from a single code path; the column must carry the same type. questions.id is TEXT
  under CHECK (id ~ '^SAT(M|RW)[12][A-Z0-9]{6}$') — canonical SAT IDs, not UUIDs — making UUID
  structurally impossible regardless of FK presence. The revert migration
  (20260806010000_tutor_instruction_assignments_uuid_revert.sql) that would have cast this column
  to UUID is dropped.
  (d) Wire-contract Zod schemas: Doc 03B §4.1's wire protocol definitions validate
  source_question_row_id and related_question_row_id as z.string().uuid(). These Zod schemas
  (shared/tutor-contract.ts, shared/tutor-orchestrator-wire.ts, server/routes/tutor-runtime.ts)
  would reject canonical SAT question IDs at parse time. Same root cause as (b) — the spec typed
  question IDs as UUID when questions.id is TEXT.
WAS (c): §18.4 typed tutor_instruction_assignments.source_question_row_id as UUID (no FK). A
  revert migration existed to cast the production TEXT column back to UUID.
WAS (d): Zod schemas validated source_question_row_id and related_question_row_id as
  z.string().uuid() — 10 call sites across 4 files (shared + server + generated worker copy).
IS (c): Column stays TEXT, matching the other four question-FK columns. Revert migration dropped.
IS (d): Zod schemas validate with z.string().regex(CANONICAL_ID_PATTERN) using the existing
  single-source-of-truth regex from shared/question-bank-contract.ts. All 10 call sites fixed.
Rationale: Karl ruling 2026-08-06 — extend SCL-024, do not revert to UUID. The same value flows
  to all four tables from one code path; mixed types are a latent runtime failure. The Zod UUID
  validation would reject every real question ID at parse time.
Artifact: PR #523, branch claude/lisa-tutor-inventory-27lras.
Owner action: at next spec pass, retype §18.4 source_question_row_id to TEXT and update Doc 03B
  §4.1 wire-contract definitions to use canonical question ID format, not UUID.

SCL-023 | 2026-08-04 | Doc 03C V3.0, Doc 03C.1, Doc 03A (crisis classifier gate) | OPEN (owner-promoted 2026-08-14)
Change: Doc 03C V3.0 contains no crisis classifier stage. Full-text scan returns zero occurrences
  of crisis, self-harm, safety classifier, or classifier. Three siblings delegate crisis handling
  there: Doc 03 §21.1 (crisis detection trigger), INV-03-16 (crisis classification before main
  response generation), Doc 03A §17 schema (crisis_flagged column + idx_tutor_conversations_crisis
  index), Doc 03B §0 and §13 step 14 (crisis flow references). Doc 03C.1 has no crisis test
  scenario.
WAS: Doc 03C V3.0 has no crisis classifier stage. The pipeline spec gap means four sibling docs
  reference a capability Doc 03C does not define. Doc 03C §4.5 "Content safety pre-pass" is named
  misleadingly — it performs prompt-token bounding and its own body says it is not safety
  enforcement. Doc 03C V3.0's "no further architectural change expected before V1 launch" is
  falsified by this addition.
IS: Two-layer crisis classifier gate, both pre-generation, parallel:
  Layer 1: deterministic signature match against a tutor_crisis_signatures table, reusing the
  tutor_injection_signatures pattern (Doc 03A). Layer 2: model inference on a new classifier_class
  alias (alongside flash_class and pro_class; unknown alias continues to throw).
  New pipeline stage inserted before Vertex invocation. Ordering is load-bearing: INV-03-16 requires
  "before main response generation."
  Either layer positive → crisis path per Doc 03 §21.2 (unchanged, referenced not restated).
  Failure modes: Layer 2 failure → retry once, then Layer 1 result stands, turn proceeds, turn is
  force-enqueued to the §21.3 review queue, SLI increments. Failure-rate breach pages ops rather
  than flooding the queue. This is a deliberate narrow exception to fail-closed — blocking returns
  an error to a student who may be the person the gate exists for. Layer 1 signature table
  unreadable → fail closed on the turn.
  Doc 03C §4.5 "Content safety pre-pass" renamed — it does prompt-token bounding, not safety
  enforcement. The name collides with the crisis classifier stage.
Rationale: Karl ruling 2026-08-04 — Doc 03C is the sole pipeline-architecture spec and four sibling
  docs delegate crisis handling to it. The gap is structural, not editorial. Two-layer design
  provides deterministic baseline (Layer 1) with model-backed depth (Layer 2). Fail-open on Layer 2
  only is justified because the alternative (fail-closed) returns an error to the student who may be
  in crisis — the person the gate exists to help.
Version: Doc 03C → V3.1, Doc 03C.1 → V1.2, Doc 03A → V3.1 (crisis signature table).
No code/schema change from this entry. Owner action: add crisis classifier stage to Doc 03C,
  add classifier_class alias to Doc 03A, add crisis test scenarios to Doc 03C.1, rename §4.5 at
  next spec pass.

SCL-022 | 2026-07-01 | questions_governance.md §A.4 (skill-classification convention) | OPEN (owner-promoted 2026-08-14)
Change: Added **Skill Classification Convention** subsection to §A.4 with: primary-competency rule
  (tag the skill the student must exercise to reach the correct answer), disambiguation table for
  5 boundary rules (Linear Eq Two Var vs Linear Functions, Nonlinear Eq vs Nonlinear Functions,
  Central Ideas vs Command of Evidence vs Inferences [three-way], Transitions vs Rhetorical Synthesis,
  Boundaries vs Form/Structure/Sense),
  tiebreak rule (specificity → CB precedent → coverage spread), Q4 worked example demonstrating
  Pair 1 resolution, and auditor parity statement (Codex applies the same table for TAG_MISMATCH).
WAS: §A.4 listed the 29 frozen skills but provided no guidance on resolving classification ambiguity
  at skill boundaries — authoring and audit could disagree on plausible-either-way tagging.
IS: §A.4 now includes a deterministic disambiguation protocol that both authors and Codex auditors
  apply identically, reducing false TAG_MISMATCH findings on boundary-case questions.
Rationale: Prerequisite for volume batch (70 questions across all 29 skills). Without a locked
  disambiguation convention, boundary-case skill tags would be auditor-subjective, risking spurious
  Codex REJECTs on first submission — counter to the graduation criterion (zero genuine content
  defects on first Codex submission).
Owner action: review disambiguation table and tiebreak rule at next spec pass.

SCL-021 | 2026-07-01 | questions_governance.md §A.3/§A.8 (grid-in correctness model) | OPEN (owner-promoted 2026-08-14)
Change: Grid-in correctness model clarified. Grading is by **value-equivalence** (`gridInResponseMatches`,
  `shared/question-ingestion-qa.ts:436-444`); `correct_variants` is the deterministically-generated
  canonical set (`gridInAcceptedForms` — reduced fraction + exact decimal, no trailing zeros), validated
  by `normalizeGridInKey`, and is neither exhaustive nor the grading authority.
WAS: §A.3 described `correct_variants` as "the exhaustive set of CB-accepted surface forms" and §A.8
  had no explicit grid-in audit guidance, leading Codex to flag missing surface forms (e.g. `0.50` for
  `1/2`) as defects — a false-positive class, since adding such forms would break `normalizeGridInKey`
  ingestion QA and grading already accepts them via value-equivalence.
IS: §A.3 now distinguishes grading acceptance (runtime, value-equivalence) from `correct_variants`
  (stored, deterministic canonical set). §A.8 adds check 1a (grid-in correctness) with explicit
  guidance: do NOT flag `correct_variants` for omitting value-equivalent surface forms.
Rationale: Codex REJECT on proving_batch_001 Q4 (`SATM2L6TC5Y`, `correct_answer='1/2'`,
  `correct_variants=['1/2','0.5','.5']`) was adjudicated a false positive. The governance doc's
  conflation of grading-acceptance with `correct_variants` caused the false-positive class.
  Supersedes any prior language implying `correct_variants` must enumerate all accepted surface forms.
Owner action: review at next spec pass; confirm value-equivalence model aligns with Doc 04B.
SCL-021 | 2026-07-09 | Doc 02B §14 / contracts/mcfr-coexistence.contract.md (practice grid-in serve + grade) | OPEN (owner-promoted 2026-08-14)
Change: Grid-in (free-response / SPR) questions are now **functional end-to-end on the practice path**.
WAS: grid-in items could enter practice sessions via `select_practice_pool_random` but grading always
  failed with 422 (MCQ-only `normalizeAnswerKey` rejected numeric answers). Anti-leak was structurally
  sound but unproven for grid-in (zero integration-test coverage).
IS: `practice_session_items` extended with `question_item_type` (mcq|grid_in) and `question_correct_variants`
  (TEXT[]). `toCanonicalQuestionFromSessionItem` reads item_type from snapshot. `gradeAnswer` branches:
  MCQ key-match vs grid-in `correct_variants.includes(submitted.trim())` (TIGHTENING-1). Submit/skip
  handlers emit `mode: "grid_in"` with `correctAnswer` (canonical display value, post-submit). Anti-leak
  integration test proves no `correct_variants` leak on serve, correct grading on submit.
Rationale: MCFR contract practice lane. Migration `20260708000000_practice_grid_in_columns.sql` committed
  but NOT applied — Karl applies. Review + full-length lanes are named follow-ons.
Build artifact: PR on branch `claude/grid-in-anti-leak-audit-v0wha5`.

SCL-020 | 2026-06-28 | questions_governance.md §A.4 (canonical skill taxonomy casing) | OPEN (owner-promoted 2026-08-14)
Change: Canonical skill taxonomy frozen as **29 Title Case strings** in governance doc §A.4.
WAS: skill strings in mixed sentence-case/title-case (internal inconsistency).
IS: all 29 skills locked to Title Case (e.g., `Linear Equations in One Variable`, `Words in Context`),
  matching CB-native capitalization. `student_skill_mastery.skill` must use these exact strings.
Rationale: single source of truth; no deployed SQL function hardcodes skill strings, so the governance
  doc is the sole authority — its internal consistency is load-bearing. Title Case matches CB convention.
No code/DB change from this entry. Owner action: confirm Title Case convention at next spec pass.

SCL-018 | 2026-06-28 | Doc 02A §15/§16 / questions_governance.md §A.3 (grid-in / free-response scope) | OPEN (owner-promoted 2026-08-14)
Change: Free-response (grid-in / student-produced response) is **in scope for prelaunch**, superseding
  the prior MCQ-only deferral.
WAS (gap-closure plan proposal): grid-in deferred to post-launch (MCQ-only for launch).
IS: grid-in is a launch question type. Schema extension via migration
  `20260628010000_grid_in_schema_extension.sql` adds `item_type` (mcq|grid_in) and `correct_variants`
  (TEXT[]) columns with fail-closed shape-integrity CHECK. Grid-in authoring rules defined in
  `questions_governance.md` §A.3.
Rationale: Karl ruling (2026-06-28) — grid-in represents ~25% of Digital SAT Math questions and must be
  authorable this content wave. Migration awaiting Karl apply (not applied to prod).
Owner action: apply migration; promote into Doc 02A spec at next revision; update Doc 02A §23 QA gate
  "Four options present" to exempt grid-in items (`options.length = 0` is valid for `grid_in`).

SCL-016 | Doc 02B (flow-cards / adaptive practice flow) | OPEN (owner-promoted 2026-08-14)
Change: flow-cards is a POST-LAUNCH feature; removed from launch UI.
WAS: flow-cards positioned as the adaptive practice flow for students (the useAdaptivePractice path).
IS: flow-cards deferred to post-launch as an Anki/Quizlet-style spaced-practice feature, distinct from
  launch practice. Removed from the launch practice UI; the useAdaptivePractice hook is retired.
Rationale: CEO ruling 2026-06 — launch practice is the unified filter-driven engine. Flow-cards is a
  separate post-launch product surface, not part of launch. Its best idea ("target weak skills") is
  salvaged as the Vertical B weakest-skills filter preset.
Owner action: revise any 02B flow-cards prose to post-launch status. No code/DB change from this entry.

SCL-015 | Doc 02B §15 (item selection) | OPEN (owner-promoted 2026-08-14)
Change: launch selection is filter-driven native random; adaptive/weakness-ranked selection is POST-LAUNCH.
WAS (02B §15): weakness-first ranking from mastery + seeded Fisher-Yates determinism ("reconstructable
  from recorded state", INV-02B-07) + cold-start blueprint-balanced sampling.
IS (launch, CEO ruling 2026-06): student-picked multi-select filters (difficulty/domain/skill, multi per
  facet, none=all) → native Postgres ORDER BY random() over the filtered pool → ALL N items prepopulated
  into practice_session_items at session creation. Determinism is satisfied BY STORAGE (the prepopulated
  rows ARE the durable record of what was selected); no seed/replay needed. No mastery read at selection.
Rationale: CEO ruling — launch practice is standard filter-driven prepopulation, industry-standard, built
  near-scratch (both legacy hooks retired). Adaptive selection (weakness-ranked) deferred to post-launch.
  The audit "gaps" G-SEL-1 (weakness-first), G-SEL-2 (seeded shuffle), G-SEL-3 (cold-start blueprint)
  CLOSE AS NOT-GAPS — they described a feature being deliberately deferred, not a defect.
  The "work on your weakest skills" idea is preserved but reframed: a FILTER PRESET (lowest-N mastery
  skills → filter input) in Vertical B (mastery-coupled, post-baseline-diagnostic), NOT an adaptive
  selection engine. INV-02B-07 (seeded reconstructability) superseded by store-the-result determinism.
Owner action: revise Doc 02B §15 to the filter-driven launch model; mark adaptive selection post-launch.
No code/DB change from this entry; records the spec-vs-launch-model divergence.

SCL-014 | Doc 05A §4.6/§11.4 (canonical_mastery_events source tables) | OPEN (owner-promoted 2026-08-14)
Change: spec prose names event-source tables that differ from the live canonical schema. DB is canonical.
WAS (spec text): canonical_mastery_events derives events from `test_session_answers` (full_length_answer)
   and `practice_attempts_v0` (practice_attempt).
IS (live canonical schema, verified read-only + Codex-confirmed via lane_c_mastery_seam.sql):
   - practice_attempt  → practice_session_items.id   (lane_c_mastery_seam.sql:42-53)
   - review_error_attempt → review_error_attempts.id (lane_c_mastery_seam.sql:66-70)
   - full_length_answer → full_length_exam_responses.id (persisted response PK)
   The `practice_attempts_v0` table is the retired fossil (Doc 02B §8 names practice_session_items as the
   V2 replacement; the DB function comment already flags this). `test_session_answers` is the spec-text
   name for what the live schema exposes as full_length_exam_responses.
Rationale: WS-0 mastery vertical (PR @cleanup) grounded the TS write-bridge against the LIVE canonical
   tables, not the stale spec prose, per the standing directive (DB/live schema is canonical; repo/spec-
   text lag is reconciled forward, never resolved by trusting stale names). event_id sourcing is
   idempotency-load-bearing ((event_source_kind, event_id) dedup on mastery_event_audit_log); Codex
   independently re-derived that the sourced PKs match canonical_mastery_events' derivation — confirmed
   correct. No code/DB change from this entry; it records that Doc 05A's prose table names should be
   updated to the live names at the next owner spec edit. Tracks the divergence so it's not reburied.
No DB migration. No code change. Owner action: update Doc 05A §4.6/§11.4 table names at next spec pass.

### SCL-013 — Doc 01 V8 §40.3 subscription-cancellation timing corrected to match built implementation
**Date:** 2026-06-27 · **Status:** OPEN (owner-promoted 2026-08-14)
**Touches:** Doc 01 V8 §40.3 (line ~1968)
**Change:** subscription-cancellation timing corrected to match built + proven implementation.
WAS: "Stripe subscription cancellation is initiated immediately" (at deletion request)
NOW: subscription remains active through the 7-day grace period; billing is paused (Stripe
     pause_collection: void) and the entitlement is removed at T+7 execution, not at request.
     Full Stripe subscription cancellation DEFERRED to PR-4b.
**Rationale:** Spec-auditor (PR #444) flagged §40.3 contradicts built behavior. Grounded against code:
request_account_deletion performs NO Stripe operation (sets profiles.deleted_at only); pauseStripeBilling
+ entitlement removal occur at T+7 in the execution driver (PR-4a). The grace period exists for
reconsideration — preserving paid access the user already paid for, and ensuring a cancelled deletion
leaves the subscription uninterrupted. Karl ruled (2026-06-27) the IMPLEMENTATION is correct; the spec
line is stale. User-facing copy states "access ends + not charged again" (true now, true post-4b) —
makes NO Stripe-cancellation claim.
**Cross-ref:** SCL-012 (§19 disclosure framing). Both align spec to the counsel/Karl-ruled deletion model.
**Artifact:** PR-5e Bucket 2 (spec correction). Karl separately updating Doc 01 §40.3 to match.

### SCL-012 — Doc 01 §19 deletion-confirmation prompt framing aligned to counsel ruling
**Date:** 2026-06-27 · **Status:** OPEN (owner-promoted 2026-08-14)
**Touches:** Doc 01 §19 (line ~1047)
**Change:** deletion-confirmation prompt framing aligned to counsel ruling.
WAS: "...the confirmation prompt should explain ... data anonymization at T+7"
NOW: "...the confirmation prompt should explain ... permanent account deletion at T+7"
**Rationale:** Counsel ruled (2026-06-27) that user-facing language is HARD DELETION — anonymized
retained data is legally non-identifiable (not the user's data), so it is NOT disclosed in user-facing
copy. The INTERNAL mechanism remains anonymize-retain (Doc 05E governs; cascade 'anonymize' mode). This
is the internal/external split: §19 user-facing prompt says "deleted"; the engine anonymizes.
Doc 05E (anonymize mechanism) UNCHANGED. Only the §19 USER-FACING PROMPT DESCRIPTION changes.
Privacy Policy locked consistent with this framing (Anonymized Structured Learning Data, LISA scoped out).

Doc 01 §19 line ~1047 edit:
  "data anonymization at T+7" → "permanent deletion of the account at T+7"
And §19's enumerated prompt disclosures become (per counsel + Karl ruling):
  (1) 7-day grace window;
  (2) paid access continues during grace, ends at deletion, no further charges (full Stripe
      cancellation tracked separately in PR-4b — NOT claimed as "cancelled" in UI; see SCL-013);
  (3) [REMOVED — guardian pending-deletion display is unbuilt; not disclosed];
  (4) data-treatment mechanism NOT surfaced in UI (internal anonymize per Doc 05E; counsel ruling).
Proposed §19 prompt discloses items 1 and 2 (corrected wording) only; 3 dropped, 4 internal.
**Artifact:** PR-5e Bucket 2 (copy changes). Karl separately updating Doc 01 §19 to match.

### SCL-011 — Authoritative user-scoped table partition (66 tables, proven 2026-06-25)
**Date:** 2026-06-25 · **Status:** OPEN · **Touches:** 05E §5/§6 (INV-05E-03), INV-DELETION-COMPLETE
**Change:** Live enumeration proves 66 user-scoped tables, partitioned: 5 ACTIVITY (need actor_id:
practice_sessions, practice_session_items, review_sessions, review_session_items,
review_error_attempts) + 2 AUDIT-LAYER (actor_id for grouping, one-way anonymized per 05D §10:
mastery_event_audit_log, mastery_domain_refresh_audit_log) + 12 DERIVED (deleted at anonymize) +
34 OPERATOR-CONFIG (updated_by/changed_by — operator-FK preflight guard, NOT user activity, no
actor_id) + 7 IDENTITY/BILLING/CONSENT (pre-clear/scrub) + 4 OPERATIONAL (auto-cascade) + 2
governance-constants (mastery_constants/_history). Zero unclassified-with-student-data.
**CORRECTION captured here:** the audit layer is 2 tables, not 1 — an earlier PR-5a scope pass named
only mastery_event_audit_log and missed mastery_domain_refresh_audit_log. Surfaced by the owner's
demand for exhaustive enumeration ("are there truly only these"). PR-5a actor_id column-add covers 7
tables (5 activity + 2 audit). This partition is the authoritative enumeration that
INV-DELETION-COMPLETE / INV-05E-03 must encode; prose lists elsewhere are non-authoritative.
**Artifact:** Live-proven partition (Supabase introspection 2026-06-25). CI guard:
scripts/ci/actor-id-coverage-guard.sql (PR-5a stub asserts the 7 tables + profiles + ledger +
nullability split). Migration: 20260625020000_05e_actor_id_substrate.sql (applied + verified live).

### SCL-010 — Doc 05E supersedes Doc 05D §10.2 Layer-2 mechanism (v_surrogate → actor_id)
**Date:** 2026-06-25 · **Status:** OPEN · **Touches:** 05D §10.2, 05E §3/§5
**Change:** Doc 05D §10.2 specifies Layer-2 anonymization via `v_surrogate` — re-key the identity
column IN PLACE to one gen_random_uuid() generated AT anonymization time, reused across Layer-2
tables. Doc 05E SUPERSEDES this with the decoupled actor_id mechanism: a SEPARATE actor_id column,
assigned at PROFILE-CREATION time, with the identity column SET NULL at anonymization. Reason: (1)
actor_id enables pre-anonymization trajectory grouping (world-model value — the surrogate only
existed post-anonymization); (2) actor_id is true-anonymization (born dissociated from identity)
whereas the in-place surrogate briefly co-exists in the identity column. Doc 05E §3 is now canonical
for the Layer-2 anonymize mechanism; 05D §10.2 Layer-2 v_surrogate is retired. The 05D §10
HARD-DELETE cascade is UNAFFECTED — it DELETEs rows, does not re-key, and remains the service_role
admin tool.
**Artifact:** Doc 05E committed to docs/Spec (cleanup+main). Build: PR-5 wave (PR-5a substrate
applied + verified live 2026-06-25; 5b write-path stamping next).

### SCL-009 — Doc 05E created (anonymized-retention governance)
**Date:** 2026-06-25 · **Status:** OPEN · **Touches:** new Doc 05E; references 05D §10
**Change:** New governance doc `Doc_05E_Anonymization_Actor_ID.md` defines the anonymize disposition (decoupled synthetic identifier, lifelong cross-service grouping, linkage-destroyed-at-deletion, structured-only retention). Governance-level: owns doctrine/invariants/procedure, not schema.
**Reason:** World-model retention is canonical; anonymize is the user-facing deletion default. Counsel approved the mechanism.
**Artifact:** Doc 05E draft (self-audit-clean; pending Codex independent audit + owner commit to docs/Spec).

### SCL-008 — Anonymize is the user-facing deletion default; hard-delete is the internal/admin tool
**Date:** 2026-06-25 · **Status:** OPEN · **Touches:** 05D §10, 05E §1
**Change:** Inverts the deletion model. User-facing "delete account" → anonymize (scrub identity, retain decoupled-identifier activity for the world model). Hard-delete cascade (05D §10, proven on prod) is repurposed as `service_role`-only internal tool for cases where even anonymized retention must be purged.
**Reason:** World-model build requires retained anonymized usage; permanent hard-delete on every user deletion would destroy canonical training data.
**Artifact:** Doctrine in 05E; hard-delete cascade live in prod (migration 20260625010000), grant already service_role-only (verified).

### SCL-007 — Decoupled synthetic identifier (actor_id) doctrine
**Date:** 2026-06-25 · **Status:** OPEN · **Touches:** 05E §3
**Change:** Activity retained under a synthetic per-user identifier that is born dissociated from identity, never co-located with identity on any surface that survives deletion, stable lifelong/cross-service, linkage destroyed at anonymization. Rejected on record: keep-profile_id (pseudonymous), hash-user_id (reversible), SET-NULL-only (loses grouping), drop-FKs (loses write-path integrity), BEFORE-DELETE-trigger-on-auth (ungated), shared-sentinel (loses grouping).
**Reason:** Pseudonymization vs anonymization legal line — only a born-dissociated identifier clears the bar counsel's caveat requires. Industry precedent: Jira alias-translation, JetBrains randomized scheme.
**Artifact:** 05E §3–§4. Implementation deferred to PR-5 wave.

### SCL-006 — Lifelong grouping chosen over sessionization (with compensating controls)
**Date:** 2026-06-25 · **Status:** OPEN · **Touches:** 05E §7.1
**Change:** Grouping identifier is lifelong/cross-service, not session-scoped. Higher fingerprinting-risk form, accepted because retained data is structured-only. Compensating controls: free-text boundary (INV-05E-04), purpose limitation (05E §1.1), counsel retention-horizon re-review at each new-data-surface gate. Reverts to session-scoped for any surface where a control cannot hold.
**Reason:** World-model value needs full multi-year trajectory; structured-only data keeps accumulated-trace uniqueness low. Counsel approved conditioned on structured-only.
**Artifact:** 05E §7.1.

### SCL-005 — INV-DELETION-COMPLETE (deletion-completeness CI guard)
**Date:** 2026-06-25 · **Status:** OPEN · **Touches:** 05D §10, 05E §6 (INV-05E-03); new CI guard
**Change:** New invariant + CI guard: every user-scoped table (FK-to-profiles OR convention column student_id/user_id/*_profile_id) MUST be classified in the deletion partition (delete / retain-anonymized / audit / identity) or an explicit tracked deferral, else CI fails. Extended for 05E to also require the synthetic grouping identifier on every retained activity table. Authoritative drift-proof enumeration; prose table-lists are non-authoritative.
**Reason:** Manual partition (audited 3 ways) still missed a table — see SCL-004. Only live-enumerating CI catches the convention-keyed-no-FK class as the schema grows. Future verticals (Stripe, full-length, tutor) register as tracked deferrals so building them forces cascade wiring.
**Artifact:** To be built (PR-4c / PR-5 wave). Live enumeration at decision time: 52 FK-to-profiles + 14 convention-only tables.

### SCL-004 — student_kpi_rollups_current is an unclassified user-data table (silent retention hole)
**Date:** 2026-06-25 · **Status:** OPEN · **Touches:** 05D §10 Layer-1 set
**Change:** `student_kpi_rollups_current` (student_id, no FK to profiles, not referenced by the cascade) was found unaccounted in the deletion partition — a deleted user's KPI rollup would silently survive. Empty in prod now, so the destructive test could not catch it. Must be added to the deleted-derived set; 05E §5 defers the authoritative L1 enumeration to INV-DELETION-COMPLETE precisely so this cannot recur.
**Reason:** Found by the SCL-005 guard reasoning before the guard was even built — the invariant earned itself.
**Artifact:** Fix to land with PR-4c/PR-5; do not hardcode L1 lists in prose.

### SCL-003 — Storage purge moved out of the SQL cascade to the orchestration layer (PR-4)
**Date:** 2026-06-25 · **Status:** OPEN · **Touches:** 05D §10
**Change:** `DELETE FROM storage.objects` removed from `execute_account_deletion_cascade`. Supabase `storage.protect_delete()` trigger blocks direct SQL deletion of storage objects; the Storage API is mandatory. Storage purge becomes a PR-4 orchestration responsibility (Storage API call BEFORE invoking the SQL cascade). Registered as GAP-OP-06 / GAP-PR4-STORAGE.
**Reason:** Prod-only bug caught by the destructive real-account test; local rehearsal (stubbed storage, no trigger) structurally could not catch it. Cascade failed AND rolled back atomically — target intact.
**Artifact:** PR #431 (subtractive fix, Codex PASS, applied to prod). Cascade re-tested clean end-to-end after fix.

### SCL-002 — 05D §10 deletion-cascade owner rulings (as built)
**Date:** 2026-06-25 · **Status:** OPEN · **Touches:** 05D §10
**Change:** As-built rulings on the hard-delete cascade: (Q2) deletion-request row is DELETED by the cascade — "remains in soft-delete state" satisfied instead by transactional rollback on failure; (Q3) review_schedule classified as L1 identity-linked state (hard-delete), not event data; (Q6) only the two audit_logs FKs (actor/target) dropped, immutability trigger untouched; operator-attribution preflight guard added (36 *_config/*_config_history operator-FK edges block deletion with PROFILE_HAS_OPERATIONAL_CONFIG_REFERENCES until reassigned); auth.users SQL delete confirmed working on prod.
**Reason:** Decisions made during PR-3 build + destructive prod test. FK partition proven exhaustive (59 edges).
**Artifact:** Migration 20260625010000, applied + verified live (exact-target precision, negative control survived, idempotent no_op).

### SCL-001 — 05A §5.1/§4.9 PR-2 alignment (GUC atomicity + p_chain_downstream)
**Date:** 2026-06-25 · **Status:** OPEN · **Touches:** 05A §5.1, §4.9
**Change:** `recompute_skill_mastery` gained conditional `p_chain_downstream boolean DEFAULT true` (unconditional downstream fan-out deadlocks under backfill interleave; conditional makes lock order monotonic). Backfill/event paths stamp `triggered_by` via `SET LOCAL` GUC; `triggered_by` made NOT NULL + CHECK(IN event/backfill_recompute) to close the CHECK-passes-on-NULL hole.
**Reason:** PR-2 build findings (deadlock analysis + GUC atomicity). Two CI guards hardened against comment-false-match by perturbation proof.
**Artifact:** Migration 20260625000000, applied + verified live.

### SCL-P-GRIDIN-01 — Grid-in serve+grade rides MCQ machinery [OPEN (owner-promoted 2026-08-14)]
Decision: Grid-in (numeric-entry) item type extends the existing MCQ practice pipeline — same serializer,
  same practice_session_items table (+ question_item_type, question_correct_variants), same submit handler,
  same select_practice_pool_random (widened to return item_type + correct_variants). Branches only at
  type-specific points (grade equivalence, empty options, input mode). NO parallel grid-in path.
Rationale: minimize deviation / no double surfaces. One pipeline, one branch point per item type.
Effect: grid-in fully functional end-to-end (serve → typed entry → grade → feedback). Backend migration
  applied [date], Codex-passed, verified live (RPC stays plain invoker).

### SCL-P-GRIDIN-02 — Grid-in grades against correct_variants (snapshot, not lookup) [OPEN (owner-promoted 2026-08-14)]
Decision: Grid-in correctness matches submitted answer against the correct_variants accepted-forms ARRAY
  snapshotted into practice_session_items at prepopulation — NOT against correct_answer alone, and NOT via
  submit-time lookup back to questions. correct_answer = canonical display value; correct_variants = grading
  set (deterministically derived from gridInAcceptedForms).
Rationale: session-immutable grading, single answer-data path (parallel-paths-built-differently avoidance),
  accepts equivalent forms (e.g. "1/5" for "0.2").
Effect: grading is snapshot-based, immutable per session, correct across equivalent forms.

### SCL-P-GRIDIN-03 — Malformed grid-in fails closed, no fallback grading [OPEN (owner-promoted 2026-08-14)]
Decision: If a grid-in canonical value won't parse / variants missing, the handler FAILS CLOSED (data-
  integrity error), NOT a fallback grading path. One grading path only.
Rationale: a malformed answer is a data defect to surface loudly, not grade around; a second grading path
  is a double surface.
Effect: bad grid-in data errors visibly rather than silently mis-grading.

### SCL-P-SUBMIT-01 — Unified answer-submission dispatcher (action-boundary validation) [OPEN (owner-promoted 2026-08-14)]
Decision: Client answer-submission validates WELL-FORMEDNESS via ONE dispatcher, isSubmittableAnswer(
  question, answer), called by BOTH the submit-button state (canSubmit) AND the submitAnswer action guard.
  Enforced at the ACTION boundary before payload/fetch (the disabled button is UX-only and bypassable via
  Enter-key). Per-type: MCQ = non-null option; grid-in = isValidGridInFormat; unknown = fail closed.
  Server owns CORRECTNESS; client owns WELL-FORMEDNESS.
Rationale: industry-standard (client form-check + server correctness; disabled button is bypassable so the
  action must be the guard). Single dispatcher prevents button/action drift. Symmetric across item types,
  extensible at one point.
Effect: both item types validated at one bypass-proof point; MCQ gained action-boundary validation it
  previously lacked. Future item types add one dispatcher case.
Follow-on (logged, not built): button-enabled + inline-error a11y pattern for BOTH types (industry trend
  away from disabled-button); apply to both to preserve symmetry when done.

### SCL-P-GRIDIN-FOLLOWON — Review + full-length grid-in [OPEN (owner-promoted 2026-08-14)]
Note: grid-in serve+grade was built for PRACTICE only. Review and full-length session-item surfaces have
  the SAME latent grid-in gap and need the same fix shape before they serve grid-in. Full-length also
  blocked on 04B seam. Named follow-on, not yet built.

### SCL-P-TZRESET — quota_reset_timezone: UTC (Q13) → America/Chicago [OPEN (owner-promoted 2026-08-14)]
Context: Q13 locked UTC for quota daily-reset determinism. Live config landed as America/Chicago;
  Karl confirmed Central is the intended boundary.
Rationale: US-only launch userbase; midnight Central is a more humane reset than 00:00 UTC. DST wobble
  (23h/25h reset window twice yearly) is acceptable for a quota reset (non-safety, non-scoring). Q13's
  determinism concern was load-bearing for seeded selection (deferred, SCL-P-ADAPTIVE), not quota windows.
Effect: unpaid 40/day quota resets at 00:00 America/Chicago. No code/migration change; config row already
  America/Chicago on prod. Supersedes Q13's UTC clause for quota_reset_timezone only.
Status: OPEN (owner-promoted 2026-08-14).

### SCL-P-CONTENT-01 — Content-column disposition contract (anti-whack-a-mole) [OPEN (owner-promoted 2026-08-14)]
Decision: Every `questions` column has a declared disposition — served_pre_submit / server_only /
  post_submit_only — in a registry, enforced by a CI test that FAILS when a new column appears undeclared.
  served_pre_submit: id, section, stem, passage, options, assets, difficulty, domain, skill_codes, item_type.
  server_only: option_metadata, correct_variants, estimated_time_seconds, premium_flag, quality_score,
  issue_flags, source_lineage, generation_attribution, version, source_type, status, created_at,
  published_at, retired_at. post_submit_only: correct_answer, explanation.
Rationale: recurring defect class — a content column exists on `questions` but the RPC never SELECTs it, so
  it arrives null (caused the R&W passage P0, then option_metadata). A per-column declared contract makes a
  new column require a conscious serve/don't-serve decision; ends the class.
Effect: RPC widened to serve passage + assets; option_metadata/estimated_time_seconds carried server-side
  only. Migration applied, verified live. premium_flag documented permanently unused (Karl: no premium
  questions ever; all questions servable to all users).

### SCL-P-SERVABLE-01 — servable_questions view is the shared flagged-question gate [OPEN (owner-promoted 2026-08-14)]
Decision: `servable_questions` = questions WHERE status='published' AND issue_flags empty. Created WITH
  (security_invoker=true); GRANT SELECT to service_role ONLY. select_practice_pool_random selects FROM the
  view. All student-serving question reads route through it (practice-topics, questions-runtime student
  paths, full-length selection); a CI gate FAILS on direct `.from("questions")` / `FROM questions` in
  student-serving paths (authoring/ingestion allowlisted by path).
Rationale: one shared definition of "servable" so review + full-length inherit the flagged-question gate
  rather than re-implementing it. security_invoker + service_role-only grant are load-bearing: the view is
  SELECT* over answer-bearing columns (correct_answer, explanation, option_metadata), so a broader grant
  would expose the bank WITH ANSWER KEYS via PostgREST.
Effect: flagged questions excluded from selection everywhere; historical reconstruction of already-served
  items may still read `questions` directly (a question flagged after a student saw it must still render in
  review). Migration applied, verified live (security_invoker=true, service_role-only ACL confirmed).
SECURITY BOUNDARY: the servable_questions grant must NEVER be widened beyond service_role. Load-bearing.

### SCL-P-OPTMETA-01 — option_metadata is server-only LISA context, never client [OPEN (owner-promoted 2026-08-14)]
Decision: option_metadata ({"A":{"role":"correct","error_taxonomy":...},...}) is the ANSWER KEY plus
  distractor taxonomy. Server-only: TYPE-ABSENT from StudentSafeQuestionDTO (compile error to add), like
  correct_variants. Consumed solely as LISA (tutor) context; NEVER shown to the student, pre- or
  post-submit.
Rationale: Karl ruling — error_taxonomy is valuable tutor context (LISA can say "you made an equation-setup
  error") but naming it to the student pre-submit leaks the correct role, and post-submit adds no student
  value over the explanation. Simpler and safer as server-only, full stop.
Effect: carried RPC→snapshot server-side; never in any student payload. LISA reads it; INV-03-01 (LISA never
  writes mastery) unaffected.

### SCL-P-ASSETS-01 — assets discriminated union; role is an anti-leak boundary [OPEN (owner-promoted 2026-08-14)]
Decision: assets = { v:1, items:[{ id, kind:"svg"|"table", role:"stimulus"|"option"|"explanation", alt,
  option_key?, ... }] }. Inline, text-representable (not object storage). ROLE is an anti-leak boundary:
  pre-submit serves ONLY stimulus/option; explanation-role (worked-solution figures) is post-submit only.
  filterAssetsPreSubmit FAILS CLOSED — unknown v / missing role / unknown role / unknown kind → excluded,
  never passthrough.
Rationale: inline SVG keeps figures legible to LISA (labels as text), transacts+deletes with the row (no
  second deletion surface vs object storage), and is AI-authorable/auditable. Role-filtering server-side
  prevents explanation figures (which reveal the answer) leaking pre-submit. Fail-closed because an
  unrecognized asset shape is exactly when least should be revealed (3rd fail-open default caught in
  program — quota, rate-limiter, assets).
Effect: assets threaded RPC→snapshot→DTO→client (renderer deferred — 0 authored). Server role-filter live.
  Authoring note (out of engine scope): inline SVG is an XSS vector — authoring gate must reject
  script/event-handler/external-href; renderer sanitizes.

### SCL-P-SECTION-01 — Shared section resolver; fail-closed label [OPEN (owner-promoted 2026-08-14)]
Decision: shared/section-display.ts exports isMathSection() and sectionDisplayLabel() (M→Math, RW→R&W).
  Badge, Desmos gate, and reference-sheet gate all call these — no ad-hoc section comparison in the client.
  sectionDisplayLabel returns null (not a defaulted section) on unknown; callers render a neutral state.
  Resume path reads the item's canonical section ('M'/'RW'), not the session-spec full-word string.
Rationale: a hardcoded/broken section check badged Math questions "R&W" (data verified clean). One shared
  resolver kills the double-surface. Fail-closed on the label (not defaulting to a section) prevents the
  "unknown → R&W" recurrence; the earlier percentage-style default WAS that recurrence.
Effect: badge correct on practice + resume + review + full-length (shared helper, reusable by those
  surfaces). Client-only, no migration.

### SCL-P-EXPLANATION-01 — Post-submit explanation/answer values route through MathRenderer [OPEN (owner-promoted 2026-08-14)]
Decision: post-submit explanation text and answer-value displays route through MathRenderer (which
  tokenizes inline $...$ within prose) at all render sites: QuestionRenderer, NumericEntryInput,
  FullLengthReviewView (explanation + answer values), review-errors. Placed INSIDE the post-submit
  result panel (anti-leak: never renders pre-submit).
Rationale: explanations are prose-with-inline-math ("the $4$th value is $18$"); the stem is whole-string
  math. The renderer already tokenized inline $...$; the gap was threading, not parsing. MathRenderer is a
  display component — placement inside the post-submit gate preserves anti-leak.
Effect: LaTeX in explanations/answers renders typeset, not raw source. Client-only, no migration.
Content note (authoring track): explanations must reference answer VALUES, not option letters — options
  randomize per serve, so "Option B" is meaningless. Existing "Option B" explanations are authored wrong
  for the randomized model; report-an-issue loop surfaces them.

### SCL-P-DESMOS-01 — Desmos resizable side-panel; CSS min-width is the pixel floor [OPEN (owner-promoted 2026-08-14)]
Decision: Bluebook-parity resizable side panel (question left, Desmos right, draggable divider), math-only,
  graphing+scientific modes with per-mode state preserved across switches. Split activates at 1062px;
  below it the calculator stacks full-width (never a sub-450px side panel). The 450px floor (Desmos stacks
  its expression list below the graph under 450px container width) is enforced by BROWSER CSS min-width:496px
  on the calculator panel (host = 496−16 padding = 480 ≥ 450) — the single source of truth, honored on first
  render. calculator.resize() called on container-change/toggle/mode-switch (autosize:true explicit).
Rationale: a fixed sidebar structurally can't clear 450px on laptops; a resizable panel with a real pixel
  floor can. CSS min-width is browser-continuous and needs no JS — chosen over a JS ResizeObserver
  recompute (which was found dead in prod: ref mounted after the effect ran → observer never created; a
  phantom mechanism everyone believed enforced the floor). One mechanism, browser-enforced.
Effect: calculator renders desktop layout ≥450px on first paint and after resize; verified by a test that
  measures resolved pixels (stubbed BCR), not the CSS attribute. Divider drag/keyboard are library-provided,
  bounded by the CSS floor; real interaction proof deferred to a Playwright e2e follow-up. Client-only.

### SCL-P-REFSHEET-01 — Math reference sheet typeset + complete [OPEN (owner-promoted 2026-08-14)]
Decision: all 12 official Bluebook formulas render via MathRenderer (were plain text); added the two
  missing special-right-triangle figures (30-60-90: x, x√3, 2x; 45-45-90: s, s, s√2) as labeled figures.
Rationale: plain-text "pi r^2" beside a typeset question is a visible quality tell; the two special
  triangles are on the official sheet and heavily used. Verified against the official Bluebook sheet.
Effect: reference sheet matches the official sheet, typeset. Client-only.

### SCL-P-OWNERSHIP-01 — Practice session reads are non-owning [OPEN (owner-promoted 2026-08-14)]
Decision: /state and /resume READ session state WITHOUT writing client_instance_id — no adoption, no claim.
  Ownership mutates ONLY on the answer-submit WRITE. client_instance_id is generated once and persisted
  (sessionStorage) so a refresh reuses the same id. Concurrent /state + /resume on load are de-duplicated.
Rationale: a P0 — practice sessions 409'd on refresh. Root cause: client_instance_id regenerated per-render
  + /state and /resume racing to ADOPT ownership (one adopts, the other 409s). Reads don't conflict; only
  concurrent writes/claims do — so ownership enforcement belongs on the write path, and a read must never
  409 on instance mismatch. Reads-non-owning verified by code-trace (stored id unchanged after a read).
Effect: refresh/resume works; a new tab/device can read a resumable session without stealing it. Pure
  client/server-logic fix, NO migration.

---

## Owner spec-annotations owed (fold into locked docs on next revision)

These are OPEN entries above that specifically need the locked spec doc text updated by the owner:

- Doc 01 §40.3 — SCL-013 (subscription-cancellation timing: "initiated immediately" → active during grace, paused at T+7)
- Doc 01 §19 — SCL-012 (deletion-confirmation prompt: "data anonymization at T+7" → "permanent deletion of the account at T+7")
- 05A §5.1/§4.9 — SCL-001 (PR-2 GUC + p_chain_downstream)
- 05D §10 — SCL-002 (Q2 request-row deletion; Q3 review_schedule→L1; Q6 audit FK drops; operator-attribution guard)
- 05D §10 — SCL-003 (storage-purge → PR-4 orchestration seam)
- 05D §10 — SCL-004 (student_kpi_rollups_current → deleted-derived set; defer enumeration to INV-DELETION-COMPLETE)
- Doc 02B §15 — SCL-015 (item selection: weakness-ranked + seeded Fisher-Yates → filter-driven native random prepopulation; adaptive deferred post-launch)
- Doc 02B (flow-cards) — SCL-016 (flow-cards deferred post-launch; useAdaptivePractice retired)
- Doc 05E — SCL-007/008/006 commit to docs/Spec after Codex audit
- Doc 03 INV-03-03 — SCL-029 (past_due/trialing: platform entitlement predicate wins over literal "status=active")
- Doc 03 INV-03-10 — SCL-030 (scope narrowed to model-generated text; structured API fields excluded; LISA-FULL-007 tracks enforcement)
- Doc 03B §5.5 — SCL-032 (remove step 4 live exam block from Start Conversation; amend §3.4 "turn" language; annotate INV-03-02 scope)
- Doc 03C IAM table — SCL-031 (annotate compaction worker Supabase access as defense-in-depth, not canonical write path)
- Doc 03A §18.2 — SCL-028 (widen idempotency constraint to include role in uniqueness key)
- Doc 03B §6.5 — SCL-027 (confirm step 5/6 ordering inversion: payload validation before ownership check)
- Doc 03A §7.3/§10.3 — SCL-026 (update §7.3 to V1 per-turn capture; add learner_observation to §10.3 orchestrator response contract)
- Doc 03B §3.1, Doc 03 §21.3, Doc 07E — SCL-025 (safety review is separate surface; amend §21.3 tooling to keep content in Supabase)
- Doc 03A §18.7/§18.1/§18.2/§18.4/§18.5, Doc 03B §4.1 — SCL-024 (config table → Doc 01A §8; retype question FK columns UUID→TEXT; wire-contract Zod schemas)
- Doc 03C, Doc 03C.1, Doc 03A — SCL-023 (add crisis classifier stage; add classifier_class alias; add crisis test scenarios; rename §4.5)
- questions_governance.md §A.4 — SCL-022 (review skill-classification disambiguation table and tiebreak rule)
- questions_governance.md §A.3/§A.8 — SCL-021 (confirm value-equivalence correctness model; align with Doc 04B)
- questions_governance.md §A.4 — SCL-020 (confirm 29-skill Title Case convention)
- Doc 02A §15/§16/§23 — SCL-018 (promote grid-in into spec; update QA gate to exempt grid-in from "four options present")
- Doc 05A §4.6/§11.4 — SCL-014 (update source table names to match live schema)
- Doc 03 INV-03-05, Doc 03A §16.2–16.3 — SCL-033 (narrow "no derived indicators" to "no indicators derived from conversation substance"; permit bare skill-topic coverage to guardians)
- Doc 03D §3, §5.1 CASE-18, authoring brief — SCL-039 (affective state as scaffolding input; permit structural supply on self-directed negative judgment; directive paired with recent_friction context block per §7.4)
- Doc 03D §3.1, §3.2 — SCL-034 (add buggy-procedure as third diagnostic mode; amend misconception repair rate definition)
- Doc 03D §5.1 CASE-15/CASE-16 — SCL-035 (decompose-first with three-level floor; annotate owner's blind gold response)
- Doc 03D §3.2, §5.1 coverage taxonomy — SCL-036 (add disengagement signal replacing frustration model; reclassify self-deprecation category)
- Doc 03D §0, §5.1 authoring brief — SCL-037 (INV-03-04 justification narrowed to product decision; redirect-over-refuse posture grounded)
- Doc 03D §9 — SCL-038 (record expected effect-size range and power consequences; coordinate marketing substantiation)
