# What is still open

> **Updated 2026-09-02.** Work orders 09–14 are done and have been
> deleted — the specs served their purpose and a folder of finished
> requests is a folder nobody reads. This file is the whole outstanding
> list. If it is not here, it is not waiting on anyone.

> **Superseded 2026-09-04 for backend availability.** Two days after the
> above, `09-schema-mismatch-blocks-everything.md` found `final/backend` —
> the branch actually deployed — running against a schema that no longer
> exists, and `10-remaining-after-keys.md` confirmed it's a 2,700-line
> scaffold (boot, auth, health, the key pool), not the 18,700-line
> `backendv2` this file was written against. The "Waiting on the backend"
> table below (grounded generation, derive) and the "§08 was never
> missing" note describe **`backendv2`, which was never merged** — on
> `final/backend` both 404 outright. Treat
> [10-remaining-after-keys.md](10-remaining-after-keys.md) as the current
> picture of what's reachable; this file stays as the original record.

## Answered: production is `backendv2`

Settled 2 Sep, and not by probing — the service found our uniquely-named
request in its own log, carrying `x-forwarded-host: www.murchid.com` and
the same request id the browser was handed. Six releases are reachable
and the `temperature: 0` repetition bug is gone.

**One thing we got wrong.** "The frontend now points at the new host" was
true in the repo and not in production: `API_PROXY_TARGET` in Vercel
still held the old host until it was changed and redeployed — exactly
the warning in our own commit. Until then none of phases 0–5 reached a
teacher.

**And an outage we could not have caught.** The cutover took every AI
path down for ~25 minutes: the v2 service carried
`ALLOWED_ORIGINS = localhost` only, so the live site was refused with
403 before reaching auth. Probing the backend host directly sends no
`Origin` header, and the service allows a request without one — so CORS
never fired for us. It only fires through a browser, and non-AI pages
stayed healthy throughout because they read Supabase directly.

## Waiting on the backend

| # | What | Spec |
|---|---|---|
| — | **Grounded generation** — inject retrieved passages into lesson and quiz prompts, prefer her material over ours, cite which source a section drew on. The corpus and `/api/corpus/search` now exist; this is the step that uses them | this file, §3 |
| 15 | **Derive, exercised for real** — `/api/curriculum/derive` is built and its logic verified on a CBSE syllabus, but the table below still lists the HTTP route and the `not_a_syllabus` refusal as unverified. The syllabus upload now sits next to the derive action instead of in another screen, so this is finally reachable in one sitting. Needs one real run: upload → read → units, and one deliberate non-syllabus to see the refusal | this file, table below |

**§08 was never missing — on `backendv2`.** The route exists there and
`skill_ids` are honoured through `resolveSkills({ explicitIds })`, on
both branches. Our 404 was the old host or the auth wall. *(Correction,
2026-09-04: on `final/backend` — the branch actually deployed — the
route, and the `teaching_skills`/`skill_assignments` tables it reads,
genuinely don't exist. See
[10-remaining-after-keys.md](10-remaining-after-keys.md) §3: this isn't
"next in the queue," it's a spec for a feature the rebuilt frontend has
no UI for at all.)*

One open question of ours, in the other direction:

- **What is `estimateCredits()`'s rule for a multi-document lesson?**
  The composer quoted ~6 and the real spend was 9 (a lesson plan and
  student notes, +5 and +4). Ours quotes the price-table entry for each
  selected *kind*; a lesson evidently produces more than one document
  and is metered per document. Send the formula and the quote will
  mirror it — guessing a multiplier would replace a wrong number with a
  differently wrong one.

### One line still owed on our side

