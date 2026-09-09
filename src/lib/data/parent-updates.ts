import { supabase } from "@/lib/supabase/client";
import { BackendError } from "./backend";
import { generateParentUpdate } from "./generation";
import type { StudentSummary } from "./report-comments";

function requireClient() {
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

export interface ParentUpdate {
  update_text: string | null;
  status: "draft" | "approved";
}

export async function listParentUpdates(classId: string): Promise<Record<string, ParentUpdate>> {
  const db = requireClient();
  const { data, error } = await db
    .from("parent_updates")
    .select("student_id, update_text, status")
    .eq("class_id", classId);
  if (error) throw error;
  const out: Record<string, ParentUpdate> = {};
  for (const row of data ?? []) {
    out[row.student_id] = { update_text: row.update_text, status: row.status };
  }
  return out;
}

export async function upsertParentUpdate(
  ownerId: string,
  classId: string,
  studentId: string,
  updateText: string,
  status: "draft" | "approved",
): Promise<void> {
  const db = requireClient();
  const { error } = await db.from("parent_updates").upsert(
    {
      owner_id: ownerId,
      class_id: classId,
      student_id: studentId,
      update_text: updateText,
      status,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "class_id,student_id" },
  );
  if (error) throw error;
}

// Deliberately quotes no marks. assessments has no max_score, so "scored 7
// on Unit Test 2" tells a parent nothing they can interpret — a teacher at
// least knows what the paper was out of. Attendance is the one figure that
// reads correctly to either, so it leads.
function localTemplate(name: string, summary: StudentSummary): string {
  const { present, late, absent, total } = summary.attendance;
  const attendance =
    total > 0
      ? `${name} has attended ${present} of ${total} session${total === 1 ? "" : "s"} so far${
          late > 0 ? `, arriving late ${late} time${late === 1 ? "" : "s"}` : ""
        }${absent > 0 ? `, and been absent ${absent} time${absent === 1 ? "" : "s"}` : ""}.`
      : `Attendance hasn't been recorded for ${name} yet.`;
  const work =
    summary.results.length > 0
      ? ` ${name} has completed ${summary.results.length} piece${
          summary.results.length === 1 ? "" : "s"
        } of assessed work this term.`
      : ` No assessed work has been recorded for ${name} yet.`;
  return `${attendance}${work}`;
}

// Same confirmed-400/404 fallback contract as draftReportComment:
// "parent_update" is a new feature value the current backend rejects, so
// the teacher still gets a usable starting draft, tagged as a template.
export async function draftParentUpdate(
  classId: string,
  studentName: string,
  summary: StudentSummary,
  note?: string,
): Promise<{ content: string; source: "ai" | "template" }> {
  try {
    const result = await generateParentUpdate(classId, { name: studentName, ...summary }, note);
    return { content: result.content, source: "ai" };
  } catch (e) {
    if (e instanceof BackendError && (e.status === 400 || e.status === 404)) {
      return { content: localTemplate(studentName, summary), source: "template" };
    }
    throw e;
  }
}
