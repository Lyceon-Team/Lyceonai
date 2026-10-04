> **DRAFT — NOT PUBLISHED — FOR COUNSEL REVIEW**
>
> Document: LYCEON Privacy Policy, proposed version 5 (replaces published v4, `legal/privacy-policy/v4/en.md`, effective 2026-09-22).
> Status: awaiting counsel. Prepared 2026-10-03 for plan row G7 (`docs/plans/seo/seo-marketing-vertical.md`). Not built, not served, not linked from the product.
> Sections marked **[Effective when F10/F11 ship]**, **[Effective when Q2 ships]** or **[Effective with the first school agreement]** describe features that are not live. They must be removed or confirmed before publication, and nothing in them may be published early.
> Spec departures in this draft are recorded in SCL-208.

# **LYCEON Privacy Policy**

LYCEON respects your privacy and is committed to protecting personal data. This Privacy Policy explains how we collect, use, store, share, and protect information when students, parents, and guardians use the LYCEON platform.

This policy applies to students using LYCEON, parents or guardians connected to a student account, people who pay for a subscription, and visitors to the LYCEON website or app.

---

## **1. Information We Collect**

### **1.1 Information You Provide**

* Name or username
* Email address
* Date of birth
* Account credentials, or your Google account if you sign in with Google
* A parent's or guardian's email address, if a student asks us to email them a link code
* Messages, responses, or feedback submitted through the platform

### **1.2 Learning and Usage Data**

* Answers submitted to questions
* Progress and performance data
* Time spent on activities
* Interaction with explanations and AI tools

### **1.3 Technical and Device Data**

* Device type and browser
* IP address
* Log data and error reports
* Cookies and similar technologies, described in the **LYCEON Cookie Policy**

### **1.4 Billing Information**

**We do not store payment card numbers.** Payments are processed by Stripe, and card details go directly to Stripe without passing through LYCEON's systems.

When a subscription is purchased, **Stripe receives and stores** the payer's name, email address, billing address, and payment method details. **LYCEON stores** the payer's Stripe customer identifier, the subscription identifier, the subscription status and billing period, and which student account the subscription funds.

We also store a record of the payer's consent to the Billing Terms, as described in Section 6.3.

---

## **2. How We Use Information**

We use information to:

* Provide and operate the LYCEON platform
* Personalize learning, for example by tracking progress by skill
* Improve explanations and content quality
* Monitor platform performance, reliability, and security
* Prevent abuse, cheating, or misuse
* Process payments and manage subscriptions
* Send service messages, and marketing messages only if you opt in (see the **LYCEON Marketing Communications Consent**)

**We do not use personal information for targeted advertising, and we do not sell personal information.**

---

## **3. AI and Data Usage**

LYCEON uses artificial intelligence to support learning. The **LYCEON AI Content Disclosure** explains what this means for you.

### **3.1 Personalization**

Learning data is used to adapt explanations and practice to the student.

### **3.2 Service Improvement**

We may analyze data in aggregated, de-identified, or pseudonymized form to improve the quality, accuracy, safety, and reliability of the service.

### **3.3 Third-Party AI Services**

Conversations with LISA, our AI tutor, are processed by Google Cloud for AI services and content safety. Data shared with these services is limited to what is needed for the conversation, and Google is contractually prohibited from using it to train public or general-purpose models.

**No data from a user under 13 is sent to any third-party AI service**, because LISA is not available below that age. See Section 4.

---

## **4. Children's Privacy**

LYCEON is designed for students aged 13 and over. A student under 13 may use LYCEON only under the conditions in this Section. The **LYCEON Children's Online Privacy Notice** describes these conditions for parents in more detail.

### **4.1 Under-13 Students Need a Connected Parent or Guardian**

A student under 13 **cannot use any learning feature until a parent or guardian has connected to their account.**

