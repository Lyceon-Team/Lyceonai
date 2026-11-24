# Video coverage report: sub-skill match for LISA (before vs after tonight's pending tags)

Date: 2026-11-22. Source: production project hncolwkccbbjkfithhlo (SELECT only) plus `tags-review.csv` (pending). "After" = production tags UNION pending tags. Only approved segments count (video_segments.approved_at and video_resources.approved_at both not null).

## Headline numbers

| Metric | Before (prod) | After apply | Change |
|---|---|---|---|
| Tagged questions that would get a video (shares a sub-skill with an approved segment) | 2427 / 3494 (69.5%) | 3188 / 3494 (91.2%) | +761 |
| Tagged questions with NO video (LISA serves "no video") | 1067 (30.5%) | 306 (8.8%) | -761 |
| Sub-skills with >=1 approved segment | 90 / 181 | 125 / 181 | +35 |
| Clusters with >=1 approved segment | 171 / 282 | 202 / 282 | +31 |
| Approved segments carrying >=1 sub-skill tag | 313 / 412 | 409 / 412 | +96 |

- Sub-skills with 0 approved segments: **91 before -> 56 after**; with 1-2 approved segments after: **56**.
- All of tonight's gain is in Problem Solving and Data Analysis (0 -> 761 questions). Algebra and Advanced Math question coverage is unchanged by the pending tags.
- 306 tagged questions still get no video after apply. All 306 of them share a cluster with some approved segment, but LISA requires a shared sub-skill first, so a cluster match alone does not serve a video.

### Important scope caveat: question tagging is incomplete

Question sub-skill tags exist only for Algebra, Advanced Math and 4 of the PSDA skill codes. Every Geometry and Reading and Writing question has zero sub-skill tags, so LISA cannot match any video to them regardless of video tags. The miss rate below is over **tagged** questions only.

| Section | Domain | Total questions | Published, not retired | Tagged with sub-skills |
|---|---|---|---|---|
| M | Advanced Math | 1039 | 1018 | 1018 |
| M | Algebra | 1491 | 1484 | 1484 |
| M | Geometry and Trigonometry | 1049 | 1043 | 0 |
| M | Problem Solving and Data Analysis | 1713 | 1711 | 992 |
| RW | Craft and Structure | 840 | 835 | 0 |
| RW | Expression of Ideas | 621 | 621 | 0 |
| RW | Information and Ideas | 824 | 824 | 0 |
| RW | Standard English Conventions | 694 | 694 | 0 |

PSDA skill codes with no tagged questions: Evaluating Statistical Claims; Inference from Sample Statistics and Margin of Error; Two-Variable Data: Models and Scatterplots. Their sub-skills show tagged_questions = 0 below for that reason, not because no questions exist.

### Input validation of the pending file

| Check | Result |
|---|---|
| Pending rows (sub-skill / cluster) | 1231 (586 / 645), 466 segments |
| Pending ids not in sub_skills / clusters | 0 / 0 |
| Pending segment ids not in video_segments | 0 |
| Pending segments that are NOT approved (their tags do not count here) | 55 |
| Pending sub-skill tags already in production / new | 378 / 208 |
| Pending cluster tags already in production / new | 501 / 144 |
| Production tags not in the CSV (kept by the union) | 33 sub-skill, 386 cluster |
| Approved segments / videos with approved segments / channels | 412 / 183 / 15 |
| Approved segments still without any sub-skill tag after apply | 3 |

## 3. Question-level miss rate

### Per domain

| Section | Domain | Tagged Qs | Get video before | Get video after | No video after | Miss rate after |
|---|---|---|---|---|---|---|
| M | Advanced Math | 1018 | 1005 (98.7%) | 1005 (98.7%) | 13 | 1.3% |
| M | Algebra | 1484 | 1422 (95.8%) | 1422 (95.8%) | 62 | 4.2% |
| M | Problem Solving and Data Analysis | 992 | 0 (0.0%) | 761 (76.7%) | 231 | 23.3% |

### Per skill_code

| Domain | skill_code | Tagged Qs | Get video before | Get video after | No video after | Miss rate after |
|---|---|---|---|---|---|---|
| Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | 255 | 0 | 76 | 179 | 70.2% |
| Algebra | Linear Functions | 294 | 239 | 239 | 55 | 18.7% |
| Problem Solving and Data Analysis | Percentages | 255 | 0 | 218 | 37 | 14.5% |
| Problem Solving and Data Analysis | One-Variable Data: Distributions and Measures of Center and Spread | 241 | 0 | 226 | 15 | 6.2% |
| Advanced Math | Equivalent Expressions | 336 | 323 | 323 | 13 | 3.9% |
| Algebra | Linear Equations in One Variable | 298 | 293 | 293 | 5 | 1.7% |
| Algebra | Linear Inequalities in One or Two Variables | 294 | 292 | 292 | 2 | 0.7% |
| Advanced Math | Nonlinear Equations in One Variable and Systems of Equations in Two Variables | 346 | 346 | 346 | 0 | 0.0% |
| Advanced Math | Nonlinear Functions | 336 | 336 | 336 | 0 | 0.0% |
| Algebra | Linear Equations in Two Variables | 300 | 300 | 300 | 0 | 0.0% |
| Algebra | Systems of Two Linear Equations in Two Variables | 298 | 298 | 298 | 0 | 0.0% |
| Problem Solving and Data Analysis | Probability and Conditional Probability | 241 | 0 | 241 | 0 | 0.0% |

### Top 25 sub-skills by tagged questions that would get no video (after apply)

Count = questions carrying this sub-skill where none of the question's sub-skills has an approved segment. A sub-skill with >=1 segment always scores 0 here.

| # | sub_skill_id | skill_code | Name | Tagged Qs | No video before | No video after | Segments after |
|---|---|---|---|---|---|---|---|
| 1 | RAT.10 | Ratios, Rates, Proportional Relationships, and Units | Proportion Setup and Solve | 91 | 91 | 91 | 0 |
| 2 | RAT.14 | Ratios, Rates, Proportional Relationships, and Units | Multi-Step Rate and Proportion Problems | 86 | 86 | 86 | 0 |
| 3 | LF.4 | Linear Functions | Interpret slope, intercept, and constants in context | 36 | 35 | 35 | 0 |
| 4 | LF.2 | Linear Functions | Build a linear model from a verbal description | 41 | 21 | 21 | 0 |
| 5 | PCT.6 | Percentages | Find Part, Percent, or Whole | 20 | 20 | 20 | 0 |
| 6 | OVD.9 | One-Variable Data: Distributions and Measures of Center and Spread | Compute the Range | 20 | 20 | 15 | 0 |
| 7 | PCT.14 | Percentages | Compound Category Percentages | 15 | 15 | 15 | 0 |
| 8 | EE.1 | Equivalent Expressions | Add, subtract, and combine like terms | 88 | 13 | 13 | 0 |
| 9 | LE1.2 | Linear Equations in One Variable | Find the value of an expression or an equivalent equation without stopping at the variable | 5 | 5 | 5 | 0 |
| 10 | LI.6 | Linear Inequalities in One or Two Variables | Determine a parameter for no-solution / all-solution conditions | 2 | 2 | 2 | 0 |
| 11 | PCT.15 | Percentages | Percent from Data | 2 | 2 | 2 | 0 |
| 12 | RAT.12 | Ratios, Rates, Proportional Relationships, and Units | Ratio Interpretation and Simplification | 2 | 2 | 2 | 0 |
| 13 | RAT.13 | Ratios, Rates, Proportional Relationships, and Units | Density and Derived-Rate Calculations | 1 | 1 | 1 | 0 |

Only 13 sub-skills have any no-video questions after apply, so the list stops there.

## 5. Videos to add next (ranked target list)

Order: tagged questions with no video (desc), then 0 approved segments first, then tagged questions (desc). Rows below cover every sub-skill with no-video questions, then every sub-skill with 0 approved segments; the full ranking of all sub-skills is in `coverage-by-subskill.csv`. Sub-skills in untagged domains (Geometry, RW, 3 PSDA skill codes) show 0 tagged questions only because their questions are untagged.

