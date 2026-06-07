# **Lyceon — Doc 03 ADR-001: LISA Storage Architecture (V1.0)**

| Field | Value |
| ----- | ----- |
| **Status** | Accepted |
| **Date** | 2026-06-06 |
| **Decider** | Karl (founder/CEO) |
| **Doc family** | Doc 03 (LISA AI Tutor) |
| **Scope** | Platform ownership of LISA persistence vs inference for V1.0 |
| **Supersedes** | Nothing. Doc 00 V6 does not address this boundary; this ADR closes that gap. |

---

## **1\. Context**

Lyceon is pre-production with zero users. LISA inference runs on GCP (Cloud Run orchestrator \+ Vertex AI Gemini), while the spec corpus in `docs/Spec/` describes LISA persistence in Supabase. Before the comprehensive state-assessment audit runs, the platform boundary needed an explicit, citable ruling so that audit findings against the LISA surface are judged against a settled architecture rather than an implied one.

The question: **where does LISA persistent state live in V1.0, given that inference is GCP-native?**

## **2\. Options Considered**

**Option 1 — Everything LISA in GCP, including storage. REJECTED.** Requires a multi-month migration of conversation tables, memory summaries, and instruction-assignment logging out of Supabase. The scale benefits that would justify GCP-native storage do not manifest at zero users. Splits canonical truth across two platforms for no V1.0 gain.

**Option 2 — Inference in GCP, persistence in Supabase. CHOSEN.** Matches what the spec corpus already describes. Keeps a single canonical truth platform. Smallest delta between spec and reality entering the audit.

**Option 3 — Hybrid by data class. REJECTED.** Theoretically optimal placement per data class, but the most complex option, with the largest surface for ownership ambiguity. Premature at zero users.

## **3\. Decision**

Option 2 is the V1.0 architecture.

| Domain | Owns |
| ----- | ----- |
| **GCP (Cloud Run \+ Vertex AI)** | LISA model inference; request orchestration; context cache (ephemeral only); Cloud Tasks compaction |
| **Supabase** | ALL persistent storage, including every LISA conversation/memory/policy-logging table; identity; auth; entitlements; canonical content; mastery; KPI; scoring formulas (as PL/pgSQL with constants in DB tables); Stripe entitlement state; everything else |

GCP holds no durable LISA state. Anything in GCP that is lost on restart is by definition reconstructible from Supabase or safely discardable.

## **4\. Auth Flow Across the Boundary**

Supabase Auth issues JWTs. GCP services verify JWTs using Supabase's public key, cached as a GCP secret. For claims that can change mid-session — entitlement status, age-gating — GCP does not trust the JWT snapshot; it reads current state from Supabase via internal service auth on a per-request basis. The service-auth mechanism itself is owned by its canonical doc in `docs/Spec/` and is referenced here, not defined.

## **5\. Mastery Coupling**

When a tutor exchange triggers a verified retry, the retry flows through the review engine, which emits the canonical mastery event to the Supabase `mastery_outbox`. LISA never writes mastery directly — that invariant is owned by the Doc 03 family and is referenced here, not restated. The cross-platform write boundary is therefore exactly one well-defined path: GCP orchestration → review-engine-mediated event → Supabase outbox.

## **6\. Consequences**

* Supabase remains the single canonical truth platform; the audit program evaluates all persistence findings against Supabase state.  
* Tutor data-retention and pseudonymization obligations (the retention matrix and pseudonymization mechanism owned by the Doc 03 family and privacy corpus) are implemented on the Supabase tutor tables. Per the standing "Reading B" ruling, the canonical conversation store legitimately holds verbatim content within the spec'd retention window before pseudonymization; the non-verbatim discipline applies to logs and the retired audit side-table, not the conversation store.  
* GCP services are stateless beyond the ephemeral context cache and may be redeployed freely without data-loss considerations.  
* No migration work is created by this ADR. It ratifies the boundary the corpus already describes.

## **7\. V2.0+ Trajectory (Non-Commitment)**

Migration of hot-path LISA storage (conversation history, memory summaries) to GCP-native storage may be warranted at scale. That is a forward-looking observation, not a V1.0 commitment, and requires a separate ADR with its own stress-test if and when it is scoped.

## **8\. Non-Restatement Note**

This ADR allocates **platform ownership only**. Every mechanism it touches — service auth, retention, pseudonymization, mastery emission, outbox semantics — remains owned by its canonical document in `docs/Spec/`. Where this ADR and a canonical doc appear to conflict on a mechanism's definition, the canonical doc wins and this ADR is in defect.

