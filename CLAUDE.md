# Working in this repo

## Never start `fixtures/seller.ts`

It is a **fake shop** — a local web server that answers a trivial question for USDC and checks the
chain before answering. Nothing in this project uses it. Not the app, not the connector, not the
mandate, not the tests.

**Do not start it to demonstrate anything.** Not to make a payment "have a consequence", not to
show a purchase, not as setup for anything else. Start it only when a human asks for it by name.

The reason is not tidiness. A counterparty you launch yourself, on localhost, moments before
paying it, is not a counterparty — it is paying a script you control. It proves nothing that a
plain transfer does not, and to anyone watching it reads as theatre, so it costs credibility
rather than adding it. Showing a purchase is only worth doing against a service nobody here wrote.

What this project actually claims needs none of it: an allowance granted on a phone, an agent on
another machine spending inside it unattended, the chain refusing the payment that would exceed
it, and the whole thing going inert on revoke. Every one of those is visible in the wallet and on
a block explorer.

The same goes for any long-running process. Starting a server nobody asked for is a side effect,
not a step.

## Verifying things

Prefer the chain over a fork, and a measurement over an argument. Several bugs here were invisible
on a fork and obvious against live Arc — a fee too low to be included, an operation dropped in
silence, a mandate that could not spend at all. `docs/FINDINGS.md` records what the docs do not
cover; add to it when something costs you an afternoon.

`npm run gate` is the full check: typecheck, unit, contracts against a fork of Arc, integration.
Run it before a commit that touches contracts or the SDK. Do not run it after a styling change —
it cannot see a screen, and the person holding the phone is the only reviewer that can.

## Screens

`app/preview.tsx` renders every control in every state without a wallet. Use it. Several defects
here shipped because the only way to reach a state was to complete a passkey ceremony first, so
nobody had ever looked at it.
