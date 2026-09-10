# Open on our side — frontend, product, ops

Split out of [backend/00-open.md](backend/00-open.md) on 2026-09-10, so
that file could be the backend team's queue alone. Nothing here is
waiting on them; most of it is what *they* are waiting on.

## 1. The thing blocking the backend

**Request shapes for seven routes** — `/api/chat`,
`/api/studio/agent`, `quiz-tweak`, `regenerate`,
`/api/onboarding/parse`, student invites, and a yes/no on
`/api/corpus/search`. Each is a same-day build once the shape is
settled, so this is an unanswered question rather than a queue of work.
Answering it unblocks their entire list.

## 2. Frontend writes

- **`goals.term_start` / `term_end` are null on all three plans.**
  `src/lib/data/goal-planner.ts` selects both and never writes either —
  the schedule response carries the window and the browser writes the
  item dates but not the goal's own, so a plan row can't say what term
  it covers. Confirmed from both sides that this is ours: one writer per
  table, and the backend doesn't write `goals`.
- **A teacher-facing billing UI** — "Upgrade to Pro" (calls
  `/api/billing/checkout`) and "Manage billing" (calls `/portal`). Both
  endpoints are live. Gated on §3 first — there's no point shipping an
  upgrade button while Pro gates nothing.

## 3. Product decisions (owner)

- **Free-tier limits — what Pro actually gets.** Nothing anywhere reads
  `subscriptions.plan`, confirmed on both sides: no frontend behaviour
  changes with it and no backend route consults it, so **Pro currently
  buys nothing.** Settle this before an upgrade button ships — selling a
  plan that caps nothing is the worse failure.
- **Trial policy** for Pro (length, if any), and proration/downgrade
  behaviour (Stripe's portal default is probably fine; only worth
  custom-building if it isn't).
- **Single-device session enforcement** — whether it comes back at all.
  If yes, the column + RLS predicate get designed here first, then the
  backend adds its check.
- **A unique index on `(goal_id, kind)`.** Deliberately *not* added.
  No duplicates exist today, but the retry path re-drafts only the kinds
  that failed, so a unique index would convert a duplicate into a failed
  retry. That's the better failure — but it's a product call, not a
  migration to slip in.

## 4. Ops chores (owner — account access, not code)

- **Create the recurring Pro prices in Stripe.** Then the backend sets
  `STRIPE_PRICE_PRO_*` in Render and checkout works.
- **Validate a Brevo sender address.** Without one Brevo answers 201 and
  silently drops every email — which also blocks student invites being
  worth building.
- **Point a pinger at `/api/keepwarm`**, every ~10 minutes. The route is
  live in this repo (`app/api/keepwarm/route.ts`); cold start measured
  22.6s against 0.16s warm. Nothing to build — cron-job.org or
  UptimeRobot at `https://www.murchid.com/api/keepwarm`.
- **A curriculum specialist** to verify and extend
  `src/lib/curriculum.js`. The 12 seeded units carry `source: 'starter'`
  and the UI calls them a draft — honest, but not a ministry sequence.

## 5. Still unexercised end to end

- **Two of three plans are unplaced** — 21 goal items exist, only 7 are
  dated. The placement path works; it has run once.
- The student invite loop and checkout (§2, §4).
- The weak-spot recap, which needs a class with real question-level
  marks — the test account has one student with none, so a pass today
  would prove nothing.

Working verification queries live in the **backend** repo at
`db/verification-queries.sql`, not in `db/` here.

## Settled — don't reopen

- **The credits formula.** Metered per document, priced from
  `feature_costs`, charged only after each document succeeds — a plan
  whose exam fails is charged for six. Three plans, 7 ledger rows and 9
  credits each; exam 2, slide_deck 2, 1 each for the other five.
  `/api/studio/generate` writes **nothing**, to the ledger or any table,
  so a single generation quotes zero.
- **Term-plan placement works** — seven items dated Sep 14 → Dec 11,
  zero on a weekend, teaching order intact with the exam last, and
  `assessments.goal_item_id` filled for both assessments.
- **Template library paths:** `/api/studio/library` and
  `/api/studio/library/filters`. Not `/api/library/filters` — that's a
  404, don't wire against it.
- **Live and gated** (probed): `/api/studio/generate`, `/plan`,
  `/skill-profile`, `/uploads`, `/api/curriculum/derive`,
  `/api/superadmin/keys`, `/api/billing/{checkout,portal,webhook}`.
