# Backend integration — how the two halves connect

Against `https://murchid-backend-no24.onrender.com`.

**This is reference, not a task list.** The live queue is
[backend/00-open.md](backend/00-open.md); what follows is how the
frontend and the service are wired, which is the part worth keeping
accurate because breaking it takes the whole AI surface down at once.

## How the two are connected (keep this working)

`API_PROXY_TARGET=https://murchid-backend-no24.onrender.com` makes
`next.config.ts` rewrite `/api/*` to the service **server-side** — no
CORS, no preflight, the token never crosses an origin. **It must be set
in the Vercel project environment too**, or every AI path 404s in
production. It is deliberately not `NEXT_PUBLIC_`. Streaming works
through the rewrite (verified: chunks arrive incrementally).

The service also carries a hardcoded `ALLOWED_ORIGINS` list
(localhost:5173/3000 + murchid.com variants); any new domain must be
added there **and** to the Supabase redirect list.

The SSE vocabulary the frontend reads (reference):

```
data: {"type":"batch"|"status"|"scope"|"artifact_start"|"delta"|
       "artifact"|"artifact_end"|"done"|"error"}     generate (batch)
data: {"type":"session"|"tool"|"action"|"delta"|"done"|"error"}  chat
```

## Validation errors are `validation_error`, never `bad_request`

Worth its own heading because it silently breaks fallbacks. **Every**
validation failure on `/studio/generate` — bad `feature`, bad `classId`,
empty `prompt`, an unknown `additionalTiers` value — answers:

```
400 { "error": "feature: feature must be one of: …",
      "code": "validation_error", "errorId": "…" }
```

There is no `bad_request` code on that route and there never has been.
Specs 13–17 each asked for one; the service kept its own envelope, which
is the right call. Anything degrading on a rejected request must branch
on **`e.status === 400`**, not on the code string — `draftReportComment`
and `draftParentUpdate` in `src/lib/data/` both do, and would silently
stop falling back if anyone "tidied" them into a code comparison.

`/api/curriculum/derive` follows the same rule, with two of its own:
ownership answers **`404 class_not_found`, not 403** (a 403 would confirm
the id exists, which is a fact about another teacher's account), and its
`422 not_a_syllabus` refusal does carry exactly that code.

## Specs 13–17: shipped, and the deviations that outlived them

The five request docs were deleted once the work landed — same as the
00–07 batch before them. What the frontend still depends on:

| # | Shipped | Still binds the frontend |
|---|---|---|
| 13 | `additionalTiers` on `/studio/generate` | Tiers work on **any** feature, not just homework. Titles are suffixed server-side (the model wouldn't do it reliably). `usage` covers the standard version only; tier tokens are logged as `tierTokens` server-side for whenever the credits decision happens — a two-tier request currently bills as one generation. |
| 14 | `feature: "report_comment"` | `prompt` is optional **for this feature only**. Not grounded in class materials, and returns no `grounded_on`. Cross-assessment comparison is forbidden server-side — without `max_score` there is no honest one to make. |
| 15 | `POST /api/curriculum/derive` | Its own mount, not under `/studio`. `seq` is assigned by the backend, contiguous from 1 — insert it as given. `syllabusText` under 120 chars is refused without a model call; 40,000 max. Nothing is written to Supabase. |
| 16 | `grounded_on` on `/studio/generate` | Each entry carries `origin: "class" \| "library" \| "curriculum"` — a curriculum chapter can ground a draft the teacher never attached, so the UI labels it. `unread_materials` is now `{id, title}[]`. |
| 17 | `feature: "parent_update"` | Marks are **withheld from the model**, not merely forbidden — so no phrasing that compares or characterises a score is possible. Tiers ignored; no `grounded_on`. |

**One recommendation both 14 and 17 make, unprompted and independently:**
add `max_score` to `assessments`. Without a denominator a mark of 8 could
be full marks or a quarter of them, so both features report marks rather
than characterising them, and the evaluative half of each comes back the
day that column exists.

## Open items

**Moved.** The live queue is [backend/00-open.md](backend/00-open.md) —
one page, kept current, and the only thing to hand the backend team.

Of the seven items that were listed here, five shipped between 12 Aug
and 2 Sep: the 429 split, `id` on `done`, cold-start keep-warm (the
route exists; the pinger is an ops task), extraction, and the whole
phase 0–5 chain. What remains from this file:

- **`POST /api/studio/skill-profile`** and assignment-aware
  `skill_ids` — [backend/00-open.md](backend/00-open.md) §3.
- **Per-field confidence in `/api/onboarding/parse`** — the funnel wants
  to flag low-confidence auto-filled fields for review; today it only
  gets the `found`/`missing` split. Cosmetic, and the reason it has
  never been urgent.
- **The single-device NULL nit** — a token whose `users.active_session_id`
  is NULL gets `401 session_superseded`, while Postgres's own
  `is_current_device()` treats NULL as *unclaimed* and allows it.
  Harmless in practice, since sign-in claims before anything else runs,
  but the two definitions should agree.

This file stays for the section above it: the proxy arrangement, the
`ALLOWED_ORIGINS` list and the SSE vocabulary are reference, not tasks.
