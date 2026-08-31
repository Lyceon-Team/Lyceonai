# URGENT, UNROUTED — every student in crisis is given a US-only phone number

**Status: REPORTED, NO CODE CHANGED. Needs an owner and a product/safety ruling.**
**Surface: child-facing (students 13–18), crisis response. Not a billing defect.**

Found 2026-08-31 while drafting `SCL-DRAFT-A-declared-country`. It surfaced from the
Stripe vertical but **is not Stripe's, is not in any agent's layer, and must not wait
on the billing work.** Routed out deliberately rather than absorbed.

---

## What happens today

A student's message trips the crisis classifier. The system looks up regional crisis
resources by country and returns them. Every student receives **"Call or text 988"**,
the US Suicide & Crisis Lifeline, regardless of where they are.

There are **two independent reasons**, and fixing either one alone does not fix it.

### Reason 1 — nobody has a country

`server/routes/tutor-runtime.ts:902-909`:

```ts
const { data: profileRow } = await supabaseServer
  .from("profiles")
  .select("country_code")
  .eq("id", studentId)
  .maybeSingle();
const crisisContent = getCrisisResponse(
  (profileRow?.country_code as string | null) ?? "US",
);
```

`profiles.country_code` is **null on all 115 production rows** (owner-verified
2026-08-31). The repo already knows this — `server/lib/stripe/country-eligibility.ts:120`
carries the string *"`profiles.country_code` is null on every existing row."*

So the `?? "US"` fires for **every student, every time**. Not an edge case: the only case.

### Reason 2 — the "unknown country" fallback IS the US number

`server/services/tutor-crisis.ts:427-429`:

```ts
export function getCrisisResponse(country: string): string {
  const upperCountry = country.toUpperCase().trim();
  return CRISIS_RESOURCES[upperCountry] ?? DEFAULT_CRISIS_RESPONSE;
}
```

This *looks* like a safe unknown-country path. It is not. `DEFAULT_CRISIS_RESPONSE`
(`:85`) is **byte-identical** to the `US` entry (`:75`) — verified by string comparison,
not by eye:

```
US     : If you're in crisis, the 988 Suicide & Crisis Lifeline is there for you. Call or text 988. Real people, anytime.
DEFAULT: If you're in crisis, the 988 Suicide & Crisis Lifeline is there for you. Call or text 988. Real people, anytime.
IDENTICAL
```

**This is the part that matters for the fix.** Deleting the `?? "US"` at the call site —
the obvious one-line fix — changes nothing. An unknown country then falls to
`DEFAULT_CRISIS_RESPONSE`, which is the same 988 message. There is no generic
"we don't know where you are" response in the system at all.

`CRISIS_RESOURCES` covers eight codes: `US, CA, UK, GB, IE, AU, NZ, SG`. A student
anywhere else — India, Nigeria, Brazil, anywhere in continental Europe — also lands on
the US number, by the same fallback, even once countries are being collected.

---

## The consequence, stated plainly

988 is a North American short code. It does not route from the UK, Ireland, Australia,
New Zealand, Singapore, or most of the world. A student in distress outside North
America is handed a number **that will not connect**, at the moment the system has
correctly identified that they are in crisis.

Nothing in the system distinguishes this from a working response. There is no error, no
log, no alert — the crisis protocol reports success. The failure is silent by
construction, which is why it has survived.

The surrounding code takes crisis handling seriously: `flagConversationForReview` is
deliberately **blocking**, with the comment *"an unreviewed crisis turn is a safety gap
that monitoring alone cannot close within the 48h SLA."* That care stops at the content
actually shown to the student.

---

## Supporting facts, each verified

| Fact | Evidence |
|---|---|
| Zero test coverage | `grep -rn "getCrisisResponse\|DEFAULT_CRISIS" --include=*.test.ts` → no matches |
| The default equals the US entry | byte comparison above |
| The column is null on every row | owner-verified; corroborated at `country-eligibility.ts:120` |
| The design assumption is stated, and broken | `tutor-crisis.ts:29, 71, 422` all say the region is *"derived from billing country, not IP"*. A free-tier student has **no billing country** — and free-tier students are the population most likely to reach this path, since they have not paid for anything. |
| The ISO confusion has already reached this table | `CRISIS_RESOURCES` lists **both** `UK` and `GB` with identical text. Somebody hit the encoding ambiguity here and worked around it by listing both, rather than the codes being wrong in one place. See `SCL-DRAFT-A-tier1-iso-literal`. |

---

## What is NOT proposed here

No code is changed, and none should be until an owner rules. This is not a defect with
an obvious safe patch:

- **Falling back to a generic message** means writing one. What do you tell a student in
  crisis whose country you do not know? That is a safety-content decision, not an
  engineering one, and getting it wrong is worse than the status quo in a different way.
- **Asking the student for their country mid-crisis** is a product decision with obvious
  hazards.
- **Widening `CRISIS_RESOURCES`** requires sourcing and verifying crisis lines per
  country — real research with a duty of care attached, not a table anyone should fill
  from memory.
- **Using IP geolocation** contradicts the stated design (`"not IP"`) and Doc 03A's
  context-resolution authority, and carries its own privacy weight on a minors' surface.

Each of these is a decision about what a child in distress is shown. None is an agent's
to make.

---

## What the owner is asked to do

1. **Assign an owner.** This surface belongs to nobody in the current split. It is not
   B's, C's or D's, and holding it inside the Stripe vertical is how it stays unfixed.
2. **Rule on the unknown-country content** — what a student with no known country is
   shown, and whether that differs from the US message.
3. **Rule on sourcing** for countries outside the current eight.
4. **Decide the relationship to `SCL-DRAFT-A-declared-country`.** That SCL proposes
   collecting a declared country at signup. This reader is the strongest argument for
   doing so, and the argument is asymmetric in a way worth stating: **nobody falsifies
   their country to receive worse crisis resources.** The incentive that makes a declared
   country untrustworthy for a paywall does not exist here, so for crisis routing a
   self-declared country is not merely acceptable — it is the right signal. That SCL's
   ruling must therefore say **which column each reader consumes**, not only the
   eligibility gate, because this reader fails silently and it is a safety surface rather
   than a financial one.

---

## Provenance

Found while auditing readers of `profiles.country_code` for the declared-country SCL.
Reported the same day, unrouted, with no code changed. Recorded here rather than in the
Stripe plans because it is not a Stripe defect and should outlive that workstream.
