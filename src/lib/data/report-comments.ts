import { supabase } from "@/lib/supabase/client";
import { BackendError } from "./backend";
import { generateReportComment } from "./generation";

function requireClient() {
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

export interface StudentSummary {
  results: { title: string; score: number | null }[];
  attendance: { present: number; late: number; absent: number; total: number };
}

// No max_score/total_marks column exists on assessments, so scores of
// different scales can't be honestly averaged — list each one instead.
export async function getStudentSummaries(classId: string): Promise<Record<string, StudentSummary>> {
  const db = requireClient();
  const [{ data: assessments, error: assessmentsError }, { data: attendanceRows, error: attendanceError }] =
    await Promise.all([
      db.from("assessments").select("id, title").eq("class_id", classId),
      db.from("attendance").select("student_id, status").eq("class_id", classId),
    ]);
  if (assessmentsError) throw assessmentsError;
  if (attendanceError) throw attendanceError;

  const assessmentTitles = new Map((assessments ?? []).map((a) => [a.id, a.title as string]));
  const assessmentIds = (assessments ?? []).map((a) => a.id);

  let resultRows: { student_id: string; assessment_id: string; score: number | null }[] = [];
  if (assessmentIds.length > 0) {
    const { data, error } = await db
      .from("results")
      .select("student_id, assessment_id, score")
      .in("assessment_id", assessmentIds);
    if (error) throw error;
    resultRows = data ?? [];
  }

  const summaries: Record<string, StudentSummary> = {};
  function ensure(studentId: string): StudentSummary {
    if (!summaries[studentId]) {
      summaries[studentId] = { results: [], attendance: { present: 0, late: 0, absent: 0, total: 0 } };
    }
    return summaries[studentId];
  }

  for (const r of resultRows) {
    ensure(r.student_id).results.push({
      title: assessmentTitles.get(r.assessment_id) ?? "Assessment",
      score: r.score,
    });
  }

  for (const a of attendanceRows ?? []) {
    const summary = ensure(a.student_id);
    summary.attendance.total += 1;
    if (a.status === "present") summary.attendance.present += 1;
    else if (a.status === "late") summary.attendance.late += 1;
    else if (a.status === "absent") summary.attendance.absent += 1;
  }

  return summaries;
}

export interface ReportComment {
  comment_text: string | null;
  status: "draft" | "approved";
}

export async function listReportComments(classId: string): Promise<Record<string, ReportComment>> {
  const db = requireClient();
  const { data, error } = await db
    .from("report_comments")
    .select("student_id, comment_text, status")
    .eq("class_id", classId);
  if (error) throw error;
  const out: Record<string, ReportComment> = {};
  for (const row of data ?? []) {
    out[row.student_id] = { comment_text: row.comment_text, status: row.status };
  }
  return out;
}

export async function upsertReportComment(
  ownerId: string,
  classId: string,
  studentId: string,
  commentText: string,
  status: "draft" | "approved",
): Promise<void> {
  const db = requireClient();
  const { error } = await db.from("report_comments").upsert(
    {
      owner_id: ownerId,
      class_id: classId,
      student_id: studentId,
      comment_text: commentText,
      status,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "class_id,student_id" },
  );
  if (error) throw error;
}

function localTemplate(name: string, summary: StudentSummary): string {
  const scoreLine =
    summary.results.length > 0
      ? `scored ${summary.results.map((r) => `${r.score ?? "—"} on ${r.title}`).join(", ")}`
      : "has no recorded assessment scores yet";
  const { present, late, absent, total } = summary.attendance;
  const attendanceLine =
    total > 0
      ? `attended ${present} of ${total} session${total === 1 ? "" : "s"}${
          late > 0 ? ` (${late} late)` : ""
        }${absent > 0 ? `, absent ${absent} time${absent === 1 ? "" : "s"}` : ""}`
      : "has no attendance recorded yet";
  return `${name} ${scoreLine} this term, and ${attendanceLine}.`;
}

// Tries the real endpoint; falls back to a plain factual local template on
// a confirmed 400/404 — "report_comment" is a brand-new `feature` value, so
// the current backend rejecting it with 400 (missing/invalid feature) is
// the actual documented behavior, not a guess. See
// todo/backend/14-report-comment-spec.md.
export async function draftReportComment(
  classId: string,
  studentName: string,
  summary: StudentSummary,
  note?: string,
): Promise<{ content: string; source: "ai" | "template" }> {
  try {
    const result = await generateReportComment(classId, { name: studentName, ...summary }, note);
    return { content: result.content, source: "ai" };
  } catch (e) {
    if (e instanceof BackendError && (e.status === 400 || e.status === 404)) {
      return { content: localTemplate(studentName, summary), source: "template" };
    }
    throw e;
  }
}
