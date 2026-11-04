# Content-gap run, 2026-11-04: sources tagged, segments and write-ups made

Karl approved the new-sources run on 2026-11-04: A + B + C, about $27 with retries
(`content-gaps-step0.md` §7). The backfill of existing segments stays deferred. Each write-up also
records how the instructor explains (`watch-writeup-step0.md` §8).

**Stopped here, for Karl's segment review.** Nothing is written to a database. The chunk steps
(rewrite, audit, example check, embed) run only on segments Karl approves, so they have not run.

## 1. What ran

| Step                                           | Result                                                                                                                                                                | Spend                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `sources.json`                                 | 75 video picks: Brain Buffs (37, tier 5 strict, flagged in the label for teaching-quality review), Tutorllini flashcards (31, tier 3), 7 singles (tier 5 strict)      | —                                                          |
| Metadata                                       | 75 of 75 available and embeddable; 1 has chapters                                                                                                                     | quota only                                                 |
| Skill tags                                     | 75 tagged, 0 with no SAT skill                                                                                                                                        | $0.394                                                     |
| Methods and format                             | 70 rows. 57 needed the video watched, against 18 of 66 in October. 5 failed: their two watch runs disagreed on the format (below)                                     | $4.731, plus a first attempt with unrecorded spend (below) |
| Segments, pass 1 with the write-up, and pass 2 | 70 videos (the 5 held rows sit out). 3 videos' pass 2 finished in a second call after a Vertex 429 and the cap                                                        | $12.850 + $0.415                                           |
| Agreement                                      | `segments-gaps-2026-11-04-review.csv`: 217 segments, 127 proposed approve, 55 retag, 35 drop (not teaching). Spot-check sample: `segments-gaps-2026-11-04-sample.csv` | —                                                          |

**Recorded spend: $18.39.** The first methods attempt aborted partway, on one row's format
disagreement, and its usage was never recorded. Its spend is unknown, and at most what the full
pass cost ($4.73). Vertex billing has the real figure.

What the attempt exposed was a code bug: the rule says such a row fails on its own, but
`tag-videos.ts` aborted the whole pass instead. That is fixed. The row now fails alone, written
with blank cells and `method_source = failed`, and is never cached.

**The 5 held videos** (`approve` blank, the reason in the row): `iKc31gO-it4`, `z2Lpcp2enXY`,
`545R4urlf2A`, `PnjaHIiVqhk` and `P6fkZwGTAhA`. The two watch runs disagreed on the format
(lesson, worked example or formula). Karl sets the format, and the rows then go through the
segment passes.

## 2. The gate

The gate is 70% sub-skill agreement, judged for skills with at least 3 tagged segments.

- **Pass (15 skills):** Area and Volume 82%, Circles 100%, Equivalent Expressions 91%, Linear
  Equations in One and Two Variables, Linear Inequalities, Nonlinear Equations, Nonlinear
  Functions 86%, Percentages, Right Triangles 90%, Systems, and Two-Variable Data.
- **Fail (3 skills), held as Phase B held Inferences and Rhetorical Synthesis:**

| Skill                                                | Agreement   |
| ---------------------------------------------------- | ----------- |
| Lines, Angles, and Triangles                         | 67% (10/15) |
| One-Variable Data                                    | 60% (3/5)   |
| Ratios, Rates, Proportional Relationships, and Units | 50% (2/4)   |

- **Reported, not gated (under 3 segments):** Inference from Sample Statistics, Linear
  Functions, and Probability.

## 3. The gaps it closes, if approved as proposed

A segment's method is its video's `methods`, as retrieval reads it.

