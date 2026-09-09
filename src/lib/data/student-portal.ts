import { supabase } from "@/lib/supabase/client";

function requireClient() {
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

// The student half of the app. Everything here is readable only because of
// the "student reads …" policies in db/tune.sql — the first non-owner read
// path in the schema. Those policies key off students.auth_user_id, which
// is set exactly once, by claim_student_invite() below.

/** Redeems an invite code the teacher handed over. Links this signed-in
 * account to the student record, flips the profile to role 'student', and
 * burns the code. Throws with the database's own message when the code is
 * unknown or already used. */
export async function claimStudentInvite(code: string): Promise<void> {
  const db = requireClient();
  const { error } = await db.rpc("claim_student_invite", { code });
  if (error) throw new Error(error.message);
}

export interface StudentIdentity {
  id: string;
  name: string;
  roll_no: string | null;
}

/** The caller's own student record, or null if this account has never
 * redeemed an invite (in which case they aren't a student at all). */
export async function getCurrentStudent(): Promise<StudentIdentity | null> {
  const db = requireClient();
  const { data, error } = await db.from("students").select("id, name, roll_no").limit(1);
  if (error) throw error;
  return (data?.[0] as StudentIdentity | undefined) ?? null;
}

export interface StudentNote {
  id: string;
  title: string;
  body_md: string | null;
  storage_path: string | null;
  subject: string;
}

/** Every note a teacher has switched on for a class this student is in.
 * No filtering by owner or class is needed — and none is written — because
 * the policies already return exactly this set and nothing else. */
export async function listStudentNotes(): Promise<StudentNote[]> {
  const db = requireClient();
  const { data, error } = await db
    .from("class_materials")
    .select("material:materials(id, title, body_md, storage_path), class:classes(subject)")
    .eq("visible_to_students", true);
  if (error) throw error;

  const rows = (data ?? []) as unknown as {
    material: { id: string; title: string; body_md: string | null; storage_path: string | null } | null;
    class: { subject: string } | null;
  }[];

  return rows
    .filter((r) => r.material !== null)
    .map((r) => ({
      id: r.material!.id,
      title: r.material!.title,
      body_md: r.material!.body_md,
      storage_path: r.material!.storage_path,
      subject: r.class?.subject ?? "Class",
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject) || a.title.localeCompare(b.title));
}
