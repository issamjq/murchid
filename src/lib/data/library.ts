import { supabase } from "@/lib/supabase/client";

function requireClient() {
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

export interface SharedMaterialRow {
  id: string;
  title: string;
  kind: string;
  subject: string | null;
  syllabus: string | null;
  grade_level: number | null;
  storage_path: string | null;
  created_at: string;
}

const SHARED_MATERIAL_COLUMNS =
  "id, title, kind, subject, syllabus, grade_level, storage_path, created_at";

export function sharedLibraryFileUrl(storagePath: string): string {
  const db = requireClient();
  return db.storage.from("shared-library").getPublicUrl(storagePath).data.publicUrl;
}

export async function uploadSharedLibraryFile(file: File): Promise<string> {
  const db = requireClient();
  const path = `${crypto.randomUUID()}-${file.name}`;
  const { error } = await db.storage.from("shared-library").upload(path, file);
  if (error) throw error;
  return path;
}

export interface SharedMaterialFilters {
  syllabus?: string;
  gradeLevel?: number;
  subject?: string;
}

export async function listSharedMaterials(
  filters: SharedMaterialFilters = {},
): Promise<SharedMaterialRow[]> {
  const db = requireClient();
  let query = db
    .from("materials")
    .select(SHARED_MATERIAL_COLUMNS)
    .eq("is_shared", true)
    .order("syllabus", { ascending: true })
    .order("grade_level", { ascending: true })
    .order("subject", { ascending: true });

  if (filters.syllabus) query = query.eq("syllabus", filters.syllabus);
  if (filters.gradeLevel) query = query.eq("grade_level", filters.gradeLevel);
  if (filters.subject) query = query.ilike("subject", `%${filters.subject}%`);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as SharedMaterialRow[];
}

export async function attachExistingMaterial(
  ownerId: string,
  classId: string,
  materialId: string,
): Promise<void> {
  const db = requireClient();
  const { error } = await db
    .from("class_materials")
    .insert({ class_id: classId, material_id: materialId, owner_id: ownerId });
  if (error) throw error;
}

/** Pulls a shared material into a class as the teacher's OWN editable copy,
 * rather than attachExistingMaterial's read-only reference to the admin's
 * row. Only the text is copied: a file-only material has nothing to adapt,
 * and pointing a private row at the admin-locked shared-library bucket
 * would muddle provenance for no gain — so those report `no_text` and the
 * caller sends the teacher to Add instead. body_md is fetched here rather
 * than in listSharedMaterials so browsing stays cheap. */
export async function copySharedMaterialToClass(
  ownerId: string,
  classId: string,
  materialId: string,
): Promise<{ copied: boolean; reason?: "no_text" }> {
  const db = requireClient();
  const { data: source, error: sourceError } = await db
    .from("materials")
    .select("title, kind, body_md, subject, syllabus, grade_level")
    .eq("id", materialId)
    .single();
  if (sourceError) throw sourceError;

  const bodyMd = (source.body_md ?? "").trim();
  if (!bodyMd) return { copied: false, reason: "no_text" };

  const { data: copy, error: copyError } = await db
    .from("materials")
    .insert({
      owner_id: ownerId,
      title: `${source.title} (copy)`,
      kind: source.kind,
      body_md: source.body_md,
      subject: source.subject,
      syllabus: source.syllabus,
      grade_level: source.grade_level,
      is_shared: false,
    })
    .select()
    .single();
  if (copyError) throw copyError;

  const { error: linkError } = await db
    .from("class_materials")
    .insert({ class_id: classId, material_id: copy.id, owner_id: ownerId });
  if (linkError) throw linkError;

  return { copied: true };
}

export interface NewSharedMaterialInput {
  title: string;
  syllabus: string;
  gradeLevel: number;
  subject: string;
  bodyMd: string;
  storagePath?: string;
}

export async function createSharedMaterial(
  ownerId: string,
  input: NewSharedMaterialInput,
): Promise<SharedMaterialRow> {
  const db = requireClient();
  const { data, error } = await db
    .from("materials")
    .insert({
      owner_id: ownerId,
      title: input.title,
      kind: "note",
      syllabus: input.syllabus,
      grade_level: input.gradeLevel,
      subject: input.subject,
      body_md: input.bodyMd,
      storage_path: input.storagePath ?? null,
      is_shared: true,
    })
    .select(SHARED_MATERIAL_COLUMNS)
    .single();
  if (error) throw error;
  return data as SharedMaterialRow;
}

export async function deleteSharedMaterial(id: string): Promise<void> {
  const db = requireClient();
  const { error } = await db.from("materials").delete().eq("id", id);
  if (error) throw error;
}