Before a parent or guardian connects, the account holds only what was needed to create it (name, email address, date of birth, and sign-in details), plus the record of the sign-up agreements and the technical data described in Section 1.3. It can be used only to connect a parent or guardian and to manage the account. No learning activity is collected, because the learning features are not available.

If the student asks us to, we email their link code to the parent or guardian address they enter. We use that address only to send that email and to limit how often such emails can be sent.

A parent or guardian connects by entering the student's link code and agreeing to the **LYCEON Parent / Guardian Terms**. A parent or guardian must be at least 18. Once connected, the student's learning features become available.

**If the last connected parent or guardian disconnects, the learning features close again** until a parent or guardian reconnects.

### **4.2 No AI Tutor Below 13**

**LISA is not available to any user under 13**, whether or not a parent or guardian is connected. No tutor conversation data from an under-13 account is created, stored, or sent to any third-party AI service.

### **4.3 What We Collect From an Under-13 Account**

While a parent or guardian is connected, an under-13 account is subject to the collection described in Section 1, **except** that:

* no tutor conversation data exists;
* it is excluded from product analytics and session recording (Section 9); and
* it never receives marketing messages.

### **4.4 Parent and Guardian Rights**

A connected parent or guardian may ask to review, correct, or delete their student's information, or ask us to stop collecting it, at any time by contacting **support@lyceon.ai**.

**Disconnecting ends the student's access to learning features.** You may ask us to delete the student's information at the same time.

### **4.5 How We Treat This Consent**

Connecting a parent or guardian account is how we obtain and record consent for an under-13 student's use of LYCEON. We describe this mechanism plainly rather than claiming it satisfies any particular legal standard for verifiable parental consent. If you have questions about how we handle your student's information, contact **support@lyceon.ai** and we will answer directly.

---

## **5. How We Share Information**

LYCEON shares information only where necessary to operate the platform, where you direct us to, or where the law requires it.

### **5.1 With a Connected Parent or Guardian**

**When a parent or guardian is connected to a student account, they can see the student's progress and practice activity, skill breakdown, test results, and study calendar.** Some of this is available only while the student has a paid subscription.

**A connected parent or guardian cannot see the student's conversations with LISA.** Tutor conversations are private to the student.

This sharing is a direct consequence of connecting, and either party can end the connection at any time.

### **5.2 Service Providers**

We share information with the following providers, which process it only on LYCEON's instructions. The **LYCEON Sub-Processor List** gives more detail.

| Provider | Purpose | What it receives |
|---|---|---|
| **Supabase** | Database and authentication | Account data, learning data |
| **Vercel** | Application hosting and delivery | Request and log data, including IP address |
| **Stripe** | Payment processing | Payer name, email, billing address, payment method |
| **Google Cloud** | AI services and content safety for LISA; background processing | Tutor conversation content (**never for users under 13**); internal identifiers |
| **Google** | Sign in with Google, if you choose it | Your Google sign-in |
| **Resend** | Email delivery | Your email address and the message we send |
| **Desmos** | The graphing calculator on math questions | Technical data from your browser (such as IP address and browser type) when the calculator loads |
| **Slack** | Internal alerts to LYCEON staff | Internal reference numbers only — no conversation content and no names |
| **[ERROR-MONITORING VENDOR — TO BE CONFIRMED]** | Error monitoring | Error reports, which may include IP address and an internal account reference |
| **PostHog** **[Effective when F10/F11 ship]** | Product analytics and session recording | Usage events and page interactions, as described in Section 9 |
| **Cloudflare** **[Effective when Q2 ships]** | Abuse protection (Turnstile) on public question pages | Technical data from your browser |

Where a provider is used for AI services, it is contractually prohibited from using personal information to train public or general-purpose models.

### **5.3 Legal and Safety Reasons**

We may disclose information where required to comply with legal obligations, respond to lawful requests, or protect the rights, safety, or security of LYCEON, our users, or others.

