# 13 · Differentiated worksheets — `additionalTiers` on `POST /api/studio/generate`

> **Status (2026-09-08): 🔴 NOT BUILT — this file is the request.** The
> frontend half shipped today: the Homework composer
> (`app/(dashboard)/classes/[classId]/homework/page.tsx`) now shows two
> optional toggles, "Simplified" and "Challenge", next to the existing
> prompt box. Checking one sends the field described below on the
> existing `POST /api/studio/generate` call — same route as
> `11-generation-pipeline-spec.md`, no new endpoint. **The frontend
> degrades cleanly when this is missing**: it sends the field, gets back
> today's exact response shape unchanged, notices there's no `additional`
> key, creates only the standard worksheet, and tells the teacher
> differentiated versions aren't available yet. No error, no retry, no
> broken UI — this is a value-add a teacher can turn on, not a hard
> dependency the rest of the app is blocked on.

This is an **additive extension** of the endpoint `11-generation-pipeline-spec.md` already specced and (per its own banner) built and live — not a new route. Every other caller of `/studio/generate` (lessons, presentations, activities, notes, quizzes, exams) sends no `additionalTiers` field and is completely unaffected.

## Why response-shape, not a 404, is the signal

The usual "frontend calls it, falls back on a confirmed `404 not_found`" pattern (see `10-remaining-after-keys.md` §1) doesn't apply here: `/studio/generate` already exists and answers 200 today. Sending it an extra field it doesn't recognize won't 404 — most JSON body parsers just ignore unknown keys — so the frontend would get back a normal 200 with the old shape and no signal that tiers weren't honored. The contract below is designed around that: **the presence or absence of `additional` in the response is the whole signal**, checked after a normal 200, not a status code.

## Request — one new optional field

```
POST /api/studio/generate
Authorization: Bearer <supabase access token>

→ {
    "feature": "homework",
    "classId": "<uuid>",
    "prompt": "A worksheet labeling the stages of cellular respiration…",
    "additionalTiers": ["support", "extend"]   // optional, 0-2 of these two values
  }
```

- Field absent, or an empty array → identical to today's contract in every way. Nothing below applies.
- `"support"` → also draft a version for students who need more scaffolding: shorter/simpler sentences, more worked examples, smaller steps. Same learning objective as the standard version — less friction reaching it, not a lower bar.
- `"extend"` → also draft a version for students ready to go further: an added layer of complexity, application, or open-endedness. Same objective, more reach.
- Order in the array doesn't matter; validate it's a subset of `{"support","extend"}` — reject anything else per the existing 400 rule below.

## Response — existing shape unchanged, one new optional field

```
← 200 {
    "title": "Cellular Respiration — Grade 10 Biology",
    "content": "## Objectives\n…the standard version, exactly as today…",
    "usage": { "input_tokens": 812, "output_tokens": 1204 },
    "additional": {
      "support": { "title": "…", "content": "…markdown…" },
      "extend":  { "title": "…", "content": "…markdown…" }
    }
  }
```

- `title`/`content`/`usage` at the top level describe the **standard** version — untouched by this spec, still what every other feature kind gets back.
- `additional` is present **only** when at least one tier was actually generated, and only carries the keys that were requested and produced. Omit the whole `additional` object (not an empty `{}`) if none of the requested tiers could be generated — the frontend treats a present-but-empty `additional` the same as absent, so either is safe, but omitting it is the cleaner signal.
- Each tier variant is a full `{title, content}` pair, same shape as the standard one — a support/extend worksheet may reasonably need its own title (e.g. "— Simplified").

### What the frontend does with this

Writes one `goals` row (as today) and one `goal_items` row per version returned — the standard one plus one per key in `additional` — all sharing that same `goal_id` as siblings of one assignment, tagged via a new nullable `goal_items.tier` column (`null` = standard, `'support'`/`'extend'` otherwise). Purely a frontend/Supabase-schema concern; this route doesn't write to Supabase either way, per the "one writer per table" principle in `11-generation-pipeline-spec.md`.

## Generate tiers in parallel, not serially

A single generation is already a few seconds; the frontend's request timeout is 90s (`src/lib/data/generation.ts`). Three full drafts (standard + 2 tiers) run serially could get close to that budget and would make a differentiation feature feel like a tax on generation speed. Recommend firing all requested generations concurrently server-side and returning together once they've all resolved — latency should stay close to a single generation's, not multiply by the number of tiers requested.

If a tier's generation fails while the standard one succeeds, prefer returning the standard result with `additional` simply omitting that tier over failing the whole request — a partial win (the teacher gets the worksheet they asked for, minus an extra they didn't strictly need) beats losing the base generation over a nice-to-have.

## Credits — not yet a live question, flagging for whenever billing lands

`11-generation-pipeline-spec.md`'s own "not in this spec" section notes credits/billing metering is gated on the Stripe decision and tracked separately — so this isn't a blocking question today. But when metering does get built: does 1 additional tier cost the same as the base generation (2 tiers selected = the same spend as 3 separate generations), or is there a bundled/discounted rate for generating them together in one call? Worth deciding deliberately rather than defaulting to whatever's easiest to implement — same reasoning as the open multi-document-lesson credit question in `00-open.md`, where guessing a multiplier replaced one wrong number with a differently wrong one.

## Errors

Same envelope and codes as `11-generation-pipeline-spec.md` — no new codes needed:

| Status | Code | When |
|---|---|---|
| 400 | `bad_request` | `additionalTiers` present but contains a value outside `{"support","extend"}` |
| 403 / 429 / 503 | (existing) | Unchanged from the base route |

## Test plan

- Send `additionalTiers: ["support"]` for a homework prompt on a class with attached materials — confirm `additional.support` comes back, is grounded in the same class materials as the standard version, and reads as a genuinely simpler version of the same content (not a shorter, truncated one).
- Send both `"support"` and `"extend"` together — confirm both come back and neither blocks on the other (check timing is close to a single generation, not ~3x).
- Send no `additionalTiers` — confirm the response is byte-for-byte the same shape as before this spec (no stray `additional: null` or similar).
- Confirm a request with `additionalTiers: ["hard"]` (invalid value) gets a 400, not silently ignored.
