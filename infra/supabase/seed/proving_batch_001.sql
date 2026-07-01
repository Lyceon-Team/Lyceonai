-- proving_batch_001.sql
-- Proving batch of 8 original SAT questions for Codex audit.
-- @spec [questions_governance.md §A.1–A.9] | @implemented [2026-06-30]
-- All questions: source_type=2, status='draft'. DO NOT apply to prod — Karl applies after Codex APPROVE.

-- Q1: Math MCQ Easy — Algebra / Linear Equations in One Variable
INSERT INTO questions (
  id, section, source_type, domain, skill_codes, difficulty,
  item_type, stem, passage, options, correct_answer, correct_variants,
  explanation, option_metadata, assets,
  status, version, estimated_time_seconds, premium_flag,
  source_lineage, generation_attribution
) VALUES (
  'SATM2P7VK3N', 'M', 2, 'Algebra', ARRAY['Linear Equations in One Variable'], 1,
  'mcq',
  'If $5x + 4 = 29$, what is the value of $x$?',
  NULL,
  '[{"key":"A","text":"$5$"},{"key":"B","text":"$\\frac{29}{5}$"},{"key":"C","text":"$\\frac{33}{5}$"},{"key":"D","text":"$25$"}]'::jsonb,
  'A',
  NULL,
  'The correct answer is A. Subtract $4$ from both sides of $5x + 4 = 29$ to get $5x = 25$, then divide both sides by $5$ to get $x = 5$. Option D ($25$) is the result of the first step only, without dividing by $5$. Option B ($\frac{29}{5}$) comes from dividing $29$ by $5$ without first subtracting $4$.',
  '{"A":{"role":"correct","error_taxonomy":null},"B":{"role":"distractor","error_taxonomy":"equation_setup_error"},"C":{"role":"distractor","error_taxonomy":"sign_error"},"D":{"role":"distractor","error_taxonomy":"partial_reasoning"}}'::jsonb,
  NULL,
  'draft', 1, 45, false,
  '{"provenance":"Lyceon original","authored_by":"claude","authored_date":"2026-06-30"}'::jsonb,
  '{"model":"claude","generation_date":"2026-06-30","prompt_version":"questions_governance_v1"}'::jsonb
);

-- Q2: Math MCQ Hard — Advanced Math / Nonlinear Equations in One Variable and Systems of Equations in Two Variables
INSERT INTO questions (
  id, section, source_type, domain, skill_codes, difficulty,
  item_type, stem, passage, options, correct_answer, correct_variants,
  explanation, option_metadata, assets,
  status, version, estimated_time_seconds, premium_flag,
  source_lineage, generation_attribution
) VALUES (
  'SATM2H9WR2X', 'M', 2, 'Advanced Math', ARRAY['Nonlinear Equations in One Variable and Systems of Equations in Two Variables'], 3,
  'mcq',
  E'The system of equations below has two solutions, $(x_1, y_1)$ and $(x_2, y_2)$.\n$$y = x^2 - 4x + 1$$\n$$y = 2x - 7$$\nWhat is the value of $x_1 + x_2$?',
  NULL,
  '[{"key":"A","text":"$-6$"},{"key":"B","text":"$2$"},{"key":"C","text":"$6$"},{"key":"D","text":"$8$"}]'::jsonb,
  'C',
  NULL,
  E'The correct answer is C. Substituting the second equation into the first gives $2x - 7 = x^2 - 4x + 1$, which simplifies to $x^2 - 6x + 8 = 0$. Factoring yields $(x - 2)(x - 4) = 0$, so $x_1 = 2$ and $x_2 = 4$. Therefore $x_1 + x_2 = 6$. Alternatively, by Vieta\'s formulas, the sum of the roots of $x^2 - 6x + 8 = 0$ is $\\frac{-(-6)}{1} = 6$. Option A ($-6$) results from a sign error in applying Vieta\'s formulas. Option B ($2$) gives only one solution. Option D ($8$) is the product of the roots, not the sum.',
  '{"A":{"role":"distractor","error_taxonomy":"sign_error"},"B":{"role":"distractor","error_taxonomy":"partial_reasoning"},"C":{"role":"correct","error_taxonomy":null},"D":{"role":"distractor","error_taxonomy":"concept_gap"}}'::jsonb,
  NULL,
  'draft', 1, 105, false,
  '{"provenance":"Lyceon original","authored_by":"claude","authored_date":"2026-06-30"}'::jsonb,
  '{"model":"claude","generation_date":"2026-06-30","prompt_version":"questions_governance_v1"}'::jsonb
);

