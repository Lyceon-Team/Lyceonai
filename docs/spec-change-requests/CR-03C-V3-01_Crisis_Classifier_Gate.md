# CR-03C-V3-01 — Crisis Classifier Gate

| Field | Value |
|---|---|
| **CR ID** | `CR-03C-V3-01` |
| **Tags** | `[BLOCKER]` `[STRUCTURAL]` `[NO-MIGRATION]` |
| **Target docs** | Doc 03C V3.0 → **V3.1**; Doc 03C.1 V1.1 → **V1.2** |
| **Raised** | 2026-08-04 |
| **Raised by** | CTO advisory review during LISA Vertical C grounding |
| **Status** | Proposed — pending Karl approval |
| **Blocks** | WS-L2 (orchestrator rebuild). Does **not** block WS-L0/WS-L1. |

---

## 1. Finding

**Doc 03C V3.0 contains no crisis classifier stage.** A full-text scan of the document returns zero occurrences of `crisis`, `self-harm`, `safety classifier`, or `classifier`.

Three canonical documents delegate the mechanism to 03C:

| Doc | Location | Text |
|---|---|---|
| Doc 03 Main V1.1 | §21.1 | "The orchestration layer (Doc 03C) includes a classifier step for crisis signal detection… The classifier runs on Flash-Lite for cost efficiency (it's a classification task, per Doc 03C §model routing)." |
| Doc 03 Main V1.1 | INV-03-16 | "Every student turn runs through the crisis classifier (Flash-Lite) before main response generation. No turn is exempt… **Enforced: Doc 03 §21.1, Doc 03C orchestration pipeline.**" |
| Doc 03A V3.0 | §17 schema | `tutor_conversations.crisis_flagged BOOLEAN NOT NULL DEFAULT FALSE` + partial index `idx_tutor_conversations_crisis`; §2341 counts `classifier_inference_count` per turn across "register, crisis, injection" |
| Doc 03B V4.1 | §0 invariant list | "INV-03-16 (crisis classifier per turn) — every append-turn invokes classifier via orchestrator" |
| Doc 03B V4.1 | §13 step 14 | "Invoke orchestration via Doc 03C — **crisis classifier**, model call, structured output parse" |

**Doc 03C V3.0 never receives it.** Doc 03C.1 Test Matrix V1.1 contains no crisis or classifier test scenario, so the acceptance contract does not detect the absence either.

This is the *mechanism-assigned-to-a-doc-that-does-not-own-it* defect class. Three documents pointing at a fourth that is silent is a drafting defect with an unambiguous direction of repair, not a deliberate omission.

### 1.1 What exists in 03C V3 and is NOT this

| §  | What it is | Why it does not satisfy INV-03-16 |
|---|---|---|
| §4.5 "Content safety pre-pass" | Prompt-token bounding and truncation | The section states its own scope: *"This is NOT anti-leak enforcement… This is prompt-size bounding for cost and model compatibility."* Misleading name; does no content safety work. |
| §5.3.2 Vertex 422 handling | Provider-side safety filter on the **response** | Google's content filter on model output. Not a classifier on **student input**, does not run pre-generation, cannot detect a distressed student asking a benign-looking question. |
| §4.2.2 Deterministic PII guard | PII leakage prevention in the envelope | Different concern entirely. |

### 1.2 Missing config keys (related)

03C §5.2 specifies alias-resolution config keys `vertex.model.flash_class_alias` and `vertex.model.pro_class_alias` per 03A V3 §18.7. Verified against prod `tutor_context_runtime_config`: **neither key is seeded.** Nine keys exist; no model-alias keys among them. Carried into WS-L0.

---

## 2. Severity rationale

Lyceon serves students aged 13–18 through a free-text conversational surface. INV-03-16 is the only mechanism in the corpus that detects a student in crisis. Every other P0 on the LISA surface fails toward a broken product; this one fails toward a student in distress receiving a routine SAT tutoring reply.

