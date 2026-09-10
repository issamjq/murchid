"use client";

import { useState } from "react";
import Link from "next/link";
import { Pencil, Check, X, ChevronRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { IconButton } from "./icon-button";
import { AddDivisionCard, AddSubjectForm } from "./class-tree-forms";
import { updateGrade, updateDivision, updateClass, type BatchRow } from "@/lib/data/classes";

export function GradeSection({
  grade,
  ownerId,
  onChanged,
}: {
  grade: BatchRow["grades"][number];
  ownerId: string;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [level, setLevel] = useState(grade.level);

  async function saveEdit() {
    await updateGrade(grade.id, level);
    setEditing(false);
    onChanged();
  }

  return (
    <Card>
      <CardContent className="p-5">
        <div className="group/grade flex items-center gap-1">
          {editing ? (
            <>
              <Input
                type="number"
                value={level}
                onChange={(e) => setLevel(Number(e.target.value))}
                className="h-8 w-16"
                autoFocus
              />
              <IconButton title="Save" onClick={saveEdit}>
                <Check className="size-3.5" />
              </IconButton>
              <IconButton title="Cancel" onClick={() => setEditing(false)}>
                <X className="size-3.5" />
              </IconButton>
            </>
          ) : (
            <>
              <h2 className="text-sm font-bold">Grade {grade.level}</h2>
              <div className="flex items-center gap-0.5 pointer-events-none opacity-0 transition-opacity group-hover/grade:pointer-events-auto group-hover/grade:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
                <IconButton title="Edit grade" onClick={() => setEditing(true)}>
                  <Pencil className="size-3.5" />
                </IconButton>
              </div>
            </>
          )}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {grade.divisions.map((division) => (
            <DivisionCard
              key={division.id}
              division={division}
              ownerId={ownerId}
              onChanged={onChanged}
            />
          ))}
          <AddDivisionCard ownerId={ownerId} gradeId={grade.id} onAdded={onChanged} />
        </div>
      </CardContent>
    </Card>
  );
}

function DivisionCard({
  division,
  ownerId,
  onChanged,
}: {
  division: BatchRow["grades"][number]["divisions"][number];
  ownerId: string;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(division.label);

  async function saveEdit() {
    if (!label.trim()) return;
    await updateDivision(division.id, label.trim());
    setEditing(false);
    onChanged();
  }

  return (
    <div className="rounded-2xl border border-border bg-secondary/30 p-4">
      <div className="group/division flex items-center gap-1">
        {editing ? (
          <>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} className="h-7 w-16" autoFocus />
            <IconButton title="Save" onClick={saveEdit}>
              <Check className="size-3.5" />
            </IconButton>
            <IconButton title="Cancel" onClick={() => setEditing(false)}>
              <X className="size-3.5" />
            </IconButton>
          </>
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Division {division.label}
            </p>
            <div className="flex items-center gap-0.5 pointer-events-none opacity-0 transition-opacity group-hover/division:pointer-events-auto group-hover/division:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
              <IconButton title="Edit division" onClick={() => setEditing(true)}>
                <Pencil className="size-3" />
              </IconButton>
            </div>
          </>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {division.classes.map((c) => (
          <SubjectChip key={c.id} classRow={c} onChanged={onChanged} />
        ))}
        <AddSubjectForm ownerId={ownerId} divisionId={division.id} onAdded={onChanged} />
      </div>
    </div>
  );
}

// The one thing a teacher actually comes to this page to do — open a
// class — so it reads as a real tile with a clear "go here" affordance,
// not a bare text chip competing with its own edit/delete controls.
function SubjectChip({
  classRow,
  onChanged,
}: {
  classRow: { id: string; subject: string };
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(classRow.subject);

  async function saveEdit() {
    if (!subject.trim()) return;
    await updateClass(classRow.id, subject.trim());
    setEditing(false);
    onChanged();
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 rounded-xl border border-border bg-card px-2 py-1.5">
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="h-7 w-28" autoFocus />
        <IconButton title="Save" onClick={saveEdit}>
          <Check className="size-3.5" />
        </IconButton>
        <IconButton title="Cancel" onClick={() => setEditing(false)}>
          <X className="size-3.5" />
        </IconButton>
      </div>
    );
  }

  return (
    <div className="group/subject flex items-center rounded-xl border border-border bg-card py-1 pl-1 pr-1.5 shadow-[0_1px_2px_rgb(0_0_0_/_0.04)] transition-colors hover:border-primary hover:bg-secondary/60">
      <Link
        href={`/classes/${classRow.id}`}
        className="flex items-center gap-1 rounded-lg py-1 pl-2 pr-1 text-sm font-medium"
      >
        {classRow.subject}
        <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-hover/subject:translate-x-0.5" />
      </Link>
      {/* Reserves its own layout space rather than floating over the link
          — an absolutely-positioned overlay here would sit close enough
          to intercept clicks meant for short subject names like "PE". */}
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/subject:opacity-100 focus-within:opacity-100">
        <IconButton title="Rename subject" onClick={() => setEditing(true)}>
          <Pencil className="size-3" />
        </IconButton>
      </div>
    </div>
  );
}
