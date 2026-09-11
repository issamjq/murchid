# Open for the backend team

Verified 2026-09-11 against the live database. Our side is in
[../our-side.md](../our-side.md).

## ⚠️ Bug 1 has recurred on the two newest routes

**`chat` and `studio_agent` meter at zero.** Neither is in
`feature_costs` (it holds nine features; neither is one of them), and
every ledger row they've written carries `credits = 0`:

| feature | rows | tokens | charged |
|---|---|---|---|
| `chat` | 18 | 107,864 | **0** |
| `studio_agent` | 6 | 25,844 | **0** |

That's 133,708 tokens across 24 turns, free. `chat` is the **single
largest token consumer** in the recent window — more than any generation
feature — and the ledger says it costs nothing.

This is the same shape as the bug just fixed: *"the ledger had rows and
looked entirely healthy while being blind to the busiest path."* It
matters more here, because the whole point of the current exercise is
**sizing an allowance off the ledger** — and an allowance derived from a
ledger blind to chat and agent will be systematically wrong. Free users
would also get unlimited assistant use the moment enforcement lands.

Worth deciding rather than defaulting: a conversational turn isn't a
document, so the per-document price list may be the wrong model — a
per-turn price near the `report_comment` end (0.1–0.2) looks closer to
the measured ~6k tokens/turn than either 0 or 1. Note the agent's
`start_generation` already charges correctly via `/generate`; it's only
the conversation itself that's free.

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

## Verified fixed

All three metering fixes confirmed against the live database:
`credit_ledger.credits` is `numeric` (139.4 total, so fractions record
end to end), `feature_costs` carries all nine features with
`report_comment`/`parent_update` at 0.2, and the ledger grew 108 → 135
rows once `/generate` started metering.

**Your verification data is gone, though** — all three `goals` and all
21 `goal_items` have been deleted (test cleanup, presumably). The FK is
`ON DELETE SET NULL`, so that correctly nulled `goal_id` on every ledger
row rather than corrupting anything. But plan-level attribution can no
longer be re-derived, including the 3 × 9-credit evidence and the placed
term plan. Worth re-creating one plan if any of it still needs proving.

## Still open

| # | Item | Blocked on |
|---|---|---|
| 1 | **Student invites** | Sender is set to `dev.mjq@gmail.com`, but confirm it's *validated* in Brevo — and it can't be the production sender. A `gmail.com` From address can't carry SPF/DKIM for a domain nobody owns, so Brevo-sent mail fails DMARC alignment and gets spam-foldered under Google/Yahoo's 2024 rules. Brevo still answers 201. Needs `invites@murchid.com` with domain authentication |
| 2 | **`POST /api/billing/plans`** | The owner deciding what Pro actually includes |
| 3 | **`STRIPE_PRICE_PRO_MONTHLY` / `_ANNUAL` in Render** | The owner creating the recurring prices in Stripe |
| 4 | **Confirm the `rk_live_…` key mode** | You, to answer. Still live money |
| 5 | **`goal_days`** — resurrect, or read `goal_items.scheduled_for`? | Us. Answer below |
| 6 | **Price `chat` and `studio_agent`** | The owner, on the note above — then it's one row each in `feature_costs` |

**On `goal_days`:** our read is **don't resurrect it.** It was never
created by any tracked migration, `goal_items.scheduled_for` is already
the thing the placement path writes and the calendar reads, and a real
placed plan proved it works end to end before that test data was
deleted — 7 items dated, zero weekend, order intact, verified
2026-09-10. Reviving a table nothing has written since the rebuild
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
