-- Fix skill codes (and domain) on 9 videos whose segments teach a different skill than the video is filed under.
-- Each UPDATE only changes the row if it still has the exact old values, so a row someone already fixed is left alone.
-- Evidence: every segment summary of each video (both blind tagging passes and the reviewers agreed).
BEGIN;

-- Filed as Words in Context (Craft and Structure); the segments are Command of Evidence (Information and Ideas).
UPDATE public.video_resources SET domain = 'Information and Ideas', skill_codes = ARRAY['Command of Evidence']
WHERE video_id IN ('qLEVgoVO65U','YbIToNjrWBE','uLYm9UC4Wis')
  AND domain = 'Craft and Structure' AND skill_codes = ARRAY['Words in Context'];

-- Filed as Transitions (Expression of Ideas); the segments are Command of Evidence (Information and Ideas).
UPDATE public.video_resources SET domain = 'Information and Ideas', skill_codes = ARRAY['Command of Evidence']
WHERE video_id IN ('6GLUNxyNuhI','CnPWdS42whA','gdaX-8LP1rw','JwiaqsMWyfc')
  AND domain = 'Expression of Ideas' AND skill_codes = ARRAY['Transitions'];

-- Filed as Inferences; the segment is a Command of Evidence question.
UPDATE public.video_resources SET skill_codes = ARRAY['Command of Evidence']
WHERE video_id = 'nLLwupYkfCo'
  AND domain = 'Information and Ideas' AND skill_codes = ARRAY['Inferences'];

-- Filed as Transitions + Boundaries (Expression of Ideas); all three segments teach clause boundaries (Standard English Conventions).
UPDATE public.video_resources SET domain = 'Standard English Conventions', skill_codes = ARRAY['Boundaries']
WHERE video_id = 'Yo-Haulw6gM'
  AND domain = 'Expression of Ideas' AND skill_codes = ARRAY['Transitions','Boundaries'];

SELECT video_id, domain, skill_codes FROM public.video_resources
WHERE video_id IN ('qLEVgoVO65U','YbIToNjrWBE','uLYm9UC4Wis','6GLUNxyNuhI','CnPWdS42whA','gdaX-8LP1rw','JwiaqsMWyfc','nLLwupYkfCo','Yo-Haulw6gM')
ORDER BY video_id;

COMMIT;
