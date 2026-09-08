import { supabase } from "@/lib/supabase/client";

function requireClient() {
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

export type AttentionCategory = "stale_attendance" | "ungraded" | "failed_plan" | "unscheduled";

export interface AttentionItem {
  id: string;
  category: AttentionCategory;
  title: string;
  detail: string;
  href: string;
}

const CATEGORY_ORDER: AttentionCategory[] = [
  "stale_attendance",
  "ungraded",
  "failed_plan",
  "unscheduled",
];

const KIND_ROUTE: Record<string, string> = {
  lesson_plan: "notes",
  note: "notes",
  slide_deck: "presentations",
  quiz: "quizzes",
  exam: "exams",
  activity: "activities",
  homework: "homework",
};

function daysAgo(dateStr: string): number {
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export async function getNeedsAttention(
  ownerId: string,
): Promise<{ items: AttentionItem[]; totalCounts: Record<AttentionCategory, number> }> {
  const db = requireClient();
  const today = new Date().toISOString().slice(0, 10);
  const staleThreshold = new Date();
  staleThreshold.setDate(staleThreshold.getDate() - 3);
  const staleThresholdIso = staleThreshold.toISOString().slice(0, 10);

  const [attendanceRes, progressRes, goalItemRes, failedRes] = await Promise.all([
    db
      .from("class_attendance_freshness")
      .select("class_id, subject, last_marked")
      .eq("owner_id", ownerId)
      .or(`last_marked.is.null,last_marked.lt.${staleThresholdIso}`)
      .order("last_marked", { ascending: true, nullsFirst: true }),
    db
      .from("assessment_progress")
      .select("assessment_id, class_id, title, subject, scheduled_for, roster_count, graded_count")
      .eq("owner_id", ownerId)
      .lte("scheduled_for", today)
      .order("scheduled_for", { ascending: false }),
    db
      .from("goal_item_details")
      .select("id, class_id, kind, title, subject, updated_at")
      .eq("owner_id", ownerId)
      .is("scheduled_for", null)
      .order("updated_at", { ascending: true }),
    db
      .from("goals")
      .select("id, title, updated_at")
      .eq("owner_id", ownerId)
      .eq("status", "failed")
      .order("updated_at", { ascending: false }),
  ]);

  const staleAll = (attendanceRes.data ?? []) as {
    class_id: string;
    subject: string;
    last_marked: string | null;
  }[];
  const ungradedAll = (progressRes.data ?? []).filter(
    (r) => (r.roster_count ?? 0) > (r.graded_count ?? 0),
  ) as {
    assessment_id: string;
    class_id: string;
    title: string;
    subject: string;
    roster_count: number;
    graded_count: number;
  }[];
  const unscheduledAll = (goalItemRes.data ?? []) as {
    id: string;
    class_id: string;
    kind: string;
    title: string;
    subject: string;
  }[];
  const failedAll = (failedRes.data ?? []) as { id: string; title: string | null }[];

  const totalCounts: Record<AttentionCategory, number> = {
    stale_attendance: staleAll.length,
    ungraded: ungradedAll.length,
    unscheduled: unscheduledAll.length,
    failed_plan: failedAll.length,
  };

  const items: AttentionItem[] = [
    ...staleAll.slice(0, 5).map((r) => ({
      id: `stale_attendance:${r.class_id}`,
      category: "stale_attendance" as const,
      title: r.subject,
      detail: r.last_marked ? `Not marked in ${daysAgo(r.last_marked)} days` : "Never marked",
      href: `/classes/${r.class_id}/attendance`,
    })),
    ...ungradedAll.slice(0, 5).map((r) => ({
      id: `ungraded:${r.assessment_id}`,
      category: "ungraded" as const,
      title: `${r.subject} — ${r.title}`,
      detail: `${r.graded_count} of ${r.roster_count} graded`,
      href: `/classes/${r.class_id}/results`,
    })),
    ...failedAll.slice(0, 3).map((r) => ({
      id: `failed_plan:${r.id}`,
      category: "failed_plan" as const,
      title: r.title ?? "Term plan",
      detail: "Generation failed — try again",
      href: `/goal-planner`,
    })),
    ...unscheduledAll.slice(0, 5).map((r) => ({
      id: `unscheduled:${r.id}`,
      category: "unscheduled" as const,
      title: `${r.subject} — ${r.title}`,
      detail: "Drafted, not scheduled",
      href: `/classes/${r.class_id}/${KIND_ROUTE[r.kind] ?? "notes"}`,
    })),
  ];

  items.sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
  );

  return { items: items.slice(0, 8), totalCounts };
}
