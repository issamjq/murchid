"use client";

import Link from "next/link";
import { AlertCircle, CalendarClock, CheckCircle2, ClipboardCheck, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { AttentionCategory, AttentionItem } from "@/lib/data/needs-attention";

const CATEGORY_ICON: Record<AttentionCategory, LucideIcon> = {
  stale_attendance: AlertCircle,
  ungraded: ClipboardCheck,
  failed_plan: RefreshCw,
  unscheduled: CalendarClock,
};

const CATEGORY_ORDER: AttentionCategory[] = [
  "stale_attendance",
  "ungraded",
  "failed_plan",
  "unscheduled",
];

interface Props {
  items: AttentionItem[] | null;
  totalCounts: Record<AttentionCategory, number> | null;
}

export function NeedsAttentionCard({ items, totalCounts }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Needs your attention</CardTitle>
      </CardHeader>
      <CardContent>
        {items === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="All caught up"
            description="Nothing needs your attention right now."
          />
        ) : (
          <div className="divide-y divide-border">
            {items.map((item) => {
              const Icon = CATEGORY_ICON[item.category];
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className="-mx-2 flex items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-muted/50"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                    <Icon className="size-4" strokeWidth={1.5} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium leading-snug">
                      {item.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">{item.detail}</span>
                  </span>
                </Link>
              );
            })}
            {totalCounts
              ? CATEGORY_ORDER.map((category) => {
                  const shown = items.filter((i) => i.category === category).length;
                  const total = totalCounts[category];
                  const remaining = total - shown;
                  if (remaining <= 0) return null;
                  return (
                    <p key={category} className="px-2 py-2 text-xs text-muted-foreground">
                      +{remaining} more
                    </p>
                  );
                })
              : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
