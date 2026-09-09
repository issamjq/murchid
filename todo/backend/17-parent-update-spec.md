# 17 · Parent updates — `feature: "parent_update"` on `POST /api/studio/generate`

> **Status (2026-09-09): 🔴 NOT BUILT — this file is the request.** The
> frontend half shipped today:
> `app/(dashboard)/classes/[classId]/parent-updates/page.tsx` drafts a
> short, plain-language progress update per student for their parent, and
> the teacher **copies it** into whatever channel they already use.
> Degrades exactly like `14-report-comment-spec.md`: `"parent_update"` is
> a new `feature` value, today's backend rejects it with the documented
> `400 bad_request`, and the frontend falls back to a local template.

**This route sends nothing, and neither does anything else in this
product.** There is no email transport anywhere in the frontend repo —
`brevo|sendinblue|resend|nodemailer|smtp` return zero hits including in
`package.json`, and `src/config/env.ts` exposes only the Supabase URL,
publishable key, and a configured flag. The only mail this product has
ever sent is Supabase Auth's own signup/reset mail. This endpoint returns
text; a human decides where it goes.

Same route, same auth, same "one writer per table" rule as the rest.

## Request — identical `student` payload to `report_comment`

```
POST /api/studio/generate
Authorization: Bearer <supabase access token>

→ {
    "feature": "parent_update",
    "classId": "<uuid>",
    "prompt": "",                          // optional teacher note — may be empty
    "student": {
      "name": "Reem Al Dhaheri",
      "results": [
        { "title": "Forces quiz", "score": 8 },
        { "title": "Unit test", "score": 45 }
      ],
      "attendance": { "present": 16, "late": 2, "absent": 1, "total": 19 }
    }
  }
```

Deliberately the same shape as `14`'s so both features share one payload
builder. What differs is entirely in the writing.

## What the model should do — the whole point is the register

The reader is **a parent, not a colleague**. Two or three sentences,
warm but factual, no education jargon ("formative assessment",
"scaffolding", "AfL"), no invented incidents or personality claims the
data doesn't support.

**Do not quote raw marks.** `assessments` has no `max_score`/`total_marks`
column, so a bare "scored 45 on the unit test" is uninterpretable to
someone who doesn't know what the paper was out of — and worse, it reads
as a percentage to most people. Refer to assessed work qualitatively
("has kept up with the assessed work this term", "found the recent unit
test harder than the earlier quiz") or by count. Attendance figures *are*
safe to state plainly — "attended 16 of 19 sessions" means the same thing
to everyone — and are usually the most useful concrete fact available.

If `results` is empty and attendance is empty, say plainly that there
isn't much on record yet rather than padding with generalities. If the
teacher's `prompt` note is present, weave it in — it's usually the part
the parent most wants to hear.

## Response — same shape as the base route

```
← 200 {
    "title": "Reem Al Dhaheri — parent update",
    "content": "Reem has settled well into the forces unit and has attended 16 of her 19 lessons so far. She's kept pace with the assessed work, and the most recent test was a step up in difficulty for most of the class. Happy to talk through anything in more detail.",
    "usage": { … }
  }
```

`content` drops straight into an editable textarea; `title` is unused by
this feature's frontend. Do **not** return `grounded_on`
(`16-grounded-sources-spec.md`) here — like `report_comment`, this is
grounded in a student's own record, not in class reference material.

## Errors

Same envelope, no new codes. The one that matters: `400 bad_request` for
an unrecognized `feature` is **the frontend's current fallback trigger**
— changing that shape would silently break the degrade path.

## Test plan

- A student with good attendance and mixed marks — confirm the update
  reads as plain language a parent would understand, and quotes **no raw
  scores**.
- A student with `results: []` and `attendance.total: 0` — confirm it says
  there's little on record rather than inventing progress.
- With a `prompt` note ("she's been much more confident speaking up in
  class") — confirm it's integrated, not appended as a disconnected line.
- Confirm the response carries no `grounded_on` for this feature.