| Rank | sub_skill_id | Domain | skill_code | Name | Tagged Qs | No-video Qs after | Segments after |
|---|---|---|---|---|---|---|---|
| 1 | RAT.10 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Proportion Setup and Solve | 91 | 91 | 0 |
| 2 | RAT.14 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Multi-Step Rate and Proportion Problems | 86 | 86 | 0 |
| 3 | LF.4 | Algebra | Linear Functions | Interpret slope, intercept, and constants in context | 36 | 35 | 0 |
| 4 | LF.2 | Algebra | Linear Functions | Build a linear model from a verbal description | 41 | 21 | 0 |
| 5 | PCT.6 | Problem Solving and Data Analysis | Percentages | Find Part, Percent, or Whole | 20 | 20 | 0 |
| 6 | OVD.9 | Problem Solving and Data Analysis | One-Variable Data: Distributions and Measures of Center and Spread | Compute the Range | 20 | 15 | 0 |
| 7 | PCT.14 | Problem Solving and Data Analysis | Percentages | Compound Category Percentages | 15 | 15 | 0 |
| 8 | EE.1 | Advanced Math | Equivalent Expressions | Add, subtract, and combine like terms | 88 | 13 | 0 |
| 9 | LE1.2 | Algebra | Linear Equations in One Variable | Find the value of an expression or an equivalent equation without stopping at the variable | 5 | 5 | 0 |
| 10 | LI.6 | Algebra | Linear Inequalities in One or Two Variables | Determine a parameter for no-solution / all-solution conditions | 2 | 2 | 0 |
| 11 | PCT.15 | Problem Solving and Data Analysis | Percentages | Percent from Data | 2 | 2 | 0 |
| 12 | RAT.12 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Ratio Interpretation and Simplification | 2 | 2 | 0 |
| 13 | RAT.13 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Density and Derived-Rate Calculations | 1 | 1 | 0 |
| 14 | OVD.10 | Problem Solving and Data Analysis | One-Variable Data: Distributions and Measures of Center and Spread | Compare or Relate Measures of Center and Spread | 5 | 0 | 0 |
| 15 | CID.2 | Information and Ideas | Central Ideas and Details | Retrieve an explicitly stated key detail | 0 | 0 | 0 |
| 16 | CID.3 | Information and Ideas | Central Ideas and Details | Draw a conclusion the details support but do not state | 0 | 0 | 0 |
| 17 | CID.4 | Information and Ideas | Central Ideas and Details | Characterize a person's feelings, traits or attitudes in a literary text | 0 | 0 | 0 |
| 18 | COE.1 | Information and Ideas | Command of Evidence | Read data accurately from a table or graph | 0 | 0 | 0 |
| 19 | CTC.3 | Craft and Structure | Cross-Text Connections | Predict a supportive or applied response | 0 | 0 | 0 |
| 20 | ESC.3 | Problem Solving and Data Analysis | Evaluating Statistical Claims: Observational Studies and Experiments | Understanding Sample Variability | 0 | 0 | 0 |
| 21 | ESC3 | Problem Solving and Data Analysis | Evaluating Statistical Claims: Observational Studies and Experiments | Sampling variability: a sample result is not a certainty | 0 | 0 | 0 |
| 22 | INF.1 | Information and Ideas | Inferences | Draw a conclusion from a comparison | 0 | 0 | 0 |
| 23 | INF.2 | Information and Ideas | Inferences | Chain stated premises to a consequence | 0 | 0 | 0 |
| 24 | INF.3 | Information and Ideas | Inferences | Weigh new evidence against a stated claim | 0 | 0 | 0 |
| 25 | INF.4 | Information and Ideas | Inferences | Generalize from specific cases | 0 | 0 | 0 |
| 26 | INF.5 | Information and Ideas | Inferences | Infer a person's view or motive | 0 | 0 | 0 |
| 27 | INFS.3 | Problem Solving and Data Analysis | Inference from Sample Statistics and Margin of Error | What the sampling design supports | 0 | 0 | 0 |
| 28 | LAT.3 | Geometry and Trigonometry | Lines, Angles, and Triangles | Isosceles and equilateral triangles | 0 | 0 | 0 |
| 29 | LE2.1 | Algebra | Linear Equations in Two Variables | Model a situation with a linear equation | 0 | 0 | 0 |
| 30 | LE2.2 | Algebra | Linear Equations in Two Variables | Interpret parts of a contextual linear equation or graph | 0 | 0 | 0 |
| 31 | LE2.3 | Algebra | Linear Equations in Two Variables | Find one quantity in context when the other is known | 0 | 0 | 0 |
| 32 | PCT.1 | Problem Solving and Data Analysis | Percentages | Percent of a quantity | 0 | 0 | 0 |
| 33 | PCT.13 | Problem Solving and Data Analysis | Percentages | Chained Percent Relationships | 0 | 0 | 0 |
| 34 | PCT.2 | Problem Solving and Data Analysis | Percentages | Unknown percent or unknown whole | 0 | 0 | 0 |
| 35 | PRB.3 | Problem Solving and Data Analysis | Probability and Conditional Probability | Find a count from a probability or from totals | 0 | 0 | 0 |
| 36 | PRB.7 | Problem Solving and Data Analysis | Probability and Conditional Probability | Find Count from Probability | 0 | 0 | 0 |
| 37 | RAT.1 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Unit conversion (linear units) | 0 | 0 | 0 |
| 38 | RAT.11 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Proportional Expression Construction | 0 | 0 | 0 |
| 39 | RAT.2 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Ratios and proportional scaling | 0 | 0 | 0 |
| 40 | RAT.4 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Density and per-area/per-volume rates | 0 | 0 | 0 |
| 41 | RAT.5 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Converting squared or cubed units | 0 | 0 | 0 |
| 42 | RAT.6 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Single-Step Unit Conversion | 0 | 0 | 0 |
| 43 | RAT.7 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Multi-Step Unit Conversion | 0 | 0 | 0 |
| 44 | RAT.8 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Squared and Cubed Unit Conversion | 0 | 0 | 0 |
| 45 | RS.1 | Expression of Ideas | Rhetorical Synthesis | Compare or contrast two or more items | 0 | 0 | 0 |
| 46 | RS.2 | Expression of Ideas | Rhetorical Synthesis | Fit the sentence to a stated audience | 0 | 0 | 0 |
| 47 | RS.3 | Expression of Ideas | Rhetorical Synthesis | Report a research study | 0 | 0 | 0 |
| 48 | RS.4 | Expression of Ideas | Rhetorical Synthesis | Generalize, define, or give an example | 0 | 0 | 0 |
| 49 | RS.5 | Expression of Ideas | Rhetorical Synthesis | Focus on one named feature of one subject | 0 | 0 | 0 |
| 50 | TRN.2 | Expression of Ideas | Transitions | Cause, result and purpose | 0 | 0 | 0 |
| 51 | TRN.5 | Expression of Ideas | Transitions | Time, sequence and place | 0 | 0 | 0 |
| 52 | TVD.11 | Problem Solving and Data Analysis | Two-Variable Data: Models and Scatterplots | Compute Average Rate of Change Between Intervals | 0 | 0 | 0 |
| 53 | TVD.7 | Problem Solving and Data Analysis | Two-Variable Data: Models and Scatterplots | Make Predictions Using a Line or Curve of Best Fit | 0 | 0 | 0 |
| 54 | TVD.8 | Problem Solving and Data Analysis | Two-Variable Data: Models and Scatterplots | Estimate the Slope of a Line of Best Fit | 0 | 0 | 0 |
| 55 | TVD.9 | Problem Solving and Data Analysis | Two-Variable Data: Models and Scatterplots | Select or Write the Equation of a Line of Best Fit | 0 | 0 | 0 |
| 56 | WIC.3 | Craft and Structure | Words in Context | Inferred-relationship blank | 0 | 0 | 0 |

## 1. Per sub-skill coverage (after apply, with before for comparison)

Flags: ZERO = 0 approved segments after apply; LOW = 1-2. Channels are counted after trimming whitespace and ignoring case.

