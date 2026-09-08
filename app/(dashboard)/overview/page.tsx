"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Users,
  TrendingUp,
  Sparkles,
  CalendarDays,
  PieChart as PieChartIcon,
  BarChart3,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { AttendanceChart } from "@/components/charts/attendance-chart";
import { ResultsChart } from "@/components/charts/results-chart";
import { TermProgressDonut } from "@/components/charts/term-progress-donut";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { useSession } from "@/features/auth/session-context";
import { getOverviewSnapshot, type OverviewSnapshot } from "@/lib/data/overview";
import {
  getNeedsAttention,
  type AttentionCategory,
  type AttentionItem,
} from "@/lib/data/needs-attention";
import { NeedsAttentionCard } from "@/features/overview/needs-attention-card";

export default function OverviewPage() {
  const { user } = useSession();
  const [snapshot, setSnapshot] = useState<OverviewSnapshot | null>(null);
  const [attentionItems, setAttentionItems] = useState<AttentionItem[] | null>(null);
  const [attentionCounts, setAttentionCounts] = useState<Record<
    AttentionCategory,
    number
  > | null>(null);

  useEffect(() => {
    if (!user) return;
    getOverviewSnapshot(user.id).then(setSnapshot);
    getNeedsAttention(user.id).then(({ items, totalCounts }) => {
      setAttentionItems(items);
      setAttentionCounts(totalCounts);
    });
  }, [user]);

  const loaded = snapshot !== null;

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Where your classes stand this week."
      />
      <div className="space-y-5 p-6 md:p-8">
        <NeedsAttentionCard items={attentionItems} totalCounts={attentionCounts} />

        {loaded && snapshot.classCount === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No classes yet"
            description="Set up your first batch, grade, division and subject — everything else on this page fills in once you have a class."
            action={
              <Button asChild size="sm">
                <Link href="/classes">Set up a class</Link>
              </Button>
            }
          />
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={BookOpen}
            label="Classes"
            value={loaded ? String(snapshot.classCount) : "…"}
          />
          <StatCard
            icon={Users}
            label="Students"
            value={loaded ? String(snapshot.studentCount) : "…"}
          />
          <StatCard
            icon={TrendingUp}
            label="Avg. attendance"
            value={loaded ? (snapshot.avgAttendancePct !== null ? `${snapshot.avgAttendancePct}%` : "—") : "…"}
            hint={loaded && snapshot.avgAttendancePct === null ? "No attendance recorded yet" : undefined}
          />
          <StatCard
            icon={Sparkles}
            label="Pending review"
            value={loaded ? String(snapshot.pendingReview) : "…"}
            hint="term plans awaiting approval"
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Attendance this week</CardTitle>
            </CardHeader>
            <CardContent>
              {!loaded ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : snapshot.attendanceByDay.length === 0 ? (
                <EmptyState
                  icon={CalendarDays}
                  title="No attendance recorded yet"
                  description="Mark attendance for a class and it'll show up here."
                />
              ) : (
                <AttendanceChart data={snapshot.attendanceByDay} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Term progress</CardTitle>
            </CardHeader>
            <CardContent>
              {!loaded ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : snapshot.termProgress.approved + snapshot.termProgress.drafted === 0 ? (
                <EmptyState
                  icon={PieChartIcon}
                  title="No term plans yet"
                  description="Start one from the Goal Planner."
                />
              ) : (
                <TermProgressDonut
                  data={[
                    { label: "Approved", value: snapshot.termProgress.approved },
                    { label: "Drafted", value: snapshot.termProgress.drafted },
                  ]}
                />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Results by class</CardTitle>
            </CardHeader>
            <CardContent>
              {!loaded ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : snapshot.resultsByClass.length === 0 ? (
                <EmptyState
                  icon={BarChart3}
                  title="No results recorded yet"
                  description="Marks entered against a quiz or exam will show up here, grouped by class."
                />
              ) : (
                <ResultsChart data={snapshot.resultsByClass} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Coming up</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!loaded ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : snapshot.upcoming.length === 0 ? (
                <EmptyState
                  icon={CalendarDays}
                  title="Nothing scheduled"
                  description="Schedule a lesson, quiz, or exam and it'll show up here."
                />
              ) : (
                snapshot.upcoming.map((u) => (
                  <div key={u.id} className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium leading-snug">{u.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(u.date).toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "short",
                        })}
                      </p>
                    </div>
                    <StatusPill status={u.status} />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
