"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, CalendarDays } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { listUpcoming, type UpcomingItem } from "@/lib/data/classes";

const KIND_LABEL: Record<UpcomingItem["kind"], string> = {
  quiz: "Quiz",
  exam: "Exam",
  slide_deck: "Presentation",
  note: "Notes",
  activity: "Activity",
  homework: "Homework",
};

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
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
          <p className="text-sm text-muted-foreground">Loading…</p>
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
          <div className="space-y-3">
            {items.map((item) => (
              <Card key={`${item.kind}-${item.id}`}>
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.classLabel} · {formatDate(item.scheduledFor)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusPill status="scheduled" />
                    <Link
                      href={`/classes/${item.classId}`}
                      className="text-xs font-medium text-muted-foreground hover:text-primary"
                    >
                      {KIND_LABEL[item.kind]}
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
