"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import {
  getClassWithPath,
  listClassStudents,
  listScheduledForDate,
  type ClassWithPath,
  type StudentRow,
  type ScheduledItem,
} from "@/lib/data/classes";
import styles from "./sub-plan.module.css";

const KIND_LABEL: Record<ScheduledItem["kind"], string> = {
  lesson_plan: "Lesson",
  slide_deck: "Slides",
  activity: "Activity",
  homework: "Homework",
  note: "Notes",
  exam: "Exam",
  quiz: "Quiz",
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function SubPlanPage() {
  const { classId } = useParams<{ classId: string }>();
  const [date, setDate] = useState(todayIso);
  const [cls, setCls] = useState<ClassWithPath | null>(null);
  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [items, setItems] = useState<ScheduledItem[] | null>(null);

  useEffect(() => {
    getClassWithPath(classId).then(setCls);
    listClassStudents(classId).then(setStudents);
  }, [classId]);

  useEffect(() => {
    setItems(null);
    listScheduledForDate(classId, date).then(setItems);
  }, [classId, date]);

  const roster = (students ?? []).filter((s) => s.status !== "removed");
  const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-5 p-6 md:p-8">
      <div className={`flex flex-wrap items-end justify-between gap-3 ${styles.noPrint}`}>
        <div>
          <h2 className="text-lg font-semibold">Substitute plan</h2>
          <p className="text-sm text-muted-foreground">
            Everything scheduled for this class on one day, ready to hand to a substitute.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div>
            <label
              htmlFor="sub-plan-date"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Date
            </label>
            <Input
              id="sub-plan-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-40"
            />
          </div>
          <Button onClick={() => window.print()}>
            <Printer />
            Print
          </Button>
        </div>
      </div>

      <div className={styles.printArea}>
        <div className="mb-4">
          <h1 className="text-xl font-black tracking-tight">
            {cls ? `Grade ${cls.grade.level} · Div ${cls.division.label} · ${cls.subject}` : "…"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {dateLabel} · Prepared for a substitute teacher
          </p>
        </div>

        <Card className="mb-4">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Roll no.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-sm text-muted-foreground">
                      No students on this class&apos;s roster yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  roster.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{s.name}</TableCell>
                      <TableCell>{s.roll_no ?? "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {items === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <EmptyState
            title={`Nothing scheduled for ${date}`}
            description="The roster above still prints for attendance."
          />
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <Card key={item.id} className={styles.item}>
                <CardContent className="p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {KIND_LABEL[item.kind]}
                  </p>
                  <p className="text-sm font-semibold">{item.title}</p>
                  {item.markdown ? (
                    <div className="mt-2 whitespace-pre-wrap text-sm">{item.markdown}</div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