Doc 03 Main §21 specifies the full downstream protocol — response substitution, regional resource selection by billing country, `crisis_flagged` write, ops alert, §21.3 human review queue with a 48h SLA. **All of it is gated on a detection step that does not exist in the implementing document.**

**Legal note (not a legal opinion):** AI-and-minors regulation is moving quickly and post-dates my reliable knowledge. I am not asserting what any specific statute requires. This CR is justified on the spec-consistency and product-safety grounds above. Confirming the statutory floor for conversational AI serving minors is counsel work and should attach to the existing Doc 07E **W9 legal counsel sign-off** gate rather than being resolved here.

---

## 3. Proposed resolution

### 3.1 Design ruling — two-layer gate

A single model-inference classifier has an unacceptable property: when Vertex is degraded, the safety control disappears. A safety control must degrade to *reduced sensitivity*, never to *off*.

**Layer 1 — deterministic signature match (fail-proof).**
Reuses the existing `tutor_injection_signatures` pattern from 03A V3 — a pattern-data table, not a `*_runtime_config` scalar table. New sibling: `tutor_crisis_signatures`.

Doc 03 §21.1's first two triggers are literally *"explicit self-harm keywords"* and *"explicit suicide ideation keywords."* These are string matching, not classification. Layer 1 runs in-process against the student turn with zero provider dependency and cannot fail open on a Vertex outage.

**Layer 2 — `classifier_class` model inference.**
Covers what keywords cannot: severe hopelessness unrelated to academic context, family violence or abuse mentions, emotional breakdown patterns. Requires a third alias.

**Either layer positive → crisis path per Doc 03 §21.2.** No change to §21.2–§21.5; those remain canonical in Doc 03 Main and are referenced, not restated.

**Rationale for reuse over invention:** this is the signature-table pattern the corpus already uses for injection defense, applied to a second detection domain. No new architectural concept is introduced.

### 3.2 Alias addition — §5.2

Add a third spec-level alias. Aliases remain spec-level; provider strings remain config-only per AMD-V2.2-06.

```
type ModelAlias = 'flash_class' | 'pro_class' | 'classifier_class';
```

| Alias | Purpose | Production mapping |
|---|---|---|
| `classifier_class` | Classification tasks only — crisis, emotional register, injection scoring | Flash-Lite–class provider string |

New runtime-config key, per 03A V3 §18.7 convention: `vertex.model.classifier_class_alias`.

`resolveProviderModel()` extends to three branches. **Unknown alias continues to throw** — closed-world, consistent with the existing V2.2 implementation and with the platform fail-closed doctrine.

**Why a third alias rather than collapsing onto `flash_class`:** Doc 03 §21.1 names Flash-Lite explicitly and grounds it in cost — the classifier runs on *every* turn, so its unit cost sits on the critical cost path that §24's $20/user/month cap governs. Collapsing to `flash_class` runs a full Flash inference per turn for a binary classification and contradicts a locked sibling. Doc 03 Main wins under the family precedence rule.

### 3.3 Pipeline placement — new §4.6

Insert **§4.6 Crisis classification gate** immediately after §4.5, before Part V (Vertex invocation). Ordering is load-bearing: INV-03-16 says *"before main response generation."* A response that has already been generated cannot be blocked, only discarded — and discarding still burns the generation cost and the latency.

Sequence per turn:

1. Layer 1 deterministic signature match against student turn
2. Layer 2 `classifier_class` inference (parallel with Layer 1; both must return before routing)
3. If either positive → return crisis outcome to 03B; **skip main generation entirely**
4. If both negative → proceed to §5.3 routing

### 3.4 Failure posture — the part that needs the most care

| Condition | Behavior |
|---|---|
| Layer 1 positive | Crisis path. No model dependency. Cannot be suppressed by provider failure. |
| Layer 2 positive | Crisis path. |
| Layer 2 fails (5xx / 429 / timeout) | **Retry once.** On second failure: Layer 1 result stands; turn proceeds to normal generation; turn is enqueued to the §21.3 safety review queue with `classifier_degraded` reason; SLI increments. |
| Layer 2 failure rate breaches threshold in window | **Page ops.** Do not flood the review queue — a provider outage must produce one alert, not N thousand tickets. |
| Layer 1 signature table unreadable | **Fail closed on the turn.** Layer 1 is in-process against a cached table; unavailability indicates infrastructure failure, not provider failure. |

