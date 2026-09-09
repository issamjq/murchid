"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { SiteHeader } from "@/components/layout/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useSession } from "@/features/auth/session-context";
import { claimStudentInvite } from "@/lib/data/student-portal";

// The only way to become a student. There is no self-registration: the code
// comes from a teacher, and claim_student_invite() refuses anything it
// doesn't recognise or that has already been redeemed.
export default function StudentJoinPage() {
  const router = useRouter();
  const { user, signUpWithPassword } = useSession();
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      // Already signed in (e.g. they created an account and the claim
      // failed) — just redeem, don't try to sign up again.
      if (!user) {
        const { needsEmailConfirmation } = await signUpWithPassword(email.trim(), password);
        if (needsEmailConfirmation) {
          setNeedsConfirmation(true);
          return;
        }
      }
      await claimStudentInvite(code);
      router.replace("/student");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't join with that code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SiteHeader homeHref="/" label="Student" />
      <div className="mx-auto w-full max-w-md p-6 md:p-8">
        <h1 className="text-xl font-black tracking-tight">Join your class</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your teacher gives you a join code. You can&apos;t sign up without one.
        </p>

        <Card className="mt-6">
          <CardContent className="p-5">
            {needsConfirmation ? (
              <p className="text-sm">
                Check your email to confirm your account, then come back to this page and enter your
                code again.
              </p>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="join-code">Join code</Label>
                  <Input
                    id="join-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="e.g. 4F2A9C71"
                    className="font-mono tracking-widest"
                    autoFocus
                  />
                </div>
                {!user ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="join-email">Email</Label>
                      <Input
                        id="join-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="join-password">Choose a password</Label>
                      <Input
                        id="join-password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={8}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Signed in as {user.email} — enter your code to finish joining.
                  </p>
                )}
                {error ? <p className="text-xs text-destructive">{error}</p> : null}
                <Button type="submit" disabled={busy || !code.trim()} className="w-full">
                  {busy ? "Joining…" : "Join"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