| sub_skill_id | Domain | skill_code | Name | Segs before | Segs after | Videos after | Channels after | Tagged Qs | Flag |
|---|---|---|---|---|---|---|---|---|---|
| EE.1 | Advanced Math | Equivalent Expressions | Add, subtract, and combine like terms | 0 | 0 | 0 | 0 | 88 | ZERO |
| EE.2 | Advanced Math | Equivalent Expressions | Expand and multiply | 4 | 5 | 4 | 2 | 105 |  |
| EE.3 | Advanced Math | Equivalent Expressions | Factor polynomials (and rewrite quadratic forms) | 21 | 25 | 12 | 6 | 162 |  |
| EE.4 | Advanced Math | Equivalent Expressions | Exponents and radicals | 4 | 8 | 5 | 4 | 56 |  |
| EE.5 | Advanced Math | Equivalent Expressions | Rational expressions | 8 | 9 | 5 | 4 | 156 |  |
| EE.6 | Advanced Math | Equivalent Expressions | Divide polynomials by long division | 2 | 2 | 1 | 1 | 12 | LOW(<=2) |
| NLE.1 | Advanced Math | Nonlinear Equations in One Variable and Systems of Equations in Two Variables | Rearrange a formula to isolate a variable | 1 | 1 | 1 | 1 | 0 | LOW(<=2) |
| NLE.2 | Advanced Math | Nonlinear Equations in One Variable and Systems of Equations in Two Variables | Solve a quadratic or polynomial equation in one variable | 8 | 10 | 9 | 4 | 224 |  |
| NLE.3 | Advanced Math | Nonlinear Equations in One Variable and Systems of Equations in Two Variables | Solve an absolute value, radical, or rational equation in one variable | 13 | 14 | 8 | 5 | 53 |  |
| NLE.4 | Advanced Math | Nonlinear Equations in One Variable and Systems of Equations in Two Variables | Determine the number of real solutions | 6 | 9 | 8 | 5 | 88 |  |
| NLE.5 | Advanced Math | Nonlinear Equations in One Variable and Systems of Equations in Two Variables | Solve a system of a linear and a nonlinear equation | 5 | 7 | 6 | 3 | 106 |  |
| NLF.1 | Advanced Math | Nonlinear Functions | Function notation: evaluate, read and solve input-output | 13 | 16 | 11 | 5 | 128 |  |
| NLF.2 | Advanced Math | Nonlinear Functions | Interpret a nonlinear function in context | 2 | 2 | 2 | 2 | 12 | LOW(<=2) |
| NLF.3 | Advanced Math | Nonlinear Functions | Exponential growth and decay structure | 2 | 5 | 3 | 2 | 64 |  |
| NLF.4 | Advanced Math | Nonlinear Functions | Quadratic and polynomial structure and models | 17 | 23 | 13 | 7 | 192 |  |
| NLF.5 | Advanced Math | Nonlinear Functions | Transformations of functions | 13 | 13 | 8 | 3 | 27 |  |
| LE1.1 | Algebra | Linear Equations in One Variable | Solve a linear equation for its variable | 1 | 2 | 2 | 2 | 233 | LOW(<=2) |
| LE1.2 | Algebra | Linear Equations in One Variable | Find the value of an expression or an equivalent equation without stopping at the variable | 0 | 0 | 0 | 0 | 5 | ZERO |
| LE1.3 | Algebra | Linear Equations in One Variable | Translate between a context and a linear equation or expression | 1 | 1 | 1 | 1 | 0 | LOW(<=2) |
| LE1.4 | Algebra | Linear Equations in One Variable | Solve a context problem for an unknown quantity | 2 | 2 | 1 | 1 | 45 | LOW(<=2) |
| LE1.5 | Algebra | Linear Equations in One Variable | Determine the number of solutions or the constant that sets it | 2 | 3 | 3 | 3 | 15 |  |
| LE2.1 | Algebra | Linear Equations in Two Variables | Model a situation with a linear equation | 0 | 0 | 0 | 0 | 0 | ZERO |
| LE2.2 | Algebra | Linear Equations in Two Variables | Interpret parts of a contextual linear equation or graph | 0 | 0 | 0 | 0 | 0 | ZERO |
| LE2.3 | Algebra | Linear Equations in Two Variables | Find one quantity in context when the other is known | 0 | 0 | 0 | 0 | 0 | ZERO |
| LE2.4 | Algebra | Linear Equations in Two Variables | Connect a line's equation, graph, table, slope and intercepts | 8 | 12 | 8 | 3 | 300 |  |
| LE2.5 | Algebra | Linear Equations in Two Variables | Relate a second line: parallel, perpendicular or translated | 3 | 8 | 6 | 3 | 93 |  |
| LF.1 | Algebra | Linear Functions | Evaluate or invert a given linear rule | 2 | 2 | 1 | 1 | 198 | LOW(<=2) |
| LF.2 | Algebra | Linear Functions | Build a linear model from a verbal description | 0 | 0 | 0 | 0 | 41 | ZERO |
| LF.3 | Algebra | Linear Functions | Determine a linear function from points, a table, values, or slope | 3 | 3 | 3 | 2 | 130 |  |
| LF.4 | Algebra | Linear Functions | Interpret slope, intercept, and constants in context | 0 | 0 | 0 | 0 | 36 | ZERO |
| LF.5 | Algebra | Linear Functions | Intercepts and graph features of a linear function | 2 | 4 | 3 | 3 | 16 |  |
| LI.1 | Algebra | Linear Inequalities in One or Two Variables | Model a situation with a one-sided inequality or system | 2 | 3 | 2 | 2 | 160 |  |
| LI.2 | Algebra | Linear Inequalities in One or Two Variables | Solve for a boundary value (maximum / minimum) | 1 | 2 | 2 | 2 | 187 | LOW(<=2) |
| LI.3 | Algebra | Linear Inequalities in One or Two Variables | Two-sided ranges (compound inequalities) | 1 | 1 | 1 | 1 | 21 | LOW(<=2) |
| LI.4 | Algebra | Linear Inequalities in One or Two Variables | Test solutions of a given inequality or system | 5 | 5 | 3 | 3 | 28 |  |
| LI.5 | Algebra | Linear Inequalities in One or Two Variables | Read an inequality from its graph | 0 | 1 | 1 | 1 | 0 | LOW(<=2) |
| LI.6 | Algebra | Linear Inequalities in One or Two Variables | Determine a parameter for no-solution / all-solution conditions | 0 | 0 | 0 | 0 | 2 | ZERO |
| SYS.1 | Algebra | Systems of Two Linear Equations in Two Variables | Solve a system algebraically | 2 | 3 | 3 | 3 | 106 |  |
| SYS.2 | Algebra | Systems of Two Linear Equations in Two Variables | Value of an expression from a system | 3 | 3 | 2 | 2 | 46 |  |
| SYS.3 | Algebra | Systems of Two Linear Equations in Two Variables | Number of solutions and conditions on constants | 7 | 7 | 4 | 1 | 77 |  |
| SYS.4 | Algebra | Systems of Two Linear Equations in Two Variables | Model a context with a system | 2 | 3 | 1 | 1 | 70 |  |
| SYS.5 | Algebra | Systems of Two Linear Equations in Two Variables | Solutions shown on a graph | 2 | 3 | 1 | 1 | 0 |  |
| AV.1 | Geometry and Trigonometry | Area and Volume | Polygon perimeter and area | 3 | 4 | 3 | 2 | 0 |  |
| AV.2 | Geometry and Trigonometry | Area and Volume | Circle area and circumference | 2 | 2 | 2 | 1 | 0 | LOW(<=2) |
| AV.3 | Geometry and Trigonometry | Area and Volume | Volume of solids | 5 | 6 | 3 | 3 | 0 |  |
| AV.4 | Geometry and Trigonometry | Area and Volume | Surface area of solids | 1 | 1 | 1 | 1 | 0 | LOW(<=2) |
| AV.5 | Geometry and Trigonometry | Area and Volume | Similarity and scaling between figures | 0 | 1 | 1 | 1 | 0 | LOW(<=2) |
| CIR1 | Geometry and Trigonometry | Circles | Circle equation: center and radius | 6 | 7 | 5 | 4 | 0 |  |
| CIR2 | Geometry and Trigonometry | Circles | Points and lines relative to a circle in the xy-plane | 2 | 2 | 2 | 1 | 0 | LOW(<=2) |
| CIR3 | Geometry and Trigonometry | Circles | Arcs, central angles and circumference | 1 | 4 | 3 | 2 | 0 |  |
| CIR4 | Geometry and Trigonometry | Circles | Radius-built triangles and tangent segments | 1 | 3 | 2 | 1 | 0 |  |
| CIR5 | Geometry and Trigonometry | Circles | Radian measure and the unit circle | 0 | 2 | 2 | 2 | 0 | LOW(<=2) |
| LAT.1 | Geometry and Trigonometry | Lines, Angles, and Triangles | Angle relationships at intersecting and parallel lines | 0 | 4 | 3 | 2 | 0 |  |
| LAT.2 | Geometry and Trigonometry | Lines, Angles, and Triangles | Triangle angle sum and exterior angles | 1 | 1 | 1 | 1 | 0 | LOW(<=2) |
| LAT.3 | Geometry and Trigonometry | Lines, Angles, and Triangles | Isosceles and equilateral triangles | 0 | 0 | 0 | 0 | 0 | ZERO |
| LAT.4 | Geometry and Trigonometry | Lines, Angles, and Triangles | Congruence and similarity: correspondence, criteria, and angle preservation | 2 | 4 | 3 | 2 | 0 |  |
| LAT.5 | Geometry and Trigonometry | Lines, Angles, and Triangles | Similar figures: proportional side lengths | 0 | 1 | 1 | 1 | 0 | LOW(<=2) |
| RTT1 | Geometry and Trigonometry | Right Triangles and Trigonometry | Pythagorean theorem: missing side | 3 | 9 | 7 | 3 | 0 |  |
| RTT2 | Geometry and Trigonometry | Right Triangles and Trigonometry | Special right triangles (45-45-90, 30-60-90) | 1 | 3 | 3 | 2 | 0 |  |
| RTT3 | Geometry and Trigonometry | Right Triangles and Trigonometry | Right-triangle trig ratios (SOH-CAH-TOA) | 2 | 4 | 3 | 3 | 0 |  |
| RTT4 | Geometry and Trigonometry | Right Triangles and Trigonometry | Trig-ratio relationships: complements and similarity | 0 | 3 | 3 | 2 | 0 |  |
| ESC.1 | Problem Solving and Data Analysis | Evaluating Statistical Claims: Observational Studies and Experiments | Determining Generalization Scope | 0 | 3 | 2 | 2 | 0 |  |
| ESC.2 | Problem Solving and Data Analysis | Evaluating Statistical Claims: Observational Studies and Experiments | Identifying Sampling Bias | 0 | 6 | 3 | 3 | 0 |  |
| ESC.3 | Problem Solving and Data Analysis | Evaluating Statistical Claims: Observational Studies and Experiments | Understanding Sample Variability | 0 | 0 | 0 | 0 | 0 | ZERO |
| ESC1 | Problem Solving and Data Analysis | Evaluating Statistical Claims: Observational Studies and Experiments | Scope of generalization: the largest population the results apply to | 2 | 3 | 2 | 2 | 0 |  |
| ESC2 | Problem Solving and Data Analysis | Evaluating Statistical Claims: Observational Studies and Experiments | Detect a biased (non-representative) sample | 5 | 6 | 3 | 3 | 0 |  |
| ESC3 | Problem Solving and Data Analysis | Evaluating Statistical Claims: Observational Studies and Experiments | Sampling variability: a sample result is not a certainty | 0 | 0 | 0 | 0 | 0 | ZERO |
| INFS.1 | Problem Solving and Data Analysis | Inference from Sample Statistics and Margin of Error | Estimate a population count from a sample | 4 | 4 | 2 | 2 | 0 |  |
| INFS.2 | Problem Solving and Data Analysis | Inference from Sample Statistics and Margin of Error | Interpret an estimate with a margin of error | 1 | 1 | 1 | 1 | 0 | LOW(<=2) |
| INFS.3 | Problem Solving and Data Analysis | Inference from Sample Statistics and Margin of Error | What the sampling design supports | 0 | 0 | 0 | 0 | 0 | ZERO |
| INFS.4 | Problem Solving and Data Analysis | Inference from Sample Statistics and Margin of Error | Interpreting Margin of Error | 0 | 1 | 1 | 1 | 0 | LOW(<=2) |
| INFS.5 | Problem Solving and Data Analysis | Inference from Sample Statistics and Margin of Error | Estimating Population Values from Samples | 0 | 4 | 2 | 2 | 0 |  |
| OVD.1 | Problem Solving and Data Analysis | One-Variable Data: Distributions and Measures of Center and Spread | Read and interpret a data display | 4 | 4 | 3 | 2 | 0 |  |
| OVD.10 | Problem Solving and Data Analysis | One-Variable Data: Distributions and Measures of Center and Spread | Compare or Relate Measures of Center and Spread | 0 | 0 | 0 | 0 | 5 | ZERO |
| OVD.11 | Problem Solving and Data Analysis | One-Variable Data: Distributions and Measures of Center and Spread | Effect of Data Changes on Statistics | 0 | 1 | 1 | 1 | 83 | LOW(<=2) |
| OVD.12 | Problem Solving and Data Analysis | One-Variable Data: Distributions and Measures of Center and Spread | Solve for an Unknown Using the Mean (Including Weighted Mean) | 0 | 1 | 1 | 1 | 60 | LOW(<=2) |
| OVD.13 | Problem Solving and Data Analysis | One-Variable Data: Distributions and Measures of Center and Spread | Compare Standard Deviations from Distributions | 0 | 1 | 1 | 1 | 5 | LOW(<=2) |
| OVD.2 | Problem Solving and Data Analysis | One-Variable Data: Distributions and Measures of Center and Spread | Find a measure of center from data | 3 | 5 | 4 | 4 | 0 |  |
| OVD.3 | Problem Solving and Data Analysis | One-Variable Data: Distributions and Measures of Center and Spread | Measures of spread: range and standard deviation | 1 | 1 | 1 | 1 | 0 | LOW(<=2) |
| OVD.4 | Problem Solving and Data Analysis | One-Variable Data: Distributions and Measures of Center and Spread | Use the mean-total relationship | 1 | 1 | 1 | 1 | 0 | LOW(<=2) |
| OVD.5 | Problem Solving and Data Analysis | One-Variable Data: Distributions and Measures of Center and Spread | Compare measures across data sets or after a change | 0 | 1 | 1 | 1 | 0 | LOW(<=2) |
| OVD.6 | Problem Solving and Data Analysis | One-Variable Data: Distributions and Measures of Center and Spread | Read or Interpret a Data Display | 0 | 4 | 3 | 2 | 8 |  |
| OVD.7 | Problem Solving and Data Analysis | One-Variable Data: Distributions and Measures of Center and Spread | Compute the Mean | 0 | 1 | 1 | 1 | 14 | LOW(<=2) |
| OVD.8 | Problem Solving and Data Analysis | One-Variable Data: Distributions and Measures of Center and Spread | Find the Median | 0 | 1 | 1 | 1 | 65 | LOW(<=2) |
| OVD.9 | Problem Solving and Data Analysis | One-Variable Data: Distributions and Measures of Center and Spread | Compute the Range | 0 | 0 | 0 | 0 | 20 | ZERO |
| PCT.1 | Problem Solving and Data Analysis | Percentages | Percent of a quantity | 0 | 0 | 0 | 0 | 0 | ZERO |
| PCT.10 | Problem Solving and Data Analysis | Percentages | Percent as Algebraic Expression | 0 | 2 | 1 | 1 | 0 | LOW(<=2) |
| PCT.11 | Problem Solving and Data Analysis | Percentages | Interpret Percent Expression | 0 | 1 | 1 | 1 | 0 | LOW(<=2) |
| PCT.12 | Problem Solving and Data Analysis | Percentages | Successive and Exponential Percent Changes | 0 | 4 | 2 | 2 | 106 |  |
| PCT.13 | Problem Solving and Data Analysis | Percentages | Chained Percent Relationships | 0 | 0 | 0 | 0 | 0 | ZERO |
| PCT.14 | Problem Solving and Data Analysis | Percentages | Compound Category Percentages | 0 | 0 | 0 | 0 | 15 | ZERO |
| PCT.15 | Problem Solving and Data Analysis | Percentages | Percent from Data | 0 | 0 | 0 | 0 | 2 | ZERO |
| PCT.2 | Problem Solving and Data Analysis | Percentages | Unknown percent or unknown whole | 0 | 0 | 0 | 0 | 0 | ZERO |
| PCT.3 | Problem Solving and Data Analysis | Percentages | Apply or undo a single percent increase or decrease | 4 | 6 | 2 | 2 | 0 |  |
| PCT.4 | Problem Solving and Data Analysis | Percentages | Percent change between two values | 2 | 2 | 2 | 2 | 0 | LOW(<=2) |
| PCT.5 | Problem Solving and Data Analysis | Percentages | Chained percents (percent of a percent result) | 3 | 4 | 2 | 2 | 0 |  |
| PCT.6 | Problem Solving and Data Analysis | Percentages | Find Part, Percent, or Whole | 0 | 0 | 0 | 0 | 20 | ZERO |
| PCT.7 | Problem Solving and Data Analysis | Percentages | Apply Percent Increase or Decrease | 0 | 2 | 2 | 2 | 58 | LOW(<=2) |
| PCT.8 | Problem Solving and Data Analysis | Percentages | Percent Change Calculation | 0 | 1 | 1 | 1 | 32 | LOW(<=2) |
| PCT.9 | Problem Solving and Data Analysis | Percentages | Reverse Percent (Find Original Before Change) | 0 | 3 | 2 | 2 | 48 |  |
| PRB.1 | Problem Solving and Data Analysis | Probability and Conditional Probability | Probability of an event in the whole group | 1 | 2 | 1 | 1 | 0 | LOW(<=2) |
| PRB.2 | Problem Solving and Data Analysis | Probability and Conditional Probability | Conditional probability (restricted sample space) | 3 | 4 | 2 | 2 | 0 |  |
| PRB.3 | Problem Solving and Data Analysis | Probability and Conditional Probability | Find a count from a probability or from totals | 0 | 0 | 0 | 0 | 0 | ZERO |
| PRB.4 | Problem Solving and Data Analysis | Probability and Conditional Probability | Complement and exclusion events | 1 | 1 | 1 | 1 | 0 | LOW(<=2) |
| PRB.5 | Problem Solving and Data Analysis | Probability and Conditional Probability | Whole-Group Probability | 0 | 2 | 1 | 1 | 105 | LOW(<=2) |
| PRB.6 | Problem Solving and Data Analysis | Probability and Conditional Probability | Conditional Probability | 0 | 4 | 2 | 2 | 136 |  |
| PRB.7 | Problem Solving and Data Analysis | Probability and Conditional Probability | Find Count from Probability | 0 | 0 | 0 | 0 | 0 | ZERO |
| RAT.1 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Unit conversion (linear units) | 0 | 0 | 0 | 0 | 0 | ZERO |
| RAT.10 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Proportion Setup and Solve | 0 | 0 | 0 | 0 | 91 | ZERO |
| RAT.11 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Proportional Expression Construction | 0 | 0 | 0 | 0 | 0 | ZERO |
| RAT.12 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Ratio Interpretation and Simplification | 0 | 0 | 0 | 0 | 2 | ZERO |
| RAT.13 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Density and Derived-Rate Calculations | 0 | 0 | 0 | 0 | 1 | ZERO |
| RAT.14 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Multi-Step Rate and Proportion Problems | 0 | 0 | 0 | 0 | 86 | ZERO |
| RAT.2 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Ratios and proportional scaling | 0 | 0 | 0 | 0 | 0 | ZERO |
| RAT.3 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Rates between different quantities | 0 | 1 | 1 | 1 | 0 | LOW(<=2) |
| RAT.4 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Density and per-area/per-volume rates | 0 | 0 | 0 | 0 | 0 | ZERO |
| RAT.5 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Converting squared or cubed units | 0 | 0 | 0 | 0 | 0 | ZERO |
| RAT.6 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Single-Step Unit Conversion | 0 | 0 | 0 | 0 | 0 | ZERO |
| RAT.7 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Multi-Step Unit Conversion | 0 | 0 | 0 | 0 | 0 | ZERO |
| RAT.8 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Squared and Cubed Unit Conversion | 0 | 0 | 0 | 0 | 0 | ZERO |
| RAT.9 | Problem Solving and Data Analysis | Ratios, Rates, Proportional Relationships, and Units | Rate Application | 0 | 1 | 1 | 1 | 76 | LOW(<=2) |
| TVD.1 | Problem Solving and Data Analysis | Two-Variable Data: Models and Scatterplots | Read data and changes from a graph | 2 | 2 | 2 | 1 | 0 | LOW(<=2) |
| TVD.10 | Problem Solving and Data Analysis | Two-Variable Data: Models and Scatterplots | Identify the Appropriate Model Type | 0 | 1 | 1 | 1 | 0 | LOW(<=2) |
| TVD.11 | Problem Solving and Data Analysis | Two-Variable Data: Models and Scatterplots | Compute Average Rate of Change Between Intervals | 0 | 0 | 0 | 0 | 0 | ZERO |
| TVD.12 | Problem Solving and Data Analysis | Two-Variable Data: Models and Scatterplots | Evaluate Residuals and Deviations from a Model | 0 | 4 | 2 | 2 | 0 |  |
| TVD.13 | Problem Solving and Data Analysis | Two-Variable Data: Models and Scatterplots | Interpret Slope or Intercept in Real-World Context | 0 | 4 | 1 | 1 | 0 |  |
| TVD.14 | Problem Solving and Data Analysis | Two-Variable Data: Models and Scatterplots | Select or Determine a Nonlinear Model Equation | 0 | 2 | 2 | 2 | 0 | LOW(<=2) |
| TVD.2 | Problem Solving and Data Analysis | Two-Variable Data: Models and Scatterplots | Predict with a fitted model and compare data to it | 4 | 4 | 2 | 2 | 0 |  |
| TVD.3 | Problem Solving and Data Analysis | Two-Variable Data: Models and Scatterplots | Linear model: direction, slope, intercept, equation, interpretation | 5 | 5 | 2 | 2 | 0 |  |
| TVD.4 | Problem Solving and Data Analysis | Two-Variable Data: Models and Scatterplots | Nonlinear model fitted to a scatterplot | 1 | 1 | 1 | 1 | 0 | LOW(<=2) |
| TVD.5 | Problem Solving and Data Analysis | Two-Variable Data: Models and Scatterplots | Classify linear vs exponential relationships | 0 | 1 | 1 | 1 | 0 | LOW(<=2) |
| TVD.6 | Problem Solving and Data Analysis | Two-Variable Data: Models and Scatterplots | Read Values from Graphs and Scatterplots | 0 | 2 | 2 | 1 | 0 | LOW(<=2) |
| TVD.7 | Problem Solving and Data Analysis | Two-Variable Data: Models and Scatterplots | Make Predictions Using a Line or Curve of Best Fit | 0 | 0 | 0 | 0 | 0 | ZERO |
| TVD.8 | Problem Solving and Data Analysis | Two-Variable Data: Models and Scatterplots | Estimate the Slope of a Line of Best Fit | 0 | 0 | 0 | 0 | 0 | ZERO |
| TVD.9 | Problem Solving and Data Analysis | Two-Variable Data: Models and Scatterplots | Select or Write the Equation of a Line of Best Fit | 0 | 0 | 0 | 0 | 0 | ZERO |
| CTC.1 | Craft and Structure | Cross-Text Connections | Predict a rebuttal | 4 | 4 | 3 | 2 | 0 |  |
| CTC.2 | Craft and Structure | Cross-Text Connections | Predict a qualified (yes-but) response | 2 | 2 | 2 | 2 | 0 | LOW(<=2) |
| CTC.3 | Craft and Structure | Cross-Text Connections | Predict a supportive or applied response | 0 | 0 | 0 | 0 | 0 | ZERO |
| CTC.4 | Craft and Structure | Cross-Text Connections | Identify common ground | 1 | 1 | 1 | 1 | 0 | LOW(<=2) |
| CTC.5 | Craft and Structure | Cross-Text Connections | Describe the difference or relationship between the texts | 0 | 1 | 1 | 1 | 0 | LOW(<=2) |
| TSP.1 | Craft and Structure | Text Structure and Purpose | Main purpose of an informational text | 2 | 2 | 1 | 1 | 0 | LOW(<=2) |
| TSP.2 | Craft and Structure | Text Structure and Purpose | Overall structure of a text | 7 | 7 | 4 | 3 | 0 |  |
| TSP.3 | Craft and Structure | Text Structure and Purpose | Function of a part in an informational text | 5 | 5 | 4 | 3 | 0 |  |
| TSP.4 | Craft and Structure | Text Structure and Purpose | Purpose or function in a literary text | 2 | 2 | 1 | 1 | 0 | LOW(<=2) |
| WIC.1 | Craft and Structure | Words in Context | Restated-meaning blank | 3 | 3 | 2 | 2 | 0 |  |
| WIC.2 | Craft and Structure | Words in Context | Contrasted-meaning blank | 1 | 1 | 1 | 1 | 0 | LOW(<=2) |
| WIC.3 | Craft and Structure | Words in Context | Inferred-relationship blank | 0 | 0 | 0 | 0 | 0 | ZERO |
| WIC.4 | Craft and Structure | Words in Context | Given word's meaning in context | 1 | 1 | 1 | 1 | 0 | LOW(<=2) |
| RS.1 | Expression of Ideas | Rhetorical Synthesis | Compare or contrast two or more items | 0 | 0 | 0 | 0 | 0 | ZERO |
| RS.2 | Expression of Ideas | Rhetorical Synthesis | Fit the sentence to a stated audience | 0 | 0 | 0 | 0 | 0 | ZERO |
| RS.3 | Expression of Ideas | Rhetorical Synthesis | Report a research study | 0 | 0 | 0 | 0 | 0 | ZERO |
| RS.4 | Expression of Ideas | Rhetorical Synthesis | Generalize, define, or give an example | 0 | 0 | 0 | 0 | 0 | ZERO |
| RS.5 | Expression of Ideas | Rhetorical Synthesis | Focus on one named feature of one subject | 0 | 0 | 0 | 0 | 0 | ZERO |
| TRN.1 | Expression of Ideas | Transitions | Contrast and concession | 4 | 4 | 3 | 3 | 0 |  |
| TRN.2 | Expression of Ideas | Transitions | Cause, result and purpose | 0 | 0 | 0 | 0 | 0 | ZERO |
| TRN.3 | Expression of Ideas | Transitions | Addition and similarity | 2 | 2 | 2 | 2 | 0 | LOW(<=2) |
| TRN.4 | Expression of Ideas | Transitions | Example, specification, restatement and emphasis | 1 | 1 | 1 | 1 | 0 | LOW(<=2) |
| TRN.5 | Expression of Ideas | Transitions | Time, sequence and place | 0 | 0 | 0 | 0 | 0 | ZERO |
| CID.1 | Information and Ideas | Central Ideas and Details | Identify the central idea of the whole text | 1 | 1 | 1 | 1 | 0 | LOW(<=2) |
| CID.2 | Information and Ideas | Central Ideas and Details | Retrieve an explicitly stated key detail | 0 | 0 | 0 | 0 | 0 | ZERO |
| CID.3 | Information and Ideas | Central Ideas and Details | Draw a conclusion the details support but do not state | 0 | 0 | 0 | 0 | 0 | ZERO |
| CID.4 | Information and Ideas | Central Ideas and Details | Characterize a person's feelings, traits or attitudes in a literary text | 0 | 0 | 0 | 0 | 0 | ZERO |
| COE.1 | Information and Ideas | Command of Evidence | Read data accurately from a table or graph | 0 | 0 | 0 | 0 | 0 | ZERO |
| COE.2 | Information and Ideas | Command of Evidence | Use data as evidence for a claim | 12 | 12 | 8 | 4 | 0 |  |
| COE.3 | Information and Ideas | Command of Evidence | Choose a finding or source statement that supports or weakens a claim | 8 | 8 | 7 | 3 | 0 |  |
| COE.4 | Information and Ideas | Command of Evidence | Choose a quotation from a named work that illustrates a claim about it | 2 | 2 | 2 | 2 | 0 | LOW(<=2) |
| INF.1 | Information and Ideas | Inferences | Draw a conclusion from a comparison | 0 | 0 | 0 | 0 | 0 | ZERO |
| INF.2 | Information and Ideas | Inferences | Chain stated premises to a consequence | 0 | 0 | 0 | 0 | 0 | ZERO |
| INF.3 | Information and Ideas | Inferences | Weigh new evidence against a stated claim | 0 | 0 | 0 | 0 | 0 | ZERO |
| INF.4 | Information and Ideas | Inferences | Generalize from specific cases | 0 | 0 | 0 | 0 | 0 | ZERO |
| INF.5 | Information and Ideas | Inferences | Infer a person's view or motive | 0 | 0 | 0 | 0 | 0 | ZERO |
| BND.1 | Standard English Conventions | Boundaries | Linking independent clauses | 6 | 15 | 8 | 4 | 0 |  |
| BND.2 | Standard English Conventions | Boundaries | Setting off supplements and introductory elements | 6 | 10 | 7 | 3 | 0 |  |
| BND.3 | Standard English Conventions | Boundaries | No punctuation inside an integrated structure | 2 | 2 | 2 | 2 | 0 | LOW(<=2) |
| BND.4 | Standard English Conventions | Boundaries | Colons and series punctuation | 1 | 8 | 6 | 4 | 0 |  |
| BND.5 | Standard English Conventions | Boundaries | End-of-sentence punctuation (direct vs indirect question) | 0 | 1 | 1 | 1 | 0 | LOW(<=2) |
| FSS.1 | Standard English Conventions | Form, Structure, and Sense | Subject-verb agreement | 14 | 18 | 6 | 4 | 0 |  |
| FSS.2 | Standard English Conventions | Form, Structure, and Sense | Verb tense and aspect | 8 | 11 | 4 | 3 | 0 |  |
| FSS.3 | Standard English Conventions | Form, Structure, and Sense | Finite vs. nonfinite verb forms | 3 | 4 | 2 | 2 | 0 |  |
| FSS.4 | Standard English Conventions | Form, Structure, and Sense | Number and possession in nouns, pronouns, and determiners | 3 | 6 | 3 | 2 | 0 |  |
| FSS.5 | Standard English Conventions | Form, Structure, and Sense | Subject-modifier placement | 4 | 4 | 2 | 2 | 0 |  |

