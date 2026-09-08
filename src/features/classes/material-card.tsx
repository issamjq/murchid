"use client";

import { useState } from "react";
import { FileUp, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { deleteMaterial, updateMaterial, type MaterialRow } from "@/lib/data/classes";

export function MaterialCard({
  material,
  canManage,
  onOpen,
  onChanged,
}: {
  material: MaterialRow;
  canManage: boolean;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(material.title);
  const [bodyMd, setBodyMd] = useState(material.body_md ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateMaterial(material.id, { title: title.trim(), body_md: bodyMd });
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save those changes.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    if (!confirm(`Delete "${material.title}"? This removes it from every class it's attached to.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteMaterial(material.id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete that.");
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <Card>
        <CardContent className="space-y-2 p-4">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 text-sm" />
          <Textarea
            rows={10}
            value={bodyMd}
            onChange={(e) => setBodyMd(e.target.value)}
            className="text-xs"
            placeholder="The syllabus, curriculum outline or notes this class is planned from…"
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy || !title.trim()}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setTitle(material.title);
                setBodyMd(material.body_md ?? "");
                setError(null);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="group">
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{material.title}</p>
          {material.storage_path ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <FileUp className="size-3" /> Uploaded file
            </p>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canManage ? (
            // Revealed on hover from md up; always there on touch, which
            // has no hover to reveal them with.
            <div className="flex items-center gap-0.5 transition-opacity focus-within:opacity-100 md:opacity-0 md:group-hover:opacity-100">
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Edit ${material.title}`}
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={busy}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Delete ${material.title}`}
                onClick={remove}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ) : null}
          <Button variant="outline" size="sm" onClick={onOpen}>
            Open
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
