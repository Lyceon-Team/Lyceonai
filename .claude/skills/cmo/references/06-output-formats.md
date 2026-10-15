# 06: Output formats

Use these templates exactly. Karl reads on his phone: lead with the answer, keep each section short, put detail in an appendix or the linked file.

## Contents
1. Universal rules
2. Daily report (exceptions only)
3. Weekly executive memo
4. Monthly strategy review
5. Answer to a question (read or diagnose)
6. Decision memo
7. Gate-opening memo
8. Research brief
9. Content brief
10. "To record" block (Claude app)
11. Slack conventions

---

## 1. Universal rules

- **Answer first.** The first line says the conclusion.
- **Negatives get equal billing.** Every report has a "what's not working" section, even when it's short. If nothing moved, say "nothing moved".
- **Every number has a window and a source.** "49 new students (Supabase, Oct 8–15)".
- **Hygiene is declared.** One line on what was excluded or reclassified.
- **Sample size is declared.** Small numbers are labeled per `03` §7.
- **Every recommendation:** case for, case against, lens(es), your call, confidence (high / medium / low), and what would change your mind.
- **No student-level data.** Aggregates only.
- **Plain English.** No jargon without a short definition. No "leverage", "synergy", "delve".

## 2. Daily report (exceptions only)

Post only if something crossed a threshold. If nothing did, post nothing (or a one-line "quiet day" if Karl prefers; check `decisions.md`).

Thresholds *(proposed)*: signups zero for a day; a day's signups at least double the 7-day average; any paid entitlement or cancellation; email bounce rate over 5% or any send failure; a sudden traffic spike or drop (±50% vs 7-day average); a new review; a channel post that drew unusual traffic; anything going badly that the CMO paused.

```
CMO daily, <date>
What happened: <one or two lines, the exception itself>
Why it matters: <one line>
What I did / what I recommend: <one line; "paused X" or "no action, watching">
```

## 3. Weekly executive memo

```
CMO weekly, <week, e.g. Oct 8–15>

The headline
<Two or three sentences: the most important truth this week, negative first if it matters most.>

Numbers (source, window)
<Compact table: traffic and sources after hygiene; new students and guardians; active students;
diagnostics started/completed; full-length started/completed; questions answered; LISA usage;
redemptions; paying families; revenue; emails sent and delivery rate. Week-over-week change
where a prior snapshot exists, labeled for sample size.>
Hygiene applied: <one line>

What's working
<Bullets, each with its evidence.>

What's not working
<Bullets, each with its evidence. Never empty without saying "nothing clearly failing this week".>

What Karl did that explains the numbers
<From the activity log, or "not logged; please add".>

Decisions for Karl
<Each as a short item: the decision, my call, confidence, link to the memo if there is one.>

Gates
<Only gates whose status changed, or the one bottleneck worth acting on now.>

New ideas
<Two or three, each tied to a gate and a lens, each with "why now".>

Last week's calls, graded
<From track-record.md: what I recommended, what happened, right or wrong, what I learned.>

Next week
<What I'll do inside my authority; what I'm waiting on.>
```

## 4. Monthly strategy review

```
CMO monthly, <month>

Where we are: <the month in three sentences>
The funnel, month over month: <table>
Channels: <each channel judged on its own numbers, down the funnel, against its kill criterion>
Bets: <what we tried, the result, keep / kill / extend>
Gates opened or moved: <list>
The calendar ahead: <SAT dates, deadlines, score releases in the next 60 days, and what they imply>
Proposals: <the month's decision memos, ranked>
Track record: <hit rate of last month's calls, by lens if there's enough data>
```

## 5. Answer to a question (read or diagnose)

```
<The answer in one or two sentences.>

The evidence: <numbers, each with source and window; hygiene and sample-size notes>
Competing explanations: <for "why" questions, each explanation and what the data says about it>
What I'd do: <recommendation with case for and against, or "nothing yet" and why>
What would change my mind: <specific>
```

## 6. Decision memo

The format for anything that needs Karl's approval. Save to `docs/marketing/cmo/memos/YYYY-MM-DD-<slug>.md` in Claude Code.

```
Memo: <title>
Date: <date>    Status: proposed
Needs: Karl's decision | needs engineering | needs legal

The decision
<One sentence: what Karl is being asked to approve.>

My recommendation
<The call, in one or two sentences. Confidence: high / medium / low.>

Why now
<The trigger: a number, a gate opening, a date.>

Evidence
<Live data, sourced. Research, sourced.>

Options
1. <Option> — for: … / against: … / lens: … / cost (money, Karl's time): … / reversible: yes/no
2. <Option> …
3. Do nothing — for: … / against: …

Risks and how we'd see them
<What could go wrong, the early signal, the stop condition.>

How we'll judge it
<Success metric, minimum run length, decision date. Set now, not later.>

What would change my mind
<Specific evidence.>
```

## 7. Gate-opening memo

Same as the decision memo, plus a section right after "The decision":

```
Gate <ID>: prerequisites
| Prerequisite | Status | Evidence |
| … | met | <query, file or Karl's statement> |
```

## 8. Research brief

```
Research: <question>
Date: <date>   Researcher: Jake (research persona)

Answer: <two or three sentences>
Findings: <bullets, each with a source link and date read>
What this means for Lyceon: <implications, labeled as inference>
Confidence and gaps: <what's solid, what's thin, what we couldn't verify>
Suggested next step: <tied to a gate or a decision>
```

Rules: cite every factual claim; prefer primary sources (College Board, official pages, filings); say when a source is old or self-reported; never copy long passages.

## 9. Content brief

For content outside the blog pipeline (pages, emails, ads, social, Reddit drafts). Blog posts go through content-ops.

```
Brief: <working title>
Audience: parents | students (13+) | both      Register: credibility | attention
Channel and format: <…>
Angle and hook: <from hook-bank.md; name it>
Awareness stage: <Schwartz: unaware / problem-aware / solution-aware / product-aware / most aware>
The one promise: <one sentence>
Proof: <what's demonstrated or cited>
Sources: <for any SAT fact>
Lyceon-specific claims needing approval: <list, or "none; all from product-facts.md">
Call to action: <usually the free diagnostic or /login with UTM>
Tracking: <UTM tags>
Success metric and run length: <…>
```

## 10. "To record" block (Claude app)

In the Claude app you can't write repo files. End any answer that produced a ruling, a fact, a call to grade later, or a state change with:

```
To record
- decisions.md: <dated ruling, if Karl ruled>
- product-facts.md: <claim approved, if any>
- activity-log.md: <Karl's actions this week, if he shared them>
- track-record.md: <the call I made and its review date>
- state.md: <changed state>
```

Karl or a Claude Code session commits it.

## 11. Slack conventions

- One message per report; the headline in the first line; under about 15 lines; link to the full report file in the repo for detail.
- Use Slack-safe formatting: bold with *asterisks*, simple bullets, no tables (use short "label: value" lines), and **no horizontal rules (`---`)**, which break Slack's block formatting.
- No student data, ever. No links to private dashboards that expose individuals.
- Thread replies for follow-ups; don't flood the channel.
- One Slack integration pattern across pipelines (Karl's rule); see `07` for which channel and method.
