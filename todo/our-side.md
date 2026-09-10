# Open on our side — frontend, product, ops

Split out of [backend/00-open.md](backend/00-open.md) on 2026-09-10, so
that file could be the backend team's queue alone. Nothing here is
waiting on them; most of it is what *they* are waiting on.

## 1. Ratify the tool-calling behaviour we never chose

**`/api/studio/agent` shipped anyway** (probed 2026-09-10: 401, was
404). It was blocked on a question only we could answer and we never
answered it, so whatever it does now was decided without us.

The question: **what happens when a request needs tool calling and the
four-provider rotation lands on a provider that doesn't support it**
(Groq does, NVIDIA varies, OmniRoute depends on what it fronts).
Previously any provider served any request; tool calling ends that.

The three plausible answers, and what each costs:

- **Restrict tool requests to capable providers** — smaller pool, more
  queuing under load, but behaviour is consistent.
- **Degrade to a no-tools answer** — always responds, but the same
  question silently gives a worse answer depending on which provider
  happened to serve it. This is the one a teacher experiences as a
  broken product rather than a busy one.
- **Fail and retry elsewhere** — consistent, costs latency on a miss.

So this is no longer "send them a decision" — it's **find out which one
they implemented, then keep it or change it.** The same answer governs
chat's tool half.

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
| `POST /api/chat` | SSE, `{ message, scope?, sessionId? }` | Sessions persist across restarts. `onTool`/`onAction` fire only once §1 is settled |
| `POST /api/studio/agent` | **Unknown — never specced to us** | Ask for the contract rather than inferring it; it's the one route whose shape wasn't read off our own old code |

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
