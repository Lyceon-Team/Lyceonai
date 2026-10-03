> **DRAFT — NOT PUBLISHED — FOR COUNSEL REVIEW**
>
> Document: LYCEON Parental Consent Mechanism (clickwrap text and logging; Doc 10 §9.15, as amended by SCL-187 and recorded in SCL-208).
> Status: awaiting counsel. Prepared 2026-10-03 for plan row G7. Not built, not served.
> **What changed since Doc 10 §9.15.** Doc 10 assumed a 13+ service with parent acknowledgment at sign-up. SCL-187 (APPLIED 2026-09-30) lets an under-13 student use LYCEON only while a parent or guardian link is active. It also makes redeeming the student's link code the connecting act, replacing the email-consent flow. **Whether that act is sufficient consent in law is the open counsel question below.**

# **Parental Consent Mechanism**

## **1. How a parent or guardian connects today**

1. The student creates an account and gives their date of birth. If they are under 13, the learning features stay closed (SCL-187).
2. The student shows their parent or guardian a **link code**. If the student asks, LYCEON emails the code to an address the student enters.
3. The parent or guardian signs in to their own LYCEON account. They must be 18 or older; the date of birth they give is checked at sign-up and again before redeeming.
4. They enter the link code, tick the clickwrap box (Section 2), and submit. The link becomes active, and an under-13 student's learning features open.
5. Disconnecting the last active link closes the under-13 student's learning features again, automatically.

**Today's clickwrap text** (`client/src/features/guardian/AddStudentDialog.tsx:191-209`):

> ☐ I agree to the LYCEON Parent / Guardian Terms.

## **2. Proposed clickwrap text**

Shown unticked. Submit is disabled until it is ticked.

> ☐ I am this student's parent or legal guardian, and I am at least 18. I have read and agree to the **Parent / Guardian Terms**, and I have read the **Privacy Policy** and the **Children's Online Privacy Notice**. I consent to my child using LYCEON as those documents describe, including LYCEON collecting and using my child's learning activity to provide the service.

Shown underneath, in smaller text:

> You can disconnect, or ask us to delete your child's information, at any time. Email **support@lyceon.ai**.

For a student aged 13 to 17, the same text is used, with the last sentence of the checkbox reading "I agree to my child using LYCEON as those documents describe."

## **3. What is recorded**

Each acceptance is written to `legal_acceptances` (`supabase/migrations/20260618000000_legal_acceptances.sql:33`):

* the document and its version;
* the date and time;
* whether the student is a minor;
* where the acceptance was given (the consent source);
* the IP address and browser, for fraud prevention.

On account deletion, the IP address and browser are removed after 24 months, and the dated record remains (Privacy Policy v5 §6.2).

## **4. Identity verification**

Version 1 relies on the parent or guardian's acceptance, the adult date-of-birth check, and the student having handed over their own link code. No further identity check is made. Doc 10 §9.15 anticipates adding identity verification in sensitive jurisdictions later.

---

## Standard sources followed

* FTC COPPA Rule, 16 CFR §312.5 (parental consent; §312.5(b) verifiable consent methods; §312.5(c) exceptions), as amended in 2025 — https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312
* FTC, *Complying with COPPA: Frequently Asked Questions*, Section H (verifiable parental consent) — https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions
* GDPR Article 8 (child's consent; member-state age thresholds, e.g. Ireland 16) — https://eur-lex.europa.eu/eli/reg/2016/679/oj

## Counsel checklist

1. **Open question (SCL-187, SCL-051): is the link-code connection "verifiable parental consent"?** The parent's act is redeeming a code the child provides, plus a clickwrap and an adult date of birth. §312.5(b) lists acceptable methods (for example a signed form, a payment-card transaction, a phone or video call, government ID, knowledge-based questions, or facial matching). The "email plus" method is limited to operators who do not disclose children's information, and LYCEON discloses it to processors. **Counsel to decide whether the current mechanism is sufficient, or which method must be added before under-13 launch.**
2. **Paid connections.** Where the parent also subscribes, a payment-card transaction occurs at checkout. Decide whether checkout should be linked to the consent step so that it counts as a §312.5(b) method for subscribing families.
3. **Clickwrap wording.** Confirm the proposed text, including the separate 13–17 variant.
4. **Consent record retention.** The product removes IP address and browser after 24 months and keeps the dated record. Confirm this is adequate evidence.
5. **Ireland and other GDPR states.** Digital consent ages above 13 (e.g. Ireland 16) are not implemented. Decide the launch posture for those countries.
