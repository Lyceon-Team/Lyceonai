-- ============================================================================
-- E5: three deterministic full-length exam forms (form_001 .. form_003)
-- ============================================================================
-- @spec [Doc-04A_V2.2, §5.1 test_forms, §5.2 test_form_items, §6.1 lifecycle
--        (forms are born draft), §6.3 composition check (c)]
--       [Doc-04B_V4.3, §13.1 locked difficulty composition, §13.2
--        validate_form_composition as amended by SCL-121]
--       [E5 brief 2026-09-24 + owner addendum "Domain spread per module"]
-- @implemented [2026-09-24]
--
-- plain English: inserts three DRAFT full-length forms and their 441 items.
--   Every item is an existing row of public.servable_questions, written here
--   as a literal question_id, so the file produces the same three forms every
--   time it runs. It does NOT publish (owner ruling: drafts only). Publishing
--   is a separate owner step:
--     UPDATE public.test_forms SET status = 'published', published_at = now()
--      WHERE id IN (<the three ids below>) AND status = 'draft';
--   which fires the real publish gate (version active, thresholds in range,
--   validate_form_composition).
--
-- NOT A MIGRATION. Owner-run in the Supabase SQL editor after two reviews.
--
-- IDEMPOTENT. Run it twice: the second run inserts nothing and changes no row.
--   * Forms have fixed ids; INSERT ... ON CONFLICT (id) DO NOTHING. There is no
--     generated id anywhere, so no run can create a fourth form.
--   * Items are inserted only while their form is still draft (a published
--     form's items are immutable, and its item trigger would refuse the insert
--     even when ON CONFLICT would skip it), with ON CONFLICT DO NOTHING.
--   * Then, whatever state the forms were found in, the file ASSERTS that each
--     form's metadata and item set are exactly the literals below. Any
--     difference (a hand-edited draft, a question re-tagged or unpublished,
--     a leftover row) raises and the whole transaction rolls back.
--
-- WHAT THE FILE ASSERTS BEFORE COMMIT (any failure raises; nothing is kept)
--   A1 scoring_model_versions 'v1.0' exists and is 'active'.
--   A2 all 441 question_ids are rows of servable_questions (published, no
--      issue_flags) with exactly the section/domain/difficulty/item_type this
--      file was assembled from.
--   A3 each form row carries exactly the literal metadata.
--   A4 each form's items equal the literal set (both directions, 147 each).
--   A5 the (form, section, module, ordinal, question_id) serialisation hashes
--      to md5 9df4d1b305e72d2fbd08eee9965eec27 (the value the selection rule
--      below produced against production on 2026-09-24).
--   A6 every joint (module, domain, difficulty, item_type) cell equals the
--      owner's table. validate_form_composition checks the three dimensions
--      separately (SCL-121 ruling), so this joint check lives here.
--   A7 validate_form_composition(form) passes for all three.
--   A8 no question_id is in more than one of the three forms.
--
-- FORM METADATA (ruled)
--   routing_threshold_rw 20, routing_threshold_m 15 (inside the gate's
--   RW 18-21 / M 13-16 range); RW modules 32 min (1,920,000 ms), Math modules
--   35 min (2,100,000 ms), break 10 min (600,000 ms); score_table_version
--   'v1.0'; routing_override_* NULL (CHECK-pinned, G-EX-04); status 'draft'.
--
-- SELECTION RULE (reproducible: same bank + same rule = same forms)
--   1. Cell targets. The owner's domain x difficulty table fixes each module's
--      (domain, difficulty) counts. The owner's grid-in-per-domain table fixes
--      how many of a (module, domain)'s items are grid-in. Grid-in difficulty
--      (left to the assembler): split that domain's grid-ins across
--      difficulties in proportion to the domain's difficulty counts, largest
--      remainder, ties to the LOWER difficulty. The rest of each cell is mcq.
--      Result: 82 non-empty (module, domain, difficulty, item_type) cells per
--      form, the same table for all three forms (listed at the end of this
--      header).
--   2. Pool: public.servable_questions.
--   3. Within each (section, domain, difficulty, item_type) bank cell, rank
--      the pool by question_id COLLATE "C". Hand the ranked items out in
--      order: form 1 module 1, 2A, 2B; then form 2; then form 3. So form 1
--      takes the first N, form 2 the next N, form 3 the next N, and no
--      question can repeat across forms.
--   4. Ordinals (1..N contiguous per module; the order the student sees):
--      RW  : domain in SAT order (Craft and Structure, Information and Ideas,
--            Standard English Conventions, Expression of Ideas), then
--            difficulty ascending, then question_id COLLATE "C".
--      Math: difficulty ascending, then domain (Algebra, Advanced Math,
--            Problem Solving and Data Analysis, Geometry and Trigonometry),
--            then question_id COLLATE "C".
--   The rule as SQL is the commented-out SELECTION QUERY at the end of this
--   file. It is read-only; run it against the bank and compare its md5 with
--   A5. Against production on 2026-09-24 it returned 441 rows, 441 distinct,
--   md5 9df4d1b305e72d2fbd08eee9965eec27.
--
-- WHEN THE BANK GROWS: this file does not change; it names its items
--   literally, so the three forms stay what they are. Re-running the RULE on
--   a larger bank gives different picks wherever a new question_id sorts
--   before a picked one in the same cell; that is expected, and why the
--   literals, not the rule, are the artifact. A picked question that later
--   leaves servable_questions makes this file fail A2 (before any write).
--
-- ROLLBACK: nothing to roll back if any assertion fails (single transaction).
--   To remove the forms while they are still draft:
--     DELETE FROM public.test_form_items WHERE test_form_id IN (<ids>);
--     DELETE FROM public.test_forms      WHERE id           IN (<ids>);
--   Once published they cannot be deleted (Doc 04A §6.1); archive instead.
--
-- OWNER'S GRID-IN-PER-DOMAIN TABLE (input to step 1; Math only)
--              Alg  AdvM  PSDA  G&T  total
--     M  1      1     0     1    1     3
--     M  2A     3     1     2    2     8
--     M  2B     3     1     2    2     8
--   Each module's row/column sums of the table below equal the owner's
--   domain x difficulty table (mcq + grid added together).
--
-- JOINT CELL TABLE (per form; RW has no grid-in; E/M/H = difficulty 1/2/3)
--   RW 1    E  M  H
--     I&I    2  3  2
--     C&S    2  3  3
--     EoI    2  2  1
--     SEC    2  3  2
--   RW 2A   E  M  H
--     I&I    4  2  1
--     C&S    4  2  1
--     EoI    3  2  1
--     SEC    3  3  1
--   RW 2B   E  M  H
--     I&I    1  2  4
--     C&S    1  2  4
--     EoI    1  2  3
--     SEC    1  3  3
--   M  1    E(mcq+grid)  M(mcq+grid)  H(mcq+grid)
--     Alg      2+1         3+0         2+0
--     AdvM     2+0         3+0         2+0
--     PSDA     1+0         1+1         1+0
--     G&T      0+1         1+0         1+0
--   M  2A   E(mcq+grid)  M(mcq+grid)  H(mcq+grid)
--     Alg      2+2         1+1         1+0
--     AdvM     3+1         3+0         1+0
--     PSDA     1+1         0+1         0+0
--     G&T      0+1         1+1         1+0
--   M  2B   E(mcq+grid)  M(mcq+grid)  H(mcq+grid)
--     Alg      1+0         1+1         2+2
--     AdvM     1+0         3+0         3+1
--     PSDA     0+0         0+1         1+1
--     G&T      0+1         1+1         1+0
-- ============================================================================

BEGIN;

-- Literal item set: (form_no, section, module, ordinal, question_id) plus the
-- bank attributes it was assembled from (checked by A2, never written).
CREATE TEMP TABLE e5_items (
  form_no int NOT NULL, section text NOT NULL, module text NOT NULL, ordinal int NOT NULL,
  question_id text NOT NULL, difficulty int NOT NULL, item_type text NOT NULL, domain text NOT NULL
) ON COMMIT DROP;

