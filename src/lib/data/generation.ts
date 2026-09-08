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
  // Shape not fully specified by the backend yet — treated as opaque,
  // only its length is relied on.
  unread_materials?: unknown[];
  // Present only once the backend implements todo/backend/13 — its
  // absence (when additionalTiers was sent) means "not built yet", not
  // an error. See createTieredGoalItemsFromPrompt in lib/data/classes.ts.
  additional?: Partial<Record<Tier, { title: string; content: string }>>;
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
// See todo/backend/14-report-comment-spec.md.
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

export function unreadMaterialsNotice(result: GenerationResult): string | undefined {
  const count = result.unread_materials?.length ?? 0;
  if (count === 0) return undefined;
  return `${count} material${count === 1 ? "" : "s"} attached to this class ${
    count === 1 ? "hasn't" : "haven't"
  } been read yet (uploaded as a file with no extracted text) — this draft may be missing that context.`;
}
