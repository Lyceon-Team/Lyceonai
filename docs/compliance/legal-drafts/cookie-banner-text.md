> **DRAFT — NOT PUBLISHED — FOR COUNSEL REVIEW**
>
> Document: LYCEON Cookie Banner / Consent Notice text (new; Doc 10 §9.11).
> Status: awaiting counsel. Prepared 2026-10-03 for plan row G7. Not built, not served.
> **[Effective when F11 ships]** in full. This is the legal-disclosure text the banner shows. The behaviour requirements at the end are what F11 must build, so that the text stays true.

# **Cookie Banner — Text**

## **First layer (shown on first visit)**

**Cookies on LYCEON**

We use cookies that are needed to make LYCEON work. With your permission, we'd also like to use analytics cookies to understand how the site is used and fix what's broken. We don't use advertising cookies.

Buttons, equal in size, style and position:

**[ Reject analytics ]   [ Accept analytics ]**

Link: **Choose settings** · Link: **Cookie Policy**

## **Second layer (Choose settings)**

**Your cookie settings**

**Strictly necessary** — Always on
Keep you signed in, protect your account, and remember your settings. These can't be switched off.

**Analytics** — Off / On (off by default)
Help us understand how LYCEON is used, including recordings of how pages are used. Recordings never include the question and answer area or conversations with LISA. Provided by PostHog.

Buttons, equal in size and style:

**[ Reject all ]   [ Save my choices ]   [ Accept all ]**

## **When a Global Privacy Control signal is detected**

The banner is not shown. A short notice is shown instead:

**Your browser asked us not to use analytics.** We've turned analytics cookies off. You can change this in **Cookie settings**.

## **Footer link (every page)**

**Cookie settings**

## **Account settings (signed in)**

**Cookies and analytics** — reopens the second layer.

---

## Behaviour the banner must have (for F11)

| Requirement | Source |
|---|---|
| Accept and reject equally prominent; no pre-ticked boxes; no colour or size nudging | Doc 10 §9.11; EDPB 03/2022 deceptive design; ICO |
| Nothing beyond strictly necessary cookies before a choice | ePrivacy Art. 5(3) |
| GPC treated as reject; banner not shown | Doc 10 §9.11, §9.13; 11 CCR §7025; plan F11 |
| Choice remembered for 6 months, then asked again | Doc 10 §9.11; plan F11 |
| Withdrawing is as easy as consenting (footer link, account settings) | GDPR Art. 7(3) |
| Consent log: timestamp, categories accepted, banner text version | Doc 10 §9.11; GDPR Art. 7(1) |
| Under-13 accounts: analytics never loads, whatever the choice | SCL-201, SCL-204 |
| Refuse means zero analytics requests | plan F11 proof |

---

## Standard sources followed

* EDPB Guidelines 03/2022 on deceptive design patterns in social media platform interfaces — https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-032022-deceptive-design-patterns-social-media_en
* EDPB Guidelines 05/2020 on consent — https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-052020-consent-under-regulation-2016679_en
* UK ICO, *Guidance on the use of storage and access technologies* (consent mechanisms) — https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/
* California CCPA regulations, 11 CCR §7004 (symmetry in choice) and §7025 (opt-out preference signals) — https://cppa.ca.gov/regulations/
* Global Privacy Control specification — https://globalprivacycontrol.org/

## Counsel checklist

1. **Wording.** Confirm the first-layer wording is sufficient "clear and comprehensive information" under ePrivacy Art. 5(3) and the ICO guidance, with the Cookie Policy one click away.
2. **Recordings.** The banner places session recording under the analytics category. Confirm whether recording needs its own toggle (the EDPB granularity expectation).
3. **GPC handling.** Confirm that skipping the banner when GPC is present is acceptable in the EU/UK, where GPC has no statutory force. The alternative is to show the banner with analytics already off.
4. **Re-ask interval.** Confirm 6 months.
5. **Consent log.** Confirm what the log must keep (and for how long) to evidence consent. This draft proposes a timestamp, the categories and the banner text version, and no IP address.
