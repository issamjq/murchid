# What is still open

> **Consolidated 2026-09-10** from six files (`00-open.md`,
> `08-skills-refinement.md`, `09-schema-mismatch-blocks-everything.md`,
> `10-remaining-after-keys.md`, `11-generation-pipeline-spec.md`,
> `12-billing-spec.md`) into this one. Resolved items and historical
> diagnosis were dropped; this is the pending list only. If it's not
> here, it's not waiting on anyone.
>
> The short version of where things stand: `final/backend` — the branch
> actually deployed — is a deliberate scaffold (boot, auth, health, the
> key pool, and now the core generation endpoint). It reads the rebuilt
> frontend's schema (`profiles`/`classes`/`batches`/`grades`/`divisions`/
> `materials`/`goal_items`/`assessments`), not the old one
> (`faculty`/`ai_studio`/`teaching_skills`/…). `backendv2`/`main` have a
> lot more built against that old schema, but none of it is deployed or
> reconnected.

## 1. Scoping decision needed before picking up anything below

For each route in §2: reconnect the old logic against the new schema,
rebuild from scratch against it, or some mix. `backendv2` and `main` are
both intact and readable on GitHub if reusing logic is worth it —
nothing there was deleted, it just isn't live.

## 2. Not reachable at all right now (404 on `final/backend`)

| Feature | Old route(s) | Notes |
|---|---|---|
| Studio conversation agent | `POST /api/studio/agent` | "Make the AI Studio a conversation rather than a pipeline" |
| Chat assistant | `POST /api/chat` | Separate from the studio routes |
| Onboarding document parsing | `POST /api/onboarding/parse` | CV/document → structured profile fields |
| Curriculum derive | `POST /api/curriculum/derive` | Syllabus upload → term structure. Logic was verified against a real CBSE syllabus on `backendv2`; the HTTP route itself was never exercised end-to-end even there |
| Corpus / grounding | `POST /api/corpus/search` + injection into generation | Ingest + search shipped and were verified (scope wall, tenant isolation) on `backendv2`; injecting retrieved passages into prompts was never finished even there. See §5 |
| Materials extraction (OCR/text) | `POST /api/materials/:id/extract`, `POST /api/materials/extract-pending` | Must be an authenticated per-teacher call (25 files a batch), not a cron job — the service holds no service-role key on purpose, so a sweep of everyone's backlog isn't something a scheduled job can safely do. This is what the current frontend's "paste the extracted text yourself" honesty notice (Notes tab, shared library) stands in for |
| Template library + moderation | `/api/library/*` | See `docs/templates.md` on the backend repo |
| Student invites | Brevo-based invite email | Class-named invite links |
| Skill-profile refinement | `POST /api/studio/skill-profile` | Orphaned, not just unbuilt — see §3 |
| `quiz-tweak`, `regenerate` | `POST /api/studio/{quiz-tweak,regenerate}` | Not yet rebuilt alongside `generate` (§4) |
| Images compatibility tail | `GET /api/images/:id` | Marked "compatibility tail only" even on `backendv2` |

## 3. Skills refinement — orphaned, needs a fresh spec

`08-skills-refinement.md` targeted `/teaching-skills`, a `teaching_skills`
table, and a `skill_assignments` table keyed on `faculty_id` — none of
which exist in the rebuilt frontend (dropped in the `clean_slate_v2`
rewrite). Not "next in the queue" — it needs a new spec against the
current schema, or a product call that the feature isn't coming back
yet. Worth reading the old spec for the *shape* of assignment-aware
grounding (a skill applies where grade/section/subject match, or
globally if unassigned) if a v2 equivalent gets designed.

## 4. Generation — built; what's still missing around it

`POST /api/studio/generate` is live and wired into all 7 class tabs.
Still open:

- **Grounded generation.** The corpus and `/api/corpus/search` exist;
  injecting retrieved passages into lesson/quiz prompts does not. When
  built: prefer the teacher's material over generic knowledge where both
  match, say in the output which source a section drew on, and generate
  as today rather than forcing in weak passages when retrieval finds
  nothing useful.
- **`estimateCredits()`'s rule for a multi-document lesson.** The
  composer quoted ~6 credits, the real spend was 9 (a lesson plan +
  student notes, +5 and +4) — it's evidently metered per document, not
  per selected kind. Get the real formula rather than guessing a
  multiplier.
