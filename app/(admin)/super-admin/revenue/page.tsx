"use client";

import { useEffect, useState } from "react";
import { DollarSign } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { listAllAccounts, listAllSubscriptions, type SubscriptionRow, type AccountRow } from "@/lib/data/superadmin";

export default function SuperAdminRevenuePage() {
  const [subs, setSubs] = useState<SubscriptionRow[] | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);

  useEffect(() => {
    listAllSubscriptions().then(setSubs);
    listAllAccounts().then(setAccounts);
  }, []);

  const accountById = new Map((accounts ?? []).map((a) => [a.id, a]));
  const paying = (subs ?? []).filter((s) => s.plan === "pro" && s.status === "active");

  return (
    <div>
      <PageHeader
        title="Revenue"
        description="Real subscription rows — the backend's checkout and webhook are built, but no teacher-facing upgrade UI calls them yet, so this reads zero until one does."
      />
      <div className="space-y-6 p-6 md:p-8">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <StatCard label="Paying accounts" value={subs ? String(paying.length) : "…"} />
          <StatCard label="Total subscription rows" value={subs ? String(subs.length) : "…"} />
        </div>

        {subs === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : subs.length === 0 ? (
          <EmptyState
            icon={DollarSign}
            title="No subscriptions yet"
            description="No teacher-facing 'Upgrade to Pro' exists to call checkout yet — see todo/backend/00-open.md §5. Every account is implicitly on the free plan until then."
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Billing</TableHead>
                    <TableHead>Renews</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subs.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">
                        {accountById.get(s.owner_id)?.name ?? accountById.get(s.owner_id)?.email ?? s.owner_id}
                      </TableCell>
                      <TableCell className="capitalize">{s.plan}</TableCell>
                      <TableCell>
                        <Badge variant={s.status === "active" ? "success" : "outline"} className="capitalize">
                          {s.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="capitalize text-muted-foreground">
                        {s.billing_period ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.current_period_end
                          ? new Date(s.current_period_end).toLocaleDateString()
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
