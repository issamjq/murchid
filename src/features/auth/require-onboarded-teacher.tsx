"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useSession } from "./session-context";
import { isOnboarded } from "./types";

export function RequireOnboardedTeacher({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/signin");
      return;
    }
    if (user.role === "super_admin" || user.role === "sub_admin") {
      router.replace("/super-admin");
      return;
    }
    if (user.role === "organisation") {
      router.replace("/organisation");
      return;
    }
    if (user.role === "student") {
      router.replace("/student");
      return;
    }
    if (!isOnboarded(user)) {
      router.replace("/onboarding/teacher");
    }
  }, [loading, user, router]);

  if (
    loading ||
    !user ||
    user.role === "super_admin" ||
    user.role === "sub_admin" ||
    user.role === "organisation" ||
    user.role === "student" ||
    !isOnboarded(user)
  ) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return <>{children}</>;
}
