> **DRAFT — NOT PUBLISHED — FOR COUNSEL REVIEW**
>
> Document: LYCEON Marketing Communications Consent, proposed version 1 (new; Doc 10 §9.21; plan R26).
> Status: awaiting counsel. Prepared 2026-10-03 for plan row G7. Not built, not served, not linked from the product.
> Product today: an unticked opt-in checkbox at profile completion (`client/src/pages/profile-complete.tsx:371`, stored as `profiles.marketing_opt_in`, default `false`). The Settings toggle, the under-13 block and the reset fix are plan row Q5. Marketing email sending is plan row D3. Parts marked **[Effective when Q5/D3 ship]** depend on them.

# **LYCEON Marketing Communications Consent**

## **1. The checkbox (sign-up and profile completion)**

Shown unticked, separate from agreeing to the Terms, and not required to use LYCEON:

> ☐ **Send me occasional emails from LYCEON** with study tips, SAT news and updates about new features. I can unsubscribe at any time.

Shown underneath, in smaller text:

> We'll still send emails about your account — like sign-in, billing and safety messages — whether or not you tick this box. See our **Privacy Policy**.

**Not shown to students under 13.** They cannot opt in. **[Effective when Q5 ships]**

## **2. What we send if you opt in**

* Study tips and SAT preparation guides
* News about the SAT that is relevant to students or parents
* Updates about new LYCEON features
* Occasional offers about LYCEON subscriptions

Messages are written for your role: **students** (13 and over) get student content; **parents and guardians** get parent content. **[Effective when D3 ships]**

## **3. What does not need this consent**

Messages about your account and the service you use: sign-in and security, billing and renewal reminders, receipts, safety messages, changes to our terms, and notifications you turned on in the app. These are not marketing, and you get them whether or not you opt in.

## **4. Changing your mind**

* **One click:** every marketing email has an **Unsubscribe** link at the bottom. One click stops marketing emails; you don't need to sign in. Email apps that show an "Unsubscribe" button use the same mechanism.
* **Settings:** turn **Marketing emails** on or off in your account settings at any time. **[Effective when Q5 ships]**
* **Email us:** **support@lyceon.ai**.

We act on an unsubscribe immediately, and in any case within 10 business days.

## **5. Who never receives marketing**

* **Students under 13**, ever, whatever any setting says.
* Anyone who has unsubscribed or asked us not to contact them.

## **6. Every marketing email identifies us**

Each marketing email says it is from LYCEON, gives our postal address **[POSTAL ADDRESS — TO BE PROVIDED]**, and includes the unsubscribe link.

## **7. Record of consent**

We record when you opted in or out, and where (sign-up or settings), so we can show your choice was respected.

---

## Standard sources followed

* CAN-SPAM Act, 15 U.S.C. §7704, and FTC *CAN-SPAM Act: A Compliance Guide for Business* — https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
* Canada's Anti-Spam Legislation (CASL), S.C. 2010, c. 23, s. 10 (express consent, identification and unsubscribe) and CRTC guidance — https://crtc.gc.ca/eng/com500/guide.htm
* GDPR Article 7 (conditions for consent) and Directive 2002/58/EC Article 13 (unsolicited communications) — https://eur-lex.europa.eu/eli/reg/2016/679/oj
* UK PECR regulation 22 and ICO direct marketing guidance — https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/
* RFC 8058, *Signaling One-Click Functionality for List Email Headers* — https://www.rfc-editor.org/rfc/rfc8058

## Counsel checklist

1. **Students aged 13–17.** Plan R26 permits marketing to students 13 and over who opt in. Confirm this is acceptable in each launch market. Some markets (e.g. the UK Children's Code) expect profiling and nudging to be off by default for under-18s. Decide whether 13–17 opt-in also needs a parent's knowledge.
2. **CASL.** Confirm the checkbox wording meets CASL's requirements for express consent (purpose, identity of the requester, statement that consent can be withdrawn), and that the "offers" category is acceptable.
3. **Postal address.** Required in every commercial email by CAN-SPAM §7704(a)(5) and CASL. Placeholder in Section 6.
4. **Consent record.** Confirm the fields (timestamp, source, value) and how long to keep them after opt-out.
5. **Unsubscribe timing.** CAN-SPAM allows 10 business days. Confirm the wording "immediately, and in any case within 10 business days".
6. **SMS.** Doc 10 §9.21 mentions SMS. No SMS exists, so this draft covers email only. Confirm that SMS must not be added without a separate consent draft.
