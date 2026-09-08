"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles, Check, Lock, FileWarning, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { StatusPill } from "@/components/ui/status-pill";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useSession } from "@/features/auth/session-context";
import { AddOwnReferenceForm } from "@/features/studio-legacy/AddOwnReferenceForm";
import { BackendError } from "@/lib/data/backend";
import {
  listHierarchy,
  hasReferenceMaterial,
  type BatchRow,
} from "@/lib/data/classes";
import {
  createDraftingGoal,
  recordGoalSources,
  finishGoal,
  insertGoalItem,
  updateGoalItemContent,
  getLibraryFilters,
  searchLibrary,
  streamPlan,
  schedulePlan,
  approvePlan,
  commitApproval,
  type GoalRow,
  type GoalItemRow,
  type LibraryBoard,
  type LibraryMaterial,
  type PlanStartedData,
  type ScheduleResult,
} from "@/lib/data/goal-planner";

// A detailed enough prompt counts as grounding on its own, per the
// concept: "curriculum, or proper detailed prompts, and textbooks or
// documents, or choose from the materials." Anything real and attached
// to the class (Notes & text) also counts, checked separately below.
const MIN_GROUNDED_PROMPT_LENGTH = 40;

type Stage = "intake" | "generating" | "review" | "scheduling" | "approved";

interface ClassOption {
  id: string;
  label: string;
}

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

const KIND_LABEL: Record<string, string> = {
  lesson_plan: "Lesson plan",
  slide_deck: "Slide deck",
  note: "Notes",
  quiz: "Quiz",
  exam: "Exam",
  activity: "Activity",
  homework: "Homework",
};

