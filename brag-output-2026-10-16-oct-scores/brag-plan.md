# Brag Plan: Lyceon — October SAT score release (TikTok, 9:16)

**Run:** 2026-10-16 · the walkthrough pipeline's 9:16 cut (`brag-output-2026-10-09-041834/`):
the same Hyperframes version, Kokoro `af_heart` voice, music bed, fonts, brand colours and
burned-in captions.
**Brief:** Karl, 2026-10-16. Congratulate October 3 test takers, ask for scores, point retakers
at the next registration deadlines. No mention of AI or how it is made, no synthetic people, no
score promises. Karl reviews in `#social` before anything is posted; he applies any platform AI
label at publish time.

## Dates (re-read 2026-10-16)
Source: https://satsuite.collegeboard.org/sat/dates-deadlines ("SAT Weekend October 2026–June 2027").

| Test date | Registration deadline | Late registration |
| --- | --- | --- |
| Nov 7, 2026 | Oct 23 | Oct 27 |
| Dec 5, 2026 | Nov 20 | Nov 24 (not shown; the brief's line names the registration deadline only) |

## Script (on screen and narrated)
| Time (s) | On screen | Voiceover |
| --- | --- | --- |
| 0–2.8 | "October SAT scores just dropped 📬" | "October SAT scores just dropped." |
| 2.6–7.0 | "Whatever you got, congrats on sitting that test." then "Drop your score 👇" | the same lines |
| 6.8–15.5 | "Retaking?" / "Nov 7 registration: Oct 23" / "(late: Oct 27)" / "Dec 5: Nov 20" | the same, dates spoken in full |
| 15.3–20.3 | the **Find your blind spots** card, then a review list; caption "Don't just study more. Study what you missed." | the same line |
| 20.0–22.5 | Lyceon logo, "lyceon.ai" | "lyceon.ai" |

**Length: 22.5 s, not ~20 s.** The retake line, spoken at 1.1× as the on-screen text, takes
8.15 s; cutting it further would drop a date or speak faster than is easy to follow.

## Footage
Both screens come from the student harness (`tests/e2e/student-harness/capture.ts`) on its test
personas and seeded test data, mobile viewport, light theme, 3× scale: UI-50 `home-free` cropped
to the blind-spots card (which also crops out the persona's name), and UI-52 `review-paid-full`.
No real student data.

## For Karl's review
- The blind-spots card shows the product's own copy, which mentions a projected SAT score; it is
  the shipped card, unchanged.
- The outro says the URL only ("lyceon.ai", spoken "Ly-see-on dot A.I."), as the walkthrough does.
