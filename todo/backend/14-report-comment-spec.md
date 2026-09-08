# 14 · Report-card comments — `feature: "report_comment"` on `POST /api/studio/generate`

> **Status (2026-09-08): 🔴 NOT BUILT — this file is the request.** The
> frontend half shipped today: `app/(dashboard)/classes/[classId]/report-comments/page.tsx`
> lists every student in a class with their results and attendance next to
> an editable comment box. A "Draft" button calls this feature on the
> existing `/studio/generate` route — no new endpoint. **Unlike
> `13-tiered-worksheets-spec.md`, this one degrades with a real fallback,
> not just a notice**: `"report_comment"` is a brand-new `feature` value,
> not an additive field on an existing one, so the current backend
> predictably rejects it with the `400 bad_request` the base spec
> (`11-generation-pipeline-spec.md`) already documents for "missing/invalid
> feature". The frontend catches exactly that and falls back to a plain,
> factual, locally-templated sentence built from the same data it would
> have sent you — the teacher always has something to start editing.

Same route as `11-generation-pipeline-spec.md`, not a new one. Same auth,
same "one writer per table" principle: this route returns text, the
browser writes it to its own `report_comments` table under RLS — this
endpoint doesn't touch Supabase.

## Request — a new `feature` value and a new `student` object

```
POST /api/studio/generate
Authorization: Bearer <supabase access token>

→ {
    "feature": "report_comment",
    "classId": "<uuid>",
    "prompt": "",                          // optional teacher note/emphasis — may be empty
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

- `results` is a **list, not an average** — `assessments` has no
  `max_score`/`total_marks` column, so a quiz out of 10 and an exam out of
  100 can't be honestly blended into one percentage. `score` may be `null`
  (an assessment with no mark entered yet for this student) — mention that
  as "not yet graded" rather than treating it as zero.
- `attendance` counts are already computed — no date-level detail needed,
  just present/late/absent/total for this class.
- `prompt` is free text the teacher optionally adds (e.g. "she's shown
  real improvement in group work this term") — treat it as emphasis to
  weave in, not a replacement for the data above.

## What the model should do

Write a short (2-4 sentence) narrative comment suitable for a report
card, in third person, using the student's actual name. Reference the
data honestly — don't invent achievements or concerns the results/
attendance don't support, and don't paper over a string of low scores or
frequent absences with generic positivity. If `results` is empty, say
there's no recorded assessment data yet rather than fabricating academic
performance. If the teacher's `prompt` note is present, incorporate it
naturally rather than appending it as a separate sentence.

## Response — same shape as the base route

```
← 200 {
    "title": "Reem Al Dhaheri — report comment",
    "content": "Reem has engaged consistently with the forces unit, scoring well on the quiz and showing a solid grasp on the unit test. Attendance has been strong this term, with only one absence.",
    "usage": { "input_tokens": 240, "output_tokens": 68 }
  }
```

`content` is the whole drafted comment, ready to drop into the textarea
as-is (the teacher edits from there — nothing is auto-saved). `title` is
unused by the frontend for this feature kind; fill it with anything
reasonable (a student-name label is fine) rather than leaving it empty if
the response schema requires it.

## Not grounded in class materials — on purpose

Every other `feature` on this route grounds its draft in the class's
attached materials (`class_materials` → `materials`). Skip that step
here: the input for a report comment is the *student's own data*, not
the class's reference documents — there is nothing in the syllabus/notes
that a report comment should quote from.

## Errors

Same envelope as the base route (`11-generation-pipeline-spec.md`) — no
new codes needed. The one that matters for the frontend's fallback:

| Status | Code | When |
|---|---|---|
| 400 | `bad_request` | `feature: "report_comment"` not recognized yet, or `student` missing/malformed once it is — **this is the confirmed signal the frontend already falls back on today** |
| 403 / 429 / 503 | (existing) | Unchanged from the base route |

## Test plan

- Send a student with a mix of strong and weak scores and one absence —
  confirm the comment reflects both, not just the positive side.
- Send a student with `results: []` — confirm the comment says there's no
  assessment data yet rather than inventing performance.
- Send a `prompt` note and confirm it's woven into the comment rather than
  tacked on as a separate, disconnected sentence.
- Confirm a request with an unrecognized `feature` value (i.e. today,
  before this ships) still comes back as `400 bad_request` — that's the
  frontend's fallback trigger, so a change to that shape would silently
  break it.