INSERT INTO e5_items (form_no, section, module, ordinal, question_id, difficulty, item_type, domain) VALUES
  -- form 1 · Reading and Writing · module 1
  (1, 'RW', '1',  1, 'SATRW202IM7V', 1, 'mcq', 'Craft and Structure'),
  (1, 'RW', '1',  2, 'SATRW203PPYM', 1, 'mcq', 'Craft and Structure'),
  (1, 'RW', '1',  3, 'SATRW200BY8U', 2, 'mcq', 'Craft and Structure'),
  (1, 'RW', '1',  4, 'SATRW2020LCZ', 2, 'mcq', 'Craft and Structure'),
  (1, 'RW', '1',  5, 'SATRW20A3BS3', 2, 'mcq', 'Craft and Structure'),
  (1, 'RW', '1',  6, 'SATRW200VXWI', 3, 'mcq', 'Craft and Structure'),
  (1, 'RW', '1',  7, 'SATRW207SHH4', 3, 'mcq', 'Craft and Structure'),
  (1, 'RW', '1',  8, 'SATRW20EJ15P', 3, 'mcq', 'Craft and Structure'),
  (1, 'RW', '1',  9, 'SATRW203C5WC', 1, 'mcq', 'Information and Ideas'),
  (1, 'RW', '1', 10, 'SATRW203D0SH', 1, 'mcq', 'Information and Ideas'),
  (1, 'RW', '1', 11, 'SATRW202LH4M', 2, 'mcq', 'Information and Ideas'),
  (1, 'RW', '1', 12, 'SATRW20CJHBQ', 2, 'mcq', 'Information and Ideas'),
  (1, 'RW', '1', 13, 'SATRW20G7WXR', 2, 'mcq', 'Information and Ideas'),
  (1, 'RW', '1', 14, 'SATRW2050NZQ', 3, 'mcq', 'Information and Ideas'),
  (1, 'RW', '1', 15, 'SATRW206TKQL', 3, 'mcq', 'Information and Ideas'),
  (1, 'RW', '1', 16, 'SATRW2078NYE', 1, 'mcq', 'Standard English Conventions'),
  (1, 'RW', '1', 17, 'SATRW2095UNN', 1, 'mcq', 'Standard English Conventions'),
  (1, 'RW', '1', 18, 'SATRW209MCWB', 2, 'mcq', 'Standard English Conventions'),
  (1, 'RW', '1', 19, 'SATRW20Q9EV4', 2, 'mcq', 'Standard English Conventions'),
  (1, 'RW', '1', 20, 'SATRW20Z78HB', 2, 'mcq', 'Standard English Conventions'),
  (1, 'RW', '1', 21, 'SATRW201N8AT', 3, 'mcq', 'Standard English Conventions'),
  (1, 'RW', '1', 22, 'SATRW204MEO6', 3, 'mcq', 'Standard English Conventions'),
  (1, 'RW', '1', 23, 'SATRW20I0GQ1', 1, 'mcq', 'Expression of Ideas'),
  (1, 'RW', '1', 24, 'SATRW20LIFQY', 1, 'mcq', 'Expression of Ideas'),
  (1, 'RW', '1', 25, 'SATRW2069EY5', 2, 'mcq', 'Expression of Ideas'),
  (1, 'RW', '1', 26, 'SATRW207H11R', 2, 'mcq', 'Expression of Ideas'),
  (1, 'RW', '1', 27, 'SATRW20A1EVV', 3, 'mcq', 'Expression of Ideas'),
  -- form 1 · Reading and Writing · module 2A
  (1, 'RW', '2A',  1, 'SATRW20C7KVQ', 1, 'mcq', 'Craft and Structure'),
  (1, 'RW', '2A',  2, 'SATRW20E5663', 1, 'mcq', 'Craft and Structure'),
  (1, 'RW', '2A',  3, 'SATRW20KORR2', 1, 'mcq', 'Craft and Structure'),
  (1, 'RW', '2A',  4, 'SATRW20KVWX8', 1, 'mcq', 'Craft and Structure'),
  (1, 'RW', '2A',  5, 'SATRW20G8AHT', 2, 'mcq', 'Craft and Structure'),
  (1, 'RW', '2A',  6, 'SATRW20KJQR0', 2, 'mcq', 'Craft and Structure'),
  (1, 'RW', '2A',  7, 'SATRW20I9NDP', 3, 'mcq', 'Craft and Structure'),
  (1, 'RW', '2A',  8, 'SATRW203HDPI', 1, 'mcq', 'Information and Ideas'),
  (1, 'RW', '2A',  9, 'SATRW206LI46', 1, 'mcq', 'Information and Ideas'),
  (1, 'RW', '2A', 10, 'SATRW207BPG0', 1, 'mcq', 'Information and Ideas'),
  (1, 'RW', '2A', 11, 'SATRW20CFIY1', 1, 'mcq', 'Information and Ideas'),
  (1, 'RW', '2A', 12, 'SATRW20X7UWL', 2, 'mcq', 'Information and Ideas'),
  (1, 'RW', '2A', 13, 'SATRW215AVGB', 2, 'mcq', 'Information and Ideas'),
  (1, 'RW', '2A', 14, 'SATRW20BFJV3', 3, 'mcq', 'Information and Ideas'),
  (1, 'RW', '2A', 15, 'SATRW20AXG4F', 1, 'mcq', 'Standard English Conventions'),
  (1, 'RW', '2A', 16, 'SATRW20NKJ1C', 1, 'mcq', 'Standard English Conventions'),
  (1, 'RW', '2A', 17, 'SATRW20V83ZN', 1, 'mcq', 'Standard English Conventions'),
  (1, 'RW', '2A', 18, 'SATRW2120CCQ', 2, 'mcq', 'Standard English Conventions'),
  (1, 'RW', '2A', 19, 'SATRW218GIPF', 2, 'mcq', 'Standard English Conventions'),
  (1, 'RW', '2A', 20, 'SATRW21ER0C1', 2, 'mcq', 'Standard English Conventions'),
  (1, 'RW', '2A', 21, 'SATRW2057BOZ', 3, 'mcq', 'Standard English Conventions'),
  (1, 'RW', '2A', 22, 'SATRW20Q8MD0', 1, 'mcq', 'Expression of Ideas'),
  (1, 'RW', '2A', 23, 'SATRW20XKGRB', 1, 'mcq', 'Expression of Ideas'),
  (1, 'RW', '2A', 24, 'SATRW2122NED', 1, 'mcq', 'Expression of Ideas'),
  (1, 'RW', '2A', 25, 'SATRW207UMXR', 2, 'mcq', 'Expression of Ideas'),
  (1, 'RW', '2A', 26, 'SATRW209UTD0', 2, 'mcq', 'Expression of Ideas'),
  (1, 'RW', '2A', 27, 'SATRW20A2JNE', 3, 'mcq', 'Expression of Ideas'),
  -- form 1 · Reading and Writing · module 2B
  (1, 'RW', '2B',  1, 'SATRW20TRO7K', 1, 'mcq', 'Craft and Structure'),
  (1, 'RW', '2B',  2, 'SATRW20U3W0B', 2, 'mcq', 'Craft and Structure'),
  (1, 'RW', '2B',  3, 'SATRW210K8RA', 2, 'mcq', 'Craft and Structure'),
  (1, 'RW', '2B',  4, 'SATRW20KMIHD', 3, 'mcq', 'Craft and Structure'),
  (1, 'RW', '2B',  5, 'SATRW20L5HDL', 3, 'mcq', 'Craft and Structure'),
  (1, 'RW', '2B',  6, 'SATRW20MBALZ', 3, 'mcq', 'Craft and Structure'),
  (1, 'RW', '2B',  7, 'SATRW20MQNCI', 3, 'mcq', 'Craft and Structure'),
  (1, 'RW', '2B',  8, 'SATRW20K7LSY', 1, 'mcq', 'Information and Ideas'),
  (1, 'RW', '2B',  9, 'SATRW219E8CJ', 2, 'mcq', 'Information and Ideas'),
  (1, 'RW', '2B', 10, 'SATRW219L4TG', 2, 'mcq', 'Information and Ideas'),
  (1, 'RW', '2B', 11, 'SATRW20DD83L', 3, 'mcq', 'Information and Ideas'),
  (1, 'RW', '2B', 12, 'SATRW20G02WN', 3, 'mcq', 'Information and Ideas'),
  (1, 'RW', '2B', 13, 'SATRW20R7DR3', 3, 'mcq', 'Information and Ideas'),
  (1, 'RW', '2B', 14, 'SATRW20ZOPFD', 3, 'mcq', 'Information and Ideas'),
  (1, 'RW', '2B', 15, 'SATRW20VVGRO', 1, 'mcq', 'Standard English Conventions'),
  (1, 'RW', '2B', 16, 'SATRW21YZX01', 2, 'mcq', 'Standard English Conventions'),
  (1, 'RW', '2B', 17, 'SATRW22LNNZA', 2, 'mcq', 'Standard English Conventions'),
  (1, 'RW', '2B', 18, 'SATRW22NYANP', 2, 'mcq', 'Standard English Conventions'),
  (1, 'RW', '2B', 19, 'SATRW20L4BGF', 3, 'mcq', 'Standard English Conventions'),
  (1, 'RW', '2B', 20, 'SATRW20N2Z7I', 3, 'mcq', 'Standard English Conventions'),
  (1, 'RW', '2B', 21, 'SATRW20OS93K', 3, 'mcq', 'Standard English Conventions'),
  (1, 'RW', '2B', 22, 'SATRW21EBOFA', 1, 'mcq', 'Expression of Ideas'),
  (1, 'RW', '2B', 23, 'SATRW20ETJ7Q', 2, 'mcq', 'Expression of Ideas'),
  (1, 'RW', '2B', 24, 'SATRW20GOLOW', 2, 'mcq', 'Expression of Ideas'),
  (1, 'RW', '2B', 25, 'SATRW20D7EYY', 3, 'mcq', 'Expression of Ideas'),
  (1, 'RW', '2B', 26, 'SATRW20DL1Z2', 3, 'mcq', 'Expression of Ideas'),
  (1, 'RW', '2B', 27, 'SATRW20F03JT', 3, 'mcq', 'Expression of Ideas'),
  -- form 1 · Math · module 1
  (1, 'M', '1',  1, 'SATM200CDWP', 1, 'mcq', 'Algebra'),
  (1, 'M', '1',  2, 'SATM2044BKK', 1, 'mcq', 'Algebra'),
  (1, 'M', '1',  3, 'SATM20PQF10', 1, 'grid_in', 'Algebra'),
  (1, 'M', '1',  4, 'SATM206XTKF', 1, 'mcq', 'Advanced Math'),
  (1, 'M', '1',  5, 'SATM20A9WV1', 1, 'mcq', 'Advanced Math'),
  (1, 'M', '1',  6, 'SATM204CPZI', 1, 'mcq', 'Problem Solving and Data Analysis'),
  (1, 'M', '1',  7, 'SATM22G4QVX', 1, 'grid_in', 'Geometry and Trigonometry'),
  (1, 'M', '1',  8, 'SATM203AATV', 2, 'mcq', 'Algebra'),
  (1, 'M', '1',  9, 'SATM203DJ80', 2, 'mcq', 'Algebra'),
  (1, 'M', '1', 10, 'SATM2091JX6', 2, 'mcq', 'Algebra'),
  (1, 'M', '1', 11, 'SATM200PFFQ', 2, 'mcq', 'Advanced Math'),
  (1, 'M', '1', 12, 'SATM202GZV2', 2, 'mcq', 'Advanced Math'),
  (1, 'M', '1', 13, 'SATM204BHOK', 2, 'mcq', 'Advanced Math'),
  (1, 'M', '1', 14, 'SATM202ZNXY', 2, 'mcq', 'Problem Solving and Data Analysis'),
  (1, 'M', '1', 15, 'SATM21EBTTT', 2, 'grid_in', 'Problem Solving and Data Analysis'),
  (1, 'M', '1', 16, 'SATM207ECZS', 2, 'mcq', 'Geometry and Trigonometry'),
  (1, 'M', '1', 17, 'SATM2015CIV', 3, 'mcq', 'Algebra'),
  (1, 'M', '1', 18, 'SATM203K97B', 3, 'mcq', 'Algebra'),
  (1, 'M', '1', 19, 'SATM201012C', 3, 'mcq', 'Advanced Math'),
  (1, 'M', '1', 20, 'SATM2031QKC', 3, 'mcq', 'Advanced Math'),
  (1, 'M', '1', 21, 'SATM201CKB1', 3, 'mcq', 'Problem Solving and Data Analysis'),
  (1, 'M', '1', 22, 'SATM20CPB1S', 3, 'mcq', 'Geometry and Trigonometry'),
  -- form 1 · Math · module 2A
  (1, 'M', '2A',  1, 'SATM2082MTB', 1, 'mcq', 'Algebra'),
  (1, 'M', '2A',  2, 'SATM209CCIX', 1, 'mcq', 'Algebra'),
  (1, 'M', '2A',  3, 'SATM20V5O3N', 1, 'grid_in', 'Algebra'),
  (1, 'M', '2A',  4, 'SATM215AO9B', 1, 'grid_in', 'Algebra'),
  (1, 'M', '2A',  5, 'SATM204QECF', 1, 'grid_in', 'Advanced Math'),
  (1, 'M', '2A',  6, 'SATM20EISV3', 1, 'mcq', 'Advanced Math'),
  (1, 'M', '2A',  7, 'SATM20FICUM', 1, 'mcq', 'Advanced Math'),
  (1, 'M', '2A',  8, 'SATM20RA359', 1, 'mcq', 'Advanced Math'),
  (1, 'M', '2A',  9, 'SATM205AHRG', 1, 'grid_in', 'Problem Solving and Data Analysis'),
  (1, 'M', '2A', 10, 'SATM205KSTH', 1, 'mcq', 'Problem Solving and Data Analysis'),
  (1, 'M', '2A', 11, 'SATM22SH3YN', 1, 'grid_in', 'Geometry and Trigonometry'),
  (1, 'M', '2A', 12, 'SATM200U6DX', 2, 'grid_in', 'Algebra'),
  (1, 'M', '2A', 13, 'SATM20A9LKV', 2, 'mcq', 'Algebra'),
  (1, 'M', '2A', 14, 'SATM207LXCD', 2, 'mcq', 'Advanced Math'),
  (1, 'M', '2A', 15, 'SATM20MPOE5', 2, 'mcq', 'Advanced Math'),
  (1, 'M', '2A', 16, 'SATM20XCF7F', 2, 'mcq', 'Advanced Math'),
  (1, 'M', '2A', 17, 'SATM21KXVSH', 2, 'grid_in', 'Problem Solving and Data Analysis'),
  (1, 'M', '2A', 18, 'SATM2026128', 2, 'grid_in', 'Geometry and Trigonometry'),
  (1, 'M', '2A', 19, 'SATM20C1JHU', 2, 'mcq', 'Geometry and Trigonometry'),
  (1, 'M', '2A', 20, 'SATM20IVM2D', 3, 'mcq', 'Algebra'),
  (1, 'M', '2A', 21, 'SATM204PWIO', 3, 'mcq', 'Advanced Math'),
  (1, 'M', '2A', 22, 'SATM20IIMWG', 3, 'mcq', 'Geometry and Trigonometry'),
  -- form 1 · Math · module 2B
  (1, 'M', '2B',  1, 'SATM20NYOFN', 1, 'mcq', 'Algebra'),
  (1, 'M', '2B',  2, 'SATM21E4LLY', 1, 'mcq', 'Advanced Math'),
  (1, 'M', '2B',  3, 'SATM233RXVW', 1, 'grid_in', 'Geometry and Trigonometry'),
  (1, 'M', '2B',  4, 'SATM20FFV4W', 2, 'mcq', 'Algebra'),
  (1, 'M', '2B',  5, 'SATM20SQ00T', 2, 'grid_in', 'Algebra'),
  (1, 'M', '2B',  6, 'SATM20YQE1V', 2, 'mcq', 'Advanced Math'),
  (1, 'M', '2B',  7, 'SATM20Z3TSW', 2, 'mcq', 'Advanced Math'),
  (1, 'M', '2B',  8, 'SATM216LIWK', 2, 'mcq', 'Advanced Math'),
  (1, 'M', '2B',  9, 'SATM21MM5MT', 2, 'grid_in', 'Problem Solving and Data Analysis'),
  (1, 'M', '2B', 10, 'SATM205C8A2', 2, 'grid_in', 'Geometry and Trigonometry'),
  (1, 'M', '2B', 11, 'SATM20IB2WT', 2, 'mcq', 'Geometry and Trigonometry'),
  (1, 'M', '2B', 12, 'SATM20L2PDV', 3, 'grid_in', 'Algebra'),
  (1, 'M', '2B', 13, 'SATM20LTQ13', 3, 'mcq', 'Algebra'),
  (1, 'M', '2B', 14, 'SATM20NERFE', 3, 'mcq', 'Algebra'),
  (1, 'M', '2B', 15, 'SATM21CWMJ8', 3, 'grid_in', 'Algebra'),
  (1, 'M', '2B', 16, 'SATM206J0JN', 3, 'mcq', 'Advanced Math'),
  (1, 'M', '2B', 17, 'SATM20CJUAF', 3, 'mcq', 'Advanced Math'),
  (1, 'M', '2B', 18, 'SATM20IM6GB', 3, 'grid_in', 'Advanced Math'),
  (1, 'M', '2B', 19, 'SATM20YZBDZ', 3, 'mcq', 'Advanced Math'),
  (1, 'M', '2B', 20, 'SATM208TGZW', 3, 'grid_in', 'Problem Solving and Data Analysis'),
  (1, 'M', '2B', 21, 'SATM20AAZ93', 3, 'mcq', 'Problem Solving and Data Analysis'),
  (1, 'M', '2B', 22, 'SATM2128GUM', 3, 'mcq', 'Geometry and Trigonometry'),
  -- form 2 · Reading and Writing · module 1
  (2, 'RW', '1',  1, 'SATRW20UYQDS', 1, 'mcq', 'Craft and Structure'),
  (2, 'RW', '1',  2, 'SATRW20W09QE', 1, 'mcq', 'Craft and Structure'),
  (2, 'RW', '1',  3, 'SATRW213PTCW', 2, 'mcq', 'Craft and Structure'),
  (2, 'RW', '1',  4, 'SATRW2156DTV', 2, 'mcq', 'Craft and Structure'),
  (2, 'RW', '1',  5, 'SATRW216B7P0', 2, 'mcq', 'Craft and Structure'),
  (2, 'RW', '1',  6, 'SATRW20YIGI4', 3, 'mcq', 'Craft and Structure'),
  (2, 'RW', '1',  7, 'SATRW20Z60GM', 3, 'mcq', 'Craft and Structure'),
  (2, 'RW', '1',  8, 'SATRW215UM02', 3, 'mcq', 'Craft and Structure'),
  (2, 'RW', '1',  9, 'SATRW20PHX00', 1, 'mcq', 'Information and Ideas'),
  (2, 'RW', '1', 10, 'SATRW20RHRH3', 1, 'mcq', 'Information and Ideas'),
  (2, 'RW', '1', 11, 'SATRW21AS98V', 2, 'mcq', 'Information and Ideas'),
  (2, 'RW', '1', 12, 'SATRW21Q34KC', 2, 'mcq', 'Information and Ideas'),
  (2, 'RW', '1', 13, 'SATRW21X92JB', 2, 'mcq', 'Information and Ideas'),
  (2, 'RW', '1', 14, 'SATRW212TWV3', 3, 'mcq', 'Information and Ideas'),
  (2, 'RW', '1', 15, 'SATRW212YMVD', 3, 'mcq', 'Information and Ideas'),
  (2, 'RW', '1', 16, 'SATRW2114QV3', 1, 'mcq', 'Standard English Conventions'),
  (2, 'RW', '1', 17, 'SATRW214VXF6', 1, 'mcq', 'Standard English Conventions'),
  (2, 'RW', '1', 18, 'SATRW22YJNIH', 2, 'mcq', 'Standard English Conventions'),
  (2, 'RW', '1', 19, 'SATRW23JFND3', 2, 'mcq', 'Standard English Conventions'),
  (2, 'RW', '1', 20, 'SATRW23LU9EO', 2, 'mcq', 'Standard English Conventions'),
  (2, 'RW', '1', 21, 'SATRW20OXDIC', 3, 'mcq', 'Standard English Conventions'),
  (2, 'RW', '1', 22, 'SATRW20XD98A', 3, 'mcq', 'Standard English Conventions'),
  (2, 'RW', '1', 23, 'SATRW21YI1XY', 1, 'mcq', 'Expression of Ideas'),
  (2, 'RW', '1', 24, 'SATRW227ZWCC', 1, 'mcq', 'Expression of Ideas'),
  (2, 'RW', '1', 25, 'SATRW20GVU44', 2, 'mcq', 'Expression of Ideas'),
  (2, 'RW', '1', 26, 'SATRW20LS1PE', 2, 'mcq', 'Expression of Ideas'),
  (2, 'RW', '1', 27, 'SATRW20L70EN', 3, 'mcq', 'Expression of Ideas'),
  -- form 2 · Reading and Writing · module 2A
  (2, 'RW', '2A',  1, 'SATRW20Y1P4Z', 1, 'mcq', 'Craft and Structure'),
  (2, 'RW', '2A',  2, 'SATRW211GN5A', 1, 'mcq', 'Craft and Structure'),
  (2, 'RW', '2A',  3, 'SATRW21FU69B', 1, 'mcq', 'Craft and Structure'),
  (2, 'RW', '2A',  4, 'SATRW21I3WVE', 1, 'mcq', 'Craft and Structure'),
  (2, 'RW', '2A',  5, 'SATRW216MFE1', 2, 'mcq', 'Craft and Structure'),
  (2, 'RW', '2A',  6, 'SATRW219PFCB', 2, 'mcq', 'Craft and Structure'),
  (2, 'RW', '2A',  7, 'SATRW21HDF29', 3, 'mcq', 'Craft and Structure'),
  (2, 'RW', '2A',  8, 'SATRW20RUSJO', 1, 'mcq', 'Information and Ideas'),
  (2, 'RW', '2A',  9, 'SATRW20X8MQH', 1, 'mcq', 'Information and Ideas'),
  (2, 'RW', '2A', 10, 'SATRW214Q694', 1, 'mcq', 'Information and Ideas'),
  (2, 'RW', '2A', 11, 'SATRW21EU89W', 1, 'mcq', 'Information and Ideas'),
  (2, 'RW', '2A', 12, 'SATRW221NQFX', 2, 'mcq', 'Information and Ideas'),
  (2, 'RW', '2A', 13, 'SATRW224TV5N', 2, 'mcq', 'Information and Ideas'),
  (2, 'RW', '2A', 14, 'SATRW21607IE', 3, 'mcq', 'Information and Ideas'),
  (2, 'RW', '2A', 15, 'SATRW21H8TUL', 1, 'mcq', 'Standard English Conventions'),
  (2, 'RW', '2A', 16, 'SATRW21W9KTB', 1, 'mcq', 'Standard English Conventions'),
  (2, 'RW', '2A', 17, 'SATRW229WYF3', 1, 'mcq', 'Standard English Conventions'),
  (2, 'RW', '2A', 18, 'SATRW23MNIGI', 2, 'mcq', 'Standard English Conventions'),
  (2, 'RW', '2A', 19, 'SATRW241DEIT', 2, 'mcq', 'Standard English Conventions'),
  (2, 'RW', '2A', 20, 'SATRW249DYFK', 2, 'mcq', 'Standard English Conventions'),
  (2, 'RW', '2A', 21, 'SATRW20YILR1', 3, 'mcq', 'Standard English Conventions'),
  (2, 'RW', '2A', 22, 'SATRW22EEXSF', 1, 'mcq', 'Expression of Ideas'),
  (2, 'RW', '2A', 23, 'SATRW23B2YTY', 1, 'mcq', 'Expression of Ideas'),
  (2, 'RW', '2A', 24, 'SATRW23DOHDD', 1, 'mcq', 'Expression of Ideas'),
  (2, 'RW', '2A', 25, 'SATRW2107BD2', 2, 'mcq', 'Expression of Ideas'),
  (2, 'RW', '2A', 26, 'SATRW21ALWEE', 2, 'mcq', 'Expression of Ideas'),
  (2, 'RW', '2A', 27, 'SATRW20M2TYN', 3, 'mcq', 'Expression of Ideas'),
  -- form 2 · Reading and Writing · module 2B
  (2, 'RW', '2B',  1, 'SATRW21LKW8L', 1, 'mcq', 'Craft and Structure'),
  (2, 'RW', '2B',  2, 'SATRW21CRKUJ', 2, 'mcq', 'Craft and Structure'),
  (2, 'RW', '2B',  3, 'SATRW21EK9PC', 2, 'mcq', 'Craft and Structure'),
  (2, 'RW', '2B',  4, 'SATRW221HUGB', 3, 'mcq', 'Craft and Structure'),
  (2, 'RW', '2B',  5, 'SATRW22B2BPB', 3, 'mcq', 'Craft and Structure'),
  (2, 'RW', '2B',  6, 'SATRW22GUAAB', 3, 'mcq', 'Craft and Structure'),
  (2, 'RW', '2B',  7, 'SATRW22HX1P3', 3, 'mcq', 'Craft and Structure'),
  (2, 'RW', '2B',  8, 'SATRW21KULOZ', 1, 'mcq', 'Information and Ideas'),
  (2, 'RW', '2B',  9, 'SATRW22BD8P5', 2, 'mcq', 'Information and Ideas'),
  (2, 'RW', '2B', 10, 'SATRW22E1C0E', 2, 'mcq', 'Information and Ideas'),
  (2, 'RW', '2B', 11, 'SATRW21GFWV2', 3, 'mcq', 'Information and Ideas'),
  (2, 'RW', '2B', 12, 'SATRW21QO6JG', 3, 'mcq', 'Information and Ideas'),
  (2, 'RW', '2B', 13, 'SATRW21UQ99Z', 3, 'mcq', 'Information and Ideas'),
  (2, 'RW', '2B', 14, 'SATRW22W7OD0', 3, 'mcq', 'Information and Ideas'),
  (2, 'RW', '2B', 15, 'SATRW22MZM66', 1, 'mcq', 'Standard English Conventions'),
  (2, 'RW', '2B', 16, 'SATRW24OLS3H', 2, 'mcq', 'Standard English Conventions'),
  (2, 'RW', '2B', 17, 'SATRW251IPX4', 2, 'mcq', 'Standard English Conventions'),
  (2, 'RW', '2B', 18, 'SATRW259OPHS', 2, 'mcq', 'Standard English Conventions'),
  (2, 'RW', '2B', 19, 'SATRW210BE3I', 3, 'mcq', 'Standard English Conventions'),
  (2, 'RW', '2B', 20, 'SATRW211FLV2', 3, 'mcq', 'Standard English Conventions'),
  (2, 'RW', '2B', 21, 'SATRW211KIAF', 3, 'mcq', 'Standard English Conventions'),
  (2, 'RW', '2B', 22, 'SATRW23HVEKR', 1, 'mcq', 'Expression of Ideas'),
  (2, 'RW', '2B', 23, 'SATRW21HETYP', 2, 'mcq', 'Expression of Ideas'),
  (2, 'RW', '2B', 24, 'SATRW21MB93H', 2, 'mcq', 'Expression of Ideas'),
  (2, 'RW', '2B', 25, 'SATRW20UEH2A', 3, 'mcq', 'Expression of Ideas'),
  (2, 'RW', '2B', 26, 'SATRW20W3AGT', 3, 'mcq', 'Expression of Ideas'),
  (2, 'RW', '2B', 27, 'SATRW210FOJK', 3, 'mcq', 'Expression of Ideas'),
  -- form 2 · Math · module 1
  (2, 'M', '1',  1, 'SATM20P46C0', 1, 'mcq', 'Algebra'),
  (2, 'M', '1',  2, 'SATM20ROM6V', 1, 'mcq', 'Algebra'),
  (2, 'M', '1',  3, 'SATM21G4R0U', 1, 'grid_in', 'Algebra'),
  (2, 'M', '1',  4, 'SATM21SCC5H', 1, 'mcq', 'Advanced Math'),
  (2, 'M', '1',  5, 'SATM21SNXCV', 1, 'mcq', 'Advanced Math'),
  (2, 'M', '1',  6, 'SATM2095NPN', 1, 'mcq', 'Problem Solving and Data Analysis'),
  (2, 'M', '1',  7, 'SATM23COSHF', 1, 'grid_in', 'Geometry and Trigonometry'),
  (2, 'M', '1',  8, 'SATM20RDIFH', 2, 'mcq', 'Algebra'),
  (2, 'M', '1',  9, 'SATM20W4N05', 2, 'mcq', 'Algebra'),
  (2, 'M', '1', 10, 'SATM210GDJ2', 2, 'mcq', 'Algebra'),
  (2, 'M', '1', 11, 'SATM218UOOW', 2, 'mcq', 'Advanced Math'),
  (2, 'M', '1', 12, 'SATM21C51FA', 2, 'mcq', 'Advanced Math'),
  (2, 'M', '1', 13, 'SATM21M66IM', 2, 'mcq', 'Advanced Math'),
  (2, 'M', '1', 14, 'SATM205F5RU', 2, 'mcq', 'Problem Solving and Data Analysis'),
  (2, 'M', '1', 15, 'SATM236HK1T', 2, 'grid_in', 'Problem Solving and Data Analysis'),
  (2, 'M', '1', 16, 'SATM20ODTL6', 2, 'mcq', 'Geometry and Trigonometry'),
  (2, 'M', '1', 17, 'SATM20O2ZQV', 3, 'mcq', 'Algebra'),
  (2, 'M', '1', 18, 'SATM20OL8DL', 3, 'mcq', 'Algebra'),
  (2, 'M', '1', 19, 'SATM215QHL1', 3, 'mcq', 'Advanced Math'),
  (2, 'M', '1', 20, 'SATM218T8RI', 3, 'mcq', 'Advanced Math'),
  (2, 'M', '1', 21, 'SATM20H5RP3', 3, 'mcq', 'Problem Solving and Data Analysis'),
  (2, 'M', '1', 22, 'SATM21CO7HO', 3, 'mcq', 'Geometry and Trigonometry'),
  -- form 2 · Math · module 2A
  (2, 'M', '2A',  1, 'SATM20XT4KY', 1, 'mcq', 'Algebra'),
  (2, 'M', '2A',  2, 'SATM2137FFF', 1, 'mcq', 'Algebra'),
  (2, 'M', '2A',  3, 'SATM21R6TME', 1, 'grid_in', 'Algebra'),
  (2, 'M', '2A',  4, 'SATM22D53R1', 1, 'grid_in', 'Algebra'),
  (2, 'M', '2A',  5, 'SATM20IRDCZ', 1, 'grid_in', 'Advanced Math'),
  (2, 'M', '2A',  6, 'SATM21UZYNF', 1, 'mcq', 'Advanced Math'),
  (2, 'M', '2A',  7, 'SATM21XNBSO', 1, 'mcq', 'Advanced Math'),
  (2, 'M', '2A',  8, 'SATM21Z8W9U', 1, 'mcq', 'Advanced Math'),
  (2, 'M', '2A',  9, 'SATM209MA1K', 1, 'mcq', 'Problem Solving and Data Analysis'),
  (2, 'M', '2A', 10, 'SATM20AJW6R', 1, 'grid_in', 'Problem Solving and Data Analysis'),
  (2, 'M', '2A', 11, 'SATM244ZQE1', 1, 'grid_in', 'Geometry and Trigonometry'),
  (2, 'M', '2A', 12, 'SATM216BBH2', 2, 'mcq', 'Algebra'),
  (2, 'M', '2A', 13, 'SATM21AMGAE', 2, 'grid_in', 'Algebra'),
  (2, 'M', '2A', 14, 'SATM21PTT4K', 2, 'mcq', 'Advanced Math'),
  (2, 'M', '2A', 15, 'SATM22064E1', 2, 'mcq', 'Advanced Math'),
  (2, 'M', '2A', 16, 'SATM222I2DF', 2, 'mcq', 'Advanced Math'),
  (2, 'M', '2A', 17, 'SATM23CAGEY', 2, 'grid_in', 'Problem Solving and Data Analysis'),
  (2, 'M', '2A', 18, 'SATM210HPEP', 2, 'mcq', 'Geometry and Trigonometry'),
  (2, 'M', '2A', 19, 'SATM219BSLG', 2, 'grid_in', 'Geometry and Trigonometry'),
  (2, 'M', '2A', 20, 'SATM20Q0Q6E', 3, 'mcq', 'Algebra'),
  (2, 'M', '2A', 21, 'SATM218XAEJ', 3, 'mcq', 'Advanced Math'),
  (2, 'M', '2A', 22, 'SATM21DYFGN', 3, 'mcq', 'Geometry and Trigonometry'),
  -- form 2 · Math · module 2B
  (2, 'M', '2B',  1, 'SATM21DCBND', 1, 'mcq', 'Algebra'),
  (2, 'M', '2B',  2, 'SATM21ZU0O5', 1, 'mcq', 'Advanced Math'),
  (2, 'M', '2B',  3, 'SATM24GOWWY', 1, 'grid_in', 'Geometry and Trigonometry'),
  (2, 'M', '2B',  4, 'SATM219NCJC', 2, 'mcq', 'Algebra'),
  (2, 'M', '2B',  5, 'SATM21WWK4K', 2, 'grid_in', 'Algebra'),
  (2, 'M', '2B',  6, 'SATM2266SOE', 2, 'mcq', 'Advanced Math'),
  (2, 'M', '2B',  7, 'SATM22DPC2P', 2, 'mcq', 'Advanced Math'),
  (2, 'M', '2B',  8, 'SATM22E0MFD', 2, 'mcq', 'Advanced Math'),
  (2, 'M', '2B',  9, 'SATM23G49TN', 2, 'grid_in', 'Problem Solving and Data Analysis'),
  (2, 'M', '2B', 10, 'SATM219GUOY', 2, 'mcq', 'Geometry and Trigonometry'),
  (2, 'M', '2B', 11, 'SATM22KRDI2', 2, 'grid_in', 'Geometry and Trigonometry'),
  (2, 'M', '2B', 12, 'SATM20RQ8VK', 3, 'mcq', 'Algebra'),
  (2, 'M', '2B', 13, 'SATM20XXNAR', 3, 'mcq', 'Algebra'),
  (2, 'M', '2B', 14, 'SATM21SWADW', 3, 'grid_in', 'Algebra'),
  (2, 'M', '2B', 15, 'SATM21T1MCK', 3, 'grid_in', 'Algebra'),
  (2, 'M', '2B', 16, 'SATM219BLHR', 3, 'mcq', 'Advanced Math'),
  (2, 'M', '2B', 17, 'SATM21SADY9', 3, 'mcq', 'Advanced Math'),
  (2, 'M', '2B', 18, 'SATM228QRSA', 3, 'mcq', 'Advanced Math'),
  (2, 'M', '2B', 19, 'SATM22JIFYZ', 3, 'grid_in', 'Advanced Math'),
  (2, 'M', '2B', 20, 'SATM20910P7', 3, 'grid_in', 'Problem Solving and Data Analysis'),
  (2, 'M', '2B', 21, 'SATM20I2D84', 3, 'mcq', 'Problem Solving and Data Analysis'),
  (2, 'M', '2B', 22, 'SATM21O3E2S', 3, 'mcq', 'Geometry and Trigonometry'),
  -- form 3 · Reading and Writing · module 1
  (3, 'RW', '1',  1, 'SATRW21O98BS', 1, 'mcq', 'Craft and Structure'),
  (3, 'RW', '1',  2, 'SATRW21QCID7', 1, 'mcq', 'Craft and Structure'),
  (3, 'RW', '1',  3, 'SATRW21VPVHP', 2, 'mcq', 'Craft and Structure'),
  (3, 'RW', '1',  4, 'SATRW21Y8DEH', 2, 'mcq', 'Craft and Structure'),
  (3, 'RW', '1',  5, 'SATRW22NVS5M', 2, 'mcq', 'Craft and Structure'),
  (3, 'RW', '1',  6, 'SATRW22O13V2', 3, 'mcq', 'Craft and Structure'),
  (3, 'RW', '1',  7, 'SATRW22PJI5U', 3, 'mcq', 'Craft and Structure'),
  (3, 'RW', '1',  8, 'SATRW22VKNEY', 3, 'mcq', 'Craft and Structure'),
  (3, 'RW', '1',  9, 'SATRW21O9UP5', 1, 'mcq', 'Information and Ideas'),
  (3, 'RW', '1', 10, 'SATRW21W8I6Q', 1, 'mcq', 'Information and Ideas'),
  (3, 'RW', '1', 11, 'SATRW22H6YZX', 2, 'mcq', 'Information and Ideas'),
  (3, 'RW', '1', 12, 'SATRW22Q05WW', 2, 'mcq', 'Information and Ideas'),
  (3, 'RW', '1', 13, 'SATRW22SXQX2', 2, 'mcq', 'Information and Ideas'),
  (3, 'RW', '1', 14, 'SATRW22XA3EO', 3, 'mcq', 'Information and Ideas'),
  (3, 'RW', '1', 15, 'SATRW235RFFI', 3, 'mcq', 'Information and Ideas'),
  (3, 'RW', '1', 16, 'SATRW23473CF', 1, 'mcq', 'Standard English Conventions'),
  (3, 'RW', '1', 17, 'SATRW23985IN', 1, 'mcq', 'Standard English Conventions'),
  (3, 'RW', '1', 18, 'SATRW25K5UCT', 2, 'mcq', 'Standard English Conventions'),
  (3, 'RW', '1', 19, 'SATRW2650JNX', 2, 'mcq', 'Standard English Conventions'),
  (3, 'RW', '1', 20, 'SATRW273L9YM', 2, 'mcq', 'Standard English Conventions'),
  (3, 'RW', '1', 21, 'SATRW214OY4B', 3, 'mcq', 'Standard English Conventions'),
  (3, 'RW', '1', 22, 'SATRW2191EH8', 3, 'mcq', 'Standard English Conventions'),
  (3, 'RW', '1', 23, 'SATRW23QA5AX', 1, 'mcq', 'Expression of Ideas'),
  (3, 'RW', '1', 24, 'SATRW23SCZKX', 1, 'mcq', 'Expression of Ideas'),
  (3, 'RW', '1', 25, 'SATRW21ME8RC', 2, 'mcq', 'Expression of Ideas'),
  (3, 'RW', '1', 26, 'SATRW22DANS3', 2, 'mcq', 'Expression of Ideas'),
  (3, 'RW', '1', 27, 'SATRW21GLXCD', 3, 'mcq', 'Expression of Ideas'),
  -- form 3 · Reading and Writing · module 2A
  (3, 'RW', '2A',  1, 'SATRW21VN3M6', 1, 'mcq', 'Craft and Structure'),
  (3, 'RW', '2A',  2, 'SATRW223A5UN', 1, 'mcq', 'Craft and Structure'),
  (3, 'RW', '2A',  3, 'SATRW224HZUN', 1, 'mcq', 'Craft and Structure'),
  (3, 'RW', '2A',  4, 'SATRW224L3PF', 1, 'mcq', 'Craft and Structure'),
  (3, 'RW', '2A',  5, 'SATRW22VTKT9', 2, 'mcq', 'Craft and Structure'),
  (3, 'RW', '2A',  6, 'SATRW238VTWC', 2, 'mcq', 'Craft and Structure'),
  (3, 'RW', '2A',  7, 'SATRW239NO4R', 3, 'mcq', 'Craft and Structure'),
  (3, 'RW', '2A',  8, 'SATRW21ZONJ4', 1, 'mcq', 'Information and Ideas'),
  (3, 'RW', '2A',  9, 'SATRW220D95R', 1, 'mcq', 'Information and Ideas'),
  (3, 'RW', '2A', 10, 'SATRW22KLNLL', 1, 'mcq', 'Information and Ideas'),
  (3, 'RW', '2A', 11, 'SATRW22L3RTX', 1, 'mcq', 'Information and Ideas'),
  (3, 'RW', '2A', 12, 'SATRW22VI8R5', 2, 'mcq', 'Information and Ideas'),
  (3, 'RW', '2A', 13, 'SATRW22YG9CB', 2, 'mcq', 'Information and Ideas'),
  (3, 'RW', '2A', 14, 'SATRW23AXS7F', 3, 'mcq', 'Information and Ideas'),
  (3, 'RW', '2A', 15, 'SATRW23CY9DN', 1, 'mcq', 'Standard English Conventions'),
  (3, 'RW', '2A', 16, 'SATRW23I004V', 1, 'mcq', 'Standard English Conventions'),
  (3, 'RW', '2A', 17, 'SATRW23QRWMC', 1, 'mcq', 'Standard English Conventions'),
  (3, 'RW', '2A', 18, 'SATRW27C021W', 2, 'mcq', 'Standard English Conventions'),
  (3, 'RW', '2A', 19, 'SATRW27DONHS', 2, 'mcq', 'Standard English Conventions'),
  (3, 'RW', '2A', 20, 'SATRW27N8QZ1', 2, 'mcq', 'Standard English Conventions'),
  (3, 'RW', '2A', 21, 'SATRW21DLCM9', 3, 'mcq', 'Standard English Conventions'),
  (3, 'RW', '2A', 22, 'SATRW24E2A1X', 1, 'mcq', 'Expression of Ideas'),
  (3, 'RW', '2A', 23, 'SATRW24EW9KO', 1, 'mcq', 'Expression of Ideas'),
  (3, 'RW', '2A', 24, 'SATRW24S05OM', 1, 'mcq', 'Expression of Ideas'),
  (3, 'RW', '2A', 25, 'SATRW22GRQV7', 2, 'mcq', 'Expression of Ideas'),
  (3, 'RW', '2A', 26, 'SATRW22J08N8', 2, 'mcq', 'Expression of Ideas'),
  (3, 'RW', '2A', 27, 'SATRW21MV2XL', 3, 'mcq', 'Expression of Ideas'),
  -- form 3 · Reading and Writing · module 2B
  (3, 'RW', '2B',  1, 'SATRW22B2846', 1, 'mcq', 'Craft and Structure'),
  (3, 'RW', '2B',  2, 'SATRW239V3XX', 2, 'mcq', 'Craft and Structure'),
  (3, 'RW', '2B',  3, 'SATRW23H8ZYU', 2, 'mcq', 'Craft and Structure'),
  (3, 'RW', '2B',  4, 'SATRW23M8TU4', 3, 'mcq', 'Craft and Structure'),
  (3, 'RW', '2B',  5, 'SATRW23O3WEO', 3, 'mcq', 'Craft and Structure'),
  (3, 'RW', '2B',  6, 'SATRW23PZ659', 3, 'mcq', 'Craft and Structure'),
  (3, 'RW', '2B',  7, 'SATRW23UY93F', 3, 'mcq', 'Craft and Structure'),
  (3, 'RW', '2B',  8, 'SATRW22ONQCY', 1, 'mcq', 'Information and Ideas'),
  (3, 'RW', '2B',  9, 'SATRW22YWE5A', 2, 'mcq', 'Information and Ideas'),
  (3, 'RW', '2B', 10, 'SATRW233NGN2', 2, 'mcq', 'Information and Ideas'),
  (3, 'RW', '2B', 11, 'SATRW23HDFND', 3, 'mcq', 'Information and Ideas'),
  (3, 'RW', '2B', 12, 'SATRW23N27SI', 3, 'mcq', 'Information and Ideas'),
  (3, 'RW', '2B', 13, 'SATRW2465KR2', 3, 'mcq', 'Information and Ideas'),
  (3, 'RW', '2B', 14, 'SATRW24A327Q', 3, 'mcq', 'Information and Ideas'),
  (3, 'RW', '2B', 15, 'SATRW23VMZQP', 1, 'mcq', 'Standard English Conventions'),
  (3, 'RW', '2B', 16, 'SATRW27W0CT3', 2, 'mcq', 'Standard English Conventions'),
  (3, 'RW', '2B', 17, 'SATRW27WCNI0', 2, 'mcq', 'Standard English Conventions'),
  (3, 'RW', '2B', 18, 'SATRW27WS5ST', 2, 'mcq', 'Standard English Conventions'),
  (3, 'RW', '2B', 19, 'SATRW21DV1QM', 3, 'mcq', 'Standard English Conventions'),
  (3, 'RW', '2B', 20, 'SATRW21HL4CJ', 3, 'mcq', 'Standard English Conventions'),
  (3, 'RW', '2B', 21, 'SATRW21OHQZS', 3, 'mcq', 'Standard English Conventions'),
  (3, 'RW', '2B', 22, 'SATRW253G0QC', 1, 'mcq', 'Expression of Ideas'),
  (3, 'RW', '2B', 23, 'SATRW232MKUT', 2, 'mcq', 'Expression of Ideas'),
  (3, 'RW', '2B', 24, 'SATRW23AL4MM', 2, 'mcq', 'Expression of Ideas'),
  (3, 'RW', '2B', 25, 'SATRW21V9KDO', 3, 'mcq', 'Expression of Ideas'),
  (3, 'RW', '2B', 26, 'SATRW21XIO9N', 3, 'mcq', 'Expression of Ideas'),
  (3, 'RW', '2B', 27, 'SATRW227ZMET', 3, 'mcq', 'Expression of Ideas'),
  -- form 3 · Math · module 1
  (3, 'M', '1',  1, 'SATM21FGHB4', 1, 'mcq', 'Algebra'),
  (3, 'M', '1',  2, 'SATM21GBB0W', 1, 'mcq', 'Algebra'),
  (3, 'M', '1',  3, 'SATM22G0RT8', 1, 'grid_in', 'Algebra'),
  (3, 'M', '1',  4, 'SATM2218XBL', 1, 'mcq', 'Advanced Math'),
  (3, 'M', '1',  5, 'SATM223EFJC', 1, 'mcq', 'Advanced Math'),
  (3, 'M', '1',  6, 'SATM20A8XT1', 1, 'mcq', 'Problem Solving and Data Analysis'),
  (3, 'M', '1',  7, 'SATM25O4865', 1, 'grid_in', 'Geometry and Trigonometry'),
  (3, 'M', '1',  8, 'SATM21B0F7Y', 2, 'mcq', 'Algebra'),
  (3, 'M', '1',  9, 'SATM21B6ZQY', 2, 'mcq', 'Algebra'),
  (3, 'M', '1', 10, 'SATM21FBGMG', 2, 'mcq', 'Algebra'),
  (3, 'M', '1', 11, 'SATM2390NWN', 2, 'mcq', 'Advanced Math'),
  (3, 'M', '1', 12, 'SATM239O6TL', 2, 'mcq', 'Advanced Math'),
  (3, 'M', '1', 13, 'SATM23DE3KK', 2, 'mcq', 'Advanced Math'),
  (3, 'M', '1', 14, 'SATM207MTQY', 2, 'mcq', 'Problem Solving and Data Analysis'),
  (3, 'M', '1', 15, 'SATM242RUUZ', 2, 'grid_in', 'Problem Solving and Data Analysis'),
  (3, 'M', '1', 16, 'SATM21EKDH0', 2, 'mcq', 'Geometry and Trigonometry'),
  (3, 'M', '1', 17, 'SATM215FYBC', 3, 'mcq', 'Algebra'),
  (3, 'M', '1', 18, 'SATM21BAVB3', 3, 'mcq', 'Algebra'),
  (3, 'M', '1', 19, 'SATM22MQ5AF', 3, 'mcq', 'Advanced Math'),
  (3, 'M', '1', 20, 'SATM230HZ1U', 3, 'mcq', 'Advanced Math'),
  (3, 'M', '1', 21, 'SATM20S6FH7', 3, 'mcq', 'Problem Solving and Data Analysis'),
  (3, 'M', '1', 22, 'SATM21QBNII', 3, 'mcq', 'Geometry and Trigonometry'),
  -- form 3 · Math · module 2A
  (3, 'M', '2A',  1, 'SATM21HIXE4', 1, 'mcq', 'Algebra'),
  (3, 'M', '2A',  2, 'SATM21NWPPK', 1, 'mcq', 'Algebra'),
  (3, 'M', '2A',  3, 'SATM237QV21', 1, 'grid_in', 'Algebra'),
  (3, 'M', '2A',  4, 'SATM23OVOH4', 1, 'grid_in', 'Algebra'),
  (3, 'M', '2A',  5, 'SATM21DVAZ1', 1, 'grid_in', 'Advanced Math'),
  (3, 'M', '2A',  6, 'SATM22E0UOB', 1, 'mcq', 'Advanced Math'),
  (3, 'M', '2A',  7, 'SATM22NGHUI', 1, 'mcq', 'Advanced Math'),
  (3, 'M', '2A',  8, 'SATM22URMZ6', 1, 'mcq', 'Advanced Math'),
  (3, 'M', '2A',  9, 'SATM20CTWZR', 1, 'mcq', 'Problem Solving and Data Analysis'),
  (3, 'M', '2A', 10, 'SATM20DJMTV', 1, 'grid_in', 'Problem Solving and Data Analysis'),
  (3, 'M', '2A', 11, 'SATM25OF2BJ', 1, 'grid_in', 'Geometry and Trigonometry'),
  (3, 'M', '2A', 12, 'SATM21GGD7R', 2, 'mcq', 'Algebra'),
  (3, 'M', '2A', 13, 'SATM22B9WSR', 2, 'grid_in', 'Algebra'),
  (3, 'M', '2A', 14, 'SATM23NJSZF', 2, 'mcq', 'Advanced Math'),
  (3, 'M', '2A', 15, 'SATM23O8PGM', 2, 'mcq', 'Advanced Math'),
  (3, 'M', '2A', 16, 'SATM23SNUO5', 2, 'mcq', 'Advanced Math'),
  (3, 'M', '2A', 17, 'SATM249QSZS', 2, 'grid_in', 'Problem Solving and Data Analysis'),
  (3, 'M', '2A', 18, 'SATM21FK9YP', 2, 'mcq', 'Geometry and Trigonometry'),
  (3, 'M', '2A', 19, 'SATM22Y0BSE', 2, 'grid_in', 'Geometry and Trigonometry'),
  (3, 'M', '2A', 20, 'SATM21JM0BW', 3, 'mcq', 'Algebra'),
  (3, 'M', '2A', 21, 'SATM231MZ16', 3, 'mcq', 'Advanced Math'),
  (3, 'M', '2A', 22, 'SATM21RG992', 3, 'mcq', 'Geometry and Trigonometry'),
  -- form 3 · Math · module 2B
  (3, 'M', '2B',  1, 'SATM21OEBBB', 1, 'mcq', 'Algebra'),
  (3, 'M', '2B',  2, 'SATM230HBEN', 1, 'mcq', 'Advanced Math'),
  (3, 'M', '2B',  3, 'SATM26GEGRE', 1, 'grid_in', 'Geometry and Trigonometry'),
  (3, 'M', '2B',  4, 'SATM21HIJCS', 2, 'mcq', 'Algebra'),
  (3, 'M', '2B',  5, 'SATM22EHRDW', 2, 'grid_in', 'Algebra'),
  (3, 'M', '2B',  6, 'SATM245DYEA', 2, 'mcq', 'Advanced Math'),
  (3, 'M', '2B',  7, 'SATM245UEHV', 2, 'mcq', 'Advanced Math'),
  (3, 'M', '2B',  8, 'SATM24BHM71', 2, 'mcq', 'Advanced Math'),
  (3, 'M', '2B',  9, 'SATM24AVIRZ', 2, 'grid_in', 'Problem Solving and Data Analysis'),
  (3, 'M', '2B', 10, 'SATM21NMWWW', 2, 'mcq', 'Geometry and Trigonometry'),
  (3, 'M', '2B', 11, 'SATM23CV1L4', 2, 'grid_in', 'Geometry and Trigonometry'),
  (3, 'M', '2B', 12, 'SATM21OGTSG', 3, 'mcq', 'Algebra'),
  (3, 'M', '2B', 13, 'SATM21VDS7A', 3, 'mcq', 'Algebra'),
  (3, 'M', '2B', 14, 'SATM231Q29K', 3, 'grid_in', 'Algebra'),
  (3, 'M', '2B', 15, 'SATM238LR5D', 3, 'grid_in', 'Algebra'),
  (3, 'M', '2B', 16, 'SATM22OVF50', 3, 'grid_in', 'Advanced Math'),
  (3, 'M', '2B', 17, 'SATM232G4F7', 3, 'mcq', 'Advanced Math'),
  (3, 'M', '2B', 18, 'SATM23DL5CG', 3, 'mcq', 'Advanced Math'),
  (3, 'M', '2B', 19, 'SATM23HHZ3Y', 3, 'mcq', 'Advanced Math'),
  (3, 'M', '2B', 20, 'SATM20APRZ6', 3, 'grid_in', 'Problem Solving and Data Analysis'),
  (3, 'M', '2B', 21, 'SATM20UDJZ1', 3, 'mcq', 'Problem Solving and Data Analysis'),
  (3, 'M', '2B', 22, 'SATM21YDABH', 3, 'mcq', 'Geometry and Trigonometry');

