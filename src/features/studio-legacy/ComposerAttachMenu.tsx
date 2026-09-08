"use client";

import { useState } from "react";
import { LibraryBig, NotebookPen } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { ChooseFromDeckList } from "@/features/classes/choose-from-deck-panel";
import { AddOwnReferenceForm } from "@/shared/add-own-reference-form";

export function ComposerAttachMenu({
  ownerId,
  classId,
  onAttached,
}: {
  ownerId: string;
  classId: string;
  onAttached: () => void;
}) {
  const [tab, setTab] = useState<"deck" | "own">("deck");

  return (
    <Card className="w-full">
      <CardContent className="space-y-3 p-3">
        <div className="flex gap-1 rounded-lg bg-secondary p-1">
          <button
            type="button"
            onClick={() => setTab("deck")}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === "deck"
                ? "bg-card shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LibraryBig className="mr-1.5 inline size-3.5" />
            Choose from deck
          </button>
          <button
            type="button"
            onClick={() => setTab("own")}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === "own"
                ? "bg-card shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <NotebookPen className="mr-1.5 inline size-3.5" />
            Add syllabus / curriculum
          </button>
        </div>
        {tab === "deck" ? (
          <ChooseFromDeckList ownerId={ownerId} classId={classId} onAttached={onAttached} />
        ) : (
          <AddOwnReferenceForm ownerId={ownerId} classId={classId} onAttached={onAttached} />
        )}
      </CardContent>
    </Card>
  );
}