## 2. Per cluster coverage (after apply)

Clusters with 0 approved segments: 111 before -> 80 after. Clusters with tagged questions but 0 segments after: 36.

| cluster_id | Display name | Family | Segs before | Segs after | Tagged Qs |
|---|---|---|---|---|---|
| CL.0016 | clear fractions by multiplying by the common denominator | by_hand_doing | 0 | 0 | 169 |
| CL.0003 | add or subtract equations to eliminate a variable | by_hand_doing | 0 | 0 | 159 |
| CL.0233 | Cross-Multiplication | by_hand_doing | 0 | 0 | 101 |
| CL.0232 | Direct Factor Application | by_hand_doing | 0 | 0 | 95 |
| CL.0237 | Multi-Operation Rate-Proportion Composition | by_hand_doing | 0 | 0 | 92 |
| CL.0257 | Order-and-Locate (Median Finding) | by_hand_doing | 0 | 0 | 86 |
| CL.0009 | check a point in the equation or inequality | by_hand_doing | 0 | 0 | 65 |
| CL.0123 | use total = mean x count | by_hand_doing | 0 | 0 | 65 |
| CL.0259 | Algebraic Mean Inversion | by_hand_doing | 0 | 0 | 59 |
| CL.0083 | scale both quantities by the same factor | by_hand_doing | 0 | 0 | 53 |
| CL.0183 | see that extreme values pull the mean, not the median | by_hand_recognizing | 0 | 0 | 53 |
| CL.0258 | Max-Minus-Min (Range Computation) | by_hand_doing | 0 | 0 | 33 |
| CL.0256 | Sum-and-Divide (Mean Computation) | by_hand_doing | 0 | 0 | 22 |
| CL.0165 | recognize a perfect-square trinomial | by_hand_recognizing | 0 | 0 | 21 |
| CL.0005 | apply an operation to every part of a compound inequality | by_hand_doing | 0 | 0 | 19 |
| CL.0245 | Nested Subset Computation | by_hand_doing | 0 | 0 | 18 |
| CL.0168 | recognize a square cannot equal a negative | by_hand_recognizing | 0 | 0 | 14 |
| CL.0175 | recognize that a constant shift preserves spread | by_hand_recognizing | 0 | 0 | 14 |
| CL.0238 | Proportion Setup and Solve | by_hand_doing | 0 | 0 | 14 |
| CL.0253 | Read Two-Way Table Marginals | by_hand_doing | 0 | 0 | 9 |
| CL.0254 | Read Two-Way Table Cell for Joint Probability | by_hand_doing | 0 | 0 | 9 |
| CL.0260 | Weighted-Average Combination | by_hand_doing | 0 | 0 | 9 |
| CL.0263 | Statistic Identification and Selection | by_hand_doing | 0 | 0 | 9 |
| CL.0124 | work backward from a part to the whole | by_hand_doing | 0 | 0 | 7 |
| CL.0105 | treat a ratio as side lengths with a common multiplier | by_hand_doing | 0 | 0 | 6 |
| CL.0088 | simplify a radical | by_hand_doing | 0 | 0 | 5 |
| CL.0234 | Ratio-to-Expression Translation | by_hand_doing | 0 | 0 | 4 |
| CL.0261 | Distribution-Shape Reasoning | by_hand_doing | 0 | 0 | 4 |
| CL.0236 | Density Formula Application | by_hand_doing | 0 | 0 | 3 |
| CL.0021 | compute a frequency-weighted mean | by_hand_doing | 0 | 0 | 2 |
| CL.0050 | locate the median position in a frequency table | by_hand_doing | 0 | 0 | 2 |
| CL.0244 | Data Extraction Then Percent Computation | by_hand_doing | 0 | 0 | 2 |
| CL.0055 | match the function input to the given argument | by_hand_doing | 0 | 0 | 1 |
| CL.0166 | recognize a proportional relationship | by_hand_recognizing | 0 | 0 | 1 |
| CL.0235 | Conversion-Factor Chaining | by_hand_doing | 0 | 0 | 1 |
| CL.0251 | Algebraic Probability Equation | by_hand_doing | 0 | 0 | 1 |
| CL.0001 | account for a negation that reverses the meaning | by_hand_doing | 0 | 0 | 0 |
| CL.0011 | check that the second idea really follows from the first | by_hand_doing | 0 | 0 | 0 |
| CL.0013 | check whether the specific case fits the general rule | by_hand_doing | 0 | 0 | 0 |
| CL.0018 | combine two facts to reach a conclusion | by_hand_doing | 0 | 0 | 0 |
| CL.0042 | find the sentence that answers the question | by_hand_doing | 0 | 0 | 0 |
| CL.0046 | infer a feeling from a character's words and actions | by_hand_doing | 0 | 0 | 0 |
| CL.0069 | rationalize the denominator | by_hand_doing | 0 | 0 | 0 |
| CL.0070 | read a box plot's five-number summary | by_hand_doing | 0 | 0 | 0 |
| CL.0076 | reduce an angle by full rotations | by_hand_doing | 0 | 0 | 0 |
| CL.0082 | rule out an alternative explanation | by_hand_doing | 0 | 0 | 0 |
| CL.0092 | square or cube a conversion factor for area or volume units | by_hand_doing | 0 | 0 | 0 |
| CL.0093 | state what must be true for both facts to hold | by_hand_doing | 0 | 0 | 0 |
| CL.0102 | translate a circle by moving its center | by_hand_doing | 0 | 0 | 0 |
| CL.0103 | translate figurative language into plain meaning | by_hand_doing | 0 | 0 | 0 |
| CL.0111 | use interval endpoints to bound a statistic | by_hand_doing | 0 | 0 | 0 |
| CL.0114 | use the exterior angle theorem | by_hand_doing | 0 | 0 | 0 |
| CL.0136 | decompose a figure into simpler shapes | by_hand_recognizing | 0 | 0 | 0 |
| CL.0140 | find the cause-and-effect signal word | by_hand_recognizing | 0 | 0 | 0 |
| CL.0141 | find the claim the new sentence actually connects to | by_hand_recognizing | 0 | 0 | 0 |
| CL.0145 | follow a comparison word to the term being compared | by_hand_recognizing | 0 | 0 | 0 |
| CL.0146 | identify the base quantity (the 'of' or 'per' denominator) | by_hand_recognizing | 0 | 0 | 0 |
| CL.0149 | identify which clause a transition word belongs to | by_hand_recognizing | 0 | 0 | 0 |
| CL.0151 | judge what the audience already knows | by_hand_recognizing | 0 | 0 | 0 |
| CL.0169 | recognize all radii are equal | by_hand_recognizing | 0 | 0 | 0 |
| CL.0170 | recognize an isosceles triangle | by_hand_recognizing | 0 | 0 | 0 |
| CL.0178 | recognize the two acute-angle tangents are reciprocals | by_hand_recognizing | 0 | 0 | 0 |
| CL.0180 | recognize when evidence can't settle the question | by_hand_recognizing | 0 | 0 | 0 |
| CL.0191 | take an unusual transition at its literal meaning | by_hand_recognizing | 0 | 0 | 0 |
| CL.0192 | tell a direct question from a reported question | by_hand_recognizing | 0 | 0 | 0 |
| CL.0196 | tell describing from arguing | by_hand_recognizing | 0 | 0 | 0 |
| CL.0197 | tell evidence from interpretation | by_hand_recognizing | 0 | 0 | 0 |
| CL.0207 | use symmetry to locate the mean | by_hand_recognizing | 0 | 0 | 0 |
| CL.0243 | Transitive Substitution Across Percent Links | by_hand_doing | 0 | 0 | 0 |
| CL.0249 | Count Recovery from Probability | by_hand_doing | 0 | 0 | 0 |
| CL.0252 | Read One-Way Table and Compute Ratio | by_hand_doing | 0 | 0 | 0 |
| CL.0265 | Slope Computation (Rise over Run) | by_hand_doing | 0 | 0 | 0 |
| CL.0266 | Sign and Intercept Reasoning | by_hand_doing | 0 | 0 | 0 |
| CL.0267 | Pattern Recognition in Data (Differences vs. Ratios) | by_hand_doing | 0 | 0 | 0 |
| CL.0270 | Substitution and Evaluation | by_hand_doing | 0 | 0 | 0 |
| CL.0271 | Interval rate-of-change computation | by_hand_doing | 0 | 0 | 0 |
| CL.0273 | Compute sample statistic from raw data | by_hand_doing | 0 | 0 | 0 |
| CL.0276 | Distinguish population parameter from individual values | by_hand_doing | 0 | 0 | 0 |
| CL.0278 | Relate sample size to margin of error | by_hand_doing | 0 | 0 | 0 |
| CL.0282 | Recognize inherent uncertainty in sampling | by_hand_doing | 0 | 0 | 0 |
| CL.0047 | isolate the variable | by_hand_doing | 26 | 26 | 1291 |
| CL.0094 | substitute a value and evaluate | by_hand_doing | 23 | 24 | 448 |
| CL.0017 | combine like terms | by_hand_doing | 17 | 17 | 427 |
| CL.0060 | multiply a rate by the amount | by_hand_doing | 1 | 1 | 385 |
| CL.0034 | distribute over every term | by_hand_doing | 10 | 10 | 355 |
| CL.0104 | translate words into an equation or inequality | by_hand_doing | 16 | 17 | 300 |
| CL.0037 | factor a trinomial | by_hand_doing | 11 | 11 | 273 |
| CL.0128 | write y = mx + b from slope and a point | by_hand_doing | 2 | 4 | 251 |
| CL.0004 | add the parts to get the whole, or subtract to find a part | by_hand_doing | 8 | 8 | 250 |
| CL.0024 | compute slope from two points | by_hand_doing | 5 | 5 | 210 |
| CL.0095 | substitute an expression | by_hand_doing | 8 | 8 | 209 |
| CL.0068 | put the part over the whole | by_hand_doing | 2 | 3 | 156 |
| CL.0122 | use the zero product property | by_hand_doing | 5 | 5 | 154 |
| CL.0248 | Restricted Sample Space Ratio | by_hand_doing | 0 | 4 | 150 |
| CL.0080 | rewrite in slope-intercept form | by_hand_doing | 2 | 2 | 145 |
| CL.0181 | restrict to the given condition's row or column | by_hand_recognizing | 4 | 4 | 136 |
| CL.0084 | set a variable to zero to find an intercept or initial value | by_hand_doing | 6 | 7 | 134 |
| CL.0089 | solve for the constant | by_hand_doing | 0 | 1 | 134 |
| CL.0008 | cancel a common factor (noting the excluded value) | by_hand_doing | 6 | 6 | 123 |
| CL.0098 | take a percent of a quantity | by_hand_doing | 1 | 2 | 120 |
| CL.0162 | read the vertex from vertex form | by_hand_recognizing | 1 | 2 | 119 |
| CL.0086 | set up and solve a proportion | by_hand_doing | 4 | 4 | 116 |
| CL.0006 | apply exponent rules | by_hand_doing | 4 | 4 | 109 |
| CL.0164 | recognize a difference of squares | by_hand_recognizing | 6 | 6 | 109 |
| CL.0241 | Multiplier Chaining | by_hand_doing | 0 | 3 | 108 |
| CL.0061 | multiply successive multipliers | by_hand_doing | 4 | 4 | 107 |
| CL.0201 | translate 'at least / at most' into an inequality symbol | by_hand_recognizing | 2 | 2 | 105 |
| CL.0133 | compare coefficients and constants to count solutions | by_hand_recognizing | 2 | 2 | 97 |
| CL.0033 | distribute a negative sign | by_hand_doing | 2 | 2 | 89 |
| CL.0116 | use the negative-reciprocal slope for a perpendicular line | by_hand_doing | 4 | 4 | 83 |
| CL.0025 | compute the discriminant | by_hand_doing | 2 | 2 | 81 |
| CL.0081 | round to the whole number the context allows | by_hand_doing | 1 | 1 | 80 |
| CL.0262 | Data-Modification Effect Analysis | by_hand_doing | 0 | 1 | 80 |
| CL.0062 | order the data and find the middle value | by_hand_doing | 1 | 1 | 76 |
| CL.0246 | Direct Ratio from Counts | by_hand_doing | 0 | 1 | 72 |
| CL.0247 | Probability via Complement or Multi-Step Counting | by_hand_doing | 0 | 2 | 71 |
| CL.0240 | Single-Multiplier Construction or Interpretation | by_hand_doing | 0 | 4 | 61 |
| CL.0242 | Reverse Division (Undo a Percent) | by_hand_doing | 0 | 3 | 61 |
| CL.0035 | divide polynomials | by_hand_doing | 2 | 2 | 53 |
| CL.0101 | test each answer choice | by_hand_doing | 7 | 10 | 51 |
| CL.0099 | take the square root of both sides | by_hand_doing | 4 | 5 | 50 |
| CL.0160 | read slope and intercept from the equation | by_hand_recognizing | 5 | 5 | 50 |
| CL.0075 | reduce a fraction or ratio to lowest terms | by_hand_doing | 2 | 2 | 49 |
| CL.0107 | undo a percent change by dividing by the multiplier | by_hand_doing | 3 | 3 | 48 |
| CL.0154 | match a number in the model to its meaning in context | by_hand_recognizing | 6 | 7 | 47 |
| CL.0120 | use the sum and product of the solutions | by_hand_doing | 3 | 3 | 46 |
| CL.0053 | match coefficients | by_hand_doing | 1 | 1 | 44 |
| CL.0039 | factor out the greatest common factor | by_hand_doing | 13 | 13 | 40 |
| CL.0023 | compute percent change from two values | by_hand_doing | 0 | 1 | 39 |
| CL.0239 | Percent-Change Formula Application | by_hand_doing | 0 | 1 | 39 |
| CL.0158 | merge categories that together meet the condition | by_hand_recognizing | 1 | 1 | 37 |
| CL.0077 | reject extraneous solutions | by_hand_doing | 1 | 1 | 36 |
| CL.0209 | use the complement | by_hand_recognizing | 1 | 1 | 33 |
| CL.0087 | shift a graph by adjusting its equation | by_hand_doing | 7 | 7 | 30 |
| CL.0091 | square both sides | by_hand_doing | 1 | 1 | 30 |
| CL.0020 | complete the square | by_hand_doing | 2 | 2 | 27 |
| CL.0029 | convert between fraction, decimal, and percent | by_hand_doing | 7 | 7 | 25 |
| CL.0177 | recognize the solution as the intersection point | by_hand_recognizing | 6 | 7 | 25 |
| CL.0156 | match equation parameters to graph features | by_hand_recognizing | 2 | 3 | 23 |
| CL.0106 | turn a percent change into a multiplier | by_hand_doing | 4 | 7 | 22 |
| CL.0198 | tell growth from decay by the base | by_hand_recognizing | 1 | 1 | 21 |
| CL.0007 | apply the quadratic formula | by_hand_doing | 2 | 2 | 19 |
| CL.0026 | compute the mean | by_hand_doing | 1 | 1 | 19 |
| CL.0185 | set aside information the question doesn't need | by_hand_recognizing | 1 | 1 | 17 |
| CL.0040 | find a common denominator | by_hand_doing | 1 | 1 | 16 |
| CL.0043 | find the vertex with x = -b/(2a) | by_hand_doing | 3 | 3 | 13 |
| CL.0038 | factor by grouping | by_hand_doing | 7 | 7 | 11 |
| CL.0153 | locate the matching cell or total in a table | by_hand_recognizing | 6 | 6 | 11 |
| CL.0172 | recognize parallel lines have equal slopes | by_hand_recognizing | 2 | 3 | 10 |
| CL.0072 | read a value from a table or graph | by_hand_doing | 14 | 14 | 7 |
| CL.0127 | write an exponential model a(1 +/- r)^t | by_hand_doing | 2 | 2 | 7 |
| CL.0210 | use the symmetry of a parabola | by_hand_recognizing | 2 | 2 | 7 |
| CL.0027 | compute the range | by_hand_doing | 1 | 2 | 6 |
| CL.0078 | rescale the exponent for a different time unit | by_hand_doing | 2 | 2 | 6 |
| CL.0189 | spot that the target expression can be reached without solving | by_hand_recognizing | 1 | 1 | 6 |
| CL.0163 | read the zeros from factored form | by_hand_recognizing | 1 | 2 | 5 |
| CL.0132 | classify growth as linear or exponential | by_hand_recognizing | 1 | 1 | 4 |
| CL.0032 | convert units with a conversion factor | by_hand_doing | 1 | 1 | 3 |
| CL.0090 | split an absolute value equation into two cases | by_hand_doing | 6 | 6 | 2 |
| CL.0134 | compare spread visually | by_hand_recognizing | 1 | 1 | 2 |
| CL.0139 | distinguish a data value from its frequency | by_hand_recognizing | 1 | 1 | 2 |
| CL.0182 | scale lengths by k, areas by k^2, volumes by k^3 | by_hand_recognizing | 1 | 1 | 2 |
| CL.0203 | treat a repeated expression as one unit | by_hand_recognizing | 0 | 1 | 2 |
| CL.0019 | compare the values for the groups or conditions | by_hand_doing | 2 | 3 | 1 |
| CL.0079 | rewrite a negative exponent as a reciprocal | by_hand_doing | 2 | 2 | 1 |
| CL.0119 | use the reference-sheet formula | by_hand_doing | 8 | 10 | 1 |
| CL.0002 | add and subtract the margin of error | by_hand_doing | 1 | 1 | 0 |
| CL.0010 | check every part of the choice against the text | by_hand_doing | 16 | 16 | 0 |
| CL.0012 | check that the subject can logically do the action | by_hand_doing | 4 | 4 | 0 |
| CL.0014 | check with a test value | by_hand_doing | 1 | 2 | 0 |
| CL.0015 | classify the relationship between two views as agree, disagree, or qualify | by_hand_doing | 5 | 5 | 0 |
| CL.0022 | compute a residual | by_hand_doing | 0 | 1 | 0 |
| CL.0028 | convert between degrees and radians | by_hand_doing | 0 | 1 | 0 |
| CL.0030 | convert between radical and rational exponent | by_hand_doing | 7 | 7 | 0 |
| CL.0031 | convert diameter or circumference to radius | by_hand_doing | 1 | 1 | 0 |
| CL.0036 | eliminate choices that go beyond the text | by_hand_doing | 2 | 2 | 0 |
| CL.0041 | find a trig value on the unit circle | by_hand_doing | 1 | 1 | 0 |
| CL.0044 | find what both sides accept beneath their disagreement | by_hand_doing | 1 | 1 | 0 |
| CL.0045 | generalize the listed examples into one idea | by_hand_doing | 1 | 1 | 0 |
| CL.0048 | join two complete sentences with a period, semicolon, or comma plus and/but/so | by_hand_doing | 15 | 15 | 0 |
| CL.0049 | label what each sentence does | by_hand_doing | 5 | 7 | 0 |
| CL.0051 | match a pronoun or determiner's number to the noun it refers to | by_hand_doing | 2 | 2 | 0 |
| CL.0052 | match a verb to the parallel verb it pairs with | by_hand_doing | 1 | 1 | 0 |
| CL.0054 | match the data to the claim's groups and measure | by_hand_doing | 11 | 11 | 0 |
| CL.0056 | match the positive or negative charge of the context | by_hand_doing | 2 | 2 | 0 |
| CL.0057 | match the scope of the choice to the text | by_hand_doing | 1 | 1 | 0 |
| CL.0058 | match the strength of the claim | by_hand_doing | 4 | 4 | 0 |
| CL.0059 | match the verb's number to its subject | by_hand_doing | 17 | 17 | 0 |
| CL.0063 | pin down the exact claim in your own words | by_hand_doing | 14 | 15 | 0 |
| CL.0064 | predict the answer in your own words before reading the choices | by_hand_doing | 6 | 7 | 0 |
| CL.0065 | punctuate a list: commas for three or more items, semicolons when items contain commas | by_hand_doing | 3 | 6 | 0 |
| CL.0066 | put a comma between an introductory or trailing phrase and the main clause | by_hand_doing | 7 | 7 | 0 |
| CL.0067 | put the noun the opening modifier describes right after it | by_hand_doing | 4 | 4 | 0 |
| CL.0071 | read a prediction off the model at a given x | by_hand_doing | 0 | 1 | 0 |
| CL.0073 | read center and radius from standard form | by_hand_doing | 3 | 4 | 0 |
| CL.0074 | read the whole sentence after the blank before deciding | by_hand_doing | 3 | 3 | 0 |
| CL.0085 | set off removable information with a matching pair of commas, dashes, or parentheses | by_hand_doing | 3 | 4 | 0 |
| CL.0096 | sum the face areas | by_hand_doing | 0 | 1 | 0 |
| CL.0097 | sum up the text's main point in one sentence | by_hand_doing | 3 | 3 | 0 |
| CL.0100 | tell a possessive pronoun from a contraction (its/it's, their/they're) | by_hand_doing | 1 | 1 | 0 |
| CL.0108 | use a colon only after a complete sentence to introduce an explanation, example, or list | by_hand_doing | 4 | 4 | 0 |
| CL.0109 | use an apostrophe only to show possession, placed for a singular or plural owner | by_hand_doing | 5 | 5 | 0 |
| CL.0110 | use dates or time words to set the order of events | by_hand_doing | 2 | 2 | 0 |
| CL.0112 | use supplementary angles | by_hand_doing | 3 | 3 | 0 |
| CL.0113 | use the distance formula | by_hand_doing | 1 | 1 | 0 |
| CL.0115 | use the midpoint formula | by_hand_doing | 1 | 1 | 0 |
| CL.0117 | use the past perfect (had + verb) for the earlier of two past events | by_hand_doing | 1 | 1 | 0 |
| CL.0118 | use the Pythagorean theorem | by_hand_doing | 7 | 9 | 0 |
| CL.0121 | use the triangle angle sum | by_hand_doing | 1 | 1 | 0 |
| CL.0125 | work out what result the claim predicts | by_hand_doing | 8 | 9 | 0 |
| CL.0126 | write a trig ratio as opposite, adjacent, hypotenuse | by_hand_doing | 4 | 4 | 0 |
| CL.0129 | check whether each side of the punctuation is a complete sentence | by_hand_recognizing | 16 | 20 | 0 |
| CL.0130 | check whether the clause still needs its main verb | by_hand_recognizing | 3 | 3 | 0 |
| CL.0131 | check whether the sample was random | by_hand_recognizing | 6 | 6 | 0 |
| CL.0135 | decide whether the added information is essential or removable | by_hand_recognizing | 3 | 3 | 0 |
| CL.0137 | describe the trend of a scatterplot | by_hand_recognizing | 1 | 1 | 0 |
| CL.0138 | distinguish 'p% of' from 'p% more/less than' | by_hand_recognizing | 3 | 3 | 0 |
| CL.0142 | find the clue that restates the blank | by_hand_recognizing | 3 | 3 | 0 |
| CL.0143 | find the contrast signal word | by_hand_recognizing | 6 | 7 | 0 |
| CL.0144 | find the true subject by skipping the interrupting phrase | by_hand_recognizing | 14 | 14 | 0 |
| CL.0147 | identify the hypotenuse | by_hand_recognizing | 2 | 2 | 0 |
| CL.0148 | identify the transversal angle pair | by_hand_recognizing | 1 | 1 | 0 |
| CL.0150 | interpret a function statement f(a) = b | by_hand_recognizing | 1 | 1 | 0 |
| CL.0152 | keep subject, verb, object, and preposition together with no punctuation | by_hand_recognizing | 2 | 2 | 0 |
| CL.0155 | match corresponding parts from the vertex order | by_hand_recognizing | 1 | 1 | 0 |
| CL.0157 | match the conclusion to the population sampled | by_hand_recognizing | 3 | 3 | 0 |
| CL.0159 | pick the equivalent form that displays a value | by_hand_recognizing | 1 | 1 | 0 |
| CL.0161 | read the title, axes, key, and scale before the data | by_hand_recognizing | 3 | 3 | 0 |
| CL.0167 | recognize a special right triangle | by_hand_recognizing | 3 | 3 | 0 |
| CL.0171 | recognize equal angles have equal trig ratios | by_hand_recognizing | 1 | 1 | 0 |
| CL.0173 | recognize similar triangles | by_hand_recognizing | 4 | 5 | 0 |
| CL.0174 | recognize sin of an angle equals cos of its complement | by_hand_recognizing | 2 | 2 | 0 |
| CL.0176 | recognize the shaded side of a boundary line | by_hand_recognizing | 2 | 2 | 0 |
| CL.0179 | recognize vertical angles | by_hand_recognizing | 2 | 2 | 0 |
| CL.0184 | see the right triangle inside the figure | by_hand_recognizing | 5 | 5 | 0 |
| CL.0186 | spot a concession before the main claim | by_hand_recognizing | 2 | 3 | 0 |
| CL.0187 | spot a word used in an uncommon sense | by_hand_recognizing | 3 | 3 | 0 |
| CL.0188 | spot comparison wording (both, whereas, while, unlike) | by_hand_recognizing | 2 | 2 | 0 |
| CL.0190 | spot the turn from a common view to the real point | by_hand_recognizing | 1 | 1 | 0 |
| CL.0193 | tell a general claim from a specific example | by_hand_recognizing | 1 | 1 | 0 |
| CL.0194 | tell a population mean apart from individual values | by_hand_recognizing | 1 | 1 | 0 |
| CL.0195 | tell an example from a restatement or a specification | by_hand_recognizing | 0 | 1 | 0 |
| CL.0199 | trace a pronoun or 'this' back to what it refers to | by_hand_recognizing | 3 | 3 | 0 |
| CL.0200 | track whose view each sentence presents | by_hand_recognizing | 3 | 3 | 0 |
| CL.0202 | treat a random sample's rate as the population's rate | by_hand_recognizing | 4 | 4 | 0 |
| CL.0204 | treat a sample statistic as an estimate, not an exact value | by_hand_recognizing | 1 | 1 | 0 |
| CL.0205 | treat an arc as a fraction of the circle | by_hand_recognizing | 4 | 4 | 0 |
| CL.0206 | turn the goal into a checklist of required parts | by_hand_recognizing | 1 | 1 | 0 |
| CL.0208 | use tangent facts | by_hand_recognizing | 3 | 4 | 0 |
| CL.0211 | use time clues in the text to choose the verb tense | by_hand_recognizing | 9 | 9 | 0 |
| CL.0212 | Desmos: graph a circle and read its center and radius | desmos | 5 | 5 | 0 |
| CL.0213 | Desmos: convert a decimal result to a fraction | desmos | 5 | 5 | 0 |
| CL.0214 | Desmos: rename the variable to x before graphing | desmos | 6 | 7 | 0 |
| CL.0215 | Desmos: graph and compare equivalent forms | desmos | 5 | 5 | 0 |
| CL.0216 | Desmos: define f(x) and evaluate it | desmos | 9 | 11 | 0 |
| CL.0217 | Desmos: graph an inequality and test the shaded region | desmos | 8 | 8 | 0 |
| CL.0218 | Desmos: fit a model through points by regression | desmos | 6 | 7 | 0 |
| CL.0219 | Desmos: graph and click the vertex (max or min) | desmos | 8 | 8 | 0 |
| CL.0220 | Desmos: graph each side and read the crossing x | desmos | 6 | 13 | 0 |
| CL.0221 | Desmos: test choices as parameterized points on a slider | desmos | 0 | 1 | 0 |
| CL.0222 | Desmos: compute a percent or multiplier as typed arithmetic | desmos | 0 | 1 | 0 |
| CL.0223 | Desmos: test whether a point lies on a graph | desmos | 3 | 3 | 0 |
| CL.0224 | Desmos: compute list statistics (mean, median) | desmos | 5 | 5 | 0 |
| CL.0225 | Desmos: graph a system and click the intersection | desmos | 25 | 26 | 0 |
| CL.0226 | Desmos: define a translated function and read its feature | desmos | 8 | 9 | 0 |
| CL.0227 | Desmos: evaluate a trig value in degree mode | desmos | 1 | 1 | 0 |
| CL.0228 | Desmos: solve for an unknown constant with a slider | desmos | 14 | 14 | 0 |
| CL.0229 | Desmos: find exact constants by regression | desmos | 4 | 5 | 0 |
| CL.0230 | Desmos: graph and click the zeros | desmos | 5 | 6 | 0 |
| CL.0250 | Complement and Multi-Step Counting | by_hand_doing | 0 | 1 | 0 |
| CL.0255 | Graph/Table Value Extraction | by_hand_doing | 0 | 4 | 0 |
| CL.0264 | Direct Graph Reading | by_hand_doing | 0 | 3 | 0 |
| CL.0268 | Residual and Deviation Analysis | by_hand_doing | 0 | 1 | 0 |
| CL.0269 | Contextual Slope and Rate Interpretation | by_hand_doing | 0 | 4 | 0 |
| CL.0272 | Nonlinear model fitting by key features | by_hand_doing | 0 | 1 | 0 |
| CL.0274 | Construct confidence interval from estimate and MOE | by_hand_doing | 0 | 1 | 0 |
| CL.0275 | Scale sample proportion to population count | by_hand_doing | 0 | 4 | 0 |
| CL.0277 | Evaluate whether a specific value is plausible | by_hand_doing | 0 | 1 | 0 |
| CL.0279 | Identify correct population for generalization | by_hand_doing | 0 | 2 | 0 |
| CL.0280 | Identify the sampled population | by_hand_doing | 0 | 2 | 0 |
| CL.0281 | Detect non-representative sampling | by_hand_doing | 0 | 5 | 0 |
| CL.0283 | Resist over-generalization | by_hand_doing | 0 | 2 | 0 |


