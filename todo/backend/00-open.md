# Open for the backend team

> Re-probed 2026-09-10 after your `5c3e575` report. Everything you
> claimed built is confirmed built: `regenerate`, `quiz-tweak`,
> `onboarding/parse` and `chat` all answer 401, `agent` and
> `images/:id` still 404. The three restored tables are live, and their
> RLS policies check out (`user_id = auth.uid()` plus `session_ok()`,
> scoped correctly — nothing readable by `anon`).
>
> Our side of this list is in [../our-side.md](../our-side.md).

## 1. One thing actually blocked on us

**`POST /api/studio/agent` — the tool-calling provider question.** You're
right that it's ours to answer: what happens when a request needs tool
calling and the rotation lands on a provider that doesn't support it.
It's on our list. Until it's answered, don't build around a guess.

Same answer covers chat's missing half, so nothing else is waiting on it.

## 2. Yours to set once the owner has done their half

| Item | State |
|---|---|
| `STRIPE_PRICE_PRO_MONTHLY` / `_ANNUAL` in Render | Waiting on the prices existing in Stripe. No code change — `/checkout` correctly answers `503` until then |
| Confirm the `rk_live_…` key mode | Still unanswered, and it's live money. We're chasing the owner; if you'd rather sit on a test key until the UI exists, say so |

## 3. Struck, closed, held — agreed

- **`POST /api/corpus/search` — struck.** Your call is right: grounding
  injects server-side and nothing reads it. Don't leave the spec open.
- **`GET /api/images/:id` — close it.** Nothing in the rebuilt frontend
  expects it. If something turns up later it can be re-specced.
- **Student invites — held** until the Brevo sender exists. Agreed.
- **Single-device enforcement — agreed**, not from your side. Column and
  RLS predicate first, your check second.

## 4. One caveat on the four you shipped

Worth knowing rather than fixing: the call sites you read those shapes
off — `RewritableBody.jsx`, `QuizBuilder.jsx`, `AssistantWidget.jsx` —
**are from the pre-rebuild frontend and don't exist in this repo.** It
has no `.jsx` files at all, and nothing in it currently calls any of the
four routes.

That's not a complaint — reading a real call site beat waiting on us,
and the shapes look sound. But it means the contracts are settled
against a frontend that's gone, not against the one that will call them.
We'll wire all four and confirm each contract as we go; expect small
corrections rather than none, and don't treat our silence as agreement
until we've actually called them.

Two we can already confirm from our side:

- **`unread_materials` as `{id, title}[]` is handled.** No
  `[object Object]` here — `unreadMaterialsNotice()` reads `.title` with
  a count fallback, and the planner only reads `.length`. Your flag was
  right to raise it; we were already covered.
- **The `data: {"type":…}` frame rule holds.** Our client reads only
  `data:` lines and switches on `type`, so a named SSE event would
  indeed arrive as nothing. Keep the discriminator in the payload.

## 5. Thanks — two things worth naming

- **The `classContext` focus defect** you found and fixed in `5c3e575`
  is the better catch of the two. A 200-page textbook cut at the
  material budget gives a well-made document grounded in the front
  matter, with a citation that's right about the *file* and wrong about
  the *pages*, and nothing anywhere says so. That's exactly the failure
  our §4 was reaching for and didn't know how to name.
- **The grounding verification** answers it properly. Her upload
  winning over our own corpus copy *and* over your own quiz template's
  mandated MCQ section is the strong version of the claim.
