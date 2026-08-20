# Stripe Vertical — Open Questions

**Date:** 2026-08-20 · **Produced by:** Stripe vertical, Phase B (deliverable B2).
Two questions for counsel, one for product. None is answered here; each is stated with the
constraint that makes it live, and where relevant both options are spec'd so neither is foreclosed.

---

## Q1 — COUNSEL. One Checkout consent checkbox vs California's separate-and-distinct requirement

Stripe Checkout provides exactly one terms-of-service consent control:
`consent_collection[terms_of_service] = 'required'` renders a single checkbox and sets the Session's
`consent.terms_of_service` to `accepted` when checked
(https://docs.stripe.com/api/checkout/sessions/create). Its label is replaceable via
`custom_text[terms_of_service_acceptance]`, capped at 1200 characters with Markdown links permitted
(https://docs.stripe.com/payments/checkout/customization/policies). There is no second checkbox.

Lyceon needs four things affirmed at checkout: acceptance of the general Terms of Use; the
auto-renewal offer terms; that the payer is 18+; and that the payer is authorized to use the payment
method. The Subscription and Auto-Renewal Notice §3.2 (heading verified: `### **3.2 What You See at
Checkout**`) commits Lyceon to presenting the auto-renewal offer terms "in a way that is clear,
conspicuous, and **separate from our broader Terms of Use**," collected by "a separately marked
checkbox or button," and states that "Agreement to our general Terms of Use is captured separately."
§6.2 (`### **6.2 Affirmative Consent**`) grounds this in California Business and Professions Code
§17602(a)(4) and adds §17602(a)(5)'s prohibition on contract language that interferes with,
detracts from, contradicts, or otherwise undermines the ability to consent. The Notice is authority
level 1 under Charter §1; Stripe supplies mechanism and has no opinion on §17602.

**The question:** does folding "18+, authorized payer, auto-renewal offer terms, Terms of Use" into
Stripe Checkout's single checkbox satisfy §17602(a)(4)–(5), or does the auto-renewal affirmation
require its own control? If it requires its own control, hosted Checkout cannot deliver it and the
surface must move to embedded Checkout or a custom flow, which is a materially larger build with its
own PCI-scope and consent-capture consequences.

Note also Stripe's own constraint on the custom text, which binds under the authority order: it may
not "violate or create ambiguity with the Stripe-generated text on Checkout, obligations under your
Stripe agreement, Stripe policies, and applicable laws." The affirmation wording is counsel-owned,
not engineering-owned.

**Status:** both options are spec'd in SCL-044; **neither is built.** The Phase C thin slice uses the
single hosted-Checkout checkbox, which is the reversible choice — if counsel requires a separate
control, the consent record shape in SCL-044 is unchanged and only the surface moves.

---

## Q2 — COUNSEL. Are LISA's calls to Vertex AI a third-party disclosure under the amended COPPA Rule?

The amended Children's Online Privacy Protection Rule is effective 2025-06-23 with a full compliance
deadline of 2026-04-22 — already passed and enforceable
(https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule).
It requires operators to obtain **separate** verifiable parental consent to disclose a child's
personal information to third parties
(https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data),
and the email-plus method covers internal-use collection only; disclosure requires a higher-tier
method — knowledge-based authentication, government ID matched against a facial image, or
text-to-parent with confirmation
(https://www.ftc.gov/business-guidance/privacy-security/verifiable-parental-consent-childrens-online-privacy-rule).

The owner has ruled under-13 permitted where the guardian holds the account and the child has a
supervised profile (SCL-051). That ruling settles the account model. It does not settle the consent
tier, and the consent tier turns on one unresolved characterisation.

**The question:** when LISA sends a student's tutoring context to Vertex AI, is that an internal
operation performed by a service provider, or a disclosure of a child's personal information to a
third party? If it is disclosure, under-13 tutor access requires a **second, separate** VPC using a
disclosure-tier method — not the same consent that established the guardian link — and Lyceon does
not implement a disclosure-tier method today. Doc 10's CR-10-02 already records that "Lyceon does not
implement COPPA-grade VPC."

Two constraints bear on the characterisation and should be put to counsel with it. First, Lyceon's
own privacy posture already forbids PII in AI prompts, which argues toward service-provider
treatment. Second, Doc 03 gates LISA on Tier-1 country (INV-03-08) and paid entitlement but on no
consent tier, because no document contemplates one — so if the answer is "disclosure," a gate must be
created, not merely configured.

**Status:** launch gate, not a build item. **No Phase C work depends on it** — the thin slice is an
unaccompanied student and touches neither LISA nor under-13.

---

## Q3 — PRODUCT, not legal. What does a guardian see when linked students differ in entitlement state?

Doc 01 V8 dropped the statement its predecessor carried. The retired V6 file said "A guardian linked
to multiple students sees a selector on their dashboard to pick which student's data to view." V8 has
no equivalent:

```
$ grep -n -i "selector\|switch student\|which student" \
    "docs/Spec/Lyceon — Document 01_ Identity, Access, Billing & Guardian Trust.md"
1372:  … (vast majority of guardians link 1-3 students) …
1704:* Per-student-email: max 3 link attempts per day
```

Two hits, neither about display. What V8 does say answers a different question: §31.3 (heading
verified: `### **31.3 Guardian with multiple linked students**`) resolves the **guardian's own**
derivation — any one active premium student grants it. §38.3 (`### **38.3 Guardian dashboard
implementation**`) lists `entitlements` among the dashboard's sources in the singular and never
addresses divergence. Doc 04C §12.4 (`### **12.4 Multi-student guardians**`) forbids an aggregated
endpoint and pushes any rollup to "Doc 01 or a future dashboard doc" — which Doc 01 V8 does not take
up.

**The question:** with one linked student entitled and another not, does the unentitled student
appear greyed, hidden, or with an upgrade call-to-action? Does the guardian see a per-student billing
state at all, or only their own derived premium status?

This becomes a real surface under SCL-045, because one subscription item can be cancelled while a
sibling item continues billing — so the dashboard will routinely hold students in different states
within one subscription. It is a product decision with a spec consequence, not a legal one, and it
does not block Phase C.

---

## Not listed here

Decisions already ruled and recorded as SCLs (payer identity, multi-student shape, country egress,
refund events, `livemode`, sync-schema removal) are not open questions. The Stripe Entitlements
question is argued separately in `Stripe_Entitlements_Options_Memo.md` and awaits an owner ruling
rather than counsel or product input.