-- Owner's joint cell table (per form), for A6.
CREATE TEMP TABLE e5_cells (
  section text NOT NULL, module text NOT NULL, domain text NOT NULL,
  difficulty int NOT NULL, item_type text NOT NULL, n int NOT NULL
) ON COMMIT DROP;
INSERT INTO e5_cells (section, module, domain, difficulty, item_type, n) VALUES
  ('RW','1','Information and Ideas',1,'mcq',2),
  ('RW','1','Information and Ideas',2,'mcq',3),
  ('RW','1','Information and Ideas',3,'mcq',2),
  ('RW','1','Craft and Structure',1,'mcq',2),
  ('RW','1','Craft and Structure',2,'mcq',3),
  ('RW','1','Craft and Structure',3,'mcq',3),
  ('RW','1','Expression of Ideas',1,'mcq',2),
  ('RW','1','Expression of Ideas',2,'mcq',2),
  ('RW','1','Expression of Ideas',3,'mcq',1),
  ('RW','1','Standard English Conventions',1,'mcq',2),
  ('RW','1','Standard English Conventions',2,'mcq',3),
  ('RW','1','Standard English Conventions',3,'mcq',2),
  ('RW','2A','Information and Ideas',1,'mcq',4),
  ('RW','2A','Information and Ideas',2,'mcq',2),
  ('RW','2A','Information and Ideas',3,'mcq',1),
  ('RW','2A','Craft and Structure',1,'mcq',4),
  ('RW','2A','Craft and Structure',2,'mcq',2),
  ('RW','2A','Craft and Structure',3,'mcq',1),
  ('RW','2A','Expression of Ideas',1,'mcq',3),
  ('RW','2A','Expression of Ideas',2,'mcq',2),
  ('RW','2A','Expression of Ideas',3,'mcq',1),
  ('RW','2A','Standard English Conventions',1,'mcq',3),
  ('RW','2A','Standard English Conventions',2,'mcq',3),
  ('RW','2A','Standard English Conventions',3,'mcq',1),
  ('RW','2B','Information and Ideas',1,'mcq',1),
  ('RW','2B','Information and Ideas',2,'mcq',2),
  ('RW','2B','Information and Ideas',3,'mcq',4),
  ('RW','2B','Craft and Structure',1,'mcq',1),
  ('RW','2B','Craft and Structure',2,'mcq',2),
  ('RW','2B','Craft and Structure',3,'mcq',4),
  ('RW','2B','Expression of Ideas',1,'mcq',1),
  ('RW','2B','Expression of Ideas',2,'mcq',2),
  ('RW','2B','Expression of Ideas',3,'mcq',3),
  ('RW','2B','Standard English Conventions',1,'mcq',1),
  ('RW','2B','Standard English Conventions',2,'mcq',3),
  ('RW','2B','Standard English Conventions',3,'mcq',3),
  ('M','1','Algebra',1,'grid_in',1),
  ('M','1','Algebra',1,'mcq',2),
  ('M','1','Algebra',2,'mcq',3),
  ('M','1','Algebra',3,'mcq',2),
  ('M','1','Advanced Math',1,'mcq',2),
  ('M','1','Advanced Math',2,'mcq',3),
  ('M','1','Advanced Math',3,'mcq',2),
  ('M','1','Problem Solving and Data Analysis',1,'mcq',1),
  ('M','1','Problem Solving and Data Analysis',2,'grid_in',1),
  ('M','1','Problem Solving and Data Analysis',2,'mcq',1),
  ('M','1','Problem Solving and Data Analysis',3,'mcq',1),
  ('M','1','Geometry and Trigonometry',1,'grid_in',1),
  ('M','1','Geometry and Trigonometry',2,'mcq',1),
  ('M','1','Geometry and Trigonometry',3,'mcq',1),
  ('M','2A','Algebra',1,'grid_in',2),
  ('M','2A','Algebra',1,'mcq',2),
  ('M','2A','Algebra',2,'grid_in',1),
  ('M','2A','Algebra',2,'mcq',1),
  ('M','2A','Algebra',3,'mcq',1),
  ('M','2A','Advanced Math',1,'grid_in',1),
  ('M','2A','Advanced Math',1,'mcq',3),
  ('M','2A','Advanced Math',2,'mcq',3),
  ('M','2A','Advanced Math',3,'mcq',1),
  ('M','2A','Problem Solving and Data Analysis',1,'grid_in',1),
  ('M','2A','Problem Solving and Data Analysis',1,'mcq',1),
  ('M','2A','Problem Solving and Data Analysis',2,'grid_in',1),
  ('M','2A','Geometry and Trigonometry',1,'grid_in',1),
  ('M','2A','Geometry and Trigonometry',2,'grid_in',1),
  ('M','2A','Geometry and Trigonometry',2,'mcq',1),
  ('M','2A','Geometry and Trigonometry',3,'mcq',1),
  ('M','2B','Algebra',1,'mcq',1),
  ('M','2B','Algebra',2,'grid_in',1),
  ('M','2B','Algebra',2,'mcq',1),
  ('M','2B','Algebra',3,'grid_in',2),
  ('M','2B','Algebra',3,'mcq',2),
  ('M','2B','Advanced Math',1,'mcq',1),
  ('M','2B','Advanced Math',2,'mcq',3),
  ('M','2B','Advanced Math',3,'grid_in',1),
  ('M','2B','Advanced Math',3,'mcq',3),
  ('M','2B','Problem Solving and Data Analysis',2,'grid_in',1),
  ('M','2B','Problem Solving and Data Analysis',3,'grid_in',1),
  ('M','2B','Problem Solving and Data Analysis',3,'mcq',1),
  ('M','2B','Geometry and Trigonometry',1,'grid_in',1),
  ('M','2B','Geometry and Trigonometry',2,'grid_in',1),
  ('M','2B','Geometry and Trigonometry',2,'mcq',1),
  ('M','2B','Geometry and Trigonometry',3,'mcq',1);

