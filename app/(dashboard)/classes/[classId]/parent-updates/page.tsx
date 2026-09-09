"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Users, Sparkles, Copy, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { useSession } from "@/features/auth/session-context";
import { listClassStudents, type StudentRow } from "@/lib/data/classes";
import { getStudentSummaries, type StudentSummary } from "@/lib/data/report-comments";
import {
  listParentUpdates,
  upsertParentUpdate,
  draftParentUpdate,
} from "@/lib/data/parent-updates";

interface EditState {
  text: string;
  status: "draft" | "approved";
  source?: "ai" | "template";
  busy?: boolean;
  copied?: boolean;
}

function summaryLine(summary: StudentSummary | undefined): string {
  if (!summary) return "No results or attendance recorded yet.";
  const { present, late, absent, total } = summary.attendance;
  const attendance =
    total > 0
      ? `${present}/${total} present${late ? `, ${late} late` : ""}${absent ? `, ${absent} absent` : ""}`
      : "No attendance yet";
  const work =
    summary.results.length > 0
      ? `${summary.results.length} piece${summary.results.length === 1 ? "" : "s"} of assessed work`
      : "No assessed work yet";
  return `${work}  ·  ${attendance}`;
}

export default function ClassParentUpdatesPage() {
  const { classId } = useParams<{ classId: string }>();
  const { user } = useSession();
  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [summaries, setSummaries] = useState<Record<string, StudentSummary>>({});
  const [edits, setEdits] = useState<Record<string, EditState>>({});

  const refresh = useCallback(() => {
    Promise.all([
      listClassStudents(classId),
      getStudentSummaries(classId),
      listParentUpdates(classId),
    ]).then(([studentRows, summaryMap, updateMap]) => {
      setStudents(studentRows);
      setSummaries(summaryMap);
      setEdits((prev) => {
        const next: Record<string, EditState> = {};
        for (const s of studentRows) {
          const existing = updateMap[s.id];
          next[s.id] = prev[s.id] ?? {
            text: existing?.update_text ?? "",
            status: existing?.status ?? "draft",
          };
        }
        return next;
      });
    });
  }, [classId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const roster = (students ?? []).filter((s) => s.status !== "removed");

  const emptySummary: StudentSummary = {
    results: [],
    attendance: { present: 0, late: 0, absent: 0, total: 0 },
  };

  async function handleDraft(studentId: string, name: string) {
    setEdits((prev) => ({ ...prev, [studentId]: { ...prev[studentId], busy: true } }));
    const result = await draftParentUpdate(classId, name, summaries[studentId] ?? emptySummary);
    setEdits((prev) => ({
      ...prev,
      [studentId]: { ...prev[studentId], text: result.content, source: result.source, busy: false },
    }));
  }

  async function handleCopy(studentId: string) {
    const edit = edits[studentId];
    if (!edit?.text) return;
    await navigator.clipboard.writeText(edit.text);
    setEdits((prev) => ({ ...prev, [studentId]: { ...prev[studentId], copied: true } }));
    setTimeout(
      () => setEdits((prev) => ({ ...prev, [studentId]: { ...prev[studentId], copied: false } })),
      2000,
    );
  }

  async function handleSave(studentId: string) {
    if (!user) return;
    const edit = edits[studentId];
    if (!edit) return;
    await upsertParentUpdate(user.id, classId, studentId, edit.text, edit.status);
  }

  async function handleMarkFinal(studentId: string) {
    if (!user) return;
    const edit = edits[studentId];
    if (!edit) return;
    await upsertParentUpdate(user.id, classId, studentId, edit.text, "approved");
    setEdits((prev) => ({ ...prev, [studentId]: { ...prev[studentId], status: "approved" } }));
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6 md:p-8">
      <p className="text-sm text-muted-foreground">
        A plain-language update per student, drafted from their record. Copy it into whatever you
        already use — Murchid doesn&apos;t email parents.
      </p>
      {students === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : roster.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No students yet"
          description="Invite students to this class before drafting updates for their parents."
        />
      ) : (
        <div className="space-y-4">
          {roster.map((s) => {
            const edit = edits[s.id] ?? { text: "", status: "draft" as const };
            return (
              <Card key={s.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{summaryLine(summaries[s.id])}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {edit.source === "template" ? (
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                          Template
                        </span>
                      ) : null}
                      <StatusPill status={edit.status} />
                    </div>
                  </div>
                  <Textarea
                    value={edit.text}
                    onChange={(e) =>
                      setEdits((prev) => ({
                        ...prev,
                        [s.id]: {
                          ...prev[s.id],
                          text: e.target.value,
                          status: prev[s.id]?.status ?? "draft",
                        },
                      }))
                    }
                    placeholder="No update yet — draft one or write your own."
                    rows={3}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDraft(s.id, s.name)}
                      disabled={edit.busy}
                    >
                      <Sparkles className="size-4" />
                      {edit.busy ? "Drafting…" : "Draft"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopy(s.id)}
                      disabled={!edit.text}
                    >
                      {edit.copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                      {edit.copied ? "Copied" : "Copy update"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleSave(s.id)}>
                      Save
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleMarkFinal(s.id)}
                      disabled={edit.status === "approved"}
                    >
                      Mark final
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