-- Q3: Math Grid-in Medium — Problem Solving and Data Analysis / Ratios, Rates, Proportional Relationships, and Units
INSERT INTO questions (
  id, section, source_type, domain, skill_codes, difficulty,
  item_type, stem, passage, options, correct_answer, correct_variants,
  explanation, option_metadata, assets,
  status, version, estimated_time_seconds, premium_flag,
  source_lineage, generation_attribution
) VALUES (
  'SATM2Q4BJ8F', 'M', 2, 'Problem Solving and Data Analysis', ARRAY['Ratios, Rates, Proportional Relationships, and Units'], 2,
  'grid_in',
  'A factory produces $240$ widgets in $6$ hours. At this same constant rate, how many widgets would the factory produce in $10$ hours?',
  NULL,
  '[]'::jsonb,
  '400',
  ARRAY['400'],
  'The correct answer is $400$. The factory produces widgets at a rate of $\frac{240}{6} = 40$ widgets per hour. In $10$ hours, the factory would produce $40 \times 10 = 400$ widgets. This is a proportional relationship: the number of widgets scales linearly with time at the constant rate.',
  NULL,
  NULL,
  'draft', 1, 75, false,
  '{"provenance":"Lyceon original","authored_by":"claude","authored_date":"2026-06-30"}'::jsonb,
  '{"model":"claude","generation_date":"2026-06-30","prompt_version":"questions_governance_v1"}'::jsonb
);

-- Q4: Math Grid-in Hard — Algebra / Linear Equations in Two Variables
INSERT INTO questions (
  id, section, source_type, domain, skill_codes, difficulty,
  item_type, stem, passage, options, correct_answer, correct_variants,
  explanation, option_metadata, assets,
  status, version, estimated_time_seconds, premium_flag,
  source_lineage, generation_attribution
) VALUES (
  'SATM2L6TC5Y', 'M', 2, 'Algebra', ARRAY['Linear Equations in Two Variables'], 3,
  'grid_in',
  'In the $xy$-plane, line $p$ passes through the point $(3, 5)$ and is perpendicular to the line $2x + 3y = 12$. What is the $y$-intercept of line $p$?',
  NULL,
  '[]'::jsonb,
  '1/2',
  ARRAY['1/2', '0.5', '.5'],
  E'The correct answer is $\\frac{1}{2}$. The line $2x + 3y = 12$ can be rewritten as $y = -\\frac{2}{3}x + 4$, which has slope $-\\frac{2}{3}$. A line perpendicular to this has slope $\\frac{3}{2}$. Using point-slope form with $(3, 5)$: $y - 5 = \\frac{3}{2}(x - 3)$, which simplifies to $y = \\frac{3}{2}x - \\frac{9}{2} + 5 = \\frac{3}{2}x + \\frac{1}{2}$. The $y$-intercept is $\\frac{1}{2}$.',
  NULL,
  NULL,
  'draft', 1, 105, false,
  '{"provenance":"Lyceon original","authored_by":"claude","authored_date":"2026-06-30"}'::jsonb,
  '{"model":"claude","generation_date":"2026-06-30","prompt_version":"questions_governance_v1"}'::jsonb
);

