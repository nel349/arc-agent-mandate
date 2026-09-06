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

## See it work

The allowance rules are **deployed on Arc testnet** at
`0x669Dd1eDb85ABD00f74186d88124614EE81E6670`, so nothing below is a simulation.

Grant an allowance from the app, install the connector into an agent, and the agent pays for what
it needs — bounded by the chain, refused by the chain when it asks for too much, and inert the
moment you revoke.

Point an agent at [`mcp/`](mcp/README.md), grant it an allowance from the app, and ask it to pay
for something. The wallet and any block explorer show the result; nothing else has to be running.

The parts that are already provable without any of that:

```bash
npm run gate     # 95 unit, 30 contract on a fork of Arc, 23 integration
```

## How it works

Your wallet is a **smart contract account**, not a key — Circle's Modular Wallet, built to
**ERC-6900**, which describes an account assembled from swappable pieces. Your passkey does not
own it directly; a piece called `WeightedWebauthnMultisigPlugin` does the face check on its
behalf. Payments arrive as **ERC-4337 user operations**: you sign an instruction, and the account
validates it before anything moves.

An allowance is a **session key** — a second key with limited authority, which the account checks
against rules stored on-chain. Granting one installs a piece that holds those rules: a spend cap,
a list of who may be paid, an expiry, a gas budget.

**The refusal happens during validation, not after.** An over-limit payment never reaches
execution, so it costs nothing — not even gas. And revoking removes the agent's authority at the
account level in one transaction. A cancelled card still leaves recurring charges; a rotated API
key still leaves live sessions. This leaves nothing.

### Why this did not already work on Arc

**ERC-4337 changed shape between v0.6 and v0.7.** Gas figures that used to have their own fields
were packed into single words, which changes the validation function's signature and therefore its
selector:

```solidity
userOpValidationFunction(uint8, UserOperation,       bytes32)   // v0.6
userOpValidationFunction(uint8, PackedUserOperation, bytes32)   // v0.7
```

**Circle's accounts run EntryPoint v0.7.** The only ERC-6900 session key plugin deployed on Arc is
built for **v0.6**. They cannot talk to each other, and you only discover it by trying to use both
together.

Done properly, installation fails on an interface check. The trap is the obvious shortcut around
it, which makes installation *succeed* and moves the failure to the first time an agent tries to
spend.

`contracts/src/session` is that plugin rebuilt against v0.7. The rules themselves — caps,
recipient lists, expiry — are untouched, because they were never the broken part.
[PORTING.md](contracts/src/session/PORTING.md) records every change and why.

## What's actually built

- **A phone wallet** (iOS + Android) unlocked by Face ID, sending real gasless USDC on Arc. Circle
  supports this on web, iOS and Android — **not React Native** — so the passkey ceremony is ours
  (`modules/arc-passkey`, `src/passkey`).
- **The allowance rules on-chain** (`contracts/src/session`) — spend caps, payee lists, expiry, gas
  budgets — running against Circle's real deployed account contracts.
- **A connector for agents you already run** (`mcp/`). One install line and Claude Code, Cursor or
  Codex can spend inside an allowance. The agent makes its own key, shows you a public address, and
  after you grant it finds the rest by itself — it watches for the `SessionKeyAdded` event naming
  its own address. One scan, no config file. See [mcp/README.md](mcp/README.md).
- **93 tests behind one gate.** `npm run gate` must be green before anything ships:

  | | | |
  |---|---|---|
  | `npm test` | 54 | parsing, encoding, the money type, mandate formatting |
  | `npm run test:contracts` | 26 | the allowance rules, against a fork with the plugin installed on a real Circle account |
  | `npm run test:integration` | 13 | the whole path — a signed user operation through the real EntryPoint, money moving, refusals costing nothing, revocation taking effect |

**Not built yet:** the phone screens for granting and revoking. The wallet screen is real; the
allowance is driven from the demo and the connector above, not yet from the app. Said plainly
because a judge will find out in thirty seconds anyway.

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
| `fixtures/` | a fake shop, for exercising a 402 flow by hand. Nothing uses it |
| `contracts/src/session` | the allowance rules, and `PORTING.md` on what we changed and why |
| `src/passkey/cose.ts` | the piece Circle assumes a browser did: attestation → public key |
| `src/arc/usdc.ts` | why a dollar on Arc has two decimal scales, and how that trap is closed |