The privacy policy has to say that class-level performance now shapes
generated material — its old wording ("what is not sent: … marks or
submissions") stops being true the moment the weak-spot prompt
deploys. Written and sitting on branch `privacy-performance-line`,
waiting on the owner because it is visitor-facing legal text.

*(The service asked for this in `src/lib/legal.ts`. The rendered policy
is `src/features/marketing/legal/privacy.ts` — `legal.js` is the older,
shorter funnel copy and has no AI-providers section to correct.)*

## Waiting on nobody's code

These are the ones that keep getting missed because they are not a pull
request:

- **Gemini is still on the free tier** — but the blast radius is much
  smaller than we said. Generation runs Anthropic (`claude-sonnet-5`);
  Gemini now only serves embeddings, so the tier decision gates
  retrieval, not the product.
- **A Brevo-validated sender address.** Not Resend — that was dropped
  for Brevo, and `env.ts` says so. The item is real but reframed: with
  an unvalidated sender, Brevo answers 201 and silently drops the
  message. (Supabase "Confirm email" is off — that half is done.)
- **A scheduled pinger on `/api/keepwarm`, every ~10 minutes.** This is
  a frontend route and it answers 200 in production today; there is
  nothing to build, only a monitor to point at it. Measured
  2 Sep: a cold first request took **22.6 seconds**; the next one took
  **0.16**. The route is built and reports the real status; it just
  This is the cheapest perceived-speed win available and it has been
  open the longest.
- **A `render.yaml` that describes the service actually serving
  traffic.** The blueprint describes `main`/starter/Singapore; the v2
  service is Free/Oregon, and there is now a third host name in play
  (`murchid-backend-no24`). That drift has already cost one failed
  deploy, and it is the reason the question at the top of this file
  cannot be answered by reading the repo.
- **`EMBEDDING_API_KEY` and `GEMINI_EMBED_MODEL`** in the backend
  environment. The first falls back to `GEMINI_API_KEY`, so retrieval
  inherits whatever the Gemini tier decision above lands on.
- **A curriculum specialist** to verify and extend
  `src/lib/curriculum.js`. The 12 seeded units carry `source: 'starter'`
  and the UI says they are our draft. That is honest, but it is not a
  ministry sequence, and it should not be shown as one.

## §1 · The 14 files nobody has read — now one press

Solved, and the reason it could not be a cron job is worth keeping: the
service **holds no service-role key on purpose**, because that key mints
access to every teacher's files. Storage is read with the teacher's own
token, so a sweep of everyone's backlog is not something a scheduled job
can do without becoming a far more dangerous thing to run.

So it is an authenticated call she makes:
`POST /api/materials/extract-pending`, 25 files a batch. The shelf shows
**Read my unread files** whenever there is a backlog, one batch per
press — every successful read is charged, and a button that keeps
spending after she has stopped looking is not one she can trust.

## §1b · Two things the service is currently breaking

Both from the contract in §2 below, both small, both change what a
teacher sees.

- **A real 404 carries no `code`.** `notFoundHandler` sends
  `{ error: 'Not found' }` and nothing else, so every genuine 404 from
  the service renders as *"this part of Murchid isn't connected yet"* —
  a missing lesson tells her the product is disconnected.
- **No SSE heartbeat exists.** The routes set the `Connection:
  keep-alive` header but never emit a periodic `:` frame. Our client
  gives up after 90 seconds of silence, so any turn that thinks for
  longer without emitting a token — a long term plan, a large attached
  PDF — is killed while the model is still working.

## §2 · What is already handled on our side

So it is not built twice:

- **Timeouts** on every AI call — 45s to first byte, 90s idle. Send a
  `:` keep-alive more often than 90 seconds while thinking.
- **Retry** carries the original brief, its materials and the full kind
  set, and is suppressed for `quota_exhausted`, `insufficient_credits`,
  `material_not_found`, `material_has_no_file` and `NO_AI_KEY`.
- **Cut-stream recovery**: a dropped connection polls the library for
  the announced `batch_id` for 60s before failing — which is why rows
  must be persisted before the response ends.
- **`no_backend`**: any server-only path that 404s *without* a `code`
  renders as "not connected yet". Always send a `code` on a real 404.
- **Credit quoting** mirrors `estimateCredits()`; a material already
  `ready` adds nothing to the quote.
- **`goal_day_id`** is now sent on `/api/studio/generate` and
  `/api/studio/agent` whenever a lesson was started from a placed term.
- **The class pick** is sent on both studio routes, and on
  `goal-plan` along with `start_date` and `periods_per_week`.
- **Weekday placement**: the browser has her real pattern because she
  picks the days, so it overwrites the service's even spread through the
  shared `(goal_id, week, day_index)` key. Both sides upsert; whichever
  runs second corrects the first.

## §3 · The corpus exists; grounding does not

The ingest and `POST /api/corpus/search` shipped. Chunks are written by
the service with the teacher's own token — it holds no service-role key
on purpose — and the scope wall behaves: all four shapes were run against
the live table, and a planted-chunk search returned her chunk and ours
while excluding another teacher's and the wrong grade.

Worth knowing about the chunker, because it was written against a real
19,000-character syllabus rather than a sample, and all three of these
were bugs found by reading its output:

- A PDF text layer often has **no blank lines at all**, so
  paragraph-based scanning found zero headings. Headings are found per
  line now.
- A shouted line must **look like language** before it is believed —
  otherwise every passage gets labelled "TOTAL 80" or "CG-9", because a
  syllabus is mostly a table.
- A heading that labels **every** section names none of them, so a
  running header is dropped. On that document 1 chunk in 10 has a
  heading, because the document genuinely has one. A citation pointing
  at the wrong section is worse than one pointing at nothing.

PDFs are read page by page and merged afterwards, so each passage keeps
its page — that cannot be recovered from the merged string later.

**What is left is the use of it.** Retrieved passages are not yet
injected into generation. When that is built: prefer her material over
ours where both match, say in the document which source a section drew
on, and generate as today rather than forcing weak passages in when
retrieval finds nothing useful.

## §4 · What has now met a teacher, and what has not

**One lesson has.** Generated through the studio on production against
v2: it streamed a plan and student notes, no cut stream, and left
`lesson_plan | ours=true | 1` — one row, written by the service, titled
"Air Resistance and Terminal Velocity" rather than "Lesson plan". The
writer flip and the trio merge both hold under a real session.

Still unexercised: the term-plan placement path (`goal_days` is still
empty, because nobody has pressed *Put N lessons on my timetable*),
grounded generation, the student invite loop and checkout.

The terminal-velocity check is **not meaningfully runnable yet** — it
needs a class with real question-level marks behind it, and the account
has one student with none. A pass today would prove nothing.

### The original table, for the paths still untested

Worth reading twice, and it is the service's own account rather than a
suspicion: every path below typechecks, builds, boots against the live
database and has had its logic verified in isolation — but **no teacher
session has exercised any of it end to end.** Driving the app needs a
signed-in teacher, which that side does not have.

| Path | Verified | Not verified |
|---|---|---|
| Row id on `done` | Insert against the live schema | That a real generation writes exactly one row |
| Trio merge | Full and partial trio, order, title | A real three-document lesson |
| 429 split | Classification against captured bodies | A live quota exhaustion |
| Extract | Mounted, auth-gated, insert shape | A real upload → ready → attach cycle |
| Goal days | Patterns 1–5, wrapping, mid-week starts | A real term plan |
| Weak spots | Real marked data, no id in the prompt | A lesson that opens with the recap |
| Derive | 15 units from a real CBSE syllabus | The HTTP route; the not-a-syllabus refusal |
| Corpus | Chunker on a real syllabus, scope CHECK, tenant isolation | A real embedding call; upload → index → search |

So the queries below are not a formality. They are the first time any
of this meets a teacher.

## §5 · Verifying a real run

Two queries settle almost everything, and neither needs a teacher
session beyond making one thing.

**A lesson is one row:**

```sql
select type, count(*) from public.ai_studio
 where batch_id = '<batch_id>' group by type;
-- lesson_plan | 1     ← whatever the trio produced
```

Any row typed `teaching_guide` or `student_notes`, or `lesson_plan`
above 1, means the merge is not live on the deployed branch.

**A lesson for a class with recent weak marks scaffolds them, and says
why** — ask for a Grade 9 Physics lesson adjacent to forces and the plan
should recap terminal velocity with a line explaining that it is there
because of a recent quiz. Ask for one on cells and it should not mention
it at all. A recap in the cells lesson is the failure mode worth
reporting fast.

**A placed term has dated days with real outcomes:**

```sql
select count(*) days, count(date) dated, count(nullif(outcomes,'{}')) with_outcomes
  from public.goal_days where goal_id = '<goal_id>';
```

`days` should equal the days in `plan.weeks[].days[]`. `with_outcomes`
at zero across the board means the model omitted `objectives` rather
than renaming it — worth telling them.
