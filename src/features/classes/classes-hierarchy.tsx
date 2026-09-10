"use client";

import { useEffect, useState, useCallback } from "react";
import { Pencil, Check, X, School } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { useSession } from "@/features/auth";
import { useClassesRefresh } from "@/features/classes/classes-refresh-context";
import { GradeSection } from "./class-tree-editor";
import { AddBatchForm, AddGradeForm } from "./class-tree-forms";
import { IconButton } from "./icon-button";
import { listHierarchy, updateBatch, type BatchRow } from "@/lib/data/classes";

export function ClassesHierarchy() {
  const { user } = useSession();
  const { bump } = useClassesRefresh();
  const [batches, setBatches] = useState<BatchRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeBatch, setActiveBatch] = useState<string | undefined>(undefined);

  const refresh = useCallback(() => {
    listHierarchy()
      .then(setBatches)
      .catch((e) => setError(e.message ?? "Failed to load classes"));
    bump();
  }, [bump]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!user) return null;
  const ownerId = user.id;

  if (error) {
    return (
      <div>
        <PageHeader title="My Classes" description="Batch → Grade → Division → Subject." />
        <div className="p-6 md:p-8">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </div>
    );
  }

  if (batches === null) {
    return (
      <div>
        <PageHeader title="My Classes" description="Batch → Grade → Division → Subject." />
        <div className="p-6 text-sm text-muted-foreground md:p-8">Loading…</div>
      </div>
    );
  }

  const currentBatchId = activeBatch ?? batches[0]?.id;
  const currentBatch = batches.find((b) => b.id === currentBatchId);

  return (
    <div>
      <PageHeader
        title="My Classes"
        description="Batch → Grade → Division → Subject."
        action={<AddBatchForm ownerId={ownerId} onAdded={refresh} />}
      />
      <div className="p-6 md:p-8">
        {batches.length === 0 ? (
          <EmptyState
            icon={School}
            title="No classes yet"
            description="Start by adding a batch (a school year, e.g. 2025-26) — grades, divisions, and subjects nest under it."
            action={<AddBatchForm ownerId={ownerId} onAdded={refresh} />}
          />
        ) : (
          <Tabs value={currentBatchId} onValueChange={setActiveBatch}>
            <div className="flex items-center justify-between gap-3">
              <TabsList>
                {batches.map((b) => (
                  <TabsTrigger key={b.id} value={b.id}>
                    {b.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {currentBatch ? (
                <BatchActions key={currentBatch.id} batch={currentBatch} onChanged={refresh} />
              ) : null}
            </div>
            {batches.map((batch) => (
              <TabsContent key={batch.id} value={batch.id}>
                <BatchDetail batch={batch} ownerId={ownerId} onChanged={refresh} />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </div>
  );
}

// Rename for the batch that's currently the open tab — lives once, next
// to the tab list, rather than repeated as a heading inside every tab's
// content (the tab label already says which batch this is).
function BatchActions({
  batch,
  onChanged,
}: {
  batch: BatchRow;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(batch.label);
  const [startYear, setStartYear] = useState(batch.start_year);
  const [saving, setSaving] = useState(false);

  async function saveEdit() {
    if (!label.trim()) return;
    setSaving(true);
    await updateBatch(batch.id, label.trim(), startYear);
    setSaving(false);
    setEditing(false);
    onChanged();
  }

  if (editing) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} className="h-8 w-24" autoFocus />
        <Input
          type="number"
          value={startYear}
          onChange={(e) => setStartYear(Number(e.target.value))}
          className="h-8 w-20"
        />
        <IconButton title="Save" onClick={saveEdit}>
          <Check className="size-4" />
        </IconButton>
        <IconButton title="Cancel" onClick={() => setEditing(false)}>
          <X className="size-4" />
        </IconButton>
        {saving ? <span className="text-xs text-muted-foreground">Saving…</span> : null}
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <IconButton title="Rename batch" onClick={() => setEditing(true)}>
        <Pencil className="size-3.5" />
      </IconButton>
    </div>
  );
}

function BatchDetail({
  batch,
  ownerId,
  onChanged,
}: {
  batch: BatchRow;
  ownerId: string;
  onChanged: () => void;
}) {
  const grades = batch.grades.slice().sort((a, b) => a.level - b.level);

  return (
    <div className="space-y-5 pt-1">
      {grades.length === 0 ? (
        <EmptyState
          icon={School}
          title="No grades yet"
          description="Add a grade to start building out this batch's classes."
          action={<AddGradeForm ownerId={ownerId} batchId={batch.id} onAdded={onChanged} />}
        />
      ) : (
        grades.map((grade) => (
          <GradeSection key={grade.id} grade={grade} ownerId={ownerId} onChanged={onChanged} />
        ))
      )}
      {grades.length > 0 ? <AddGradeForm ownerId={ownerId} batchId={batch.id} onAdded={onChanged} /> : null}
    </div>
  );
}
