# 16 · Grounded sources — `grounded_on` on `POST /api/studio/generate`

> **Status (2026-09-09): 🔴 NOT BUILT — this file is the request, and it's
> a small one.** The frontend half shipped today: every draft made from a
> studio composer now records the class materials it was grounded in, and
> the record dialog shows them under a "Grounded in" heading. **The
> backend already knows this list** — per `11-generation-pipeline-spec.md`
> §3 it joins `class_materials → materials` and concatenates their
> `body_md` into the system prompt — it just discards it before
> responding. This asks for that list back.
>
> Until it does, the frontend computes the same set client-side (attached
> materials with non-empty `body_md`). That's accurate for the common
> case, with one blind spot only the backend can fix — see below.

Same route, same auth, same "one writer per table" rule as every other
spec here: this returns a list, the browser stores it.

## What to add

One field on the existing success response:

```
← 200 {
    "title": "…",
    "content": "…",
    "usage": { … },
    "grounded_on": [
      { "id": "<material uuid>", "title": "Grade 9 Physics syllabus" },
      { "id": "<material uuid>", "title": "Chapter 4 — Forces" }
    ]
  }
```

- One entry per material **whose text actually made it into the prompt**,
  in the order it was concatenated.
- `id` is `materials.id`, `title` is `materials.title` — the frontend
  stores both and displays the title.
- Applies to every existing `feature` value that grounds in class
  materials (`lesson_plan`, `slide_deck`, `activity`, `homework`, `note`,
  `quiz`, `exam`). It does **not** apply to `report_comment`
  (`14-report-comment-spec.md`), which is grounded in a student's own
  data rather than class materials — omit the field there.

## Why the frontend's own guess isn't good enough

The client currently approximates this as "every attached material with
non-empty `body_md`". Two things it cannot see:

1. **The prompt-budget cap.** §3 of the base spec caps concatenation at
   "whatever prompt budget makes sense". When a class has more reference
   text than fits, some materials are dropped or truncated — and the
   teacher is currently told those materials grounded the draft when they
   partly or wholly didn't. This is the real reason the field is worth
   returning: it turns a good guess into a fact.
2. **Any future selection logic.** The moment grounding stops being
   "concatenate everything" and starts choosing (by relevance, recency,
   whatever), the client's guess becomes actively wrong. Returning the
   list means the frontend never needs to know how selection works.

## Also worth tightening: `unread_materials`

`unread_materials` is currently typed `unknown[]` on the frontend and
**only its length is read** (`unreadMaterialsNotice` in
`src/lib/data/generation.ts`), so its shape is unconstrained today.
Making it the same `{id, title}[]` shape as `grounded_on` is safe — no
frontend change is required for it to keep working — and would let the
notice name the unread files instead of just counting them ("Chapter 4
hasn't been read yet" rather than "1 material hasn't been read yet").
Worth doing while this area is open, but strictly optional.

## Explicitly out of scope

The corpus/chunking/embeddings/`/api/corpus/search` system described in
`00-open.md` §3 is **not** part of this. Nothing in this repo references
it and nothing in it exists here — this spec deliberately needs none of
it. Document-level provenance ("this draft saw these materials") is
achievable today with a list the backend already has in hand.
Span-level citations ("this paragraph came from §4") genuinely do need
chunk identity, and shouldn't be specced until there's real retrieval
infrastructure to build them on. The current renderer is
`whitespace-pre-wrap` over a raw string with no structure pass, so it
couldn't host inline citation markers anyway.

## Errors

No new codes, no new failure modes. If the grounding step yields nothing
(a class with no attached materials — which the frontend's send-button
gate already prevents), return `grounded_on: []` or omit it; the
frontend treats both as "nothing to show".

## Test plan

- Generate for a class with two readable materials — confirm both come
  back in `grounded_on` with correct ids and titles.
- Generate for a class with one readable material and one uploaded file
  that has no extracted text — confirm the unread one appears in
  `unread_materials` and **not** in `grounded_on`.
- Generate for a class whose materials exceed the prompt budget — confirm
  `grounded_on` lists only what actually went in, not everything attached
  (this is the case the frontend can't get right on its own).
- Confirm `report_comment` responses omit the field entirely.
