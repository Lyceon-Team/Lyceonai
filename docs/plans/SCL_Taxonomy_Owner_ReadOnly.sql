-- SCL taxonomy — OWNER-RUN, READ-ONLY queries (no writes anywhere in this file).
--
-- @spec [SPEC-CHANGE_SCL.md §3 (canonical source), §7.2 (mirror)] | @implemented [2026-10-29]
-- plain English: the canonical file is updated file-first (owner ruling 2026-10-29, Karl).
--   EE.6 "Divide polynomials by long division" exists in production but in no branch of the
--   repo, so its exact row has to come from production. Claude does not query production;
--   Karl runs these and pastes Q1's output back. The loader's pre-flight guard refuses to
--   run until the file holds every production ID, so it cannot run before EE.6 is in the file.
--
-- Run order:  Q1 + Q2 now (read-only)  ->  EE.6 added to the file from Q1  ->  loader  ->  Q3.
-- File ID lists below were generated from content/canonical/subskill-cluster-taxonomy.json
-- on branch claude/scl-taxonomy-no-fixed-counts (CL.0231 added, EE.6 not yet).

-- ---------------------------------------------------------------------------------------
-- Q1. EE.6 exactly as production holds it, as one JSON object in the file's key order.
--     Paste the single output value back; it goes into sub_skills verbatim.
--     taxonomy_version is returned separately as a check (the file keeps scl-v1.0.0).
-- ---------------------------------------------------------------------------------------
SELECT json_build_object(
         'id', id,
         'skill_code', skill_code,
         'section', section,
         'domain', domain,
         'name', name,
         'definition', definition,
         'inclusion_test', inclusion_test,
         'evidence_ids', to_json(evidence_ids)
       )::text AS ee6_json,
       taxonomy_version
FROM public.sub_skills
WHERE id = 'EE.6';