function SharedLibraryPicker({
  selected,
  onToggle,
}: {
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [filters, setFilters] = useState<{ boards: LibraryBoard[] } | null>(null);
  const [board, setBoard] = useState("");
  const [grade, setGrade] = useState("");
  const [subject, setSubject] = useState("");
  const [results, setResults] = useState<LibraryMaterial[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getLibraryFilters()
      .then(setFilters)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load the library"));
  }, []);

  useEffect(() => {
    searchLibrary({ board: board || undefined, grade: grade || undefined, subject: subject || undefined, limit: 40 })
      .then((r) => {
        setResults(r.materials);
        setTotal(r.total);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Search failed"));
  }, [board, grade, subject]);

  const boardOptions = filters?.boards ?? [];
  const activeBoard = boardOptions.find((b) => b.board === board);

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <select
          value={board}
          onChange={(e) => {
            setBoard(e.target.value);
            setGrade("");
            setSubject("");
          }}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm"
        >
          <option value="">Any board</option>
          {boardOptions.map((b) => (
            <option key={b.board} value={b.board}>
              {b.board} ({b.count})
            </option>
          ))}
        </select>
        <select
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          disabled={!activeBoard}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm disabled:opacity-50"
        >
          <option value="">Any grade</option>
          {(activeBoard?.grades ?? []).map((g) => (
            <option key={g} value={g}>
              Grade {g}
            </option>
          ))}
        </select>
        <select
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={!activeBoard}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm disabled:opacity-50"
        >
          <option value="">Any subject</option>
          {(activeBoard?.subjects ?? []).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {results === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : results.length === 0 ? (
        <p className="text-xs text-muted-foreground">No documents match those filters.</p>
      ) : (
        <>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {results.map((m) => (
              <label key={m.id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4"
                  checked={selected.has(m.id)}
                  onChange={() => onToggle(m.id)}
                />
                <span className="min-w-0">
                  <span className="block truncate">{m.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {m.board} · Grade {m.grade_label} · {m.subject} · {m.material_type}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {results.length} of {total} shown
          </p>
        </>
      )}
    </div>
  );
}

export function GoalPlannerForm() {
  const { user } = useSession();
  const approved = user?.status === "active";

  const [stage, setStage] = useState<Stage>("intake");
  const [classes, setClasses] = useState<ClassOption[] | null>(null);
  const [classId, setClassId] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [hasReference, setHasReference] = useState<boolean | null>(null);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(new Set());

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

  useEffect(() => {
    listHierarchy().then((data) => {
      const options = flattenClasses(data);
      setClasses(options);
      if (options.length > 0) setClassId(options[0].id);
    });
  }, []);

  useEffect(() => {
    if (!classId) {
      setHasReference(null);
      return;
    }
    hasReferenceMaterial(classId).then(setHasReference);
  }, [classId]);

  const grounded = hasReference || prompt.trim().length >= MIN_GROUNDED_PROMPT_LENGTH;
  const canGenerate = Boolean(classId) && Boolean(user) && grounded && stage === "intake";

  function toggleMaterial(id: string) {
    setSelectedMaterialIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function generate() {
    if (!canGenerate || !user) return;
    setStage("generating");
    setGenerationError(null);
    setItems([]);
    setFailedKinds([]);
    setStarted(null);

    const source = selectedMaterialIds.size > 0 ? "library" : "prompt";
    let createdGoal: GoalRow;
    try {
      createdGoal = await createDraftingGoal(user.id, classId, prompt.trim(), source);
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
          prompt: prompt.trim(),
          source,
          materialIds: selectedMaterialIds.size > 0 ? Array.from(selectedMaterialIds) : undefined,
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
            finishGoal(createdGoal.id, { status: "draft" }).catch(() => {});
            setStage("review");
          } else if (event === "failed") {
            const d = data as { message: string };
            finishGoal(createdGoal.id, { status: "failed", error: d.message }).catch(() => {});
            setGenerationError(d.message);
            setStage("review");
          }
        },
      );
    } catch (e) {
      const message =
        e instanceof BackendError ? e.message : e instanceof Error ? e.message : "Generation failed";
      setGenerationError(message);
      finishGoal(createdGoal.id, { status: "failed", error: message }).catch(() => {});
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
      // approving, so a later view of Lessons/Quizzes/etc. already shows
      // the real date rather than what the proposal first suggested.
      const { supabase } = await import("@/lib/supabase/client");
      if (supabase) {
        for (const [goalItemId, date] of dateByGoalItemId) {
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
      <Card>
        <CardHeader>
          <CardTitle>What are we planning?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="class">Class</Label>
            {classes === null ? (
              <p className="text-sm text-muted-foreground">Loading your classes…</p>
            ) : classes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No classes yet — add one in My Classes first.
              </p>
            ) : (
              <select
                id="class"
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                disabled={stage !== "intake"}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          <Tabs defaultValue="prompt">
            <TabsList>
              <TabsTrigger value="prompt">Prompt</TabsTrigger>
              <TabsTrigger value="upload">Upload documents</TabsTrigger>
              <TabsTrigger value="library">Shared library</TabsTrigger>
            </TabsList>
            <TabsContent value="prompt">
              <Textarea
                rows={6}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={stage !== "intake"}
                placeholder="e.g. Term 2, Unit 3: Trade routes of the ancient world. Cover the Silk Road, maritime trade, and the spread of ideas. Reference the Grade 10 CBSE Social Studies syllabus."
              />
            </TabsContent>
            <TabsContent value="upload">
              {user && classId ? (
                <AddOwnReferenceForm
                  ownerId={user.id}
                  classId={classId}
                  onAttached={() => setHasReference(true)}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Choose a class first.</p>
              )}
            </TabsContent>
            <TabsContent value="library">
              <SharedLibraryPicker selected={selectedMaterialIds} onToggle={toggleMaterial} />
            </TabsContent>
          </Tabs>

          {classId && !grounded ? (
            <div className="flex items-start gap-2 rounded-md border border-dashed border-warning/40 bg-warning/5 p-3">
              <FileWarning className="size-4 shrink-0 text-warning" />
              <p className="text-xs text-muted-foreground">
                This class has no syllabus, curriculum, or reference attached,
                and the prompt is too thin to draft from reliably. Add a
                reference in Notes & text, choose from the shared library
                above, or write more detail here first — otherwise the draft
                would be guessing.
              </p>
            </div>
          ) : null}

          <Button className="w-full" onClick={generate} disabled={!canGenerate}>
            <Sparkles /> Generate term plan
          </Button>
        </CardContent>
      </Card>

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
              {started?.unread_materials && started.unread_materials.length > 0 ? (
                <p className="text-xs text-warning">
                  {started.unread_materials.length} attached material(s) haven't been read yet — this
                  plan may be missing that context.
                </p>
              ) : null}

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
