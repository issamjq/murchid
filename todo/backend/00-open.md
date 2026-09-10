# Open for the backend team

Four items. Everything else on this list has shipped or been struck —
re-probed 2026-09-10 against `5c3e575`. Our own work is in
[../our-side.md](../our-side.md).

| # | Item | Blocked on |
|---|---|---|
| 1 | **`POST /api/studio/agent`** — needs tool calling, which today's four-provider rotation doesn't do | **Us.** What happens when a tool-calling request lands on a provider that doesn't support it. Same answer unblocks chat's tool half |
| 2 | **Student invites** | **Sender set to `dev.mjq@gmail.com`** (2026-09-10). Confirm it's actually *validated* in Brevo, not just entered — an unvalidated sender still gets a silent 201. Fine for testing, but see the note below before invites reach real students |
| 3 | **Set `STRIPE_PRICE_PRO_MONTHLY` / `_ANNUAL` in Render** | **The owner** creating the recurring prices in Stripe. No code change — `/checkout` correctly answers `503` until then |
| 4 | **Confirm the `rk_live_…` key mode** | **You**, to answer. It's live money — deliberate, or switch to a test key while the UI is wired? |

Nothing else is waiting on you. Expect small contract corrections on
`regenerate`, `quiz-tweak`, `onboarding/parse` and `chat` when we wire
them — their shapes were read off the pre-rebuild frontend, which this
repo no longer has.

## On the invite sender

`dev.mjq@gmail.com` will validate and send, but it swaps one silent
failure for another once real students are on the receiving end.

Nobody can publish SPF or DKIM records for `gmail.com` — we don't own
the domain — so mail sent through Brevo authenticates *Brevo's* domain
while the From address says `gmail.com`. That's a DMARC alignment
failure, and since Google and Yahoo's 2024 bulk-sender rules, unaligned
mail from a `gmail.com` From address routinely lands in spam or is
rejected outright. Brevo still answers 201. The teacher sees an invite
sent; the student never sees it.

**For production, send from a domain we control** — `murchid.com`, with
Brevo domain authentication (its SPF/DKIM records added to the
`murchid.com` DNS): `invites@murchid.com` or `noreply@murchid.com`.
That's the setup that actually reaches an inbox.

Keep `dev.mjq@gmail.com` for testing if it's useful — just don't let
the invite loop ship on it.
