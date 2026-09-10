"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import { Check, Lock, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { StatusPill } from "@/components/ui/status-pill";
import { useSession } from "@/features/auth/session-context";
import { BackendError } from "@/lib/data/backend";
import { listHierarchy, type BatchRow } from "@/lib/data/classes";
import {
  createDraftingGoal,
  recordGoalSources,
  finishGoal,
  insertGoalItem,
  updateGoalItemContent,
  streamPlan,
  schedulePlan,
  approvePlan,
  commitApproval,
  getLatestUnapprovedGoal,
  type GoalRow,
  type GoalItemRow,
  type PlanStartedData,
  type PlanDoneData,
  type ScheduleResult,
} from "@/lib/data/goal-planner";
import { PlanIntake, type ClassOption, type GeneratePayload } from "./plan-intake";

type Stage = "intake" | "generating" | "review" | "scheduling" | "approved";

function flattenClasses(batches: BatchRow[]): ClassOption[] {
  return batches
    .slice()
    .sort((a, b) => b.start_year - a.start_year)
    .flatMap((b) =>
      b.grades
        .slice()
        .sort((g1, g2) => g1.level - g2.level)
        .flatMap((g) =>
          g.divisions.flatMap((d) =>
            d.classes.map((c) => ({
              id: c.id,
              label: `${b.label} · Grade ${g.level} · ${d.label} · ${c.subject}`,
            })),
          ),
        ),
    );
}

// Generation streams for 2-5 minutes (per PlanIntake's own copy), long
// enough that a teacher reasonably switches tabs — a native notification
// reaches them there; the in-page banner covers everyone else.
function notifyBrowser(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "granted") new Notification(title, { body });
}

const KIND_LABEL: Record<string, string> = {
  lesson_plan: "Lesson plan",
  slide_deck: "Slide deck",
  note: "Notes",
  quiz: "Quiz",
  exam: "Exam",
  activity: "Activity",
  homework: "Homework",
};