- **The privacy policy line.** Has to say class-level performance now
  shapes generated material — current wording ("what is not sent: …
  marks or submissions") stops being true once the weak-spot prompt
  ships. Written and sitting on branch `privacy-performance-line`,
  waiting on the owner (visitor-facing legal text) — only actually
  relevant once grounded generation ships.
- **An SSE heartbeat** on any streaming route (a `:` frame at least every
  ~90s) — its absence previously meant a slow-thinking model on a long
  turn got killed by the frontend's own 90s idle timeout. Worth
  confirming this is designed in before any route above starts
  streaming, since it bit the old backend for real.

## 5. Billing — built; blocked on ops, then frontend

`POST /api/billing/{checkout,portal,webhook}` are live exactly per spec.
Blocked only on:

- **Stripe dashboard task, not code.** No recurring Murchid prices exist
  yet (`STRIPE_PRICE_PRO_MONTHLY`/`STRIPE_PRICE_PRO_ANNUAL` unset in
  Render) — `/checkout` answers `503 price_not_configured` until they
  are. Also worth confirming before real money moves: the server key is
  `rk_live_…` (live mode) — intentional, or switch to test while wiring
  the frontend UI first.
- **No teacher-facing billing UI yet.** "Upgrade to Pro" (calls
  `/checkout`) and "Manage billing" (calls `/portal`) — frontend work
  that follows once prices exist to test checkout against. Today only
  `/super-admin/revenue` reads `subscriptions`, honestly labelled
  "checkout isn't wired up yet."
- **Product decisions not yet made:** trial policy for Pro (length, if
  any), free-tier limits (what caps to make Pro worth paying for —
  the frontend reads whatever it is off `subscriptions.plan` once it
  exists), proration/downgrade behaviour (Stripe's own portal default
  is probably fine, only worth custom-building if it isn't).

## 6. Other product decisions needed before code

- **Single-device session enforcement.** Removed in the auth fix because
  `active_session_id` doesn't exist on the new schema, and enforcing it
  only in the backend while the browser's own direct Supabase writes go
  unchecked would be theatre. If this still matters: design the column +
  RLS predicate on the new schema first, then add the backend check.

## 7. Config/providers to re-add, not decisions

`final/backend`'s reset dropped these along with the code that read
them — re-adding is part of rebuilding whichever route needs them:

- **No AI provider is configured** except OpenRouter (the key pool).
  Gemini, Anthropic and Stripe (config side) are gone from the env
  schema and `package.json`. Whichever route in §2 gets rebuilt first
  picks its own provider.
- **`EMBEDDING_API_KEY`/`GEMINI_EMBED_MODEL`** no longer exist in
  `config/env.ts`. Setting them in Render does nothing until retrieval
  (§2, corpus/grounding) is rebuilt and reads them again.

## 8. Ops tasks, not code

- **A Brevo-validated sender address.** Without one, Brevo answers 201
  and silently drops every email. (Supabase's own "Confirm email" is
  off — that half is done.)
- **A scheduled pinger on `/api/keepwarm`**, every ~10 minutes. The route
  is restored and live (`app/api/keepwarm/route.ts`, in this repo, not
  the backend's) — a cold first request measured 22.6s, the next 0.16s.
  Nothing left to build, only an external pinger (cron-job.org,
  UptimeRobot) to point at `https://www.murchid.com/api/keepwarm`.
- **A `render.yaml` that describes the service actually serving
  traffic.** The blueprint still describes `main`/starter/Singapore; the
  deployed service is Free/Oregon under a third host name
  (`murchid-backend-no24`). Drift here has already cost one failed
  deploy.
- **A curriculum specialist** to verify and extend
  `src/lib/curriculum.js`. The 12 seeded units carry `source: 'starter'`
  and the UI says they're a draft — honest, but not a ministry sequence,
  and shouldn't be shown as one.

## 9. Still unexercised end-to-end, once reachable

One real lesson has generated successfully in production (streamed a
plan + student notes, one row, correct title, no cut stream). Not yet
exercised by a real teacher session:

- The term-plan placement path (`goal_days` still empty — nobody has
  pressed *Put N lessons on my timetable* for real).
- Grounded generation (§4).
- The student invite loop and checkout (§5).
- The weak-spot recap (needs a class with real question-level marks
  behind it; the test account currently has one student with none, so a
  pass today would prove nothing).

Two queries settle most of what's left once there's something to check:

```sql
-- A lesson should be exactly one row per type
select type, count(*) from public.ai_studio
 where batch_id = '<batch_id>' group by type;

-- A placed term should have dated days with real outcomes
select count(*) days, count(date) dated, count(nullif(outcomes,'{}')) with_outcomes
  from public.goal_days where goal_id = '<goal_id>';
```