## Method and SQL used

All queries ran read-only (SELECT) against production. The "after" union and all counts were computed from these exact result sets by a local script (`/tmp/claude-0/-home-claude/07fae966-44ac-55ad-9bf3-575c1cf3a9d6/scratchpad/vtag/cov/compute.py`), because pasting the 1,231 pending rows into SQL on every query was impractical. The local "before" per-domain numbers were cross-checked against a server-side SQL computation (query 5) and matched exactly (Advanced Math 1005, Algebra 1422, PSDA 0).

Rules applied:
- Approved segment = `video_segments.approved_at IS NOT NULL` AND its `video_resources.approved_at IS NOT NULL`.
- After = production `video_segment_sub_skills` / `video_segment_clusters` UNION pending CSV rows (deduplicated on segment + tag). No tag, sub-skill or cluster is treated as superseded; no taxonomy_version filter (all rows are `scl-v1.0.0`).
- A question "gets a video" if any of its `question_sub_skills` rows names a sub-skill that has at least one approved segment in that stage.
- Taxonomy counts (181 sub-skills, 282 clusters) were read live, not assumed.

**1. Segments, approval and production tags**
```sql
SELECT s.segment_id, s.video_id, (s.approved_at IS NOT NULL AND v.approved_at IS NOT NULL) appr, v.channel_name ch,
 (SELECT string_agg(sub_skill_id,' ' ORDER BY sub_skill_id) FROM public.video_segment_sub_skills x WHERE x.segment_id=s.segment_id) ss,
 (SELECT string_agg(cluster_id,' ' ORDER BY cluster_id) FROM public.video_segment_clusters x WHERE x.segment_id=s.segment_id) cl
FROM public.video_segments s JOIN public.video_resources v ON v.video_id=s.video_id ORDER BY 1;
```