Where a tutor conversation raises a safety concern, we may review it and contact a connected parent or guardian or, where necessary, appropriate authorities. This is described further in **Trust & Safety at LYCEON**.

### **5.4 We Do Not Sell or Share Personal Information**

LYCEON does not sell personal information and does not share it for cross-context behavioral advertising. See the **LYCEON Notice of Right to Opt Out of Sale or Sharing**.

### **5.5 Schools** **[Effective with the first school agreement]**

When a school or district contracts with LYCEON, we process student information on the school's behalf, under a written data privacy agreement with that school. In that role we act as a "school official" under the Family Educational Rights and Privacy Act (FERPA): we use student records only to provide the service to the school, we do not sell them or use them for advertising, and we return or delete them when the agreement ends. Parents of students using LYCEON through a school should contact the school to exercise their FERPA rights. See the **LYCEON School Data Privacy Addendum**.

---

## **6. How Long We Keep Your Information**

We keep information only as long as we need it, and we delete or de-identify it on the schedule below. We do not keep any category of information indefinitely except where this section says so explicitly.

### **6.1 Your Account and Learning Data**

While your account is open, we keep your profile, your practice and test activity, and your progress data so the service works.

Tutor conversations are kept while your subscription is active. If your subscription ends, they are deleted seven days later. If you resubscribe within those seven days, they are kept. If you have never subscribed, they are kept while your account is open and are deleted when your account is deleted.

Notifications you receive in the app are kept for 90 days.

### **6.2 When You Delete Your Account**

You have 7 days to change your mind. Nothing is erased during that window and you can cancel at any time.

After 7 days we permanently erase the information that identifies you — your name, email address, date of birth, and sign-in details. Your learning activity is de-identified: the records remain, but nothing in them connects to you, and we cannot reverse that.

Three things survive, and here is exactly why:

* **A record that you asked us to delete your account**, including your email address, kept for 24 months. We are required to keep records of these requests. After 24 months we remove the email address and keep only the date and outcome.
* **A record of consents given on the account** — which document, which version, when, and how it was given. The network details attached to it (IP address and browser) are removed 24 months after your deletion request is answered. The dated record, with nothing in it that identifies you, is kept without a fixed end date so that we can show consent was properly obtained.
* **Payment records**, kept for 7 years, because tax and financial rules require it.

If you asked us not to contact you again, we keep your email address on a do-not-contact list until you tell us otherwise. That is the only way we can honour the request.

### **6.3 Consent to the Billing Terms**

Records of consent to the Billing Terms are kept for no less than three years from the date of consent, or one year after the subscription ends, whichever is longer. This is a separate record from the consents described in Section 6.2, and it is kept on its own clock.

### **6.4 Children**

Information from an under-13 account follows the same periods as any other account, with the exceptions in Section 4: no tutor conversations exist, and the account is excluded from analytics, session recording, and marketing. A parent or guardian may ask us to delete it at any time (Section 4.4), and it is deleted as described in Section 6.2.

### **6.5 Security and Operational Records**

Records of sign-ins, security events and administrative actions are kept for 365 days. When you delete your account, your identity is removed from these records immediately; the records themselves remain for the rest of that period.

Records of how our systems were configured are kept permanently, as an operational record. These describe our operations, not you.

### **6.6 Analytics**

We use Vercel Analytics to understand how the public pages of the website are used. It does not use cookies. Analytics data is kept for 12 months.

**[Effective when F10/F11 ship — replaces the paragraph above]** We use PostHog to understand how the service is used. Analytics events are kept for **[PERIOD — TO BE CONFIRMED FROM POSTHOG PROJECT SETTINGS]**, and session recordings for **[PERIOD — TO BE CONFIRMED]**. Where analytics data has been aggregated so that it no longer relates to any person, we may keep the aggregate.

### **6.7 Anything Else**

Where we keep operational records that include information about you and are not listed above, we keep them for no more than 90 days.

