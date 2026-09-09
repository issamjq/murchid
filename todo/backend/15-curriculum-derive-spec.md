# 15 · Curriculum coverage — `POST /api/curriculum/derive`

> **Status (2026-09-09): 🔴 NOT BUILT — this file is the request.** An
> earlier doc (`00-open.md`, dated 2026-09-04, before this repo's schema
> rebuild) mentioned a `/api/curriculum/derive` route and a
> `src/lib/curriculum.js` with "12 seeded units" as if already live —
> neither exists anywhere in the current frontend repo, and there is no
> `curriculum_units` table or equivalent. That earlier reference may have
> described a different backend snapshot, or work that never actually
> shipped; either way, treat this document as the current, from-scratch
> spec, not a resume of that one. **No frontend page calls this yet** —
> unlike `13`/`14`, this pass only lays the schema foundation
> (`public.syllabus_units`, plus a nullable `goal_items.unit_id` tag) so
> the coverage tracker's manual-entry and AI-derive paths can be built
> together in one later pass, rather than shipping a manual-only UI now
> and reworking it once this exists.

Same principles as `11`/`13`/`14`: same auth, same "one writer per
table" rule (this route returns a unit list; the browser inserts the
`syllabus_units` rows itself, tagged `source: 'derived'`), same error
envelope.

## Request

```
POST /api/curriculum/derive
Authorization: Bearer <supabase access token>

→ {
    "classId": "<uuid>",
    "subject": "Physics",
    "gradeLevel": 9,
    "syllabusText": "…the full pasted/typed syllabus or reference text…"
  }
```

`syllabusText` is sent directly in the request body, not looked up
server-side from a `materialId` — there's no upload/OCR pipeline in this
repo yet (`attachOwnReference` in `src/lib/data/classes.ts` is explicit
that reference text is typed in directly), so the frontend already has
the text in hand and there's nothing to gain from a second round-trip
to re-fetch and re-verify ownership of it.

## What the model should do

Read the syllabus text and produce an **ordered list of teaching units**
— the natural chapters/topics a teacher would actually schedule lessons
against, in the order they'd be taught, not an exhaustive line-by-line
restatement of the document. For each unit: a short title, the concrete
learning outcomes it covers (verbatim or close to the source language,
not invented), and — only if the source document gives enough signal to
estimate it (a table of contents with a pacing guide, explicit week
counts, etc.) — a rough `typicalWeeks`. Omit `typicalWeeks` rather than
guessing a number the source doesn't support.

**Refusal case, carried forward from the earlier (unbuilt) reference to
this same idea**: if `syllabusText` doesn't actually read as a
curriculum document — too short, no real topic structure, random text —
refuse rather than inventing a plausible-looking unit list. This is the
same "ask for the missing reference instead of inventing content"
constraint already load-bearing elsewhere in this product
(`docs/00-concept.md`), applied here as a `422 not_a_syllabus`.

## Response

```
← 200 {
    "units": [
      {
        "seq": 1,
        "title": "Forces and Motion",
        "outcomes": ["Explain Newton's three laws", "Calculate net force on an object"],
        "typicalWeeks": 3
      },
      { "seq": 2, "title": "Energy", "outcomes": ["…"] }
    ],
    "usage": { "input_tokens": 1840, "output_tokens": 320 }
  }

← 422 {
    "error": "This doesn't read as a syllabus or curriculum document.",
    "code": "not_a_syllabus"
  }
```

`seq` starts at 1 and is contiguous — the frontend inserts these
directly as `syllabus_units.seq` (unique per `class_id`). `outcomes` may
be an empty array if the source genuinely doesn't itemize them, but
shouldn't be routinely empty — that usually means the model summarized
too coarsely.

## Errors

Same envelope as the base generation route (`11-generation-pipeline-spec.md`):

| Status | Code | When |
|---|---|---|
| 400 | `bad_request` | Missing/invalid `classId`, `subject`, or empty `syllabusText` |
| 403 | `forbidden` | `classId` doesn't belong to the caller |
| 422 | `not_a_syllabus` | Input doesn't read as a real curriculum document — see refusal case above |
| 429 / 503 | (existing) | Unchanged from the base route |

## Test plan

- A real syllabus with an explicit unit-by-unit table of contents —
  confirm the derived units match it in order and count, and
  `typicalWeeks` is populated where the source states pacing.
- A syllabus with no explicit pacing guide — confirm `typicalWeeks` is
  omitted rather than a fabricated guess.
- A deliberately non-syllabus input (e.g. a random paragraph, or a
  single sentence) — confirm `422 not_a_syllabus`, not a plausible-
  looking fake unit list.
- Confirm nothing is written to Supabase from this route — the units
  only exist once the frontend's own follow-up insert (not yet built)
  writes them to `syllabus_units`.