**Why Layer 2 failure does not block the turn:** blocking returns an error to a student who may be the exact person the gate exists for. Proceeding with generation plus mandatory human review is fail-safe-toward-review, not fail-open — no unclassified turn escapes human eyes. This is a deliberate, narrow exception to the general fail-closed doctrine and is documented as such because the failure-mode asymmetry runs the opposite direction from a security or metering control.

### 3.5 Observability additions

New SLIs, following the existing §XI.2 catalog convention:

| SLI | Alert |
|---|---|
| `orchestrator_crisis_classifier_invocations_total{layer,outcome}` | — |
| `orchestrator_crisis_classifier_failures_total{layer}` | Threshold breach in window → page |
| `orchestrator_crisis_flagged_turns_total` | — |
| `orchestrator_classifier_latency_ms{layer}` | P95 budget |

New Failure Matrix rows: **classifier provider failure** (degraded-sensitivity mode, page on rate) and **signature table unavailable** (fail-closed, page immediately).

### 3.6 Latency impact — must be measured, not assumed

Layer 2 adds one inference to every turn. Layers 1 and 2 run in parallel, so added latency is bounded by Layer 2 alone. Whether this fits the Doc 03 §26.B P95 budget is **not asserted here** — it is a WS-L2 measurement gate. If the budget is breached, the resolution is a §26.B revision or a Layer 2 latency bound, decided on measured data. No estimate is offered because none would be evidence.

---

## 4. Documents affected

| Doc | Change | Version |
|---|---|---|
| Doc 03C | New §4.6; §5.2 third alias; §5.3 routing note (classification is not routed by §5.3.1 — it is a fixed-alias pre-stage); §30.1 new config key; §XI.2 four SLIs; Failure Matrix two rows; §4.5 renamed to "Prompt bounding pre-pass" to end the naming collision | **V3.1** |
| Doc 03C.1 | New P0 scenarios: Layer 1 positive; Layer 2 positive; both negative; Layer 2 failure → degraded + queued; Layer 2 failure-rate page; Layer 1 table unavailable → fail closed; **no-turn-exempt** proof over short/single-word/continuation turns per INV-03-16 | **V1.2** |
| Doc 03A | `tutor_crisis_signatures` table added to §17 alongside `tutor_injection_signatures`; ownership class per 01A Appendix D | **V3.1** |
| Doc 03 Main | **No change.** §21 stands as canonical. §21.1's reference to "Doc 03C §model routing" resolves correctly once §5.2 carries `classifier_class` | V1.1 |

**Version bump rationale:** this adds a mandatory pipeline stage, a spec-level alias, a schema object, config keys, SLIs, failure-matrix rows, and test scenarios across three documents. That is structural, not an in-lock-cycle cleanup pass. It exceeds the `RB-<DOC>-V1-NN` register mechanism. Karl owns the final versioning call.

**Consequence for the "canonical-final" declaration:** Doc 03C V3.0's statement that *"no further architectural change is expected before V1 production launch"* is falsified by this CR. V3.1 should restate the finalization claim rather than inherit it.

---

## 5. Open questions for Karl

1. **Approve the two-layer design, or single-layer model classifier only?** Two-layer costs a signature table and its curation. Single-layer is simpler and loses the outage-resilient floor.
2. **Version bumps as proposed (03C V3.1, 03C.1 V1.2, 03A V3.1), or carry as in-lock register entries?** My read is structural → bump.
3. **Layer 2 failure posture: proceed-plus-review (proposed) or block-the-turn?** This is a product-safety judgment call, not an engineering one. It is yours.
4. **Does the counsel item attach to Doc 07E W9, or open a separate legal gate?**
