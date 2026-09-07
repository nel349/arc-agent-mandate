# Agent Mandate

**An agent key that can only spend what you allowed.**

Software that does real work has to pay for things — an API call, a search, a page of data. To let
it, you hand it something unlimited: the private key to a funded wallet, or an API key with a card
behind it. Whoever holds that can move everything in reach, for as long as they hold it, and the
first sign of trouble is the balance.

This makes the key worth nothing on its own. The authority lives on chain instead — *up to $50 this
week, only to these payees* — granted from your phone with Face ID. The agent spends inside it
without asking, and cannot go past it: an over-limit payment is refused by the chain, not by the
agent's good behaviour, so a compromised agent gets no further than an honest one. Revoke it with
your face and it stops mid-task.

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

## Run it yourself

Everything below is on **Arc testnet** and nothing in it is simulated. The allowance rules are
deployed at `0x669Dd1eDb85ABD00f74186d88124614EE81E6670`; the money is test USDC, and the refusals
are real.

Two repositories are involved. This one is the **wallet and the agent's connector** — the buyer.
[`arc-maze`](../arc-maze) is a paid maze on Arc — something to buy *from*. You can stop after step 5
and have seen the whole claim; steps 6 and 7 are the fun half.

### Before you start

| | |
|---|---|
| Node | 22.6 or newer — the tests run TypeScript directly |
| Bun | only for `arc-maze` |
| Foundry | only to run the Solidity tests |
| Xcode + an iPhone or simulator | passkeys need a real Secure Enclave or a simulator with one |
| A Circle client key | free, from [console.circle.com](https://console.circle.com) → Wallets → Modular Wallets → Client Keys |

The client key is **bound to a domain**. Use the same passkey domain the app is configured with, or
Circle refuses it with `Invalid credentials` and nothing explains why.

### 1. Configure

```bash
cp .env.example .env
```

Fill in three values. They are public by design — Expo inlines them into the bundle — so they are
not secrets, but they do have to be right.

```
EXPO_PUBLIC_CIRCLE_CLIENT_URL=https://modular-sdk.circle.com/v1/rpc/w3s/buidl
EXPO_PUBLIC_CIRCLE_CLIENT_KEY=TEST_CLIENT_KEY:…
EXPO_PUBLIC_CIRCLE_PASSKEY_DOMAIN=your-passkey-domain
```

### 2. Prove the rules before touching a phone

```bash
npm install
npm run gate
```

That is the typecheck, the unit tests, the Solidity suite **against a fork of Arc with the real
Circle account and the real EntryPoint**, and the integration tests. If this passes, the mandate
engine works; everything after it is wiring.

### 3. Make a wallet

```bash
npm run ios
```

Tap **Create a Wallet** and confirm with Face ID. That is a passkey — there is no seed phrase, and
no key leaves the device.

Then fund it with test USDC from [Circle's faucet](https://faucet.circle.com), choosing **Arc
testnet**. A dollar is plenty; a step in the maze costs a tenth of a cent.

### 4. Give an agent the connector

```bash
claude mcp add arc-mandate -- node "$PWD/mcp/server.ts"
```

The server reads this repo's `.env` itself, so there are no secrets in your agent's config. Restart
the agent afterwards — an MCP server is only launched at startup.

Then ask it:

> **you:** what's your payment address?

It prints a QR code and an address. If it does not show you the QR, tell it to — the code is for
your phone's camera and is useless sitting in tool output.

### 5. Grant an allowance, and watch it bind

In the app, scan that QR (or paste the address), set an amount and a number of days, and confirm
with Face ID.

Now ask the agent to spend:

> **you:** check your allowance
> **you:** pay $0.05 to 0x0000000000000000000000000000000000000dEaD

Then ask for more than you granted. **The refusal happens during validation**, so it costs nothing —
not even gas. Revoke in the app and try again: the next payment is refused at the account level, not
by the agent agreeing to stop.

### 6. Buy something real

```bash
cd ../arc-maze
bun install
SELLER_ADDRESS=<any address you control> bun run start
```

A maze that charges by the step. Start a run and hand the agent a paid URL:

```bash
curl -s -X POST localhost:8790/game          # free, returns a run id
```

> **you:** buy http://localhost:8790/game/<run-id>/look

The agent gets a `402`, signs a payment from the escrow your mandate funded, retries, and is told
which way the walls go. `arc-maze/README.md` has the full play-through, where an agent buys the map
and solves the maze under a budget.

### 7. Check it without trusting us

Every run is replayable by a stranger, because the maze is seeded from the round id:

```bash
curl -s localhost:8790/run/<run-id>/verify
```

That rebuilds the maze and re-walks the actions, taking nothing on trust — not the ending square,
not the step count, not the amount charged.

### If something goes wrong

| | |
|---|---|
| `Invalid credentials` from Circle | the client key is bound to a different domain than `EXPO_PUBLIC_CIRCLE_PASSKEY_DOMAIN` |
| The agent says it has no allowance | it was granted to a different address — ask it for its address again; a new key is generated if none exists |
| A payment says `unsupported_network` | something is pointed at Circle's **mainnet** Gateway. Arc is testnet-only today |
| `The allowance contract is not deployed on this network` | the app is on a network other than Arc testnet |
| Payments accepted but never arriving | the fee. Arc's base fee moves between 20 and 66 gwei and an operation at the bare estimate is accepted into the mempool and never included |

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
