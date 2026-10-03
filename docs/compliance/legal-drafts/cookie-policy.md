> **DRAFT — NOT PUBLISHED — FOR COUNSEL REVIEW**
>
> Document: LYCEON Cookie Policy, proposed version 1 (new; Doc 10 §9.10).
> Status: awaiting counsel. Prepared 2026-10-03 for plan row G7. Not built, not served, not linked from the product.
> The **[Effective when F10/F11 ship]** rows describe PostHog and the cookie banner, which are not live. They must be removed or confirmed before publication.

# **LYCEON Cookie Policy**

This Cookie Policy explains the cookies and similar technologies LYCEON uses, why we use them, and how you control them. It supplements the **LYCEON Privacy Policy**.

---

## **1. What Cookies Are**

Cookies are small text files a website stores in your browser. "Similar technologies" include your browser's local storage, which works in a similar way. In this policy, "cookies" covers both.

---

## **2. The Categories We Use**

### **2.1 Strictly Necessary**

These make the service work: keeping you signed in, protecting your account against forged requests, and remembering choices you make. They are always on and do not need your consent.

### **2.2 Analytics** **[Effective when F10/F11 ship]**

These help us understand how the service is used, so we can fix what is confusing or broken. They are set by PostHog, our analytics provider, **only if you accept analytics cookies**. Under-13 accounts are never included.

### **2.3 What We Do Not Use**

* **No advertising cookies.**
* **No cross-site tracking cookies.**
* **No cookies that sell or share your information** for advertising.

---

## **3. The Cookies**

| Name | Category | Set by | Purpose | Lasts |
|---|---|---|---|---|
| `sb-<project>-auth-token` (may be split into numbered parts) | Strictly necessary | LYCEON (first party) | Keeps you signed in | **[TO CONFIRM — session settings]** |
| `__Host-csrf` | Strictly necessary | LYCEON (first party) | Protects your account against forged requests | **[TO CONFIRM]** |
| Sign-in verifier (Supabase PKCE) | Strictly necessary | LYCEON (first party) | Completes "Sign in with Google" securely | Until sign-in completes **[TO CONFIRM]** |
| `lyceon-theme` (local storage) | Strictly necessary (preference) | LYCEON (first party) | Remembers light or dark mode | Until you clear it |
| Small app settings (local storage) | Strictly necessary (preference) | LYCEON (first party) | Remembers whether you dismissed a prompt, and keeps one device from opening duplicate sessions | Until you clear it |
| Cookie choice record | Strictly necessary | LYCEON (first party) | Remembers your cookie choice so we don't ask again **[Effective when F11 ships]** | 6 months |
| `ph_<project>_posthog` | Analytics | PostHog (first party) | Recognises your browser across visits for analytics **[Effective when F10/F11 ship — confirm name]** | **[TO CONFIRM]** |

The public pages of our website also use Vercel Analytics, which does not use cookies. **[Remove this sentence when F10 retires Vercel Analytics.]**

---

## **4. Your Choices**

* **Cookie banner** **[Effective when F11 ships].** When you first visit, we ask whether you accept analytics cookies. "Accept" and "Reject" are equally prominent, and you can choose by category.
* **Changing your mind.** Use the **Cookie settings** link at the bottom of any page, or in your account settings, at any time. Withdrawing consent is as easy as giving it.
* **Global Privacy Control.** If your browser sends a Global Privacy Control signal, we treat it as a refusal of analytics cookies.
* **Do Not Track.** There is no agreed standard for Do Not Track. We do not respond to it separately; we honour Global Privacy Control instead.
* **Your browser.** You can also block or delete cookies in your browser settings. If you block strictly necessary cookies, you will not be able to sign in.

---

## **5. Third-Party Content**

On math questions, we load the Desmos graphing calculator from desmos.com. When it loads, Desmos receives technical information from your browser, such as your IP address. **[TO CONFIRM — whether Desmos sets cookies or uses storage.]**

---

## **6. Changes**

We will update this policy when the cookies we use change, and note the date.

---

## **7. Contact**

**support@lyceon.ai**

---

## Standard sources followed

* Directive 2002/58/EC (ePrivacy) Article 5(3) — https://eur-lex.europa.eu/eli/dir/2002/58/oj
* EDPB Guidelines 05/2020 on consent under Regulation 2016/679 — https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-052020-consent-under-regulation-2016679_en
* UK ICO, *Guidance on the use of storage and access technologies* — https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/
* CNIL, cookies and other trackers guidance (structure of the cookie list) — https://www.cnil.fr/en/cookies-and-other-tracking-devices
* California CCPA regulations, 11 CCR §7025 (opt-out preference signals) — https://cppa.ca.gov/regulations/
* Global Privacy Control specification — https://globalprivacycontrol.org/

## Counsel checklist

1. **Lifetimes.** Confirm each **[TO CONFIRM]** lifetime from the Supabase auth settings, the CSRF middleware (`server/middleware/csrf-double-submit.ts`) and the PostHog configuration.
2. **Preference storage.** The theme, prompt-dismissal and client-instance keys are classed as strictly necessary. Confirm that classification under ePrivacy Article 5(3) and the ICO guidance.
3. **Pre-consent analytics.** Plan R11 says "cookieless until consent". Confirm whether any PostHog measurement may run before a choice, or whether it must wait for acceptance. This draft assumes it waits.
4. **Desmos.** Confirm whether the Desmos script sets cookies or uses storage. If it does, decide whether it needs consent or a strictly necessary justification, since it powers the calculator the user opened.
5. **Six-month re-ask.** Doc 10 §9.11 directs a 6-month do-not-re-ask period. Confirm it against current EU/UK guidance and the EU Digital Omnibus status.
6. **Do Not Track.** Confirm that the statement satisfies California's disclosure requirement (Cal. Bus. & Prof. Code §22575(b)(5)).