CREATE TEMP TABLE e5_forms (form_no int PRIMARY KEY, id uuid NOT NULL, name text NOT NULL) ON COMMIT DROP;
INSERT INTO e5_forms (form_no, id, name) VALUES
  (1, 'e5f0a000-0000-4000-8000-000000000001', 'Full-Length Practice Test 1'),
  (2, 'e5f0a000-0000-4000-8000-000000000002', 'Full-Length Practice Test 2'),
  (3, 'e5f0a000-0000-4000-8000-000000000003', 'Full-Length Practice Test 3');

-- A1 + A2: preconditions, checked before any write.
DO $e5$
DECLARE
  r record;
BEGIN
  IF (SELECT status FROM public.scoring_model_versions WHERE version = 'v1.0') IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'E5 A1: scoring_model_versions v1.0 is missing or not active';
  END IF;

  IF (SELECT count(*) FROM e5_items) <> 441
     OR (SELECT count(DISTINCT question_id) FROM e5_items) <> 441 THEN
    RAISE EXCEPTION 'E5: literal item set is not 441 distinct question_ids';
  END IF;

  SELECT i.form_no, i.section, i.module, i.ordinal, i.question_id,
         q.id IS NULL AS missing, q.section AS q_section, q.domain AS q_domain,
         q.difficulty AS q_difficulty, q.item_type AS q_item_type
    INTO r
    FROM e5_items i
    LEFT JOIN public.servable_questions q ON q.id = i.question_id
   WHERE q.id IS NULL
      OR q.section    IS DISTINCT FROM i.section
      OR q.domain     IS DISTINCT FROM i.domain
      OR q.difficulty IS DISTINCT FROM i.difficulty
      OR q.item_type  IS DISTINCT FROM i.item_type
   ORDER BY i.form_no, i.section DESC, i.module, i.ordinal
   LIMIT 1;
  IF FOUND THEN
    IF r.missing THEN
      RAISE EXCEPTION 'E5 A2: % (form % % module % ordinal %) is not in servable_questions',
        r.question_id, r.form_no, r.section, r.module, r.ordinal;
    END IF;
    RAISE EXCEPTION 'E5 A2: % (form % % module % ordinal %) changed in the bank: now section=% domain=% difficulty=% item_type=%',
      r.question_id, r.form_no, r.section, r.module, r.ordinal,
      r.q_section, r.q_domain, r.q_difficulty, r.q_item_type;
  END IF;
