# Open on our side — frontend, product, ops

Split out of [backend/00-open.md](backend/00-open.md) on 2026-09-10, so
that file could be the backend team's queue alone. Nothing here is
waiting on them; most of it is what *they* are waiting on.

## 1. Decide where the conversational studio lives

**`/api/studio/agent` is built and has no home.** There is no AI Studio
page in the rebuilt app, so nothing can call it. Its own page, or a
conversational mode inside each class tab's composer? Product call, and
it blocks wiring the one route whose whole purpose is a surface we
haven't built.

Worth knowing before deciding: the agent never writes. Its `generate`
action is a *request* — we post it to `/api/studio/generate` under the
teacher's own session, so she sees what's about to be drafted before
any credit is spent, and one-writer-per-table survives. That works
either as a page or as an in-tab mode.

## 2. Wire the five routes that are live and uncalled

`regenerate`, `quiz-tweak`, `onboarding/parse`, `chat` and now `agent`
are **live and gated** (probed 2026-09-10), but **nothing in this repo
calls any of them.** The backend derived the first four contracts by
reading call sites in `RewritableBody.jsx`, `QuizBuilder.jsx` and
`AssistantWidget.jsx` — files from the *pre-rebuild* frontend, which
doesn't exist here (this repo has no `.jsx` at all). So the shapes are
settled against a frontend that's gone.

The contracts look sound, but they're unconfirmed against what we'd
actually build. Wire each and correct as needed:

| Route | Contract as built | Notes |
|---|---|---|
| `POST /api/studio/regenerate` | SSE, `{ kind, section, current, prompt }` | Returns the section body only — we re-attach our own `## title` |
| `POST /api/studio/quiz-tweak` | SSE, `{ quiz: { questions }, instruction }` → `done.quiz` | A truncated/unparseable reply is refused outright rather than partially applied, because our sync is a transactional replace — a short answer would *delete* the omitted questions |
| `POST /api/onboarding/parse` | JSON, `{ documents: [...] }` → `{ fields, found, missing, unread? }` | Runs before the profile exists, so it carries its own auth gate. Three files max |
| `POST /api/chat` | SSE, `{ message, scope?, sessionId? }` — the corner widget | Frames: `session` → (`tool`/`action`/`delta`)… → `done`. Store `sessionId` from the first frame, send it back next turn |
| `POST /api/studio/agent` | SSE, `{ message, classId?, sessionId? }` — the conversational studio | Same frames, plus the `generate` action. `classId` is context, not permission — it's re-checked against `owner_id` server-side |

**Handling the two actions.** An action is terminal: at most one per
turn, and the reply after it is the last thing said.

- `navigate` → route to the `path` field **verbatim**. Don't rebuild it
  from `where`; the class is already ownership-checked before the path
  is built.
- `generate` (agent only) → POST the body to `/api/studio/generate`
  under her own session. It's a request, not a result — same credit
  check, same grounding, same one-writer rule as the composer form.

Show `tool` frames as "Looking that up…" with the tool named. Naming it
is what makes the answer trustworthy rather than an oracle.

**Wire-format rule that decides whether any of these work:** frames must
carry the discriminator *inside* the payload — `data: {"type":"delta",…}`.
Our `apiStream.ts` reads only `data:` lines and switches on `type`, so a
named SSE event streams perfectly and arrives as nothing: the UI spins,
the request logs 200, and no error appears anywhere. Verified this still
holds on our side.

## 3. Frontend writes

- **`goals.term_start` / `term_end` are null on all three plans.**
  `src/lib/data/goal-planner.ts` selects both and never writes either —
  the schedule response carries the window and the browser writes the
  item dates but not the goal's own, so a plan row can't say what term
  it covers. Confirmed from both sides that this is ours: one writer per
  table, and the backend doesn't write `goals`.
- **A teacher-facing billing UI** — "Upgrade to Pro" (calls
  `/api/billing/checkout`) and "Manage billing" (calls `/portal`). Both
  endpoints are live. Gated on §4 first — there's no point shipping an
  upgrade button while Pro gates nothing.

## 4. Product decisions (owner)

- **The two allowance numbers — Free and Pro.** Blocks
  `/api/billing/plans` and all enforcement. The backend's interim
  suggestion is Free ≈ 20, Pro ≈ 300–500, against a measured worst
  legitimate month of ~70 for a teacher with 5 classes of 30. Both live
  in a table, so a first guess is cheap to correct — worth not
  agonising over. **Caveat: don't size these off the ledger yet** — it
  currently records `chat` and `studio_agent` at zero, and chat is the
  largest token consumer there is.
- **Price `chat` and `studio_agent`** — see the backend doc. They're
  metering at 0 today.
- **Reprice `slide_deck` and `exam`?** Measured against real token use,
  `slide_deck` costs about what an activity does but is charged double,
  and `exam` is the most expensive thing in the product (≈5× a lesson
  plan) but charged the same 2 as a deck. The backend's suggestion is
  `slide_deck` → 1, `exam` → 4, and deliberately hasn't changed them
  because it changes what teachers are charged. One `UPDATE` each.
- **Confirm the `rk_live_…` Stripe key is the intended account — before
  creating the prices, not after.** The two missing price IDs are the
  only thing standing between a live key and a real card charge; a
  checkout probe returns `503 price_not_configured` rather than a
  wrong-mode error, which confirms the live key is fully active and its
  guard inert in production. Create the prices first and that margin
  disappears the moment the IDs land in Render — no deploy, no warning.
- **Keep two plans, not three.** Schema and code both allow only
  `free`/`pro`. Adding a tier later is a constraint change; removing one
  people have bought is not.

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
- **`goal_days` — our answer is don't resurrect it.** It was never
  created by a tracked migration, and `goal_items.scheduled_for` is
  already what the placement path writes and the calendar reads. Sent to
  the backend as settled unless they surface something we can't see.
