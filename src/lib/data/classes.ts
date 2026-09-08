import { supabase } from "@/lib/supabase/client";

export interface ClassRow {
  id: string;
  subject: string;
  division_id: string;
}

export interface DivisionRow {
  id: string;
  label: string;
  grade_id: string;
  classes: ClassRow[];
}

export interface GradeRow {
  id: string;
  level: number;
  batch_id: string;
  divisions: DivisionRow[];
}

export interface BatchRow {
  id: string;
  label: string;
  start_year: number;
  grades: GradeRow[];
}

export interface ClassWithPath extends ClassRow {
  division: { id: string; label: string };
  grade: { id: string; level: number };
  batch: { id: string; label: string };
}

function requireClient() {
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

export async function listHierarchy(): Promise<BatchRow[]> {
  const db = requireClient();
  const { data, error } = await db
    .from("batches")
    .select(
      "id, label, start_year, grades(id, level, batch_id, divisions(id, label, grade_id, classes(id, subject, division_id)))",
    )
    .order("start_year", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as BatchRow[];
}

export async function getClassWithPath(
  classId: string,
): Promise<ClassWithPath | null> {
  const db = requireClient();
  const { data, error } = await db
    .from("classes")
    .select(
      "id, subject, division_id, division:divisions(id, label, grade:grades(id, level, batch:batches(id, label)))",
    )
    .eq("id", classId)
    .single();
  if (error) return null;
  const row = data as unknown as {
    id: string;
    subject: string;
    division_id: string;
    division: { id: string; label: string; grade: { id: string; level: number; batch: { id: string; label: string } } };
  };
  return {
    id: row.id,
    subject: row.subject,
    division_id: row.division_id,
    division: { id: row.division.id, label: row.division.label },
    grade: { id: row.division.grade.id, level: row.division.grade.level },
    batch: { id: row.division.grade.batch.id, label: row.division.grade.batch.label },
  };
}

export async function createBatch(ownerId: string, label: string, startYear: number) {
  const db = requireClient();
  const { data, error } = await db
    .from("batches")
    .insert({ owner_id: ownerId, label, start_year: startYear })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createGrade(ownerId: string, batchId: string, level: number) {
  const db = requireClient();
  const { data, error } = await db
    .from("grades")
    .insert({ owner_id: ownerId, batch_id: batchId, level })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createDivision(ownerId: string, gradeId: string, label: string) {
  const db = requireClient();
  const { data, error } = await db
    .from("divisions")
    .insert({ owner_id: ownerId, grade_id: gradeId, label })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createClass(ownerId: string, divisionId: string, subject: string) {
  const db = requireClient();
  const { data, error } = await db
    .from("classes")
    .insert({ owner_id: ownerId, division_id: divisionId, subject })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Goal items: lesson plans, presentations, activities, homework ──
export type GoalItemKind =
  | "lesson_plan"
  | "slide_deck"
  | "note"
  | "quiz"
  | "exam"
  | "activity"
  | "homework";

export interface GoalItemRow {
  id: string;
  kind: GoalItemKind;
  title: string;
  detail: string | null;
  content: { markdown: string } | null;
  scheduled_for: string | null;
  created_at: string;
}

export async function listGoalItemsByKind(
  classId: string,
  kind: GoalItemKind,
): Promise<GoalItemRow[]> {
  const db = requireClient();
  const { data: goals, error: goalsError } = await db
    .from("goals")
    .select("id")
    .eq("class_id", classId);
  if (goalsError) throw goalsError;
  const goalIds = (goals ?? []).map((g) => g.id);
  if (goalIds.length === 0) return [];
  const { data, error } = await db
    .from("goal_items")
    .select("id, kind, title, detail, content, scheduled_for, created_at")
    .in("goal_id", goalIds)
    .eq("kind", kind)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as GoalItemRow[];
}

export async function createGoalItemFromPrompt(
  ownerId: string,
  classId: string,
  kind: GoalItemKind,
  prompt: string,
  generated: { title: string; content: string },
): Promise<GoalItemRow> {
  const db = requireClient();
  const { data: goal, error: goalError } = await db
    .from("goals")
    .insert({ owner_id: ownerId, class_id: classId, prompt, source: "prompt", status: "draft" })
    .select()
    .single();
  if (goalError) throw goalError;

  const { data: item, error: itemError } = await db
    .from("goal_items")
    .insert({
      owner_id: ownerId,
      goal_id: goal.id,
      kind,
      title: generated.title,
      content: { markdown: generated.content },
    })
    .select()
    .single();
  if (itemError) throw itemError;
  return item as GoalItemRow;
}

// ── Assessments: quizzes and exams ──
export interface AssessmentRow {
  id: string;
  kind: "quiz" | "exam";
  title: string;
  status: "draft" | "scheduled";
  content: { markdown: string } | null;
  scheduled_for: string | null;
  created_at: string;
}

export async function listAssessments(
  classId: string,
  kind: "quiz" | "exam",
): Promise<AssessmentRow[]> {
  const db = requireClient();
  const { data, error } = await db
    .from("assessments")
    .select("id, kind, title, status, content, scheduled_for, created_at")
    .eq("class_id", classId)
    .eq("kind", kind)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AssessmentRow[];
}

export async function createAssessmentFromPrompt(
  ownerId: string,
  classId: string,
  kind: "quiz" | "exam",
  generated: { title: string; content: string },
): Promise<AssessmentRow> {
  const db = requireClient();
  const { data, error } = await db
    .from("assessments")
    .insert({
      owner_id: ownerId,
      class_id: classId,
      kind,
      title: generated.title,
      content: { markdown: generated.content },
      status: "draft",
    })
    .select()
    .single();
  if (error) throw error;
  return data as AssessmentRow;
}

// ── Materials: notes & text, shared across classes ──
export interface MaterialRow {
  id: string;
  title: string;
  kind: string;
  body_md: string | null;
  created_at: string;
}

export async function listMaterialsForClass(classId: string): Promise<MaterialRow[]> {
  const db = requireClient();
  const { data, error } = await db
    .from("class_materials")
    .select("material:materials(id, title, kind, body_md, created_at)")
    .eq("class_id", classId);
  if (error) throw error;
  return ((data ?? []) as unknown as { material: MaterialRow }[]).map((l) => l.material);
}

// A class needs at least one attached reference (syllabus, curriculum,
// textbook chapter, or notes) before the studio or Goal Planner generates
// anything for it — otherwise there's nothing to ground the draft in and
// it comes out unreliable. See docs/00-concept.md's load-bearing
// constraint: ask for the missing reference instead of inventing content.
export async function hasReferenceMaterial(classId: string): Promise<boolean> {
  const db = requireClient();
  const { count, error } = await db
    .from("class_materials")
    .select("*", { count: "exact", head: true })
    .eq("class_id", classId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function createMaterialFromPrompt(
  ownerId: string,
  classId: string,
  generated: { title: string; content: string },
): Promise<MaterialRow> {
  const db = requireClient();
  const { data: material, error: materialError } = await db
    .from("materials")
    .insert({
      owner_id: ownerId,
      title: generated.title,
      kind: "note",
      body_md: generated.content,
    })
    .select()
    .single();
  if (materialError) throw materialError;

  const { error: linkError } = await db
    .from("class_materials")
    .insert({ class_id: classId, material_id: material.id, owner_id: ownerId });
  if (linkError) throw linkError;

  return material as MaterialRow;
}

// A teacher's own syllabus/curriculum/textbook text, pasted in directly
// (no file-upload/OCR pipeline exists yet) rather than AI-drafted — kept
// distinct from createMaterialFromPrompt because the body is the
// teacher's real reference content, not simulated studio output.
export async function attachOwnReference(
  ownerId: string,
  classId: string,
  title: string,
  bodyMd: string,
): Promise<MaterialRow> {
  const db = requireClient();
  const { data: material, error: materialError } = await db
    .from("materials")
    .insert({ owner_id: ownerId, title, kind: "note", body_md: bodyMd })
    .select()
    .single();
  if (materialError) throw materialError;

  const { error: linkError } = await db
    .from("class_materials")
    .insert({ class_id: classId, material_id: material.id, owner_id: ownerId });
  if (linkError) throw linkError;

  return material as MaterialRow;
}

export async function updateBatch(id: string, label: string, startYear: number) {
  const db = requireClient();
  const { error } = await db
    .from("batches")
    .update({ label, start_year: startYear })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteBatch(id: string) {
  const db = requireClient();
  const { error } = await db.from("batches").delete().eq("id", id);
  if (error) throw error;
}

export async function updateGrade(id: string, level: number) {
  const db = requireClient();
  const { error } = await db.from("grades").update({ level }).eq("id", id);
  if (error) throw error;
}

export async function deleteGrade(id: string) {
  const db = requireClient();
  const { error } = await db.from("grades").delete().eq("id", id);
  if (error) throw error;
}

export async function updateDivision(id: string, label: string) {
  const db = requireClient();
  const { error } = await db.from("divisions").update({ label }).eq("id", id);
  if (error) throw error;
}

export async function deleteDivision(id: string) {
  const db = requireClient();
  const { error } = await db.from("divisions").delete().eq("id", id);
  if (error) throw error;
}

export async function updateClass(id: string, subject: string) {
  const db = requireClient();
  const { error } = await db.from("classes").update({ subject }).eq("id", id);
  if (error) throw error;
}

export async function deleteClass(id: string) {
  const db = requireClient();
  const { error } = await db.from("classes").delete().eq("id", id);
  if (error) throw error;
}

export interface UpcomingItem {
  id: string;
  title: string;
  kind: "quiz" | "exam" | "slide_deck" | "note" | "activity" | "homework";
  scheduledFor: string;
  classLabel: string;
  classId: string;
}

export async function listUpcoming(): Promise<UpcomingItem[]> {
  const db = requireClient();
  const [assessments, goalItems] = await Promise.all([
    db
      .from("assessments")
      .select("id, title, kind, scheduled_for, class:classes(id, subject, division:divisions(label, grade:grades(level)))")
      .not("scheduled_for", "is", null)
      .order("scheduled_for", { ascending: true }),
    db
      .from("goal_items")
      .select(
        "id, title, kind, scheduled_for, goal:goals(class:classes(id, subject, division:divisions(label, grade:grades(level))))",
      )
      .not("scheduled_for", "is", null)
      .order("scheduled_for", { ascending: true }),
  ]);
  if (assessments.error) throw assessments.error;
  if (goalItems.error) throw goalItems.error;

  type ClassRef = { id: string; subject: string; division: { label: string; grade: { level: number } } };
  function classLabel(c: ClassRef) {
    return `Grade ${c.division.grade.level} · ${c.division.label} · ${c.subject}`;
  }

  const fromAssessments = (assessments.data ?? []).map((a) => {
    const row = a as unknown as { id: string; title: string; kind: UpcomingItem["kind"]; scheduled_for: string; class: ClassRef };
    return {
      id: row.id,
      title: row.title,
      kind: row.kind,
      scheduledFor: row.scheduled_for,
      classLabel: classLabel(row.class),
      classId: row.class.id,
    };
  });

  const fromGoalItems = (goalItems.data ?? []).map((g) => {
    const row = g as unknown as {
      id: string;
      title: string;
      kind: UpcomingItem["kind"];
      scheduled_for: string;
      goal: { class: ClassRef };
    };
    return {
      id: row.id,
      title: row.title,
      kind: row.kind,
      scheduledFor: row.scheduled_for,
      classLabel: classLabel(row.goal.class),
      classId: row.goal.class.id,
    };
  });

  return [...fromAssessments, ...fromGoalItems].sort((a, b) =>
    a.scheduledFor.localeCompare(b.scheduledFor),
  );
}

export interface StudentRow {
  id: string;
  name: string;
  roll_no: string | null;
  email: string | null;
  status: "invited" | "active" | "removed";
}

export async function listClassStudents(classId: string): Promise<StudentRow[]> {
  const db = requireClient();
  const { data, error } = await db
    .from("class_members")
    .select("student:students(id, name, roll_no, email, status)")
    .eq("class_id", classId);
  if (error) throw error;
  return ((data ?? []) as unknown as { student: StudentRow }[]).map((r) => r.student);
}

export async function inviteStudent(
  ownerId: string,
  classId: string,
  input: { name: string; rollNo?: string; email?: string },
): Promise<StudentRow> {
  const db = requireClient();
  const { data: student, error: studentError } = await db
    .from("students")
    .insert({
      owner_id: ownerId,
      name: input.name,
      roll_no: input.rollNo || null,
      email: input.email || null,
      status: "invited",
    })
    .select()
    .single();
  if (studentError) throw studentError;

  const { error: memberError } = await db
    .from("class_members")
    .insert({ class_id: classId, student_id: student.id, owner_id: ownerId });
  if (memberError) throw memberError;

  return student as StudentRow;
}
