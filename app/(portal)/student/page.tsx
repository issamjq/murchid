"use client";

import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";

import { SiteHeader } from "@/components/layout/site-header";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RequireStudent } from "@/features/auth/require-student";
import {
  getCurrentStudent,
  listStudentNotes,
  type StudentIdentity,
  type StudentNote,
} from "@/lib/data/student-portal";

function Reader({ note, onClose }: { note: StudentNote; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={note.title}
        className="relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border bg-secondary/40 px-6 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {note.subject}
            </p>
            <h2 className="mt-0.5 text-lg font-black">{note.title}</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8">
          <div className="mx-auto max-w-[70ch] whitespace-pre-wrap text-[15px] leading-7">
            {note.body_md}
          </div>
        </div>
      </div>
    </div>
  );
}

function StudentPortal() {
  const [me, setMe] = useState<StudentIdentity | null>(null);
  const [notes, setNotes] = useState<StudentNote[] | null>(null);
  const [reading, setReading] = useState<StudentNote | null>(null);

  useEffect(() => {
    getCurrentStudent().then(setMe);
    listStudentNotes().then(setNotes);
  }, []);

  // Grouped by subject so a student sees "Physics" and "Maths" rather than
  // one undifferentiated pile.
  const bySubject = new Map<string, StudentNote[]>();
  for (const note of notes ?? []) {
    bySubject.set(note.subject, [...(bySubject.get(note.subject) ?? []), note]);
  }

  return (
    <div>
      <SiteHeader homeHref="/student" label="Student" />
      <PageHeader
        title={me ? `Hello, ${me.name.split(" ")[0]}` : "Your classes"}
        description="Notes your teachers have shared with you."
      />
      <div className="space-y-6 p-6 md:p-8">
        {notes === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : notes.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="Nothing shared yet"
            description="When a teacher shares notes with your class, they'll appear here."
          />
        ) : (
          Array.from(bySubject.entries()).map(([subject, subjectNotes]) => (
            <div key={subject} className="space-y-3">
              <h2 className="text-sm font-semibold">{subject}</h2>
              {subjectNotes.map((note) => (
                <Card key={note.id}>
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <p className="min-w-0 truncate text-sm font-medium">{note.title}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!note.body_md}
                      title={note.body_md ? undefined : "Your teacher hasn't added readable text yet"}
                      onClick={() => setReading(note)}
                    >
                      Read
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          ))
        )}
      </div>
      {reading ? <Reader note={reading} onClose={() => setReading(null)} /> : null}
    </div>
  );
}

export default function StudentPortalPage() {
  return (
    <RequireStudent>
      <StudentPortal />
    </RequireStudent>
  );
}
