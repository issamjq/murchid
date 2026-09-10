# 08 · Skills refinement — `POST /api/studio/skill-profile`

> **Status (2026-08-12): 🔴 NOT BUILT — this file is the request.** The
> frontend half shipped today: the `/teaching-skills` interview collects
> answers (typed, spoken, or quick-picked), calls this endpoint, and
> **falls back to a deterministic local compile when it 404s** — so
> nothing is broken while this is missing, but profiles read as raw
> answers instead of a written document until it exists. The
> `skill_assignments` table (§3) already exists in Supabase — created by
> `db/tune.sql` in the frontend repo, RLS on.

> **Downgraded 2026-09-04: orphaned, not just unbuilt.** The frontend was
> rebuilt from a blank slate that week (`clean_slate_v2`) and the current
> schema has no `teaching_skills` or `skill_assignments` table, and no
> `/teaching-skills` route — see
> [10-remaining-after-keys.md](10-remaining-after-keys.md) §3. Nothing
> above is stale on its own terms (it was accurate when written, against
> the pre-rebuild frontend), but this is no longer "next in the queue" —
> it needs a fresh spec against the rebuilt schema before anyone builds
> against it, or a product call that the feature isn't coming back yet.
> Worth keeping for the *shape* of assignment-aware grounding if a v2
> equivalent gets designed.

Two jobs, one small and one structural:

1. **§1 — the refinement endpoint.** Turn a teacher's interview answers
   into a well-written teaching profile (Markdown).
2. **§3 — assignment-aware generation.** Stop reading *all* of a
   teacher's `teaching_skills` rows during generation; read the ones
   assigned to the class/grade/subject at hand.

Requires [00 · Setup](00-setup.md). Same auth, same single-device gate,
same credit metering as every other `/api/studio/*` route.

---

## §1 · The endpoint

```
POST /api/studio/skill-profile
Authorization: Bearer <supabase access token>
```

### Request body — TWO shapes, exactly what the frontend already sends

**Shape A — interview answers** (from `/teaching-skills`):

```json
{
  "teacher_name": "Aisha Al Marri",          // optional
  "answers": [
    {
      "id": "approach",                       // stable question id
      "heading": "Teaching approach",         // section the question maps to
      "question": "How would you describe the way you teach? …",
      "answer": "Inquiry-led — I open with a question or phenomenon before any definitions; single periods tend to lose the analysis stage."
    }
    // …only questions that were actually answered are sent (1–10 items)
  ]
}
```

**Shape B — distill an approach from a loved generation** (from the AI
Studio's "Save this approach as a skill", offered the moment a teacher
saves an artifact they liked):

```json
{
  "source": "artifact",
  "artifact": {
    "kind": "quiz",                           // lesson_plan | quiz | homework | presentation | activity
    "prompt": "Forces and motion end-of-unit quiz, grade 9, hard",
    "content": "…the generated markdown the teacher kept (≤ 8000 chars)…"
  }
}
```

For Shape B, the model's job is **reverse-engineering the method**: read
prompt + output and describe the reusable pattern — structure, question
mix, difficulty calibration, tone, pacing — as instructions a future
generation can follow. NOT a summary of the content ("a quiz about
forces") but a description of the approach ("end-of-unit quizzes open
with two confidence questions, escalate to application, mark scheme
favours explanation"). Same output contract as Shape A; keep `name`
short and method-flavoured. The frontend has a deterministic fallback
(instruction + reference excerpt) when this route is absent, so again:
missing degrades quality, not availability.

Validate: Shape A needs non-empty `answers[]` with non-empty `answer`s;
Shape B (`source: "artifact"`) needs `artifact.kind` and
`artifact.content`. 400 with a field message otherwise, same style as
the other routes.

### What the model should do

The input is Q&A fragments — quick-picks the teacher tapped, spoken
sentences, half-thoughts. The output is the document the **generator**
will read on every request, so write it for that reader:

- **One coherent Markdown document**, written in third person or first
  person consistently ("Plans open with a phenomenon…"), not Q&A echo.
- **Name the methods.** If the answers describe cold-calling, exit
  tickets, tiered worksheets — say so with the proper terms, because the
  generator keys off them.
- **Keep the teacher's specifics verbatim** (period lengths, curricula,
  named tools, class sizes). Do not invent anything the teacher did not
  say — an invented preference will silently shape every future lesson.
- Structure suggestion (not a hard contract): `## Approach`,
  `## How a lesson runs`, `## Assessment`, `## Differentiation`,
  `## Materials & constraints` — merge or drop sections the answers
  don't support.
- Also produce a **short display name** for the profile (≤ 40 chars),
  e.g. "Inquiry-led practical physics" — shown on the card and in lists.

### Response — SSE, same vocabulary as the other studio routes

