# LISA Desmos playbook

**Status:** for Karl's review, before `lisa-default-v4` is drafted or run against the G0-2 set.
**Sources:**

- Claude's draft (Karl's rule, interpretation-first, the core-moves table, four warnings), 2026-10-27.
- Gemini watched the 29 approved Desmos videos (`scripts/rag/extract-desmos-moves.ts`; extracts in the gitignored `scripts/rag/.cache/desmos-playbook/`): the 22 Tutorllini lessons, plus 7 others among the 85 approved rows.
  - 27 were read in full.
  - Two were read only in part: the Scalar "Desmos Bible" (`3l2hgANLQV8`, first 10 of 32 minutes) and "The only SAT Math Desmos Guide" (`jCT0jTVzKy0`, first 20 of 34 minutes). Their remaining clips failed with a proxy 502 on every one of four attempts.
  - Both are broad overviews whose read parts repeat moves the lessons teach.
  - Measured spend: **$3.91** (cap $10), §10.

Everything below is in our own words. Desmos input is quoted exactly, because typed syntax is not instructor text.

## 1. Karl's rule

When a student asks for Desmos (or a calculator, or graphing), LISA switches method, not tone:

1. Open with "Using Desmos…".
2. Give the first concrete input step for this question.
3. Walk through it in Desmos one step at a time, checking the student understands along the way.

It is the same Socratic breakdown, done in Desmos.

## 2. Interpretation first

The input is the easy part. The skill is translating the question into "which feature of the graph answers it":

| The question asks for                      | The graph feature                                                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| the solution of a system                   | where the graphs cross                                                                               |
| zeros, roots, x-intercepts, factors        | where the graph crosses the x-axis; a factor shares its x-intercept with the polynomial              |
| a maximum or minimum                       | the vertex. **On a restricted domain or interval, also check the endpoints**                         |
| "how many solutions"                       | the number of crossings: parallel lines, none; the same line, infinitely many                        |
| "the value of x where…" vs "the value of…" | the x-coordinate vs the y-coordinate of the same point. The other coordinate is a common trap answer |
| a constant that makes something true       | the slider value at which the picture meets the condition (touching once, parallel, overlapping)     |

The videos teach it in this order every time: read what is asked, name the feature, then type. In 26 of the 27 fully read videos the instructor explains why the feature is the answer, not only which button to press.

## 3. Core moves

The draft's table, corrected and extended. The source column gives Tutorllini lesson numbers (`T#`) and the other videos by id.

The skills column uses the exact strings in `content/canonical/taxonomy.json`. Once chunk retrieval is wired, each row maps to a `curriculum_chunks` entry with `methods = {desmos}` for those skills. Decimal-to-fraction is about answer form, so it serves every skill and is tagged with none.