**2. Tagged questions with their sub-skills and clusters**
```sql
SELECT q.id, q.section sec, q.domain dom, array_to_string(q.skill_codes,' ') codes,
 (SELECT string_agg(sub_skill_id,' ') FROM public.question_sub_skills x WHERE x.question_id=q.id) ss,
 (SELECT string_agg(cluster_id,' ') FROM public.question_clusters x WHERE x.question_id=q.id) cl
FROM public.questions q WHERE q.id IN (SELECT question_id FROM public.question_sub_skills UNION SELECT question_id FROM public.question_clusters) ORDER BY 1;

-- skill_codes re-pulled with a safe separator (codes contain spaces)
SELECT json_object_agg(id, array_to_string(skill_codes,'|'))::text j FROM public.questions WHERE id IN (SELECT question_id FROM public.question_sub_skills);
```

**3. Taxonomy**
```sql
SELECT 'ss' k, id, skill_code code, section sec, domain dom, name, NULL fam, NULL skills FROM public.sub_skills
UNION ALL SELECT 'cl', id, NULL, NULL, NULL, display_name, family, array_to_string(skills_seen_in,' ') FROM public.clusters ORDER BY 1,2;
```

**4. Question tagging scope per domain**
```sql
SELECT section, domain, count(*) total, count(*) FILTER (WHERE status='published' AND retired_at IS NULL) published,
 count(*) FILTER (WHERE id IN (SELECT question_id FROM public.question_sub_skills)) tagged
FROM public.questions GROUP BY 1,2 ORDER BY 1,2;
```