export function GoalPlannerForm() {
  const { user } = useSession();
  const approved = user?.status === "active";

  const [stage, setStage] = useState<Stage>("intake");
  const [classes, setClasses] = useState<ClassOption[] | null>(null);

  const [goal, setGoal] = useState<GoalRow | null>(null);
  const [started, setStarted] = useState<PlanStartedData | null>(null);
  const [items, setItems] = useState<GoalItemRow[]>([]);
  const [failedKinds, setFailedKinds] = useState<string[]>([]);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const [termStart, setTermStart] = useState("");
  const [termEnd, setTermEnd] = useState("");
  const [schedule, setScheduleResult] = useState<ScheduleResult | null>(null);
  const [dateByGoalItemId, setDateByGoalItemId] = useState<Map<string, string>>(new Map());
  const [committing, setCommitting] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // Which class's leftover, unapproved draft has already been offered —
  // so switching classes back and forth doesn't re-hijack the screen.
  const [autoResumedFor, setAutoResumedFor] = useState<string | null>(null);
  const [justCompleted, setJustCompleted] = useState(false);
  const [resumedDraft, setResumedDraft] = useState(false);

  useEffect(() => {
    listHierarchy().then((data) => setClasses(flattenClasses(data)));
  }, []);

  // A generated-but-unapproved goal from an earlier visit (browser back,
  // reload, a different tab) — without this it sits in the database with
  // no way back to review/approve, which is exactly "stuck in draft".
  const handleClassChange = useCallback(
    async (classId: string) => {
      if (stage !== "intake" || autoResumedFor === classId) return;
      setAutoResumedFor(classId);
      try {
        const resumable = await getLatestUnapprovedGoal(classId);
        if (resumable && resumable.items.length > 0) {
          setGoal(resumable.goal);
          setItems(resumable.items);
          setFailedKinds([]);
          setGenerationError(resumable.goal.error);
          setResumedDraft(true);
          setStage("review");
        }
      } catch {
        // Resuming is a convenience on top of generating fresh — if the
        // lookup fails, the teacher can still just generate a new plan.
      }
    },
    [stage, autoResumedFor],
  );

  function startOver() {
    setStage("intake");
    setGoal(null);
    setStarted(null);
    setItems([]);
    setFailedKinds([]);
    setGenerationError(null);
    setResumedDraft(false);
    setJustCompleted(false);
    // The draft itself isn't deleted, only hidden — clearing this lets
    // switching away and back to the class resurface it, instead of
    // "start over" being an irreversible dead end for this session.
    setAutoResumedFor(null);
  }

  async function generate({ classId, prompt, source, materialIds }: GeneratePayload) {
    if (!user) return;
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    setStage("generating");
    setGenerationError(null);
    setItems([]);
    setFailedKinds([]);
    setStarted(null);
    setResumedDraft(false);
    setJustCompleted(false);

    let createdGoal: GoalRow;
    try {
      createdGoal = await createDraftingGoal(user.id, classId, prompt, source);
      setGoal(createdGoal);
    } catch (e) {
      setGenerationError(e instanceof Error ? e.message : "Could not start the plan");
      setStage("intake");
      return;
    }

    try {
      await streamPlan(
        {
          classId,
          prompt,
          source,
          materialIds: materialIds.length > 0 ? materialIds : undefined,
          goalId: createdGoal.id,
        },
        (event, data) => {
          if (event === "started") {
            const startedData = data as PlanStartedData;
            setStarted(startedData);
            if (startedData.sources && startedData.sources.length > 0) {
              recordGoalSources(user.id, createdGoal.id, startedData.sources).catch(() => {});
            }
          } else if (event === "item") {
            const d = data as { kind: string; title: string; content: string };
            insertGoalItem(user.id, createdGoal.id, d)
              .then((row) => setItems((prev) => [...prev, row]))
              .catch((e) => setGenerationError(e instanceof Error ? e.message : "Failed to save an item"));
          } else if (event === "item_failed") {
            const d = data as { kind: string; message: string };
            setFailedKinds((prev) => [...prev, d.kind]);
          } else if (event === "done") {
            const d = data as PlanDoneData;
            finishGoal(createdGoal.id, { status: "draft" }).catch(() => {});
            setJustCompleted(true);
            notifyBrowser(
              "Term plan ready",
              `${started?.class ?? "Your"} plan finished — ${d.generated} item${d.generated === 1 ? "" : "s"} ready to review.`,
            );
            setStage("review");
          } else if (event === "failed") {
            const d = data as { message: string };
            finishGoal(createdGoal.id, { status: "failed", error: d.message }).catch(() => {});
            setGenerationError(d.message);
            notifyBrowser("Term plan failed", d.message);
            setStage("review");
          }
        },
      );
    } catch (e) {
      const message =
        e instanceof BackendError ? e.message : e instanceof Error ? e.message : "Generation failed";
      setGenerationError(message);
      finishGoal(createdGoal.id, { status: "failed", error: message }).catch(() => {});
      notifyBrowser("Term plan failed", message);
      setStage("review");
    }
  }

  function startEditing(item: GoalItemRow) {
    setEditingId(item.id);
    setEditDraft(item.content);
  }

  async function saveEdit(itemId: string) {
    await updateGoalItemContent(itemId, editDraft);
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, content: editDraft } : i)));
    setEditingId(null);
  }

  async function proposeSchedule() {
    if (!goal || !termStart || !termEnd) return;
    setScheduleError(null);
    try {
      const result = await schedulePlan(goal.id, termStart, termEnd);
      setScheduleResult(result);
      const dates = new Map<string, string>();
      for (const i of result.items) dates.set(i.id, i.scheduled_for);
      for (const a of result.assessments) dates.set(a.goal_item_id, a.scheduled_for);
      setDateByGoalItemId(dates);
    } catch (e) {
      setScheduleError(
        e instanceof BackendError ? e.message : e instanceof Error ? e.message : "Could not propose a schedule",
      );
    }
  }

  async function commit() {
    if (!goal || !schedule || !user) return;
    setCommitting(true);
    setScheduleError(null);
    try {
      // Write the (possibly hand-adjusted) dates onto goal_items before
      // approving, so a later view of Lessons/Presentations/etc. already
      // shows the real date rather than what the proposal first suggested.
      // Quiz/exam ids are excluded: commitApproval below gives each of
      // those its own row in `assessments`, which is what Quizzes/Exams
      // and the calendar actually read — writing scheduled_for here too
      // would leave the same item counted twice on the calendar.
      const assessmentGoalItemIds = new Set(schedule.assessments.map((a) => a.goal_item_id));
      const { supabase } = await import("@/lib/supabase/client");
      if (supabase) {
        for (const [goalItemId, date] of dateByGoalItemId) {
          if (assessmentGoalItemIds.has(goalItemId)) continue;
          await supabase.from("goal_items").update({ scheduled_for: date }).eq("id", goalItemId);
        }
      }

      const result = await approvePlan(goal.id);
      const contentByGoalItemId = new Map(items.map((i) => [i.id, i.content]));
      // Prefer any date she adjusted by hand over whatever the backend's
      // own approve response computed for the same item.
      const adjustedAssessments = result.assessments.map((a) => ({
        ...a,
        scheduled_for: dateByGoalItemId.get(a.goal_item_id) ?? a.scheduled_for,
      }));
      await commitApproval(goal.id, { ...result, assessments: adjustedAssessments }, contentByGoalItemId);
      setStage("approved");
    } catch (e) {
      setScheduleError(
        e instanceof BackendError ? e.message : e instanceof Error ? e.message : "Could not approve the plan",
      );
    } finally {
      setCommitting(false);
    }
  }

  const scheduleRows = useMemo(() => {
    if (!schedule) return [];
    const byId = new Map(items.map((i) => [i.id, i]));
    return [
      ...schedule.items.map((i) => ({ id: i.id, kind: i.kind, title: byId.get(i.id)?.title ?? i.kind })),
      ...schedule.assessments.map((a) => ({ id: a.goal_item_id, kind: a.kind, title: a.title })),
    ];
  }, [schedule, items]);

  const receivedCount = items.length + failedKinds.length;
  const totalKinds = started?.kinds.length ?? 7;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <PlanIntake
        classes={classes}
        ownerId={user?.id ?? null}
        busy={stage !== "intake"}
        onGenerate={generate}
        onClassChange={handleClassChange}
      />

      <Card>
        <CardHeader>
          <CardTitle>Draft</CardTitle>
        </CardHeader>
        <CardContent>
          {stage === "intake" && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Generate a plan to see the draft here.
            </p>
          )}

          {stage === "generating" && (
            <div className="space-y-3 py-10">
              <p className="text-center text-sm text-muted-foreground">
                {started
                  ? `Drafting for ${started.class} — ${receivedCount} of ${totalKinds}…`
                  : "Starting — this can take up to a minute on a cold backend…"}
              </p>
              <Progress value={totalKinds > 0 ? (receivedCount / totalKinds) * 100 : 0} />
              <p className="text-center text-xs text-muted-foreground">
                A full term plan streams for 2–5 minutes. This stays open until it's done.
              </p>
            </div>
          )}

          {(stage === "review" || stage === "scheduling" || stage === "approved") && (
            <div className="space-y-4">
              {generationError ? (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                  <AlertTriangle className="size-4 shrink-0 text-destructive" />
                  <p className="text-xs text-destructive">{generationError}</p>
                </div>
              ) : null}
              {justCompleted ? (
                <div className="flex items-start justify-between gap-2 rounded-md border border-success/40 bg-success/5 p-3">
                  <div className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" />
                    <p className="text-xs">
                      Generation's done — {items.length} item{items.length === 1 ? "" : "s"} ready to
                      review below.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setJustCompleted(false)}
                    className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Dismiss
                  </button>
                </div>
              ) : null}
              {resumedDraft && stage === "review" ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border bg-secondary/40 p-3">
                  <p className="text-xs text-muted-foreground">
                    Picked up a draft from earlier that hadn&apos;t been approved yet.
                  </p>
                  <Button variant="ghost" size="sm" onClick={startOver}>
                    Start a new plan instead
                  </Button>
                </div>
              ) : null}
              {started?.unread_materials && started.unread_materials.length > 0 ? (
                <p className="text-xs text-warning">
                  {started.unread_materials.length} attached material(s) haven't been read yet — this
                  plan may be missing that context.
                </p>
              ) : null}
              {started?.attachments?.problems.map((problem) => (
                <p key={problem} className="text-xs text-warning">
                  {problem}
                </p>
              ))}

              <div className="space-y-2">
                {items.map((item) => (
                  <div key={item.id} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{KIND_LABEL[item.kind] ?? item.kind}</p>
                        <p className="text-xs text-muted-foreground">{item.title}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusPill
                          status={
                            stage === "approved" ? "scheduled" : item.status === "draft" ? "draft" : "scheduled"
                          }
                        />
                        {stage === "review" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => (editingId === item.id ? saveEdit(item.id) : startEditing(item))}
                          >
                            {editingId === item.id ? "Save" : "Edit"}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {editingId === item.id ? (
                      <Textarea
                        rows={8}
                        className="mt-2"
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                      />
                    ) : (
                      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
                        {item.content}
                      </p>
                    )}
                  </div>
                ))}
                {failedKinds.map((kind) => (
                  <div
                    key={kind}
                    className="flex items-center justify-between rounded-md border border-dashed border-destructive/40 bg-destructive/5 p-3"
                  >
                    <p className="text-sm">{KIND_LABEL[kind] ?? kind} — failed to generate</p>
                  </div>
                ))}
              </div>

              {stage === "review" ? (
                approved ? (
                  <div className="space-y-2 rounded-md border border-border p-3">
                    <p className="text-sm font-medium">Schedule this term</p>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="space-y-1">
                        <Label htmlFor="term-start" className="text-xs">
                          Term start
                        </Label>
                        <Input
                          id="term-start"
                          type="date"
                          value={termStart}
                          onChange={(e) => setTermStart(e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="term-end" className="text-xs">
                          Term end
                        </Label>
                        <Input
                          id="term-end"
                          type="date"
                          value={termEnd}
                          onChange={(e) => setTermEnd(e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                      <Button
                        size="sm"
                        disabled={!termStart || !termEnd}
                        onClick={() => {
                          proposeSchedule();
                          setStage("scheduling");
                        }}
                      >
                        Propose dates
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Button className="w-full" variant="default" disabled>
                      <Lock /> Approve &amp; schedule
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">
                      Drafting is open now — scheduling to students needs your
                      account approved first.
                    </p>
                  </div>
                )
              ) : null}

              {stage === "scheduling" ? (
                <div className="space-y-3 rounded-md border border-border p-3">
                  {scheduleError ? <p className="text-xs text-destructive">{scheduleError}</p> : null}
                  {schedule ? (
                    <>
                      <p className="text-sm font-medium">
                        Proposed dates, {schedule.termStart} → {schedule.termEnd}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Adjust any date before approving — nothing is final yet.
                      </p>
                      <div className="max-h-56 space-y-2 overflow-y-auto">
                        {scheduleRows.map((row) => (
                          <div key={row.id} className="flex items-center justify-between gap-2 text-sm">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{row.title}</span>
                              <span className="text-xs text-muted-foreground">{KIND_LABEL[row.kind] ?? row.kind}</span>
                            </span>
                            <Input
                              type="date"
                              className="h-8 w-36 text-xs"
                              value={dateByGoalItemId.get(row.id) ?? ""}
                              onChange={(e) =>
                                setDateByGoalItemId((prev) => new Map(prev).set(row.id, e.target.value))
                              }
                            />
                          </div>
                        ))}
                      </div>
                      <Button className="w-full" onClick={commit} disabled={committing}>
                        <Check /> {committing ? "Approving…" : "Approve & schedule"}
                      </Button>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Proposing dates…</p>
                  )}
                </div>
              ) : null}

              {stage === "approved" ? (
                <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success/5 p-3">
                  <Check className="size-4 text-success" />
                  <p className="text-sm">
                    Scheduled — find these in Lessons, Presentations, Quizzes and the rest of this
                    class's tabs.
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
