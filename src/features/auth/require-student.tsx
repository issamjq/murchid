"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useSession } from "./session-context";

// The mirror of RequireOnboardedTeacher. Until now /student had no auth at
// all — it rendered hardcoded arrays to anyone who typed the URL.
export function RequireStudent({ children }: { children: React.ReactNode }) {
  const { user, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/signin");
      return;
    }
    // A signed-in non-student is a teacher/admin who wandered in; send them
    // to their own home rather than showing an empty portal.
    if (user.role !== "student") router.replace("/");
  }, [loading, user, router]);

  if (loading || !user || user.role !== "student") {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return <>{children}</>;
}