END
$e5$;

-- Forms: born draft (the publish gate refuses anything else on INSERT).
INSERT INTO public.test_forms (
  id, name, test_kind, status, score_table_version,
  routing_threshold_rw, routing_threshold_m,
  routing_override_approved_by, routing_override_reason, routing_override_ticket_id,
  break_duration_ms, rw_module1_ms, rw_module2_ms, m_module1_ms, m_module2_ms)
SELECT id, name, 'full_length', 'draft', 'v1.0',
       20, 15,
       NULL, NULL, NULL,
       600000, 1920000, 1920000, 2100000, 2100000
  FROM e5_forms
 ORDER BY form_no
ON CONFLICT (id) DO NOTHING;

-- Items: only into a form that is still draft.
INSERT INTO public.test_form_items (test_form_id, section, module, ordinal, question_id)
SELECT f.id, i.section, i.module, i.ordinal, i.question_id
  FROM e5_items i
  JOIN e5_forms f USING (form_no)
  JOIN public.test_forms t ON t.id = f.id
 WHERE t.status = 'draft'
 ORDER BY i.form_no, i.section DESC, i.module, i.ordinal
ON CONFLICT DO NOTHING;

-- A3 .. A8: postconditions.
DO $e5$
DECLARE
  r      record;
  v_md5  text;
