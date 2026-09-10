# What is still open

> **Re-checked 2026-09-10**, after the backend replied that eight items on
> this list had already been closed. Most of that reply verified — the
> details are in "Closed since the last list" at the bottom, kept short so
> nobody re-opens them. Two corrections to the reply are folded in below.
>
> **How to read a route probe.** `/api/*` returns
> `404 {"code":"not_found"}` for an unmatched path — *except* under
> `/api/studio/*` and `/api/curriculum/*`, where auth still runs before
> routing, so a path that doesn't exist answers `401 unauthorized`
> instead. Verified: `/api/studio/totally-fake-xyz` → 401. So a 401 under
> those two prefixes proves nothing about whether the route exists, and
> only an authenticated caller can tell. See §6 — this is a real bug, not
> just a testing inconvenience.

## 1. Scoping decision needed before picking up anything in §2

For each route: reconnect the old logic against the new schema, rebuild
from scratch against it, or some mix. `backendv2` and `main` are both
intact and readable on GitHub if reusing logic is worth it. The backend
has said each of these is small once the request shape is settled — send
a shape and it can be built the same day — so this decision, not the
work, is the blocker.

## 2. Still missing

Confirmed `404 not_found` on an unauthenticated probe, which is
conclusive for these (they sit outside the two auth-masked prefixes):

| Route | Notes |
|---|---|
| `POST /api/chat` | Chat assistant, separate from the studio routes |
| `POST /api/onboarding/parse` | CV/document → structured profile fields |
| `POST /api/corpus/search` | Confirmed absent — but grounding no longer needs it (§"Closed"), so this may not need building at all. Decide before speccing |
| Student invites | Brevo-based, class-named invite links |
| `GET /api/images/:id` | "Compatibility tail only" even on `backendv2` |

Reported by the backend as 404 for an *authenticated* caller. Not
independently verifiable from outside, because they sit under the
auth-masked `/api/studio/*` prefix:

| Route | Notes |
|---|---|
| `POST /api/studio/agent` | The conversational studio surface |
| `POST /api/studio/quiz-tweak`, `POST /api/studio/regenerate` | Not rebuilt alongside `generate` |

## 3. Data the pipeline doesn't write

Both verified against the live database today, both small, both make a
row unable to answer a question it should be able to answer:

- **`goals.term_start` / `term_end` are null on every plan** (0 of 3,
  including the placed one). `src/lib/data/goal-planner.ts` selects both
  and never writes either — the schedule response carries the window and
  the browser writes the item dates but not the goal's own. So a plan
  row can't say what term it covers.
- **Nothing reads `subscriptions.plan`** except `/super-admin/revenue`,
  which only counts paying accounts. No teacher-facing behaviour changes
  with it, so **Pro currently buys nothing.** Worth settling what the
  free tier actually caps before an upgrade button ships (§5) — selling
  a plan that gates nothing is the worse failure.

## 4. Product decisions needed before code

- **Free-tier limits.** What Pro is actually for — see §3. The frontend
  reads it off `subscriptions.plan` once decided.