### **6.8 Changes**

If we change these periods we will update this section and note the date.

---

## **7. Data Security and Breach Notification**

LYCEON uses reasonable administrative, technical, and organizational safeguards to protect personal information, including secure authentication, access controls, and monitoring and logging.

No system is completely secure. If a data breach compromises personal information, LYCEON will notify affected users and, where applicable, connected parents or guardians, in accordance with legal requirements.

---

## **8. Your Rights and Choices**

Depending on where you live, you may have rights to access your personal information, correct inaccurate information, request deletion, request a portable copy, restrict or object to certain processing, and withdraw consent.

**Parents and guardians may exercise these rights on behalf of a connected student.**

### **8.1 California Residents**

Under the California Consumer Privacy Act as amended, you have the right to know what personal information we collect, use, and disclose; to delete it; to correct it; to obtain a portable copy; and to be free from discrimination for exercising these rights. The **LYCEON California Notice at Collection** lists the categories we collect.

**We do not sell personal information and do not share it for cross-context behavioral advertising.** We honour the Global Privacy Control signal (Section 9).

### **8.2 European Union, EEA, and United Kingdom Residents**

Where the GDPR or UK GDPR applies, we process personal information on the following bases:

* **performance of a contract** for operating your account and subscription;
* **legitimate interests** for platform security, abuse prevention, and service improvement;
* **consent** for a parent's or guardian's connection to a student account, for non-essential cookies and analytics, and for marketing messages; and
* **legal obligation** where required.

You have the rights of access, rectification, erasure, restriction, portability, and objection, the right to withdraw consent at any time, and the right to lodge a complaint with your supervisory authority.

### **8.3 Making a Request**

Contact **support@lyceon.ai**. We will respond within the time required by applicable law and may need to verify your identity first.

---

## **9. Cookies, Analytics, and Session Recording**

LYCEON uses cookies and similar technologies that are strictly necessary to keep you signed in, protect your account, and remember your settings. These do not need your consent.

**We do not use advertising or cross-site tracking cookies.**

**[Effective when F10/F11 ship]** We also use PostHog for product analytics and session recording, which help us see where the service is confusing or broken. Specifically:

* **You choose.** When you first visit, we ask whether you accept analytics cookies. Accepting and refusing are equally easy, and you can change your choice at any time from the **Cookie settings** link.
* **Your browser's privacy signal is honoured.** If your browser sends a Global Privacy Control signal, we treat it as a refusal.
* **Session recording starts only if you accept.** Recordings never capture the question and answer area of practice, review, or tests, or your conversations with LISA. Text you type into forms is masked.
* **Under-13 accounts are excluded** from analytics and session recording entirely.
* **No names or email addresses are sent to PostHog**, and IP addresses are discarded.

The **LYCEON Cookie Policy** lists each cookie and how long it lasts.

---

## **10. International Users**

LYCEON is operated from the United States. If you use LYCEON from outside the U.S., your information may be transferred to and processed in the United States and other countries with different data protection laws, including where our providers operate.

Where required, we rely on appropriate safeguards for international transfers, including standard contractual clauses with our providers.

---

## **11. Changes to This Privacy Policy**

LYCEON may update this Privacy Policy from time to time. Each version carries a version number and effective date.

If changes are material, we will give notice through the platform or other reasonable means before they take effect. Where the law requires your consent to a change, we will ask for it.

---

## **12. Contact**

**support@lyceon.ai**

LYCEON AI

---

## Standard sources followed

