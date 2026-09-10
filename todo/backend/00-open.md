# Open for the backend team

Re-verified 2026-09-10 by probe against the live service.

| # | Item | State |
|---|---|---|
| 1 | **`POST /api/studio/agent`** | ✅ **Built** — now 401 (was 404), control paths still 404. See the note below: we never sent the tool-calling answer it was waiting on, so confirm what it does on a provider that can't do function calling |
| 2 | **Student invites** | ⏸ **Not built** — no route at any candidate path, no invite table. Correct if still deliberately held on the sender; flagging only so it isn't assumed done |
| 3 | **`STRIPE_PRICE_PRO_MONTHLY` / `_ANNUAL` in Render** | ❓ **Unverified** — can't be checked from outside (see below) |
| 4 | **Confirm the `rk_live_…` key mode** | ❓ **Unanswered** — still live money |

## Why 3 and 4 can't be verified by probe

`/api/billing/checkout` and `/portal` are correctly auth-gated (401
without a token) and the service exposes no configuration anywhere —
`/` and `/healthz` return service name and uptime only, which is right.

So telling `503 price_not_configured` from a working checkout needs an
**authenticated** call. On an `rk_live_…` key that creates a real Stripe
Checkout Session against live payment infrastructure. Not doing that
without a deliberate go-ahead, especially while item 4 is the open
question. Either:

- confirm in the Stripe dashboard that the two recurring prices exist
  and their ids match what's set in Render, or
- say the word and we'll run one authenticated checkout against a test
  key once item 4 is settled.

## On the agent route shipping

Its blocker was a question we owed you: what happens when a request
needs tool calling and the four-provider rotation lands on a provider
that doesn't support it (Groq does, NVIDIA varies, OmniRoute depends on
what it fronts). We never sent an answer, so whatever it does now is a
choice made without us.

Not a complaint if it's a reasonable default — just tell us which:
restrict tool requests to capable providers, degrade to a no-tools
answer, or fail and retry elsewhere. A teacher hitting the third
behaviour unknowingly is the one that reads as a broken product rather
than a busy one. Same answer still governs chat's tool half.