**5. Server-side cross-check of the coverage logic (before stage; pending CTE shown with sample rows)**
```sql
WITH p_raw(segment_id,ss,cl) AS (VALUES
  ('00192fcf-b6ab-49fd-b10c-dead70e06c2d','TSP.3',''),
  ('00370c83-6ac9-47a0-a133-4f3219b376f2','EE.3','CL.0039')),   -- full list: one row per segment from tags-review.csv
pending AS (
  SELECT segment_id::uuid AS segment_id, 'sub_skill' AS kind, t AS tag_id FROM p_raw, unnest(string_to_array(nullif(ss,''),' ')) t
  UNION ALL
  SELECT segment_id::uuid, 'cluster', t FROM p_raw, unnest(string_to_array(nullif(cl,''),' ')) t),
appr_seg AS (
  SELECT s.segment_id, s.video_id, v.channel_name
  FROM public.video_segments s JOIN public.video_resources v ON v.video_id = s.video_id
  WHERE s.approved_at IS NOT NULL AND v.approved_at IS NOT NULL),
ss_tag AS (
  SELECT 'before' st, segment_id, sub_skill_id FROM public.video_segment_sub_skills
  UNION ALL SELECT 'after', segment_id, sub_skill_id FROM public.video_segment_sub_skills
  UNION SELECT 'after', segment_id, tag_id FROM pending WHERE kind='sub_skill'),
ss_cov AS (
  SELECT t.st, t.sub_skill_id, count(DISTINCT a.segment_id) segs, count(DISTINCT a.video_id) vids, count(DISTINCT a.channel_name) chans
  FROM ss_tag t JOIN appr_seg a USING (segment_id) GROUP BY 1,2),
stages AS (SELECT unnest(ARRAY['before','after']) st),
q AS (SELECT DISTINCT question_id FROM public.question_sub_skills),
q_hit AS (
  SELECT s.st, q.question_id,
    EXISTS (SELECT 1 FROM public.question_sub_skills x JOIN ss_cov c ON c.sub_skill_id=x.sub_skill_id AND c.st=s.st
            WHERE x.question_id=q.question_id) AS hit
  FROM q CROSS JOIN stages s)
SELECT qq.section, qq.domain,
  count(*) FILTER (WHERE h.st='before') tq,
  count(*) FILTER (WHERE h.st='before' AND h.hit) b_hit,
  count(*) FILTER (WHERE h.st='after' AND h.hit) a_hit
FROM q_hit h JOIN public.questions qq ON qq.id=h.question_id GROUP BY 1,2;
-- result (before): Advanced Math 1005/1018, Algebra 1422/1484, PSDA 0/992
```

The full-length version of this SQL, with all 466 pending segments inlined, is saved at `/tmp/claude-0/-home-claude/07fae966-44ac-55ad-9bf3-575c1cf3a9d6/scratchpad/vtag/cov/main_full.sql`. It was not run in full form (only the reduced version above was run), and the numbers do not depend on it.