-- Q5: RW MCQ Easy — Information and Ideas / Central Ideas and Details
INSERT INTO questions (
  id, section, source_type, domain, skill_codes, difficulty,
  item_type, stem, passage, options, correct_answer, correct_variants,
  explanation, option_metadata, assets,
  status, version, estimated_time_seconds, premium_flag,
  source_lineage, generation_attribution
) VALUES (
  'SATRW2D3MN7K', 'RW', 2, 'Information and Ideas', ARRAY['Central Ideas and Details'], 1,
  'mcq',
  'Which choice best states the main idea of the text?',
  'Researchers studying coral reef ecosystems in the Pacific Ocean have found that certain species of parrotfish play a critical role in reef health. By feeding on algae that grow on coral surfaces, parrotfish prevent algae from smothering the coral and blocking the sunlight needed for photosynthesis. Without parrotfish, algae overgrowth can lead to widespread coral bleaching and reef degradation.',
  '[{"key":"A","text":"Coral reefs in the Pacific Ocean are threatened by rising ocean temperatures."},{"key":"B","text":"Parrotfish help maintain healthy coral reefs by consuming algae that would otherwise harm the coral."},{"key":"C","text":"Algae growth on coral reefs has increased significantly due to recent environmental changes."},{"key":"D","text":"Scientists have developed new methods for protecting coral reefs from environmental damage."}]'::jsonb,
  'B',
  NULL,
  'The correct answer is B. The passage focuses on how parrotfish contribute to reef health by eating algae that can smother coral, making B the best summary of the central idea. Options A and D introduce topics not discussed in the passage. Option C makes a claim about trends in algae growth that the passage does not support.',
  '{"A":{"role":"distractor","error_taxonomy":"detail_misread"},"B":{"role":"correct","error_taxonomy":null},"C":{"role":"distractor","error_taxonomy":"inference_overreach"},"D":{"role":"distractor","error_taxonomy":"detail_misread"}}'::jsonb,
  NULL,
  'draft', 1, 60, false,
  '{"provenance":"Lyceon original","authored_by":"claude","authored_date":"2026-06-30"}'::jsonb,
  '{"model":"claude","generation_date":"2026-06-30","prompt_version":"questions_governance_v1"}'::jsonb
);

-- Q6: RW MCQ Medium — Craft and Structure / Text Structure and Purpose
INSERT INTO questions (
  id, section, source_type, domain, skill_codes, difficulty,
  item_type, stem, passage, options, correct_answer, correct_variants,
  explanation, option_metadata, assets,
  status, version, estimated_time_seconds, premium_flag,
  source_lineage, generation_attribution
) VALUES (
  'SATRW2G8FP4R', 'RW', 2, 'Craft and Structure', ARRAY['Text Structure and Purpose'], 2,
  'mcq',
  'Which choice best describes the main purpose of the text?',
  E'When the Mexican muralist Diego Rivera arrived in Detroit in 1932, automotive executives expected a modest series of panels celebrating industry. Instead, Rivera spent months studying factory operations, interviewing workers, and sketching machinery in motion. The resulting twenty-seven panels of the Detroit Industry Murals transformed the courtyard of the Detroit Institute of Arts into an immersive meditation on the relationship between human labor and mechanical power.',
  '[{"key":"A","text":"to argue that Rivera''s artistic methods were superior to those of his contemporaries"},{"key":"B","text":"to describe how Rivera''s approach to a commissioned project exceeded its original scope"},{"key":"C","text":"to explain the technical processes Rivera used to create large-scale murals"},{"key":"D","text":"to compare Rivera''s Detroit murals with his earlier works in Mexico"}]'::jsonb,
  'B',
  NULL,
  E'The correct answer is B. The passage contrasts the modest expectations of the automotive executives with Rivera''s extensive research and the ambitious scope of the resulting murals, emphasizing how the project grew beyond what was originally anticipated. Option A makes a comparative claim about artistic superiority that the passage does not address. Option C focuses on technical processes, but the passage emphasizes scope and ambition rather than technique. Option D mentions earlier works in Mexico, which the passage does not discuss.',
  '{"A":{"role":"distractor","error_taxonomy":"rhetorical_purpose_error"},"B":{"role":"correct","error_taxonomy":null},"C":{"role":"distractor","error_taxonomy":"detail_misread"},"D":{"role":"distractor","error_taxonomy":"inference_overreach"}}'::jsonb,
  NULL,
  'draft', 1, 90, false,
  '{"provenance":"Lyceon original","authored_by":"claude","authored_date":"2026-06-30"}'::jsonb,
  '{"model":"claude","generation_date":"2026-06-30","prompt_version":"questions_governance_v1"}'::jsonb
);

