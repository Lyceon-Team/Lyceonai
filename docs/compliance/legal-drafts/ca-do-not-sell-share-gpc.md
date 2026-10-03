> **DRAFT — NOT PUBLISHED — FOR COUNSEL REVIEW**
>
> Document: LYCEON Notice of Right to Opt Out of Sale or Sharing, with Global Privacy Control statement, proposed version 1 (new; Doc 10 §9.13).
> Status: awaiting counsel. Prepared 2026-10-03 for plan row G7. Not built, not served, not linked from the product.
> Intended placement: footer link "Your Privacy Choices" (or "Do Not Sell or Share My Personal Information"; counsel to choose), and from the Privacy Policy.

# **Your Privacy Choices — Sale and Sharing**

## **We do not sell or share your personal information**

LYCEON **does not sell** personal information, and **does not share** it for cross-context behavioral advertising, as California law defines those terms. We have not done so in the past 12 months. We do not show advertising.

This applies to everyone, including students under 16, whose information we never sell or share.

## **Our service providers are not a sale**

We use service providers to run LYCEON: hosting, database, payments, email, AI services, and **[effective when F10/F11 ship]** product analytics. They process information only on our instructions and only to provide services to us, under contracts that forbid them from using it for their own purposes. That is not a sale or sharing. The list is in the **LYCEON Sub-Processor List**.

## **Global Privacy Control**

**We honour the Global Privacy Control (GPC) signal.** If your browser sends GPC, we treat it as:

* a request to opt out of any sale or sharing (we already do neither); and
* **[Effective when F11 ships]** a refusal of analytics cookies, so analytics and session recording do not run for that browser.

You don't need to do anything else. GPC applies to the browser that sends it. If you are signed in, we will also apply it to your account **[TO CONFIRM — F11 implementation]**.

## **If our practices change**

If we ever intend to sell or share personal information, we will update this notice before doing so and give you a way to opt out first. For anyone under 16, we would ask for opt-in consent, as the law requires.

## **Questions**

**support@lyceon.ai**

---

## Standard sources followed

* California Civil Code §1798.120 (right to opt out of sale and sharing; under-16 opt-in) and §1798.135 (methods for submitting opt-out requests) — https://leginfo.legislature.ca.gov/
* California CCPA regulations, 11 CCR §7013 (notice of right to opt out), §7025 (opt-out preference signals, including GPC), §7026 (requests to opt out) — https://cppa.ca.gov/regulations/
* Global Privacy Control specification — https://globalprivacycontrol.org/

## Counsel checklist

1. **Is a notice required at all?** Under 11 CCR §7013(a), a business that does not sell or share need not provide a notice of the right to opt out, if its privacy policy says it does not sell or share. Decide whether to publish this page anyway as industry practice (Doc 10 §9.13 directs a footer link), and which link title to use.
2. **Analytics as "sharing".** Confirm that PostHog analytics, once live, is a service-provider relationship and not "sharing" under §1798.140(ah). This depends on the PostHog DPA and settings: no cross-context behavioural advertising, IP discarded, no PII.
3. **GPC and signed-in accounts.** Under §7025(c)(1), an opt-out preference signal must apply to a known consumer's account where possible. Confirm the F11 design.
4. **Other states.** Several state privacy laws (e.g. Colorado, Connecticut, Texas) require honouring universal opt-out mechanisms. Confirm this page is worded broadly enough for them.
