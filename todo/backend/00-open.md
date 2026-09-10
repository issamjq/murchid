# Open for the backend team

Verified 2026-09-10 against `8737eec`. Our side is in
[../our-side.md](../our-side.md).

## Answers you asked for

- **`GET /api/images/:id` — strike it.** Nothing in the rebuilt frontend
  expects it. Don't carry the spec.
- **`POST /api/corpus/search` — strike it.** Grounding injects
  server-side; nothing will call it.
- **`navigate`'s allowlist is correct.** We checked all 21 paths against
  the running app: 7 sidebar entries and 14 class tabs, all real.
  `roadmap` is the one worth knowing about — it lives in the `(admin)`
  route group, but the URL really is `/roadmap` and the teacher sidebar
  links to it, so keep it.
- **We'll tell you when the IA moves.** Agreed it's a one-line change on
  your side and a dead end for a teacher if it goes stale.

## Still open

| # | Item | Blocked on |
|---|---|---|
| 1 | **Student invites** | Sender is set to `dev.mjq@gmail.com`, but confirm it's *validated* in Brevo — and it can't be the production sender. A `gmail.com` From address can't carry SPF/DKIM for a domain nobody owns, so Brevo-sent mail fails DMARC alignment and gets spam-foldered under Google/Yahoo's 2024 rules. Brevo still answers 201. Needs `invites@murchid.com` with domain authentication |
| 2 | **`POST /api/billing/plans`** | The owner deciding what Pro actually includes |
| 3 | **`STRIPE_PRICE_PRO_MONTHLY` / `_ANNUAL` in Render** | The owner creating the recurring prices in Stripe |
| 4 | **Confirm the `rk_live_…` key mode** | You, to answer. Still live money |
| 5 | **`goal_days`** — resurrect, or read `goal_items.scheduled_for`? | Us. Answer below |

**On `goal_days`:** our read is **don't resurrect it.** It was never
created by any tracked migration, `goal_items.scheduled_for` is already
the thing the placement path writes and the calendar reads, and the one
placed plan proves it works end to end — 7 items dated, zero weekend,
order intact. Reviving a table nothing has written since the rebuild
would add a second source of truth for the same fact. Tell us if that
breaks something on your side we can't see; otherwise treat it as
settled and wire the last of the planner against `scheduled_for`.

## Two things worth saying

- **The tool-calling answer is better than the question deserved.**
  Testing all five providers with live calls rather than reading docs,
  then filtering the rotation on `supports_tools` and answering
  `503 NO_TOOL_PROVIDER` when none is reachable, is the option we'd have
  picked — consistent behaviour, and a failure that's distinguishable
  from a bad request so we can degrade instead of blind-retrying.
- **The IA drift you caught is the more useful find.** Twelve of
  thirteen paths 404ing while the *nouns* were all correct is exactly
  the failure that reads as plausible in review. Deriving both the tool
  and the guide from the running app is the right fix.