| Question type                                 | Input                                                                                                                                                                          | Read                                                                                                                                                                               | Source                                | Skills (taxonomy)                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One-variable equation                         | As written: `3x+5=2x-1` gives a vertical line. Or each side as its own graph: `y=3x+5`, `y=2x-1`. Use the split for absolute value, rational and quadratic equations           | The vertical line's x, or the crossing's x. Never the crossing's y                                                                                                                 | T1, T15, jCT0jTVzKy0                  | Linear Equations in One Variable; Nonlinear Equations in One Variable and Systems of Equations in Two Variables                                         |
| Equation in a letter other than x             | Rename the letter to `x` first                                                                                                                                                 | As above                                                                                                                                                                           | T7, T15                               | Linear Equations in One Variable; Nonlinear Equations in One Variable and Systems of Equations in Two Variables                                         |
| System                                        | Both equations                                                                                                                                                                 | Click the crossing for (x, y), then do any arithmetic the question asks (for example x + y). Parallel: none. Same line: infinitely many (hide one graph to check it is really two) | T2, T6                                | Systems of Two Linear Equations in Two Variables; Nonlinear Equations in One Variable and Systems of Equations in Two Variables                         |
| Zeros / x-intercepts                          | `y=` the expression                                                                                                                                                            | Click the gray points on the x-axis to show their coordinates                                                                                                                      | T3, UDJ2RHMFax8                       | Linear Functions; Nonlinear Functions; Equivalent Expressions                                                                                           |
| Max / min                                     | `y=` the expression                                                                                                                                                            | Click the vertex; x or y as the question asks. With a restriction such as `{0<=x<=5}`, evaluate the endpoints with function notation                                               | T4, T17                               | Nonlinear Functions                                                                                                                                     |
| Equivalent expressions                        | The original, then each choice. Expressions in y are set equal to x                                                                                                            | The choice whose graph overlaps exactly; toggle it off and on to see the overlap                                                                                                   | T10, UDJ2RHMFax8                      | Equivalent Expressions                                                                                                                                  |
| Unknown constant                              | The equation with k. Add a slider; widen its bounds (the default −10 to 10 can miss) and set the step. For multiple choice, type each choice's value for k instead of dragging | The value at which the condition holds                                                                                                                                             | T7, T14, T22                          | Systems of Two Linear Equations in Two Variables; Nonlinear Equations in One Variable and Systems of Equations in Two Variables; Equivalent Expressions |
| Unknown constants, exactly                    | Regression: `[left₁, left₂] ~ [right₁, right₂]` with subscripted variables, and conditions such as `{a>1}`. For "for all x", add `x_1=[1...10]`                                | The parameter values listed under the regression                                                                                                                                   | g4vgbNrWArk, eIkiuHw9nrI, UDJ2RHMFax8 | Equivalent Expressions; Nonlinear Equations in One Variable and Systems of Equations in Two Variables; Systems of Two Linear Equations in Two Variables |
| Line, quadratic or exponential through points | Points in a table, then `y_1 ~ m x_1 + b` (or `a x_1^2 + b x_1 + c`, `a(x_1-h)^2+k`, `a^(x_1)+b`)                                                                              | The parameters, with r² = 1 for an exact fit                                                                                                                                       | T9, T21, g4vgbNrWArk                  | Linear Functions; Linear Equations in Two Variables; Nonlinear Functions; Two-Variable Data: Models and Scatterplots                                    |
| Function notation                             | `f(x)=…`, then `f(3)`; combinations such as `4f(2)-g(2)`                                                                                                                       | The computed value                                                                                                                                                                 | T8, 3l2hgANLQV8                       | Linear Functions; Nonlinear Functions                                                                                                                   |
| Translated function                           | `f(x)=…`, then `g(x)=f(x+5)`; hide f                                                                                                                                           | The feature of g the question asks for                                                                                                                                             | T4, T12                               | Nonlinear Functions                                                                                                                                     |
| Circle                                        | The equation as given, standard or expanded (no completing the square). Click the top and bottom points, then `midpoint((2,1),(2,-13))` and `distance((2,1),(2,-13))/2`        | Center = the midpoint; radius = half the distance                                                                                                                                  | T11, UDJ2RHMFax8                      | Circles                                                                                                                                                 |
| Point on a circle or line                     | Type the point                                                                                                                                                                 | Whether it sits on the curve                                                                                                                                                       | T11                                   | Circles; Linear Equations in Two Variables                                                                                                              |
| Inequality                                    | The inequality; a choice's points in a table or as `(a, 53)` with a slider                                                                                                     | Inside the shaded region. A dashed edge is excluded. For a system, the point must be in the overlap of both shadings                                                               | T5, UDJ2RHMFax8                       | Linear Inequalities in One or Two Variables                                                                                                             |
| Statistics                                    | `mean(6,10,13)`, `median(71,72,73)` (brackets also work). A missing value: `f(x)=mean(…,x)`, or a list `A=[10,12,26,x,x]` with `y=mean(A)` and `y=median(A)`                   | The value, or where the two graphs cross                                                                                                                                           | T13                                   | One-Variable Data: Distributions and Measures of Center and Spread                                                                                      |
| Percent                                       | `35% of 80`; a multiplier `1+27/100`; a change `100(0.6-1)` or `(92-45)/45*100`                                                                                                | The value. A negative change is a decrease                                                                                                                                         | T16, T18                              | Percentages                                                                                                                                             |
| Parameterized points                          | Each choice as a point in r, with a slider for r                                                                                                                               | The point that stays on the line as r moves                                                                                                                                        | T19, jCT0jTVzKy0                      | Linear Equations in Two Variables; Systems of Two Linear Equations in Two Variables                                                                     |
| Coordinate geometry                           | `polygon(A,B,C)` with the vertices in order around the shape; `distance(A,B)`                                                                                                  | Side lengths; parallel sides as the slider moves                                                                                                                                   | T23                                   | Lines, Angles, and Triangles                                                                                                                            |
| Decimal to fraction                           | The decimal, then the fraction button                                                                                                                                          | The fraction                                                                                                                                                                       | T1, T2, UDJ2RHMFax8                   | — (answer form, any skill)                                                                                                                              |
| Trig value                                    | `sin(56)`, after switching the settings (wrench) to degrees                                                                                                                    | The value                                                                                                                                                                          | UDJ2RHMFax8                           | Right Triangles and Trigonometry                                                                                                                        |

