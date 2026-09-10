"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useClassesRefresh } from "@/features/classes/classes-refresh-context";
import { getClassWithPath, updateClass, type ClassWithPath } from "@/lib/data/classes";

export default function ClassSettingsPage() {
  const { classId } = useParams<{ classId: string }>();
  const { bump } = useClassesRefresh();
  const [cls, setCls] = useState<ClassWithPath | null | undefined>(undefined);
  const [subject, setSubject] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getClassWithPath(classId).then((c) => {
      setCls(c);
      if (c) setSubject(c.subject);
    });
  }, [classId]);

  if (cls === undefined) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-6 md:p-8">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (cls === null) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-6 md:p-8">
        <p className="text-sm text-destructive">Class not found.</p>
      </div>
    );
  }

  async function saveSubject() {
    if (!subject.trim()) return;
    setSaving(true);
    setSaved(false);
    await updateClass(classId, subject.trim());
    setSaving(false);
    setSaved(true);
    bump();
  }

  return (
    <div className="min-h-0 max-w-xl flex-1 space-y-6 overflow-y-auto p-6 md:p-8">
      <Card>
        <CardHeader>
          <CardTitle>Class details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="grade">Grade</Label>
              <Input id="grade" value={`Grade ${cls.grade.level}`} disabled />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="division">Division</Label>
              <Input id="division" value={cls.division.label} disabled />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Grade and division are shared with other subjects under them —
            rename those from My Classes instead.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="subject">Subject</Label>
            <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={saveSubject} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
            {saved ? <span className="text-xs text-success">Saved</span> : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
