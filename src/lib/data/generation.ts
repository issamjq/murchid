import { backendFetch } from "./backend";

export type Feature =
  | "lesson_plan"
  | "slide_deck"
  | "activity"
  | "homework"
  | "note"
  | "quiz"
  | "exam";

export type Tier = "support" | "extend";

export interface GenerationResult {
  title: string;
  content: string;
  usage?: { input_tokens: number; output_tokens: number };
  // Now {id, title}[]; kept loose because unreadMaterialsNotice still
  // handles the older count-only shape from a stale deployment.
  unread_materials?: unknown[];
  // Live. Absent when no tiers were asked for — and if it's absent when
  // they were, that's an older deployment, not an error. See
  // createTieredGoalItemsFromPrompt in lib/data/classes.ts.
  additional?: Partial<Record<Tier, { title: string; content: string }>>;
  // The materials this draft was actually written from, in the order they
  // were concatenated. `origin` distinguishes the teacher's own upload
  // from a national-curriculum chapter the backend matched on her behalf.
  // Omitted for the student-record features (report_comment,
  // parent_update), which are grounded in a student rather than documents.
  grounded_on?: { id: string; title: string; origin?: "class" | "library" | "curriculum" }[];
}

export function generateContent(
  feature: Feature,
  classId: string,
  prompt: string,
  additionalTiers?: Tier[],
): Promise<GenerationResult> {
  return backendFetch<GenerationResult>("/studio/generate", {
    method: "POST",
    body: {
      feature,
      classId,
      prompt,
      ...(additionalTiers && additionalTiers.length > 0 ? { additionalTiers } : {}),
    },
    // Generation is slower than a normal request — give it real room
    // rather than the default 30s.
    timeoutMs: 90_000,
  });
}

export interface ReportCommentStudent {
  name: string;
  results: { title: string; score: number | null }[];
  attendance: { present: number; late: number; absent: number; total: number };
}

// A distinct "feature" value on the same /studio/generate endpoint (not
// yet in the `Feature` union above, which enumerates goal_item/assessment
// kinds) — the request shape here carries `student`, not just a prompt.
// See "Specs 13–17" in todo/backend-integration.md.
export function generateReportComment(
  classId: string,
  student: ReportCommentStudent,
  note?: string,
): Promise<GenerationResult> {
  return backendFetch<GenerationResult>("/studio/generate", {
    method: "POST",
    body: { feature: "report_comment", classId, prompt: note ?? "", student },
    timeoutMs: 90_000,
  });
}

// Same student payload as report_comment, different reader: this one is
// written for a parent, so the backend is asked for plain language and no
// bare unnormalized marks — the backend goes further and withholds them
// from the model entirely. See todo/backend-integration.md.
// Returns text only — nothing in this product sends anything.
export function generateParentUpdate(
  classId: string,
  student: ReportCommentStudent,
  note?: string,
): Promise<GenerationResult> {
  return backendFetch<GenerationResult>("/studio/generate", {
    method: "POST",
    body: { feature: "parent_update", classId, prompt: note ?? "", student },
    timeoutMs: 90_000,
  });
}

export function unreadMaterialsNotice(result: GenerationResult): string | undefined {
  const unread = result.unread_materials ?? [];
  if (unread.length === 0) return undefined;

  // The backend tightened this to {id, title}[] — name the files rather
  // than counting them. Older responses were an unspecified shape whose
  // length was all anyone read, so fall back to the count if titles
  // aren't there.
  const titles = unread
    .map((m) => (typeof m === "object" && m !== null ? (m as { title?: string }).title : undefined))
    .filter((t): t is string => typeof t === "string" && t.length > 0);

  const what =
    titles.length === unread.length
      ? titles.join(", ")
      : `${unread.length} material${unread.length === 1 ? "" : "s"} attached to this class`;

  return `${what} ${
    unread.length === 1 ? "hasn't" : "haven't"
  } been read yet (uploaded as a file with no extracted text) — this draft may be missing that context.`;
}