## 4. Warnings

The draft's four, corrected, then those the videos add.

1. **Desmos doesn't fit every question.** It is weak on geometry with no coordinates, on reading charts and tables, and on probability and study design. Say so in one line and still help; never refuse. _(Corrected: coordinate geometry is not weak. Circles, polygons, distance and midpoint are among the strongest moves, T11 and T23.)_
2. **Don't judge slope, parallel or perpendicular by eye.** The axis scale distorts the picture. Read slopes from the equations. _(Extended to "parallel": T7 and T14 find "no solution" constants by sliding until the lines look parallel, and T14 itself warns this is hard to see and needs zooming. Confirm with the slopes.)_
3. **Desmos shows decimals; answer choices use fractions.** 0.667 is 2/3: use the fraction button. Points snap to whatever you click near. _(Extended:)_
   - Exported points and regression snapshots are rounded and won't convert (T21, T22). Evaluate with function notation, or use a custom regression.
   - Dragging a point gives rounded values (T17).
   - A tangent point may show no gray dot until you zoom far in (T22).
4. **Before the student submits, give the input steps and say where to look, but never read the result off the graph for the student.** This is LISA policy; no video bears on it.

Added from the videos:

5. **Desmos defaults to radians.** Switch to degrees in settings for a degree question (UDJ2RHMFax8).
6. **Regression needs subscripts and `~`.** Write `y_1 ~ m x_1 + b`, not `y = mx + b`. Add conditions like `{a>1}` in braces at the end, or it may return a trivial solution (T9, g4vgbNrWArk).
7. **The view can hide the answer.** Crossings can be off-screen (zoom out). A near-tangent can look like one point or two (zoom in) (T1, T2, T6).
8. **Sliders approximate.** A fractional or very precise answer is found by typing candidate values, or by regression, not by dragging (T14, jCT0jTVzKy0).

## 5. Corrections to the draft

