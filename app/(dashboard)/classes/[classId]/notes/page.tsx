"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { FileText } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { useSession } from "@/features/auth/session-context";
import { MaterialCard } from "@/features/classes/material-card";
import { useStudio } from "@/features/studio-legacy/studio-context";
import { StudioComposerBar } from "@/features/studio-legacy/StudioComposerBar";
import { generateContent, unreadMaterialsNotice } from "@/lib/data/generation";
import {
  listMaterialsForClass,
  createMaterialFromPrompt,
  type MaterialRow,
} from "@/lib/data/classes";

export default function ClassNotesPage() {
  const { classId } = useParams<{ classId: string }>();
  const { user } = useSession();
  const { open } = useStudio();
  const [items, setItems] = useState<MaterialRow[] | null>(null);

  const refresh = useCallback(() => {
    listMaterialsForClass(classId).then(setItems);
  }, [classId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleCreate(prompt: string) {
    if (!user) return;
    const result = await generateContent("note", classId, prompt);
    await createMaterialFromPrompt(user.id, classId, result);
    refresh();
    const notice = unreadMaterialsNotice(result);
    return notice ? { notice } : undefined;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6 md:p-8">
        <p className="text-sm text-muted-foreground">
          Everything grounding this class — use the attach button in the bar below to choose
          from the shared deck or add a syllabus/curriculum, or prompt the studio for a plain note.
        </p>
        {items === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No notes yet"
            description="Use the attach button in the bar below to choose from the shared deck or add your syllabus/curriculum — or prompt the studio for a plain note."
          />
        ) : (
          <div className="space-y-3">
            {items.map((n) => (
              <MaterialCard
                key={n.id}
                material={n}
                canManage={n.owner_id === user?.id && !n.is_shared}
                onOpen={() => open({ title: n.title, kind: "Note", content: n.body_md })}
                onChanged={refresh}
              />
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-border bg-background p-4 md:px-8">
        <StudioComposerBar
          classId={classId}
          ownerId={user?.id ?? null}
          feature="note"
          placeholder="e.g. A one-page reading on the Silk Road for Grade 10…"
          buttonLabel="Create"
          onSubmit={handleCreate}
          onAttached={refresh}
        />
      </div>
    </div>
  );
}