BEGIN
  -- A3 metadata
  SELECT f.form_no, t.id INTO r
    FROM e5_forms f
    LEFT JOIN public.test_forms t ON t.id = f.id
   WHERE t.id IS NULL
      OR t.name <> f.name
      OR t.test_kind <> 'full_length'
      OR t.score_table_version <> 'v1.0'
      OR t.routing_threshold_rw <> 20 OR t.routing_threshold_m <> 15
      OR t.routing_override_approved_by IS NOT NULL
      OR t.routing_override_reason IS NOT NULL
      OR t.routing_override_ticket_id IS NOT NULL
      OR t.break_duration_ms <> 600000
      OR t.rw_module1_ms <> 1920000 OR t.rw_module2_ms <> 1920000
      OR t.m_module1_ms <> 2100000 OR t.m_module2_ms <> 2100000
   ORDER BY f.form_no LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'E5 A3: form % (%) is missing or its metadata differs from this file', r.form_no, r.id;
  END IF;

  -- A4 item set, both directions
  SELECT d.* INTO r FROM (
    (SELECT 'missing' AS diff, f.form_no, i.section, i.module, i.ordinal, i.question_id
       FROM e5_items i JOIN e5_forms f USING (form_no)
     EXCEPT
     SELECT 'missing', f.form_no, x.section, x.module, x.ordinal, x.question_id
       FROM public.test_form_items x JOIN e5_forms f ON f.id = x.test_form_id)
    UNION ALL
    (SELECT 'extra', f.form_no, x.section, x.module, x.ordinal, x.question_id
       FROM public.test_form_items x JOIN e5_forms f ON f.id = x.test_form_id
     EXCEPT
     SELECT 'extra', f.form_no, i.section, i.module, i.ordinal, i.question_id
       FROM e5_items i JOIN e5_forms f USING (form_no))
  ) d ORDER BY d.form_no, d.section DESC, d.module, d.ordinal LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'E5 A4: form % item % in the database: % module % ordinal % question %',
      r.form_no, r.diff, r.section, r.module, r.ordinal, r.question_id;
  END IF;

  -- A5 hash of the stored forms
  SELECT md5(string_agg(concat_ws('|', f.form_no, x.section, x.module, x.ordinal, x.question_id), E'\n'
             ORDER BY f.form_no, x.section COLLATE "C", x.module COLLATE "C", x.ordinal))
    INTO v_md5
    FROM public.test_form_items x JOIN e5_forms f ON f.id = x.test_form_id;
  IF v_md5 IS DISTINCT FROM '9df4d1b305e72d2fbd08eee9965eec27' THEN
    RAISE EXCEPTION 'E5 A5: stored forms hash to %, expected 9df4d1b305e72d2fbd08eee9965eec27', v_md5;
  END IF;

  -- A6 joint cells
  SELECT COALESCE(c.form_no, a.form_no) AS form_no,
         COALESCE(c.section, a.section) AS section, COALESCE(c.module, a.module) AS module,
         COALESCE(c.domain, a.domain) AS domain, COALESCE(c.difficulty, a.difficulty) AS difficulty,
         COALESCE(c.item_type, a.item_type) AS item_type,
         COALESCE(c.n, 0) AS expected, COALESCE(a.n, 0) AS actual
    INTO r
    FROM (SELECT f.form_no, e.* FROM e5_cells e CROSS JOIN e5_forms f) c
    FULL JOIN (
      SELECT f.form_no, x.section, x.module, q.domain, q.difficulty, q.item_type, count(*)::int AS n
        FROM public.test_form_items x
        JOIN e5_forms f ON f.id = x.test_form_id
        JOIN public.servable_questions q ON q.id = x.question_id
       GROUP BY 1, 2, 3, 4, 5, 6) a
      ON a.form_no = c.form_no AND a.section = c.section AND a.module = c.module
     AND a.domain = c.domain AND a.difficulty = c.difficulty AND a.item_type = c.item_type
   WHERE COALESCE(c.n, 0) <> COALESCE(a.n, 0)
   ORDER BY 1, 2 DESC, 3, 4, 5, 6 LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'E5 A6: form % % module % cell (%, difficulty %, %) expected % actual %',
      r.form_no, r.section, r.module, r.domain, r.difficulty, r.item_type, r.expected, r.actual;
  END IF;

  -- A7 the gate's own composition check
  FOR r IN SELECT id FROM e5_forms ORDER BY form_no LOOP
    PERFORM public.validate_form_composition(r.id);
  END LOOP;

  -- A8 no question in two forms
  IF EXISTS (SELECT 1 FROM public.test_form_items x JOIN e5_forms f ON f.id = x.test_form_id
              GROUP BY x.question_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'E5 A8: a question_id appears in more than one of the three forms';
  END IF;

  RAISE NOTICE 'E5: 3 forms, 441 items, all assertions passed (A1-A8)';
END
$e5$;

COMMIT;

/* ---------------------------------------------------------------------------
SELECTION QUERY (reproduces the literals above; read-only, not executed here).
Append this to get the A5 hash:
  WITH sel AS ( <query> ) SELECT count(*), count(DISTINCT question_id),
    md5(string_agg(concat_ws('|',form_no,section,module,ordinal,question_id), E'\n'
        ORDER BY form_no, section COLLATE "C", module COLLATE "C", ordinal)) FROM sel;

WITH targets(section, module, domain, difficulty, item_type, n) AS (
  VALUES
    ('RW','1','Information and Ideas',1,'mcq',2),
    ('RW','1','Information and Ideas',2,'mcq',3),
    ('RW','1','Information and Ideas',3,'mcq',2),
    ('RW','1','Craft and Structure',1,'mcq',2),
    ('RW','1','Craft and Structure',2,'mcq',3),
    ('RW','1','Craft and Structure',3,'mcq',3),
    ('RW','1','Expression of Ideas',1,'mcq',2),
    ('RW','1','Expression of Ideas',2,'mcq',2),
    ('RW','1','Expression of Ideas',3,'mcq',1),
    ('RW','1','Standard English Conventions',1,'mcq',2),
    ('RW','1','Standard English Conventions',2,'mcq',3),
    ('RW','1','Standard English Conventions',3,'mcq',2),
    ('RW','2A','Information and Ideas',1,'mcq',4),
    ('RW','2A','Information and Ideas',2,'mcq',2),
    ('RW','2A','Information and Ideas',3,'mcq',1),
    ('RW','2A','Craft and Structure',1,'mcq',4),
    ('RW','2A','Craft and Structure',2,'mcq',2),
    ('RW','2A','Craft and Structure',3,'mcq',1),
    ('RW','2A','Expression of Ideas',1,'mcq',3),
    ('RW','2A','Expression of Ideas',2,'mcq',2),
    ('RW','2A','Expression of Ideas',3,'mcq',1),
    ('RW','2A','Standard English Conventions',1,'mcq',3),
    ('RW','2A','Standard English Conventions',2,'mcq',3),
    ('RW','2A','Standard English Conventions',3,'mcq',1),
    ('RW','2B','Information and Ideas',1,'mcq',1),
    ('RW','2B','Information and Ideas',2,'mcq',2),
    ('RW','2B','Information and Ideas',3,'mcq',4),
    ('RW','2B','Craft and Structure',1,'mcq',1),
    ('RW','2B','Craft and Structure',2,'mcq',2),
    ('RW','2B','Craft and Structure',3,'mcq',4),
    ('RW','2B','Expression of Ideas',1,'mcq',1),
    ('RW','2B','Expression of Ideas',2,'mcq',2),
    ('RW','2B','Expression of Ideas',3,'mcq',3),
    ('RW','2B','Standard English Conventions',1,'mcq',1),
    ('RW','2B','Standard English Conventions',2,'mcq',3),
    ('RW','2B','Standard English Conventions',3,'mcq',3),
    ('M','1','Algebra',1,'grid_in',1),
    ('M','1','Algebra',1,'mcq',2),
    ('M','1','Algebra',2,'mcq',3),
    ('M','1','Algebra',3,'mcq',2),
    ('M','1','Advanced Math',1,'mcq',2),
    ('M','1','Advanced Math',2,'mcq',3),
    ('M','1','Advanced Math',3,'mcq',2),
    ('M','1','Problem Solving and Data Analysis',1,'mcq',1),
    ('M','1','Problem Solving and Data Analysis',2,'grid_in',1),
    ('M','1','Problem Solving and Data Analysis',2,'mcq',1),
    ('M','1','Problem Solving and Data Analysis',3,'mcq',1),
    ('M','1','Geometry and Trigonometry',1,'grid_in',1),
    ('M','1','Geometry and Trigonometry',2,'mcq',1),
    ('M','1','Geometry and Trigonometry',3,'mcq',1),
    ('M','2A','Algebra',1,'grid_in',2),
    ('M','2A','Algebra',1,'mcq',2),
    ('M','2A','Algebra',2,'grid_in',1),
    ('M','2A','Algebra',2,'mcq',1),
    ('M','2A','Algebra',3,'mcq',1),
    ('M','2A','Advanced Math',1,'grid_in',1),
    ('M','2A','Advanced Math',1,'mcq',3),
    ('M','2A','Advanced Math',2,'mcq',3),
    ('M','2A','Advanced Math',3,'mcq',1),
    ('M','2A','Problem Solving and Data Analysis',1,'grid_in',1),
    ('M','2A','Problem Solving and Data Analysis',1,'mcq',1),
    ('M','2A','Problem Solving and Data Analysis',2,'grid_in',1),
    ('M','2A','Geometry and Trigonometry',1,'grid_in',1),
    ('M','2A','Geometry and Trigonometry',2,'grid_in',1),
    ('M','2A','Geometry and Trigonometry',2,'mcq',1),
    ('M','2A','Geometry and Trigonometry',3,'mcq',1),
    ('M','2B','Algebra',1,'mcq',1),
    ('M','2B','Algebra',2,'grid_in',1),
    ('M','2B','Algebra',2,'mcq',1),
    ('M','2B','Algebra',3,'grid_in',2),
    ('M','2B','Algebra',3,'mcq',2),
    ('M','2B','Advanced Math',1,'mcq',1),
    ('M','2B','Advanced Math',2,'mcq',3),
    ('M','2B','Advanced Math',3,'grid_in',1),
    ('M','2B','Advanced Math',3,'mcq',3),
    ('M','2B','Problem Solving and Data Analysis',2,'grid_in',1),
    ('M','2B','Problem Solving and Data Analysis',3,'grid_in',1),
    ('M','2B','Problem Solving and Data Analysis',3,'mcq',1),
    ('M','2B','Geometry and Trigonometry',1,'grid_in',1),
    ('M','2B','Geometry and Trigonometry',2,'grid_in',1),
    ('M','2B','Geometry and Trigonometry',2,'mcq',1),
    ('M','2B','Geometry and Trigonometry',3,'mcq',1)
), mod_ord(module, mo) AS (VALUES ('1',1),('2A',2),('2B',3)),
slots AS (   -- one row per slot; slot_no numbers a cell's demand across forms 1..3, modules 1/2A/2B
  SELECT f.form_no, t.section, t.module, t.domain, t.difficulty, t.item_type,
         row_number() OVER (PARTITION BY t.section, t.domain, t.difficulty, t.item_type
                            ORDER BY f.form_no, mo.mo, k) AS slot_no
    FROM targets t JOIN mod_ord mo USING (module)
    CROSS JOIN generate_series(1,3) AS f(form_no)
    CROSS JOIN LATERAL generate_series(1, t.n) AS k
),
bank AS (
  SELECT id, section, domain, difficulty, item_type,
         row_number() OVER (PARTITION BY section, domain, difficulty, item_type
                            ORDER BY id COLLATE "C") AS rn
    FROM public.servable_questions
),
picked AS (
  SELECT s.form_no, s.section, s.module, b.id AS question_id, s.domain, s.difficulty, s.item_type
    FROM slots s JOIN bank b
      ON b.section = s.section AND b.domain = s.domain AND b.difficulty = s.difficulty
     AND b.item_type = s.item_type AND b.rn = s.slot_no
)
SELECT form_no, section, module,
       row_number() OVER (PARTITION BY form_no, section, module ORDER BY
         CASE WHEN section = 'RW' THEN
           CASE domain WHEN 'Craft and Structure' THEN 1 WHEN 'Information and Ideas' THEN 2
                       WHEN 'Standard English Conventions' THEN 3 ELSE 4 END
         ELSE difficulty END,
         CASE WHEN section = 'RW' THEN difficulty ELSE
           CASE domain WHEN 'Algebra' THEN 1 WHEN 'Advanced Math' THEN 2
                       WHEN 'Problem Solving and Data Analysis' THEN 3 ELSE 4 END
         END,
         question_id COLLATE "C") AS ordinal,
       question_id, domain, difficulty, item_type
  FROM picked
--------------------------------------------------------------------------- */