| #   | The draft said                                                  | The videos show                                                                                                                                                                                                    | Change made                                  |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| C1  | Line through points: `y1 ~ mx + b`                              | The table's columns are `x_1`, `y_1`, and both must be subscripted: `y_1 ~ m x_1 + b`. `mx` regresses against nothing (T9, g4vgbNrWArk)                                                                            | Input corrected                              |
| C2  | Circle: type the equation; read the center and radius           | Desmos doesn't display either. The videos click the top and bottom points, then use `midpoint(...)` and `distance(...)/2`. This works on the expanded form too (T11, UDJ2RHMFax8)                                  | Read column rewritten                        |
| C3  | A maximum or minimum is the vertex                              | Only without a restriction. With a restricted domain or interval, the extreme can be an endpoint; the videos evaluate `f(1)`, `g(5)` (T17, eIkiuHw9nrI)                                                            | Caveat added in §2 and §3                    |
| C4  | Max / min: click the vertex                                     | It is the vertex's x or y as the question asks; the other coordinate is a planted trap (T4)                                                                                                                        | Read column and §2 row                       |
| C5  | Unknown constant: slide until the condition holds, then read k  | The default bounds −10 to 10 often miss the answer, and dragging can't find 20.25 or 107/49. The videos widen the bounds, shrink the step, type each choice's value, or use regression (T7, T14, T22, g4vgbNrWArk) | Input column rewritten; regression row added |
| C6  | One-variable equation: as written, or `y=` each side            | Both work. For absolute value and rational equations "as written" may give no clickable points, so the videos split (T15, jCT0jTVzKy0). A letter other than x must be renamed first (T7, T15)                      | Notes and a row added                        |
| C7  | Equivalent expressions: the choice whose graph overlaps exactly | An exact overlap hides one graph, so the videos toggle it to see it is there. Expressions in y must be set equal to x (T10, UDJ2RHMFax8)                                                                           | Input column extended                        |
| C8  | Statistics: `mean([…])`, `median([…])`, `stdev([…])`            | Videos type `mean(6,10,13)` without brackets (both work). **No video uses `stdev`**, so it is unverified by this source                                                                                            | Kept, with the gap marked in §6              |
| C9  | Warning 1: weak on geometry diagrams                            | Weak on geometry _without coordinates_. Coordinate geometry (circles, polygons, distance) is a strength (T11, T23)                                                                                                 | Warning 1 narrowed                           |
| C10 | Warning 2: perpendicularity and slope                           | The videos judge _parallel_ by eye in T7 and T14, and T14 warns it is unreliable                                                                                                                                   | Warning 2 extended to parallel               |
| C11 | Warning 3: decimals vs fractions; snapping                      | Exported points and regression snapshots are rounded and won't convert; dragged values are rounded; tangent points may not show (T17, T21, T22)                                                                    | Warning 3 extended                           |
| C12 | System: "the same line means infinitely many"                   | Correct, but two identical lines look like one, so the videos toggle one off to confirm (T6)                                                                                                                       | Read column extended                         |
| C13 | No mention of degrees and radians                               | Desmos defaults to radians; trig questions need degrees (UDJ2RHMFax8)                                                                                                                                              | Warning 5 added                              |
| C14 | Moves not in the draft                                          | Percent, translated functions, parameterized points, polygons, decimal-to-fraction, trig, regression for constants and systems                                                                                     | Rows added to §3                             |

## 6. What the videos don't cover

Mapped against the 19 SAT math skills in `content/canonical/taxonomy.json`:

| Coverage        | Skills                                                                                                                                                                                                                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Covered**     | Linear equations in one variable; linear equations in two variables; linear functions; linear inequalities; systems of two linear equations; equivalent expressions; nonlinear equations and systems; nonlinear functions; percentages; two-variable data, models (regression from a table); circles                              |
| **Partly**      | Ratios, rates and units (unit-conversion arithmetic only, T18); one-variable data (mean and median only; no standard deviation, range or spread, no data from a chart); right triangles and trigonometry (a trig value in degree mode only; no right-triangle setup); lines, angles and triangles (coordinate polygons only, T23) |
| **Not covered** | Probability and conditional probability; inference from samples and margin of error; evaluating statistical claims; area and volume                                                                                                                                                                                               |

Also not covered: reading data straight from a chart, scatterplot or table without typing it in; scatterplot "line of best fit" chosen by eye; and `stdev` (C8).

## 6a. Conflicts between sources, unresolved

- **The table's "add regression" button.** T21 and `ZYDcmWtfLkk` click a regression button in the table header. `jCT0jTVzKy0` says the button it shows is part of the instructor's own web app, not the Desmos built into the digital SAT. Whether Bluebook's Desmos has it is not settled by these videos. Typing `y_1 ~ m x_1 + b` works either way, so the block and §3 use typing.
- **The letter `r` as a slider.** T14 says `r` is reserved (polar) and broke its slider, and renames it. T7 and T19 use `r` without trouble. The safe advice is: if a slider on `r` misbehaves, rename it.