```
data: {"type":"delta","text":"…"}          the profile, in pieces
                                           (the frontend renders it live)
data: {"type":"done",
       "name":"Inquiry-led practical physics",
       "skill_profile":"# How I teach — Aisha Al Marri\n\n## Approach\n…",
       "usage":{"input_tokens":…,"output_tokens":…}}
data: {"type":"error","message":"…"}       instead of done, on failure
```

The `done` frame carries the **complete final text** in `skill_profile`
(the deltas are preview only — the frontend prefers `done.skill_profile`
and falls back to concatenated deltas if it is absent). **Do not persist
anything**: the teacher reviews and edits before the browser writes the
row to `teaching_skills` itself (RLS-scoped), same division of labour as
`/api/studio/generate`.

Meter it like a generation (credits + `usage_logs`).

---

## §2 · How the frontend behaves (already shipped — for reference)

- Calls this endpoint when the interview finishes, streams deltas into a
  live rendered preview.
- On `done`: uses `name` + `skill_profile`, teacher edits/renames, then
  `POST /api/skills` (a browser→Supabase data path, not your service)
  saves `{ name, source_type: "interview", skill_profile, status: "ready" }`.
- On 404/error: compiles the answers locally into a plain sectioned
  document and tells the teacher refinement wasn't available. So this
  endpoint's absence degrades quality, never availability.

---

## §3 · Assignment-aware generation

The new table (already live, RLS `faculty_id = current_faculty_id()`):

```sql
CREATE TABLE public.skill_assignments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id   uuid NOT NULL REFERENCES public.teaching_skills(id) ON DELETE CASCADE,
  faculty_id uuid NOT NULL REFERENCES public.faculty(id) ON DELETE CASCADE,
  grade      text,      -- NULL = any grade
  section    text,      -- NULL = any section
  subject    text,      -- NULL = any subject
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- UNIQUE (skill_id, COALESCE(grade,''), COALESCE(section,''), COALESCE(subject,''))
```

Semantics the UI already promises the teacher:

- A skill with **no assignment rows is global** — it grounds everything.
- A skill with rows applies where **any** row matches; a NULL field in a
  row means "any" for that dimension.
- The same combination may appear on **several skills** (the teacher was
  warned, not blocked): all matching skills apply together.
- Matching is case-insensitive on `subject`; `grade`/`section` are the
  same text vocabulary the scheduler uses.

### Explicit override: `skill_ids` on the generate body

The studio composer now carries a **skills multi-select** (all selected
by default; the teacher's pick persists as their default). The wire
rule:

- **Field absent** → the teacher left everything selected. Apply the
  assignment-aware selection below.
- **`skill_ids: ["<uuid>", …]` present** → the teacher narrowed the
  pick. Use **exactly these** skills (validate each id belongs to this
  teacher and is `status = 'ready'`; silently drop ids that don't),
  skipping the assignment filter entirely — an explicit choice outranks
  the defaults.
- **`skill_ids: []`** (empty array) → the teacher switched every skill
  off. Ground the generation in **no** profile; generic output is the
  requested behaviour, not an error.

Accept the field on `POST /api/studio/generate` now; `quiz`,
`quiz-tweak` and `regenerate` can adopt it later with the same rule.

### Selection rule when `skill_ids` is absent (and for `goal-plan`)

Where you currently read the teacher's `teaching_skills` rows, replace
"all of them" with:

```
applicable(skill) :=
  skill.status = 'ready' AND (
    no rows in skill_assignments for skill.id
    OR EXISTS a row where
         (row.grade   IS NULL OR row.grade   = request.grade)
     AND (row.section IS NULL OR row.section = request.section)
     AND (row.subject IS NULL OR lower(row.subject) = lower(request.subject))
  )
```

Request context: `generate` already receives free-text prompts and
`context?`; the studio does not yet send an explicit grade/subject
picker. Until it does, derive `request.grade`/`request.subject` from the
`context` object when present and fall back to "match everything"
(i.e. treat missing request fields as NULL, which matches every row).
`goal-plan` can read grade/subject off the goal's own row and materials.

If several skills apply, concatenate their `skill_profile` texts in
`updated_at DESC` order under a header naming each skill, and cap the
total at whatever your prompt budget allows (drop oldest first).

---

## Errors

Same shapes as the rest of the studio: 401 `session_superseded`,
402 `subscription_expired`, 400 field validation, 429 with the real
reason (`quota_exhausted` vs `rate_limited`), in-band
`{"type":"error"}` after headers.

## Test plan

- `npm run db:demo` seeds two `teaching_skills` rows for the test
  account; add assignments via the UI at `/teaching-skills`.
- Interview → refine: answer 3 of 10 questions with one-line answers,
  confirm the profile does not invent content for the other 7.
- Generation: assign skill A to Grade 9 · Physics only, skill B global;
  a Grade 6 request should ground on B alone.