- **A unique index on `(goal_id, kind)`.** Deliberately *not* added.
  No duplicates exist today, but the retry path re-drafts only the kinds
  that failed, so a unique index would convert a duplicate into a failed
  retry. That's the better failure — but it's a product call, not a
  migration to slip in.

## 5. Ops chores (owner — account access, not code)

- **Create the recurring Pro prices in Stripe.** Then the backend sets
  `STRIPE_PRICE_PRO_*` in Render and checkout works.
- **Brevo sender — set to `dev.mjq@gmail.com` (2026-09-10).** Two things
  left: confirm it's actually *validated* in Brevo (an unvalidated
  sender still gets a silent 201), and before invites reach real
  students, move to a sender on a domain we control —
  `invites@murchid.com`, with Brevo's SPF/DKIM records added to the
  `murchid.com` DNS. Nobody can publish SPF/DKIM for `gmail.com`, so
  mail from a gmail From address through Brevo fails DMARC alignment and
  gets spam-foldered or rejected under Google/Yahoo's 2024 bulk-sender
  rules — Brevo still answers 201, the teacher sees "sent", the student
  never sees it. Gmail is fine for testing only.
- **Point a pinger at `/api/keepwarm`**, every ~10 minutes. The route is
  live in this repo (`app/api/keepwarm/route.ts`); cold start measured
  22.6s against 0.16s warm. Nothing to build — cron-job.org or
  UptimeRobot at `https://www.murchid.com/api/keepwarm`.
- **A curriculum specialist** to verify and extend
  `src/lib/curriculum.js`. The 12 seeded units carry `source: 'starter'`
  and the UI calls them a draft — honest, but not a ministry sequence.

## 6. Still unexercised end to end

- **Two of three plans are unplaced** — 21 goal items exist, only 7 are
  dated. The placement path works; it has run once.
- The student invite loop and checkout (§3, §5).
- The weak-spot recap, which needs a class with real question-level
  marks — the test account has one student with none, so a pass today
  would prove nothing.

Working verification queries live in the **backend** repo at
`db/verification-queries.sql`, not in `db/` here.

## Settled — don't reopen

- **The credits formula.** Metered per document, priced from
  `feature_costs`, charged only after each document succeeds — a plan
  whose exam fails is charged for six. Prices: exam 2, slide_deck 2, 1
  each for lesson_plan/note/activity/homework/quiz, 0.2 for
  report_comment/parent_update.

  **Correction (2026-09-11):** we previously recorded "`/generate`
  writes nothing, so a single generation quotes zero" as settled
  behaviour. It wasn't — it was a bug. That route never imported the
  credits module and metered nothing at all, which went unnoticed
  precisely because the planner and notes paths *did* meter, so the
  ledger looked healthy while blind to the busiest path in the app.
  Fixed and verified: the ledger grew 108 → 135 rows once generate
  started recording. Two more of the same class were fixed alongside it
  (a CHECK constraint that made the two per-student features unpriceable,
  and an integer `credits` column that silently swallowed fractional
  prices). Worth remembering as a reminder that "no rows" is evidence of
  nothing being *recorded*, not of nothing *happening*.
- **The tool-calling question is answered** — and well. All five
  providers were tested with live calls: groq, google, openrouter and
  nvidia do function calling, omniroute doesn't. The rotation now
  filters on `supports_tools` when a request carries tools, and answers
  `503 NO_TOOL_PROVIDER` if none is reachable. That's the
  restrict-to-capable option, with a failure we can distinguish from a
  bad request. Nothing left for us to decide.
- **`navigate`'s allowlist is correct** — we checked all 21 paths
  against the running app (7 sidebar, 14 class tabs). Note `/roadmap`
  lives in the `(admin)` route group but is a real teacher-facing URL.
  **If we add or rename a page, tell the backend** — it's one line for
  them, and a dead end for a teacher if it goes stale.
- **Struck by agreement:** `GET /api/images/:id` and
  `POST /api/corpus/search`.
- **Term-plan placement works** — seven items dated Sep 14 → Dec 11,
  zero on a weekend, teaching order intact with the exam last, and
  `assessments.goal_item_id` filled for both assessments. *Verified
  2026-09-10; that test data has since been deleted (all goals and
  goal_items are gone), so it can't be re-derived without placing a new
  plan.*
- **Template library paths:** `/api/studio/library` and
  `/api/studio/library/filters`. Not `/api/library/filters` — that's a
  404, don't wire against it.
- **Live and gated** (probed 2026-09-10): `/api/studio/generate`,
  `/plan`, `/skill-profile`, `/uploads`, `/regenerate`, `/quiz-tweak`,
  `/agent`, `/api/curriculum/derive`, `/api/onboarding/parse`,
  `/api/chat`, `/api/superadmin/keys`,
  `/api/billing/{checkout,portal,webhook}`. Live ≠ called — see §2.
- **`unread_materials` is `{id, title}[]` and we already handle it** —
  `unreadMaterialsNotice()` reads `.title` with a count fallback, the
  planner only reads `.length`. No `[object Object]` anywhere. Don't
  "fix" this.
- **Struck/closed by agreement:** `/api/corpus/search` (grounding
  injects server-side, nothing reads it) and `GET /api/images/:id`
  (nothing in the rebuilt frontend expects it).
- **Grounding is verified.** A teacher's upload beat our own corpus copy
  of the same chapter *and* the service's own quiz template — her "no
  multiple choice at Grade 9" rule won over a mandated MCQ section, and
  `grounded_on` named her file correctly.
