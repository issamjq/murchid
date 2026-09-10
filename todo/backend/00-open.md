# Open for the backend team

> Everything else that was on this list has moved to
> [../our-side.md](../our-side.md) — frontend writes, product decisions
> and ops chores that are ours or the owner's, not yours. This file is
> your queue only.
>
> **Probes are conclusive now.** A path that doesn't exist returns
> `404 {"code":"not_found"}` under every prefix; `401` means the route
> exists and is gated. Both checkable without a token. (Thanks for the
> auth-masked 404 fix — verified: fake paths under `/api/studio/*` and
> `/api/curriculum/*` now 404, all real routes still 401, and the Stripe
> webhook correctly answers 400 rather than 401 or 404.)

## 1. Seven routes, all confirmed 404 by probe

You've said each is a same-day build once the request shape is settled,
so these are waiting on **us to send shapes**, not on your effort. We
owe you that; chase us if it goes quiet.

| Route | Notes |
|---|---|
| `POST /api/chat` | Chat assistant, separate from the studio routes |
| `POST /api/studio/agent` | The conversational studio surface |
| `POST /api/studio/quiz-tweak` | Never rebuilt alongside `generate` |
| `POST /api/studio/regenerate` | Same |
| `POST /api/onboarding/parse` | CV/document → structured profile fields |
| Student invites | Brevo-based, class-named invite links. Blocked on a validated Brevo sender (ours) — until one exists Brevo answers 201 and silently drops the mail, so building it earlier just hides the failure |
| `GET /api/images/:id` | "Compatibility tail only" even on `backendv2`. Confirm it's still wanted before building |

**One to decide rather than build:** `POST /api/corpus/search` is absent,
but grounding now injects server-side and no client needs to search. If
nothing will call it, say so and we'll strike it rather than leave a
route spec open forever.

## 2. Waiting on a decision before you touch it

- **Single-device session enforcement.** Removed in the auth rebuild
  because `active_session_id` didn't exist on the new schema. If it
  comes back: the column + RLS predicate get designed **first**, then
  your check second. Enforcing it only in the backend while the browser
  writes Supabase directly would be theatre, so please don't build it
  from your side alone.

## 3. Yours to set once we've done our half

- **`STRIPE_PRICE_PRO_MONTHLY` / `STRIPE_PRICE_PRO_ANNUAL` in Render**,
  once the owner has created the recurring prices in Stripe. Until then
  `/checkout` correctly answers `503 price_not_configured` — no code
  change needed, just the env vars when the prices exist.
- **Confirm the server key mode.** It's `rk_live_…` — live money. If
  that's deliberate, say so and we'll stop asking; if not, a test key
  while the UI is wired is safer.

## 4. Verification still owed on your side

- **Grounded generation against a teacher's own uploaded material.** It's
  built and injecting, but nobody has confirmed her material outranks
  ours in a real lesson, or that the answer names the right source in
  `grounded_on`. That's the claim most worth a real check, because a
  wrong citation is worse than none.
