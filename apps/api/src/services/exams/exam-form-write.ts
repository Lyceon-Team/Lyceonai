// apps/api/src/services/exams/exam-form-write.ts
import type { BuiltForm, BuiltFormItem, ModuleId } from './exam-form-builder';

export async function insertExamFormAndItems(args: {
  supabaseServer: any;
  built: BuiltForm;
  createdByUserId?: string | null;
}): Promise<{ examFormId: string }> {
  const { supabaseServer, built } = args;

  const { data: formData, error: formErr } = await supabaseServer
    .from('exam_forms')
    .insert({
      form_kind: built.form.formKind,
      exam_type: built.form.examType,
      constraint_version: built.form.constraintVersion,
      selection_seed: built.form.selectionSeed,
      created_by: args.createdByUserId ?? null,
    })
    .select('id')
    .single();

  if (formErr) throw new Error(`insert exam_forms failed: ${formErr.message}`);
  const examFormId = formData.id as string;

  const flatten: BuiltFormItem[] = (['RW1', 'RW2', 'M1', 'M2'] as ModuleId[]).flatMap(
    (m) => built.itemsByModule[m]
  );

  const rows = flatten.map((it) => {
  const legacy = it as BuiltFormItem & { skillCode?: string | null; difficulty?: string | null };
  return {
    exam_form_id: examFormId,
    module_id: it.moduleId,
    position: it.position,
    question_canonical_id: it.canonicalId,
    is_operational: it.isOperational,
    section_code: it.sectionCode,
    domain: it.domain,
    skill: it.skill,
    subskill: it.subskill,
    skill_code: legacy.skillCode ?? null,
    difficulty: legacy.difficulty ?? it.difficultyBucket,
    question_type: it.questionType,
  };
});

  const { error: itemsErr } = await supabaseServer.from('exam_form_items').insert(rows);
  if (itemsErr) throw new Error(`insert exam_form_items failed: ${itemsErr.message}`);

  return { examFormId };
}