## 7. Student-produced responses (from T18; check before use)

T18 teaches entry rules for the answer box, and they shape how a Desmos result is typed in:

- one answer when there are several;
- no %, $ or commas;
- no mixed numbers;
- at most 5 characters for a positive answer, 6 for a negative one;
- a long decimal must be rounded or truncated to fill the box (so `.845` falls short where `0.845` or `.8451` fits).

These are the instructor's statements. They must be checked against College Board's own student-produced response directions before LISA relies on them; they are **not** in the v4 block.

## 8. Implementation notes for v4

- **Gating (ruled 2026-10-27).** The block goes in only in these two cases:
  1. **An item with `questions.section = 'M'`.** The BFF reads it from the question row and passes it as a new `question_content` field. It is never inferred from mastery data.
  2. **General mode (no item), when the student's current message matches the `desmos` method in `video_method_keywords`** (#1335, `packages/shared/src/video-methods.ts`). The same detector, not a second one.

  It goes nowhere else: not on reading-and-writing items, and not on general turns that don't ask for Desmos.

- **Kept out of the block (ruled 2026-10-27):**
  - the two open conflicts (§6a);
  - the answer-box formatting rules (§7). Those must be verified against College Board's official directions before they reach any student-facing surface.

## 9. The v4 Desmos block (derived from §1–§4)

**349 tokens**, by Vertex `countTokens` on `gemini-3.5-flash`, the model it is for (limit 350). It is added to the system instruction only under the §8 gating.

```text
DESMOS (math only). When the student asks for Desmos or a calculator, switch method: begin "Using Desmos…", give the first concrete input for this question, then go one step at a time, checking they follow. Name the graph feature that answers it.
- Equation: type it as written, or y= each side; the x of the vertical line or crossing. Rename other letters to x.
- System: the crossing; parallel is none, same line is infinitely many.
- Zeros, factors: y= expression; click x-axis points.
- Max, min: click the vertex; x or y as asked. Restricted interval: check endpoints.
- Equivalent: graph original and each choice; the match overlaps.
- Constant: slider (widen bounds), or type each choice's value.
- Points, table: table, then y_1 ~ m x_1 + b.
- Function: f(x)=…, then f(3).
- Circle: click top and bottom points; midpoint is the center, half their distance the radius.
- Inequality: shaded region; dashed edge excluded; systems need the overlap.
- mean(…), median(…), 35% of 80.
Desmos doesn't fit every question; say so in one line and still help, never refuse. Never judge slope, parallel or perpendicular by eye; read slopes from equations. Decimals vs fractions: 0.667 is 2/3; use the fraction button. Trig: switch to degrees. Before submit, give the steps and where to look; never read the result for the student.
```

What was left out to stay under 350, all kept in the playbook:

- regression for constants;
- translations, parameterization and polygons;
- the off-screen, near-tangent and rounding cautions;
- the student-produced response rules (§7, unchecked).

## 10. Extraction record

|                |                                                                                                                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model          | `gemini-3.5-flash` on Vertex, watching the public YouTube video. No transcript                                                                                                                                                                     |
| Videos         | 29 approved Desmos rows. 27 read in full; 2 in part (see Sources)                                                                                                                                                                                  |
| Calls          | One whole-video call for videos up to 15 minutes; 10-minute clips above that. Each clip is cached on its own                                                                                                                                       |
| Measured spend | **$3.91**, token counts exact: $3.48 kept (27 videos plus the cached clips of the two partial ones) and $0.43 lost on clips of an attempt that failed before per-clip caching existed. Rates are third-party list prices (`scripts/rag/vertex.ts`) |
| Not measured   | Proxy 502s return no usage. If Vertex completed any of those calls before the proxy dropped the reply, they were billed and are not in the figure                                                                                                  |