-- Q7: RW MCQ Medium — Standard English Conventions / Boundaries
INSERT INTO questions (
  id, section, source_type, domain, skill_codes, difficulty,
  item_type, stem, passage, options, correct_answer, correct_variants,
  explanation, option_metadata, assets,
  status, version, estimated_time_seconds, premium_flag,
  source_lineage, generation_attribution
) VALUES (
  'SATRW2J5AW9L', 'RW', 2, 'Standard English Conventions', ARRAY['Boundaries'], 2,
  'mcq',
  'Which choice completes the text so that it conforms to the conventions of Standard English?',
  E'Ornithologist Sarah Chen spent three years tracking the migration patterns of Arctic ______ findings revealed that climate change has shifted the birds'' traditional flyways by an average of two hundred miles.',
  '[{"key":"A","text":"terns. Her"},{"key":"B","text":"terns, her"},{"key":"C","text":"terns her"},{"key":"D","text":"terns, which her"}]'::jsonb,
  'A',
  NULL,
  'The correct answer is A. The text contains two independent clauses: one ending with ''Arctic terns'' and one beginning with ''Her findings revealed.'' A period correctly separates two independent clauses into distinct sentences. Option B creates a comma splice by joining two independent clauses with only a comma. Option C creates a run-on sentence with no punctuation between the clauses. Option D introduces ''which'' in a way that creates a grammatically incomplete construction.',
  '{"A":{"role":"correct","error_taxonomy":null},"B":{"role":"distractor","error_taxonomy":"sentence_boundary_error"},"C":{"role":"distractor","error_taxonomy":"sentence_boundary_error"},"D":{"role":"distractor","error_taxonomy":"grammar_rule_error"}}'::jsonb,
  NULL,
  'draft', 1, 90, false,
  '{"provenance":"Lyceon original","authored_by":"claude","authored_date":"2026-06-30"}'::jsonb,
  '{"model":"claude","generation_date":"2026-06-30","prompt_version":"questions_governance_v1"}'::jsonb
);

-- Q8: RW MCQ Hard — Expression of Ideas / Rhetorical Synthesis
INSERT INTO questions (
  id, section, source_type, domain, skill_codes, difficulty,
  item_type, stem, passage, options, correct_answer, correct_variants,
  explanation, option_metadata, assets,
  status, version, estimated_time_seconds, premium_flag,
  source_lineage, generation_attribution
) VALUES (
  'SATRW2E2HX6V', 'RW', 2, 'Expression of Ideas', ARRAY['Rhetorical Synthesis'], 3,
  'mcq',
  'The student wants to emphasize a disadvantage of green roofs. Which choice most effectively uses relevant information from the notes to accomplish this goal?',
  E'While researching the environmental impact of urban green roofs, a student has taken the following notes:\n- Green roofs are rooftops partially or fully covered with vegetation planted over a waterproof membrane.\n- A 2023 study by the University of Toronto measured surface temperatures on green roofs and conventional roofs in the same building complex.\n- Green roof surfaces averaged $25°C$ cooler than conventional roof surfaces during summer months.\n- Green roofs also retained approximately $60\\%$ of annual rainfall, reducing stormwater runoff.\n- The installation cost of green roofs is typically two to three times higher than that of conventional roofs.',
  '[{"key":"A","text":"Green roofs, which are rooftops covered with vegetation over a waterproof membrane, can retain approximately $60\\%$ of annual rainfall."},{"key":"B","text":"A 2023 University of Toronto study found that green roof surfaces averaged $25°C$ cooler than conventional roof surfaces during summer months."},{"key":"C","text":"Although green roofs provide benefits such as reduced stormwater runoff and lower surface temperatures, their installation cost is typically two to three times higher than that of conventional roofs."},{"key":"D","text":"Green roofs are rooftops that are partially or fully covered with vegetation and are designed to retain rainfall and reduce surface temperatures."}]'::jsonb,
  'C',
  NULL,
  E'The correct answer is C. The student''s goal is to emphasize a disadvantage, and only option C highlights the higher installation cost of green roofs. The concessive clause (\"Although green roofs provide benefits\") acknowledges the advantages while the main clause focuses on the cost disadvantage, effectively emphasizing it. Options A and B present advantages of green roofs without mentioning any disadvantage. Option D provides a neutral definition without addressing either advantages or disadvantages.',
  '{"A":{"role":"distractor","error_taxonomy":"partial_reasoning"},"B":{"role":"distractor","error_taxonomy":"evidence_mismatch"},"C":{"role":"correct","error_taxonomy":null},"D":{"role":"distractor","error_taxonomy":"rhetorical_purpose_error"}}'::jsonb,
  NULL,
  'draft', 1, 120, false,
  '{"provenance":"Lyceon original","authored_by":"claude","authored_date":"2026-06-30"}'::jsonb,
  '{"model":"claude","generation_date":"2026-06-30","prompt_version":"questions_governance_v1"}'::jsonb
);
