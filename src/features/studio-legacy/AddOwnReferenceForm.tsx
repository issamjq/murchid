"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ClassFileUpload } from "@/shared/class-file-upload";
import { attachOwnReference } from "@/lib/data/classes";

export function AddOwnReferenceForm({
  ownerId,
  classId,
  onAttached,
}: {
  ownerId: string;
  classId: string;
  onAttached: () => void;
}) {
  const [title, setTitle] = useState("");
  const [bodyMd, setBodyMd] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim() || !bodyMd.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await attachOwnReference(ownerId, classId, title.trim(), bodyMd.trim());
      setTitle("");
      setBodyMd("");
      onAttached();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that reference.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <ClassFileUpload classId={classId} clearWhenReady onAttached={onAttached} />
      <p className="text-xs text-muted-foreground">
        Scanned PDFs are transcribed automatically — the file shows up in Notes &amp; text
        once it&apos;s read.
      </p>

      <div className="flex items-center gap-2">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">or type it out</span>
        <Separator className="flex-1" />
      </div>

      <Input
        placeholder="e.g. Grade 10 Social Studies syllabus — Term 2"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="h-8 text-xs"
      />
      <Textarea
        rows={4}
        placeholder="Paste the syllabus, curriculum outline, or textbook excerpt here…"
        value={bodyMd}
        onChange={(e) => setBodyMd(e.target.value)}
        className="resize-none text-xs"
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button size="sm" onClick={submit} disabled={saving || !title.trim() || !bodyMd.trim()}>
        {saving ? "Saving…" : "Add & attach"}
      </Button>
    </div>
  );
}
