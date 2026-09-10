# Open for the backend team

Four items. Everything else on this list has shipped or been struck —
re-probed 2026-09-10 against `5c3e575`. Our own work is in
[../our-side.md](../our-side.md).

| # | Item | Blocked on |
|---|---|---|
| 1 | **`POST /api/studio/agent`** — needs tool calling, which today's four-provider rotation doesn't do | **Us.** What happens when a tool-calling request lands on a provider that doesn't support it. Same answer unblocks chat's tool half |
| 2 | **Student invites** | **The owner.** Held until a Brevo sender is validated — until then Brevo answers 201 and drops the mail, so building it earlier hides the failure |
| 3 | **Set `STRIPE_PRICE_PRO_MONTHLY` / `_ANNUAL` in Render** | **The owner** creating the recurring prices in Stripe. No code change — `/checkout` correctly answers `503` until then |
| 4 | **Confirm the `rk_live_…` key mode** | **You**, to answer. It's live money — deliberate, or switch to a test key while the UI is wired? |

Nothing else is waiting on you. Expect small contract corrections on
`regenerate`, `quiz-tweak`, `onboarding/parse` and `chat` when we wire
them — their shapes were read off the pre-rebuild frontend, which this
repo no longer has.
