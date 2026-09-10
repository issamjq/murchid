"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  CalendarDays,
  NotebookPen,
  Presentation,
  FileText,
  ListChecks,
  GraduationCap,
  Puzzle,
  ClipboardList,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { listUpcoming, type UpcomingItem } from "@/lib/data/classes";

// Same icon each kind already uses on its own class tab, reused here so
// the calendar reads as one system rather than inventing a second set.
const KIND_ICON: Record<UpcomingItem["kind"], LucideIcon> = {
  lesson_plan: NotebookPen,
  slide_deck: Presentation,
  note: FileText,
  quiz: ListChecks,
  exam: GraduationCap,
  activity: Puzzle,
  homework: ClipboardList,
};

const KIND_LABEL: Record<UpcomingItem["kind"], string> = {
  lesson_plan: "Lesson plan",
  quiz: "Quiz",
  exam: "Exam",
  slide_deck: "Presentation",
  note: "Notes",
  activity: "Activity",
  homework: "Homework",
};

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayHeading(iso: string): string {
  const date = new Date(iso + "T00:00:00");
  const diffDays = Math.round((date.getTime() - startOfToday().getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function shortDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function groupByDate(items: UpcomingItem[]) {
  const groups: { date: string; items: UpcomingItem[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.date === item.scheduledFor) last.items.push(item);
    else groups.push({ date: item.scheduledFor, items: [item] });
  }
  return groups;
}

function CalendarSkeleton() {
  return (
    <div className="space-y-8">
      {[0, 1].map((section) => (
        <div key={section} className="space-y-3">
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          <div className="space-y-2">
            {[0, 1].map((row) => (
              <div key={row} className="h-[68px] animate-pulse rounded-xl border border-border bg-muted/50" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CalendarPage() {
  const [items, setItems] = useState<UpcomingItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listUpcoming()
      .then(setItems)
      .catch((e) => setError(e.message ?? "Failed to load the calendar"));
  }, []);

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Everything scheduled across your classes, soonest first."
      />
      <div className="p-6 md:p-8">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : items === null ? (
          <CalendarSkeleton />
        ) : items.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="Nothing scheduled yet"
            description="Approve a plan in the Goal Planner, or schedule a quiz or exam from a class, and it shows up here."
            action={
              <Link
                href="/goal-planner"
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <Sparkles className="size-3.5" />
                Go to Goal Planner
              </Link>
            }
          />
        ) : (
          <div className="space-y-8">
            {groupByDate(items).map((group) => {
              const heading = dayHeading(group.date);
              const isToday = heading === "Today";
              return (
                <section key={group.date} className="space-y-3">
                  <div className="flex items-baseline gap-2">
                    <h2 className={isToday ? "text-sm font-semibold text-primary" : "text-sm font-semibold"}>
                      {heading}
                    </h2>
                    {heading === "Today" || heading === "Tomorrow" ? (
                      <span className="text-xs text-muted-foreground">{shortDate(group.date)}</span>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    {group.items.map((item) => {
                      const Icon = KIND_ICON[item.kind];
                      return (
                        <Link key={`${item.kind}-${item.id}`} href={`/classes/${item.classId}`} className="block">
                          <Card className="transition-colors hover:border-primary/40 hover:bg-secondary/30">
                            <CardContent className="flex items-center gap-3 p-4">
                              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                                {Icon ? <Icon className="size-4" /> : null}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{item.title}</p>
                                <p className="truncate text-xs text-muted-foreground">{item.classLabel}</p>
                              </div>
                              <Badge variant="outline" className="shrink-0">
                                {KIND_LABEL[item.kind]}
                              </Badge>
                            </CardContent>
                          </Card>
                        </Link>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