-- ---------------------------------------------------------------------------------------
-- Q2. Drift check: every production ID the CURRENT branch file does not hold.
--     Expected: exactly one row, ('sub_skills', 'EE.6'). Any other row is further drift
--     that must also be added to the file before the loader can run.
--     And the reverse: file IDs production does not hold. Expected: ('clusters', 'CL.0231').
-- ---------------------------------------------------------------------------------------
WITH file_ids AS (
  SELECT 'sub_skills'::text AS tbl, unnest(ARRAY[
    'EE.1', 'EE.2', 'EE.3', 'EE.4', 'EE.5', 'NLE.1', 'NLE.2', 'NLE.3', 'NLE.4', 'NLE.5',
    'NLF.1', 'NLF.2', 'NLF.3', 'NLF.4', 'NLF.5', 'LE1.1', 'LE1.2', 'LE1.3', 'LE1.4', 'LE1.5',
    'LF.1', 'LF.2', 'LF.3', 'LF.4', 'LF.5', 'LE2.1', 'LE2.2', 'LE2.3', 'LE2.4', 'LE2.5',
    'SYS.1', 'SYS.2', 'SYS.3', 'SYS.4', 'SYS.5', 'LI.1', 'LI.2', 'LI.3', 'LI.4', 'LI.5',
    'AV.1', 'AV.2', 'AV.3', 'AV.4', 'AV.5', 'LAT.1', 'LAT.2', 'LAT.3', 'LAT.4', 'LAT.5',
    'RTT1', 'RTT2', 'RTT3', 'RTT4', 'CIR1', 'CIR2', 'CIR3', 'CIR4', 'CIR5', 'RAT.1',
    'RAT.2', 'RAT.3', 'RAT.4', 'RAT.5', 'PCT.1', 'PCT.2', 'PCT.3', 'PCT.4', 'PCT.5', 'OVD.1',
    'OVD.2', 'OVD.3', 'OVD.4', 'OVD.5', 'TVD.1', 'TVD.2', 'TVD.3', 'TVD.4', 'TVD.5', 'PRB.1',
    'PRB.2', 'PRB.3', 'PRB.4', 'INFS.1', 'INFS.2', 'INFS.3', 'ESC1', 'ESC2', 'ESC3', 'WIC.1',
    'WIC.2', 'WIC.3', 'WIC.4', 'TSP.1', 'TSP.2', 'TSP.3', 'TSP.4', 'CTC.1', 'CTC.2', 'CTC.3',
    'CTC.4', 'CTC.5', 'RS.1', 'RS.2', 'RS.3', 'RS.4', 'RS.5', 'TRN.1', 'TRN.2', 'TRN.3',
    'TRN.4', 'TRN.5', 'CID.1', 'CID.2', 'CID.3', 'CID.4', 'COE.1', 'COE.2', 'COE.3', 'COE.4',
    'INF.1', 'INF.2', 'INF.3', 'INF.4', 'INF.5', 'BND.1', 'BND.2', 'BND.3', 'BND.4', 'BND.5',
    'FSS.1', 'FSS.2', 'FSS.3', 'FSS.4', 'FSS.5'
  ]::text[]) AS id
  UNION ALL
  SELECT 'clusters', unnest(ARRAY[
    'CL.0001', 'CL.0002', 'CL.0003', 'CL.0004', 'CL.0005', 'CL.0006', 'CL.0007', 'CL.0008', 'CL.0009', 'CL.0010',
    'CL.0011', 'CL.0012', 'CL.0013', 'CL.0014', 'CL.0015', 'CL.0016', 'CL.0017', 'CL.0018', 'CL.0019', 'CL.0020',
    'CL.0021', 'CL.0022', 'CL.0023', 'CL.0024', 'CL.0025', 'CL.0026', 'CL.0027', 'CL.0028', 'CL.0029', 'CL.0030',
    'CL.0031', 'CL.0032', 'CL.0033', 'CL.0034', 'CL.0035', 'CL.0036', 'CL.0037', 'CL.0038', 'CL.0039', 'CL.0040',
    'CL.0041', 'CL.0042', 'CL.0043', 'CL.0044', 'CL.0045', 'CL.0046', 'CL.0047', 'CL.0048', 'CL.0049', 'CL.0050',
    'CL.0051', 'CL.0052', 'CL.0053', 'CL.0054', 'CL.0055', 'CL.0056', 'CL.0057', 'CL.0058', 'CL.0059', 'CL.0060',
    'CL.0061', 'CL.0062', 'CL.0063', 'CL.0064', 'CL.0065', 'CL.0066', 'CL.0067', 'CL.0068', 'CL.0069', 'CL.0070',
    'CL.0071', 'CL.0072', 'CL.0073', 'CL.0074', 'CL.0075', 'CL.0076', 'CL.0077', 'CL.0078', 'CL.0079', 'CL.0080',
    'CL.0081', 'CL.0082', 'CL.0083', 'CL.0084', 'CL.0085', 'CL.0086', 'CL.0087', 'CL.0088', 'CL.0089', 'CL.0090',
    'CL.0091', 'CL.0092', 'CL.0093', 'CL.0094', 'CL.0095', 'CL.0096', 'CL.0097', 'CL.0098', 'CL.0099', 'CL.0100',
    'CL.0101', 'CL.0102', 'CL.0103', 'CL.0104', 'CL.0105', 'CL.0106', 'CL.0107', 'CL.0108', 'CL.0109', 'CL.0110',
    'CL.0111', 'CL.0112', 'CL.0113', 'CL.0114', 'CL.0115', 'CL.0116', 'CL.0117', 'CL.0118', 'CL.0119', 'CL.0120',
    'CL.0121', 'CL.0122', 'CL.0123', 'CL.0124', 'CL.0125', 'CL.0126', 'CL.0127', 'CL.0128', 'CL.0129', 'CL.0130',
    'CL.0131', 'CL.0132', 'CL.0133', 'CL.0134', 'CL.0135', 'CL.0136', 'CL.0137', 'CL.0138', 'CL.0139', 'CL.0140',
    'CL.0141', 'CL.0142', 'CL.0143', 'CL.0144', 'CL.0145', 'CL.0146', 'CL.0147', 'CL.0148', 'CL.0149', 'CL.0150',
    'CL.0151', 'CL.0152', 'CL.0153', 'CL.0154', 'CL.0155', 'CL.0156', 'CL.0157', 'CL.0158', 'CL.0159', 'CL.0160',
    'CL.0161', 'CL.0162', 'CL.0163', 'CL.0164', 'CL.0165', 'CL.0166', 'CL.0167', 'CL.0168', 'CL.0169', 'CL.0170',
    'CL.0171', 'CL.0172', 'CL.0173', 'CL.0174', 'CL.0175', 'CL.0176', 'CL.0177', 'CL.0178', 'CL.0179', 'CL.0180',
    'CL.0181', 'CL.0182', 'CL.0183', 'CL.0184', 'CL.0185', 'CL.0186', 'CL.0187', 'CL.0188', 'CL.0189', 'CL.0190',
    'CL.0191', 'CL.0192', 'CL.0193', 'CL.0194', 'CL.0195', 'CL.0196', 'CL.0197', 'CL.0198', 'CL.0199', 'CL.0200',
    'CL.0201', 'CL.0202', 'CL.0203', 'CL.0204', 'CL.0205', 'CL.0206', 'CL.0207', 'CL.0208', 'CL.0209', 'CL.0210',
    'CL.0211', 'CL.0212', 'CL.0213', 'CL.0214', 'CL.0215', 'CL.0216', 'CL.0217', 'CL.0218', 'CL.0219', 'CL.0220',
    'CL.0221', 'CL.0222', 'CL.0223', 'CL.0224', 'CL.0225', 'CL.0226', 'CL.0227', 'CL.0228', 'CL.0229', 'CL.0230',
    'CL.0231'
  ]::text[])
),
db_ids AS (
  SELECT 'sub_skills'::text AS tbl, id FROM public.sub_skills
  UNION ALL
  SELECT 'clusters', id FROM public.clusters
)
SELECT 'in DB, not in file' AS direction, d.tbl, d.id
FROM db_ids d
WHERE NOT EXISTS (SELECT 1 FROM file_ids f WHERE f.tbl = d.tbl AND f.id = d.id)
UNION ALL
SELECT 'in file, not in DB', f.tbl, f.id
FROM file_ids f
WHERE NOT EXISTS (SELECT 1 FROM db_ids d WHERE d.tbl = f.tbl AND d.id = f.id)
ORDER BY 1, 2, 3;

-- ---------------------------------------------------------------------------------------
-- Q3. After the reload: CL.0231 landed as specified, EE.6 still present, nothing deleted.
--     Re-run Q2 against the updated file's ID lists (or run scl-taxonomy-check.ts): zero rows.
-- ---------------------------------------------------------------------------------------
SELECT id, display_name, family, definition, evidence_count, core,
       skills_seen_in, method_in, playbook_move, aliases, taxonomy_version,
       cardinality(evidence_ids) AS n_evidence_ids
FROM public.clusters
WHERE id = 'CL.0231';
-- Expected: family by_hand_doing; core false; skills_seen_in {Equivalent Expressions};
--   method_in {}; playbook_move NULL; aliases {}; taxonomy_version scl-v1.0.0;
--   n_evidence_ids 15; evidence_count 15.

SELECT id, name, taxonomy_version FROM public.sub_skills WHERE id = 'EE.6';
-- Expected: one row, name "Divide polynomials by long division", scl-v1.0.0.
