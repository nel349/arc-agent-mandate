# Agent Mandate

**Give an AI agent an allowance instead of your credit card.**

Software is starting to buy things for us — data, API calls, compute. Today you either hand an
agent your card and hope, or approve every purchase yourself, which defeats the point of having
one. This gives it an allowance instead: *up to $50 this week, only to these payees*. The agent
spends inside that on its own, and it cannot go over — not because it behaves, but because the
money refuses. Revoke it with your face and it stops instantly.

## Why we built it

We wanted to build something real on Arc and find out what it takes. It turned out to take more
than expected: session keys are listed as priority infrastructure but the only one deployed on Arc
cannot serve a Circle wallet, and Circle's wallets do not reach React Native at all — so a phone
app on a chain whose whole argument is that dollars are the currency was not buildable without
closing both gaps first.

So we closed them, and the app is what proves they are closed. The allowance is a genuine product
and we would ship it; the port and the passkey bridge are the parts anyone else can pick up, and
[docs/FINDINGS.md](docs/FINDINGS.md) is what we would have wanted to read before starting.

That is the intent here — **contribute the plumbing, and use the product to show it works.**

## See it work in 30 seconds

```bash
npm install && npm run demo
```

That forks Arc, deploys the allowance rules, grants a $50-wallet an agent a **$10** mandate, and
runs an agent that buys research data from a service charging $2 a query:

```
═══ THE AGENT GETS ON WITH IT ════════════════════════════════════
  paid 2 USDC  →  ACME Corp 10-K: revenue $412M, up 8% YoY…
  paid 2 USDC  →  Globex Inc 10-Q: revenue $88M, down 2% QoQ…
  paid 2 USDC  →  Initech 8-K: CFO departure announced…
    wallet 493.99   seller 6      ← nobody approved any of that

═══ THE AGENT TRIES TO OVERSPEND ═════════════════════════════════
  refused at 12 USDC — the mandate was 10
    wallet 489.99   seller 10     ← 490 USDC it could never touch

═══ THE HUMAN REVOKES ════════════════════════════════════════════
  the agent still holds its key, and can no longer spend a cent
```

The wallet holds **500** and the mandate is **10**. That gap is the whole point: the agent is
stopped by the *rule*, not by running out of money.

Requires [Foundry](https://book.getfoundry.sh/getting-started/installation) and Node 22+. It runs
against a local fork, so it costs nothing and needs no keys.

## Why it's not just a spending limit in an app

The limit is enforced by the account itself, on-chain, in the same moment the payment is
validated. There is no server to ask, no company to trust, and no code path where a compromised
agent gets a second chance. Over-limit payments are refused during validation, so they never
even cost gas.

And revoking is complete. A card you cancel leaves recurring charges; an API key you rotate
leaves sessions open. Revoking a mandate removes the agent's authority at the account level, in
one transaction, with nothing left behind.

## What's actually built

- **A phone wallet** (iOS + Android) unlocked by Face ID, sending real gasless USDC on Arc.
  Circle supports this on web, iOS and Android — **not React Native** — so the passkey bridge is
  ours (`modules/arc-passkey`, `src/passkey`).
- **The allowance rules on-chain** (`contracts/src/session`) — spend caps, payee lists, expiry,
  gas budgets — running against Circle's real deployed account contracts.
- **73 tests behind one gate.** `npm run gate` must be green before anything ships:

  | | | |
  |---|---|---|
  | `npm test` | 34 | parsing, encoding, the money type |
  | `npm run test:contracts` | 26 | the allowance rules, against a fork with the plugin installed on a real Circle account |
  | `npm run test:integration` | 13 | the whole path — a signed user operation through the real EntryPoint, money moving, refusals costing nothing, revocation taking effect |

**Not built yet:** the phone screens for granting and revoking. The wallet screen is real; the
mandate flow is driven from the demo above, not from the app. Said plainly because a judge will
find out in thirty seconds anyway.

## Why Arc

On most chains a dollar is a token contract, so a spending limit means parsing calldata and
hoping you recognised the transfer. On Arc **the dollar is the currency itself**, so "never more
than $50" is a rule the network checks directly on the value field.

That also decided the design: the mandate is denominated in native USDC and the ERC-20 view is
closed to agents — because `approve` creates an allowance that lives in the token contract and
**survives revocation**, which would quietly break the one promise the product makes.

## What this contributes to Arc

Two pieces outlive the demo, and both fill gaps Arc's own docs make visible: **session keys that
work with Circle Modular Wallets** (the one deployed on Arc is EntryPoint v0.6 against Circle's
v0.7 — it installs, then reverts at first use), and **Circle wallets on React Native** (App Kit is
web-only; `docs.arc.io/integrate` lists no mobile SDK).

- [docs/CONTRIBUTION.md](docs/CONTRIBUTION.md) — what we built for the ecosystem and why
- [docs/FINDINGS.md](docs/FINDINGS.md) — five things building on Arc taught us that the docs don't
  cover, including a dual-decimal USDC trap that can read a funded account as empty

## Where to look

| | |
|---|---|
| `demo/` | the runnable story above — seller, agent, narrative |
| `contracts/src/session` | the allowance rules, and `PORTING.md` on what we changed and why |
| `src/passkey/cose.ts` | the piece Circle assumes a browser did: attestation → public key |
| `src/arc/usdc.ts` | why a dollar on Arc has two decimal scales, and how that trap is closed |