| Gap (from `content-gaps-step0.md` §3)                      | Before      | Proposed after                                    |
| ---------------------------------------------------------- | ----------- | ------------------------------------------------- |
| EE.3 Factor polynomials                                    | Desmos only | + algebraic, backsolve                            |
| EE.5 Rational expressions                                  | Desmos only | + algebraic, backsolve                            |
| EE.4 Exponents and radicals                                | Desmos only | + algebraic                                       |
| NLF.4 Quadratic structure (the 2026-11-04 production case) | Desmos only | + algebraic, backsolve                            |
| EE.6 Polynomial long division                              | no segment  | algebraic, backsolve                              |
| NLF.2, NLF.3                                               | no segment  | algebraic                                         |
| EE.1 Combine like terms                                    | no segment  | **still none**                                    |
| LE2.1–LE2.3, PCT.1, PCT.2                                  | no segment  | **still none**                                    |
| RAT.\*                                                     | no segment  | **still none.** Its segments are held by the gate |

- **Newly covered, 21 sub-skills:** AV.1, AV.2, CIR3, CIR4, EE.6, INFS.2, LE1.3, LE1.4, LE2.4,
  LE2.5, LI.1, LI.2, LI.3, NLE.1, NLF.2, NLF.3, RTT1, RTT3, SYS.4, SYS.5 and TVD.2.
- **Gained an algebraic segment, 11 sub-skills:** CIR1, CIR2, EE.3, EE.4, EE.5, LF.3, NLE.4,
  NLE.5, NLF.4, NLF.5 and SYS.2.

## 4. The write-ups

`writeups-2026-11-04.jsonl` holds one line per teaching segment of pass 1: 175 segments, 127 of
them proposed approve. Each line carries the facts and `delivery`.

They are committed because the cache is lost when the container is reclaimed, and paying for
pass 1 again would cost about $6.50. Every word in them is the model's paraphrase. No transcript
exists anywhere, and the mathematics is given exactly.

| Field                         | Filled                |
| ----------------------------- | --------------------- |
| step_order                    | 175/175               |
| click_phrases                 | 175/175 (352 phrases) |
| examples                      | 132/175               |
| pitfalls the instructor names | 48/175                |
| understanding_checks          | 25/175                |
| analogies                     | 10/175                |

These short videos rarely use an analogy or check understanding. The fields are filled only when
the segment shows one, so the low rates may be the honest answer. Karl's read will tell.

**One thing to rule on.** 24 of the 352 click phrases open like speech ("We need to remember…",
"Let's…"):

| Channel         | Phrases |
| --------------- | ------- |
| Brain Buffs     | 13      |
| Tutorllini      | 10      |
| Nicole Hamilton | 1       |

They may be close to the instructor's own wording. The facts go through LISA 1's rewrite into our
words before they become chunks, but `delivery` does not. **Proposal:** before `delivery` is used
for gold responses or voice examples, it passes the same rewrite with a drop-only check, so no
phrase reaches LISA in an instructor's wording.

## 5. Budget

|                                                                  |                                                                                                                   |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Approved                                                         | about $27 with retries                                                                                            |
| Recorded so far                                                  | $18.39                                                                                                            |
| Unrecorded (aborted methods attempt)                             | up to $4.73                                                                                                       |
| Chunk steps still to run, 86 focused approved segments (8,443 s) | about $6.85 with retries. Overview and clusters-only segments get no chunk; rates per `watch-writeup-step0.md` §6 |
| **Projected total**                                              | **about $25.2 to $30.0**                                                                                          |

At the top of that range the total runs over the approval by up to $3. The chunk steps wait on
Karl's segment review in any case, so the overrun is his to rule on before they run.

## 6. What Karl does next

1. **Review `segments-gaps-2026-11-04-review.csv`**, as in Phase B, with the 20-row spot-check
   sample. Then the owner-run apply.
2. **Approve the 70 new library rows** in `video-tags-review.csv` (pre-marked `yes`, as
   proposed). Then `apply-video-library.ts`, owner-run. Brain Buffs rows are flagged for a
   teaching-quality read.
3. **Set the format** of the 5 held videos.
4. **Rule on:**
   - the `delivery` rewrite (§4);
   - the three gate-held skills;
   - the chunk-step spend (§5).
