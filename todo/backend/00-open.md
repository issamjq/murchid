# What is still open

> **Re-checked 2026-09-10**, twice, after two rounds of backend replies.
> Everything below has been probed against the live service or queried
> against the live database — nothing here is taken on report any more.
>
> **Route probes are now conclusive.** A path that doesn't exist returns
> `404 {"code":"not_found"}` under *every* prefix, including
> `/api/studio/*` and `/api/curriculum/*` where auth used to run first
> and mask it (§6, now fixed and verified). So `401` means the route
> exists and is gated; `404` means it isn't deployed. Both are checkable
> without a token.

## 1. The one blocker: request shapes

Six routes are unbuilt, and the backend has said each is a **same-day
build once the request shape is settled**. That makes this an unanswered
question, not a queue of work. Answering it unblocks everything in §2.

For each: reconnect the old logic against the new schema, rebuild from
scratch, or some mix. `backendv2` and `main` are intact on GitHub if
reusing logic is worth it.

## 2. Not deployed

All confirmed `404 not_found` by direct probe today:

| Route | Notes |
|---|---|
| `POST /api/chat` | Chat assistant, separate from the studio routes |
| `POST /api/studio/agent` | The conversational studio surface |
| `POST /api/studio/quiz-tweak`, `POST /api/studio/regenerate` | Never rebuilt alongside `generate` |
| `POST /api/onboarding/parse` | CV/document → structured profile fields |
| Student invites | Brevo-based, class-named invite links |
| `POST /api/corpus/search` | Absent — but grounding no longer needs a client to search (it injects server-side), so this may not need building at all. Decide before speccing |
| `GET /api/images/:id` | "Compatibility tail only" even on `backendv2` |

## 3. Ours to write, not the backend's

- **`goals.term_start` / `term_end` are null on all three plans.**
  `src/lib/data/goal-planner.ts` selects both and never writes either —
  the schedule response carries the window and the browser writes the
  item dates but not the goal's own, so a plan row can't say what term
  it covers. Confirmed from both sides that this is a **frontend** write:
  one writer per table, and the backend doesn't write `goals`.
- **A teacher-facing billing UI** — "Upgrade to Pro" and "Manage
  billing". Gated on §5 and §4 first.

## 4. Product decisions needed before code

- **Free-tier limits — what Pro actually gets.** Nothing anywhere reads
  `subscriptions.plan` (confirmed on both sides): no frontend behaviour
  changes with it and no backend route consults it, so **Pro currently
  buys nothing.** Settle this before an upgrade button ships — selling a
  plan that caps nothing is the worse failure.
- **Trial policy** for Pro (length, if any), and proration/downgrade
  behaviour (Stripe's portal default is probably fine).
- **Single-device session enforcement.** Removed in the auth rebuild
  because `active_session_id` didn't exist on the new schema. If it
  still matters: design the column + RLS predicate first, then add the
  backend check — enforcing it only in the backend while the browser
  writes Supabase directly would be theatre.
- **A unique index on `(goal_id, kind)`.** Deliberately *not* added.
  No duplicates exist today, but the retry path re-drafts only the kinds
  that failed, so a unique index would convert a duplicate into a failed
  retry. That's the better failure — but it's a product call, not a
  migration to slip in.

## 5. Billing — built, blocked on a dashboard

`POST /api/billing/{checkout,portal,webhook}` are live. The webhook
answers `400` unauthenticated rather than 401 or 404 — correct, since
Stripe holds no Supabase session and the signature check must be what
rejects it.

- **Create the recurring Pro prices in Stripe** and set
  `STRIPE_PRICE_PRO_MONTHLY`/`STRIPE_PRICE_PRO_ANNUAL` in Render. Until
  then `/checkout` answers `503 price_not_configured`.
- **Confirm the key mode.** The server key is `rk_live_…` — live money.
  Intentional, or switch to a test key while the UI is wired?

## 6. Ops tasks, not code

- **A Brevo-validated sender address.** Without one, Brevo answers 201
  and silently drops every email.
- **A scheduled pinger on `/api/keepwarm`**, every ~10 minutes. The
  route is live in *this* repo (`app/api/keepwarm/route.ts`); cold start
  measured 22.6s against 0.16s warm. Nothing to build — point
  cron-job.org or UptimeRobot at `https://www.murchid.com/api/keepwarm`.
- **A curriculum specialist** to verify and extend
  `src/lib/curriculum.js`. The 12 seeded units carry `source: 'starter'`
  and the UI calls them a draft — honest, but not a ministry sequence.

## 7. Still unexercised end to end

- **Two of three plans are unplaced** — 21 goal items exist, only 7 are
  dated. The placement path works; it has run once.
- **Grounded generation has shipped but hasn't been checked against a
  teacher's own uploaded material** outranking ours in a real lesson.
- The student invite loop and checkout (§2, §5).
- The weak-spot recap, which needs a class with real question-level
  marks — the test account has one student with none, so a pass today
  would prove nothing.

Working verification queries live in the **backend** repo at
`db/verification-queries.sql` (not this one — don't go looking in `db/`
here). The two this file used to carry targeted `ai_studio` and
`goal_days`, both since dropped, so they errored rather than answered.

## Closed — verified, don't reopen

- **The credits formula.** Metered **per document, priced from
  `feature_costs`, charged only after each document succeeds** — a plan
  whose exam fails is charged for six. Three plans, 7 ledger rows and 9
  credits each; `feature_costs` reads exam 2, slide_deck 2, and 1 each
  for the other five. `/api/studio/generate` writes **nothing** — to the
  ledger or any table — so a single generation quotes zero. (The backend
  ran a real generation across a ledger count; still 108 rows before and
  after, which I re-confirmed independently.) The old "quoted ~6, spent
  9" mystery is closed.
- **§6, the auth-masked 404.** Unknown sub-paths under `/api/studio/*`
  and `/api/curriculum/*` used to answer `401`, so a teacher would have
  been sent to a login screen for a feature nobody had written. Fixed by
  deriving the known paths from the router objects at boot rather than a
  hand-kept list, with a fallback to prefix matching if enumeration ever
  returns nothing — the failure mode is the bug returning, never a live
  endpoint going dark. Verified: fake paths under both prefixes now 404,
  and all real routes still 401.
- **Term-plan placement has happened for real.** Seven items dated
  Sep 14 → Dec 11, **zero on a weekend**, all seven `scheduled`,
  teaching order intact with the exam last.
- **`assessments.goal_item_id` is filled** — 2 of 2 rows linked. That
  foreign key had existed since the table was created and had never once
  been populated.
- **The template library paths**, pinned after a wrong path in an
  earlier reply: `/api/studio/library` and `/api/studio/library/filters`
  (both real). `/api/library/filters` is a 404 — don't wire against it.
- Live and gated, confirmed by probe: `/api/curriculum/derive`,
  `/api/studio/skill-profile`, `/api/studio/plan`, `/api/studio/uploads`,
  `/api/superadmin/keys`. Grounded generation, an SSE heartbeat every
  15s, four AI providers with 12 keys, and a corrected `render.yaml`
  were all reported built.
