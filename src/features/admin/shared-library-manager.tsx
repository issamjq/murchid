"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, LibraryBig, Paperclip, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useSession } from "@/features/auth/session-context";
import { SYLLABUS_TYPES } from "@/features/onboarding/uae-institutions";
import {
  listSharedMaterials,
  createSharedMaterial,
  uploadSharedLibraryFile,
  sharedLibraryFileUrl,
  type SharedMaterialRow,
} from "@/lib/data/library";

function groupBySyllabusThenGrade(rows: SharedMaterialRow[]) {
  const bySyllabus = new Map<string, Map<string, SharedMaterialRow[]>>();
  for (const row of rows) {
    const syllabus = row.syllabus ?? "Unspecified syllabus";
    const grade = row.grade_level ? `Grade ${row.grade_level}` : "Unspecified grade";
    if (!bySyllabus.has(syllabus)) bySyllabus.set(syllabus, new Map());
    const byGrade = bySyllabus.get(syllabus)!;
    if (!byGrade.has(grade)) byGrade.set(grade, []);
    byGrade.get(grade)!.push(row);
  }
  return bySyllabus;
}

export function SharedLibraryManager() {
  const { user } = useSession();
  const [rows, setRows] = useState<SharedMaterialRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [syllabus, setSyllabus] = useState<string>(SYLLABUS_TYPES[0]);
  const [gradeLevel, setGradeLevel] = useState(9);
  const [subject, setSubject] = useState("");
  const [bodyMd, setBodyMd] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(() => {
    listSharedMaterials()
      .then(setRows)
      .catch((e) => setError(e.message ?? "Failed to load the shared library"));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function submit() {
    if (!user || !title.trim() || !subject.trim() || (!bodyMd.trim() && !file)) return;
    setSaving(true);
    setError(null);
    try {
      const storagePath = file ? await uploadSharedLibraryFile(file) : undefined;
      await createSharedMaterial(user.id, {
        title: title.trim(),
        syllabus,
        gradeLevel,
        subject: subject.trim(),
        bodyMd: bodyMd.trim() || `Original file attached — extracted text not pasted yet.`,
        storagePath,
      });
      setTitle("");
      setSubject("");
      setBodyMd("");
      setFile(null);
      setOpen(false);
      refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Failed to add — only super_admin/sub_admin accounts can add to the shared library.",
      );
    } finally {
      setSaving(false);
    }
  }

  const grouped = rows ? groupBySyllabusThenGrade(rows) : null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Shared library</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
          <Plus /> Add document
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {open ? (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <div className="space-y-1.5">
              <Label htmlFor="doc-title">Title</Label>
              <Input
                id="doc-title"
                placeholder="e.g. CBSE Grade 10 Social Studies — Unit 3: Trade Routes"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="doc-syllabus">Syllabus</Label>
                <select
                  id="doc-syllabus"
                  value={syllabus}
                  onChange={(e) => setSyllabus(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {SYLLABUS_TYPES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-grade">Grade</Label>
                <Input
                  id="doc-grade"
                  type="number"
                  value={gradeLevel}
                  onChange={(e) => setGradeLevel(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-subject">Subject</Label>
                <Input
                  id="doc-subject"
                  placeholder="e.g. Social Studies"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-file">Original document (optional)</Label>
              <Input
                id="doc-file"
                type="file"
                accept=".pdf,.doc,.docx,.ppt,.pptx,.txt"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                Uploaded to Supabase Storage, publicly readable by any signed-in teacher — this
                is a real file, not a placeholder.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-body">Extracted text</Label>
              <Textarea
                id="doc-body"
                rows={6}
                placeholder="Paste the extracted syllabus/curriculum/textbook text here…"
                value={bodyMd}
                onChange={(e) => setBodyMd(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                No OCR pipeline exists yet — paste the text directly, or leave this blank if
                you've attached the original file above and will add the text later.
              </p>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={submit}
                disabled={saving || !title.trim() || !subject.trim() || (!bodyMd.trim() && !file)}
              >
                {saving ? "Adding…" : "Add to library"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {error && !open ? <p className="text-sm text-destructive">{error}</p> : null}

        {rows === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={LibraryBig}
            title="Nothing in the shared library yet"
            description="Add a document above — teachers will be able to attach it from any class's Notes & text tab."
          />
        ) : (
          <div className="space-y-5">
            {Array.from(grouped!.entries()).map(([syl, byGrade]) => (
              <div key={syl} className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {syl}
                </p>
                {Array.from(byGrade.entries()).map(([grade, docs]) => (
                  <div key={grade} className="space-y-2 pl-3">
                    <p className="text-sm font-medium">{grade}</p>
                    {docs.map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          {d.storage_path ? (
                            <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate text-sm">{d.title}</p>
                            <p className="text-xs text-muted-foreground">{d.subject}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {d.storage_path ? (
                            <Button asChild size="sm" variant="ghost">
                              <a
                                href={sharedLibraryFileUrl(d.storage_path)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                View file
                              </a>
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