* FTC Children's Online Privacy Protection Rule, 16 CFR Part 312, including the 2025 amendments (notice content, §312.4(d); data retention policy, §312.10) — https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312
* FTC, *Complying with COPPA: Frequently Asked Questions* — https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions
* California Consumer Privacy Act regulations, 11 CCR §7011 (privacy policy content) and §7025 (opt-out preference signals) — https://cppa.ca.gov/regulations/
* California Civil Code §1798.100, §1798.120, §1798.130 (CCPA/CPRA) — https://leginfo.legislature.ca.gov/
* GDPR Articles 6, 7, 13 and 14 — https://eur-lex.europa.eu/eli/reg/2016/679/oj
* UK ICO, *Right to be informed* guidance — https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/
* FERPA, 34 CFR §99.31(a)(1)(i)(B) (school official exception) and U.S. Department of Education PTAC, *Protecting Student Privacy While Using Online Educational Services* — https://studentprivacy.ed.gov/

## Counsel checklist

Decisions counsel must make before publication:

1. **Under-13 consent (SCL-187, SCL-051).** Is a parent or guardian redeeming the student's link code and accepting the Parent / Guardian Terms sufficient verifiable parental consent under 16 CFR §312.5(b)? We disclose an under-13 student's information to processors (Section 5.2), so the "email plus" method is not available. §4.5 deliberately makes no legal-sufficiency claim. Confirm or tighten.
2. **Unlinked under-13 accounts (corrected contradiction #1).** v4 §4.6 and §6.4 said such an account is suspended or deleted. The product enforces neither: the account stays open but cannot reach learning features, and it holds only sign-up data (§4.1). This draft states what the product does. Counsel to decide whether 16 CFR §312.5(c)(1) requires deleting the sign-up data (in particular the email address) if no parent connects within a reasonable time. If it does, engineering must build that deletion before this section can promise it.
3. **Consent records (corrected contradiction #2).** v4 §6.2 said guardian consent records are kept for 3 years. The product strips IP address and browser after 24 months and keeps the dated, non-identifying record permanently (SCL-085/SCL-095; `supabase/migrations/20260917120000_deletion_sweeps_and_config.sql:156-166`). §6.2 now says so. Confirm this period is adequate evidence of consent.
4. **Error-monitoring vendor.** The §5.2 row is a placeholder. Karl to confirm the vendor or turn the webhook off (`server/logger.ts:685-713`, which sends raw IP and a digested user ID). Remove the row if it is turned off.
5. **PostHog retention periods (§6.6).** Fill these in from the PostHog project settings before F10 ships.
6. **Pre-consent measurement.** Plan R11 says PostHog runs "cookieless until consent". Confirm whether any measurement before an analytics choice is lawful in the EU/UK (ePrivacy Article 5(3)), or require analytics to wait for acceptance. §9 is written so that nothing beyond strictly necessary cookies runs without a choice.
7. **Vercel Analytics 12-month figure.** This is carried from v4 until F10 retires it. Confirm it matches the Vercel plan's retention.
8. **Desmos.** It is loaded from desmos.com on math questions. Confirm the processor and controller characterisation, and whether the Cookie Policy must list any Desmos storage.
9. **Google Cloud AI location.** Tutor models are called through the "global" endpoint. Confirm the international-transfer statement in §10.
10. **Schools (§5.5).** Confirm the FERPA "school official" wording and that it should publish only once a school agreement exists.
11. **"Continued use constitutes acceptance."** v4 §11 had this. It is removed here in favour of notice-before-effect and consent where required. Confirm.
12. **Analytics retention (§6.6).** v4 §6.6 also said de-identified analytics data is kept "for up to 24 months, then only in aggregate". v5 drops that sentence: Vercel Analytics has no de-identified tier that LYCEON controls, and the BigQuery archive the sentence related to was never used (SCL-106). v5 also narrows the Vercel Analytics statement to public pages, which matches `client/src/lib/analytics-surface.ts`. Confirm.
13. **Naming safety tooling.** Google Cloud is described only by purpose, "AI services and content safety" (Karl, 2026-10-03). Do not describe how those checks work (doctrine rule 2).
14. **Google Fonts.** Not listed: fonts are self-hosted on `seo` by #1088 (SEO-1). v5 must not publish until that change is live in production.