- **Trial policy** for Pro (length, if any), and proration/downgrade
  behaviour (Stripe's portal default is probably fine; only worth
  custom-building if it isn't).
- **Single-device session enforcement.** Removed in the auth rebuild
  because `active_session_id` didn't exist on the new schema. If it
  still matters: design the column + RLS predicate first, then add the
  backend check — enforcing it only in the backend while the browser
  writes Supabase directly would be theatre.
- **A unique index on `(goal_id, kind)`.** Deliberately *not* added.
  There are no duplicate items anywhere today, but the retry path
  re-drafts only the kinds that failed, so a unique index would convert
  a duplicate into a failed retry. That is the better failure, but it's
  a product call, not a migration to slip in.

## 5. Billing — built, blocked on ops, then frontend

`POST /api/billing/{checkout,portal,webhook}` are live. Blocked on:

- **A Stripe dashboard task.** No recurring Murchid prices exist yet, so
  `STRIPE_PRICE_PRO_MONTHLY`/`STRIPE_PRICE_PRO_ANNUAL` are unset in
  Render and `/checkout` answers `503 price_not_configured`.
- **A key-mode confirmation.** The server key is `rk_live_…` — live
  mode. Confirm that's intentional, or switch to a test key while the
  frontend UI is wired.
- **No teacher-facing billing UI.** "Upgrade to Pro" and "Manage
  billing" are frontend work, gated on prices existing to test against —
  and on §3/§4 deciding what Pro does.

## 6. The 404-carries-a-code fix is only half applied

Unmatched `/api/*` paths correctly return `404 {"code":"not_found"}`,
**but not under `/api/studio/*` or `/api/curriculum/*`** — auth runs
before routing there, so a nonexistent path returns `401 unauthorized`.
Verified today against the live service with a made-up path under each
prefix.

This is the exact failure the original fix was for. The frontend's
`no_backend` handling keys off a 404 carrying a `code`; a 401 from a
route that simply isn't deployed will instead read as a session problem,
and the teacher gets told to sign in again for a feature that was never
built. Mount auth *after* routing on those two prefixes, or 404 unknown
sub-paths before the auth gate.

## 7. Ops tasks, not code

- **A Brevo-validated sender address.** Without one, Brevo answers 201
  and silently drops every email.
- **A scheduled pinger on `/api/keepwarm`**, every ~10 minutes. The
  route is live in *this* repo (`app/api/keepwarm/route.ts`); a cold
  first request measured 22.6s against 0.16s warm. Nothing to build,
  only an external pinger (cron-job.org, UptimeRobot) pointed at
  `https://www.murchid.com/api/keepwarm`.
- **A curriculum specialist** to verify and extend
  `src/lib/curriculum.js`. The 12 seeded units carry `source: 'starter'`
  and the UI calls them a draft — honest, but not a ministry sequence.

## 8. Verifying a real run

The two queries this file used to carry targeted `ai_studio` and
`goal_days`, **both of which no longer exist** — confirmed today, so
they error rather than answer. Working equivalents live in the backend
repo at `db/verification-queries.sql` (not this one — don't go looking
in `db/` here). What they check: weekend placement, teaching order,
duplicate items per plan, and whether a plan's quiz and exam became
linked `assessments` rows.

Still unexercised end to end:

- **Two of three plans are still unplaced** — 21 goal items exist, only
  7 are dated. The placement path works (below); it has run once.
- Grounded generation has shipped but hasn't been checked against a
  teacher's own uploaded material outranking ours in a real lesson.
- The student invite loop and checkout (§2, §5).
- The weak-spot recap, which needs a class with real question-level
  marks behind it — the test account has one student with none, so a
  pass today would prove nothing.

## Closed since the last list

Verified by me against the live database, not taken on report:

- **The credits formula.** Metered **per document, priced from
  `feature_costs`, charged only after each document succeeds** — a plan
  whose exam fails is charged for six. Confirmed exactly: three plans,
  7 ledger rows each, 9 credits each; `feature_costs` reads exam 2,
  slide_deck 2, and 1 each for lesson_plan, note, activity, homework,
  quiz. The old "composer quoted ~6, spend was 9" mystery is closed.
  The backend also reports `/api/studio/generate` writes nothing to the
  ledger, so a single generation quotes zero — consistent with the rows
  (every one of the 108 fits a seven-document plan run), though not
  independently provable from the ledger alone.
- **Term-plan placement has happened for real.** Seven items dated
  Sep 14 → Dec 11, **zero on a weekend**, all seven `scheduled`,
  teaching order intact with the exam last.
- **`assessments.goal_item_id` is filled** — 2 of 2 rows linked. That
  foreign key had existed since the table was created and had never
  once been populated.

Reported by the backend, believed but not independently verifiable from
outside (all sit under the auth-masked prefixes — see the note at the
top): `/api/curriculum/derive` live and run against a real CBSE
syllabus; `/api/studio/skill-profile` live with both request shapes;
template library and materials extraction live; grounded generation
built, with `matchCorpus` injecting into both `/generate` and the
planner and the answer naming its sources in `grounded_on`; an SSE
heartbeat every 15s; four AI providers and 12 keys configured;
`render.yaml` corrected to free/Oregon with 23 missing env vars added.

**One correction.** The reply listed the template library as live at
`/library/filters`; that path is a confirmed 404. `/api/studio/library`
and `/api/studio/library/filters` both sit behind the auth gate and are
the likely real paths — worth pinning down exactly before the frontend
wires against them.
