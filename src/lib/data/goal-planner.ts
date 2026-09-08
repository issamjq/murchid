import { supabase } from "@/lib/supabase/client";
import { authHeader, backendFetch, BackendError } from "./backend";

function requireClient() {
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

// ── Goal (term plan) lifecycle — writes go straight to Supabase under the
// teacher's own session; the backend only ever generates and reads. ──

export type GoalStatus = "drafting" | "draft" | "approved" | "failed";
export type GoalSource = "prompt" | "upload" | "library";

export interface GoalRow {
  id: string;
  class_id: string;
  status: GoalStatus;
  title: string | null;
  error: string | null;
  term_start: string | null;
  term_end: string | null;
}

export async function createDraftingGoal(
  ownerId: string,
  classId: string,
  prompt: string,
  source: GoalSource,
): Promise<GoalRow> {
  const db = requireClient();
  const { data, error } = await db
    .from("goals")
    .insert({ owner_id: ownerId, class_id: classId, prompt, source, status: "drafting" })
    .select()
    .single();
  if (error) throw error;
  return data as GoalRow;
}

export async function recordGoalSources(
  ownerId: string,
  goalId: string,
  materialIds: string[],
): Promise<void> {
  if (materialIds.length === 0) return;
  const db = requireClient();
  const { error } = await db
    .from("goal_sources")
    .insert(materialIds.map((material_id) => ({ goal_id: goalId, material_id, owner_id: ownerId })));
  if (error) throw error;
}

export async function finishGoal(
  goalId: string,
  patch: { status: "draft" | "failed"; title?: string; error?: string },
): Promise<void> {
  const db = requireClient();
  const { error } = await db
    .from("goals")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", goalId);
  if (error) throw error;
}

export interface GoalItemRow {
  id: string;
  kind: string;
  title: string;
  content: string;
  status: "draft" | "approved" | "scheduled";
  scheduled_for: string | null;
}

export async function insertGoalItem(
  ownerId: string,
  goalId: string,
  frame: { kind: string; title: string; content: string },
): Promise<GoalItemRow> {
  const db = requireClient();
  const { data, error } = await db
    .from("goal_items")
    .insert({
      owner_id: ownerId,
      goal_id: goalId,
      kind: frame.kind,
      title: frame.title,
      content: { markdown: frame.content },
      status: "draft",
    })
    .select("id, kind, title, content, status, scheduled_for")
    .single();
  if (error) throw error;
  return {
    id: data.id,
    kind: data.kind,
    title: data.title,
    content: (data.content as { markdown: string } | null)?.markdown ?? "",
    status: data.status,
    scheduled_for: data.scheduled_for,
  };
}

export async function updateGoalItemContent(itemId: string, content: string): Promise<void> {
  const db = requireClient();
  const { error } = await db
    .from("goal_items")
    .update({ content: { markdown: content }, updated_at: new Date().toISOString() })
    .eq("id", itemId);
  if (error) throw error;
}

// ── The real curriculum corpus — via the backend, not Supabase directly.
// listSharedMaterials() (Supabase, is_shared=true) only sees is_shared
// rows and filters grade as an integer; this corpus is far larger and
// grade can be a range ("K-12"), so it has to be a separate call. ──

export interface LibraryBoard {
  board: string;
  count: number;
  grades: string[];
  subjects: string[];
  materialTypes: string[];
}

export function getLibraryFilters(): Promise<{ boards: LibraryBoard[] }> {
  return backendFetch("/studio/library/filters");
}

export interface LibraryMaterial {
  id: string;
  title: string;
  board: string;
  grade_label: string;
  subject: string;
  material_type: string;
  source_licence: string;
  byte_size: number;
}

export interface LibrarySearchResult {
  total: number;
  limit: number;
  offset: number;
  materials: LibraryMaterial[];
}

export function searchLibrary(params: {
  board?: string;
  subject?: string;
  grade?: string;
  materialType?: string;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<LibrarySearchResult> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") qs.set(key, String(value));
  }
  const suffix = qs.toString();
  return backendFetch(`/studio/library${suffix ? `?${suffix}` : ""}`);
}

// ── Streaming generation — SSE, not JSON. backendFetch can't be reused:
// it awaits the whole body as text and aborts at a fixed timeout, and a
// term plan streams for 2-5 minutes. ──

export interface PlanStartedData {
  classId: string;
  class: string;
  kinds: string[];
  quote?: number;
  sources?: string[];
  unread_materials?: unknown[];
  attachments?: { read: string[]; problems: string[] };
}
export interface PlanItemData {
  kind: string;
  title: string;
  content: string;
  usage?: unknown;
  credits?: number;
}
export interface PlanItemFailedData {
  kind: string;
  message: string;
}
export interface PlanDoneData {
  generated: number;
  failed: number;
  credits?: number;
  usage?: unknown;
}
export interface PlanFailedData {
  message: string;
  code?: string;
  generated: number;
}

export async function streamPlan(
  body: {
    classId: string;
    prompt: string;
    source: GoalSource;
    materialIds?: string[];
    kinds?: string[];
    goalId?: string;
  },
  onFrame: (event: string, data: unknown) => void,
): Promise<void> {
  const res = await fetch("/api/studio/plan", {
    method: "POST",
    headers: {
      ...(await authHeader()),
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}) as { error?: string; code?: string });
    throw new BackendError(errBody.error ?? `Request failed (${res.status})`, res.status, errBody.code);
  }
  if (!res.body) throw new Error("No response stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Split on a genuine blank line, never on the raw chunk boundary — a
    // frame can straddle two network chunks, and a generated document
    // that happens to contain "\n\n" would otherwise be read as two
    // frames.
    let i: number;
    while ((i = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(block);
      const da = /^data: (.+)$/m.exec(block);
      if (ev && da) onFrame(ev[1], JSON.parse(da[1]));
      // A bare ": ping" comment (no event/data) is a keep-alive — ignored.
    }
  }
}

// ── Schedule + approve ──

export interface ScheduleResultItem {
  id: string;
  kind: string;
  scheduled_for: string;
}
export interface ScheduleResultAssessment {
  goal_item_id: string;
  class_id: string;
  kind: string;
  title: string;
  status: string;
  scheduled_for: string;
}
export interface ScheduleResult {
  termStart: string;
  termEnd: string;
  items: ScheduleResultItem[];
  assessments: ScheduleResultAssessment[];
}

export function schedulePlan(
  goalId: string,
  termStart: string,
  termEnd: string,
): Promise<ScheduleResult> {
  return backendFetch(`/studio/plan/${goalId}/schedule`, {
    method: "POST",
    body: { termStart, termEnd },
  });
}

export interface ApproveResultAssessment {
  goal_item_id: string;
  class_id: string;
  owner_id: string;
  kind: string;
  title: string;
  status: string;
  scheduled_for: string;
}
export interface ApproveResultMaterial {
  goal_item_id: string;
  owner_id: string;
  title: string;
  kind: string;
  material_type: string;
  is_shared: boolean;
  attach_to_class: string;
}
export interface ApproveResult {
  goal: { id: string; status: "approved"; approved_at: string };
  items: { id: string; status: "scheduled" }[];
  assessments: ApproveResultAssessment[];
  materials: ApproveResultMaterial[];
}

export function approvePlan(goalId: string): Promise<ApproveResult> {
  return backendFetch(`/studio/plan/${goalId}/approve`, { method: "POST" });
}

// The backend deliberately returns no content for assessments/materials
// at approval — the browser holds the teacher's possibly-edited version,
// and the backend's own copy would overwrite it at the moment she
// approves. contentByGoalItemId is that in-memory state.
export async function commitApproval(
  goalId: string,
  result: ApproveResult,
  contentByGoalItemId: Map<string, string>,
): Promise<void> {
  const db = requireClient();

  if (result.assessments.length > 0) {
    const { error } = await db.from("assessments").insert(
      result.assessments.map((a) => ({
        goal_item_id: a.goal_item_id,
        class_id: a.class_id,
        owner_id: a.owner_id,
        kind: a.kind,
        title: a.title,
        status: a.status,
        scheduled_for: a.scheduled_for,
        content: { markdown: contentByGoalItemId.get(a.goal_item_id) ?? "" },
      })),
    );
    if (error) throw error;
  }

  for (const m of result.materials) {
    const { data: mat, error: matError } = await db
      .from("materials")
      .insert({
        owner_id: m.owner_id,
        title: m.title,
        kind: m.kind,
        body_md: contentByGoalItemId.get(m.goal_item_id) ?? "",
        is_shared: m.is_shared,
      })
      .select("id")
      .single();
    if (matError) throw matError;

    const { error: linkError } = await db
      .from("class_materials")
      .insert({ class_id: m.attach_to_class, material_id: mat.id, owner_id: m.owner_id });
    if (linkError) throw linkError;
  }

  const { error: goalError } = await db
    .from("goals")
    .update({ status: result.goal.status, approved_at: result.goal.approved_at })
    .eq("id", goalId);
  if (goalError) throw goalError;

  for (const item of result.items) {
    const { error: itemError } = await db.from("goal_items").update({ status: item.status }).eq("id", item.id);
    if (itemError) throw itemError;
  }
}
