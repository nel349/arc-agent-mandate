<p align="center">
  <img src="brand/mark.svg" alt="" width="132" height="132">
</p>

<h1 align="center">Agent Mandate</h1>

<p align="center">
  <strong>An agent key that can only spend what you allowed.</strong><br>
  <sub>The full circle is the limit. The drawn part is what is gone.<br>
  That is the mark, and it is also the whole product.</sub>
</p>

<p align="center">
  <code>Arc testnet · 5042002</code> &nbsp;·&nbsp;
  <code>Expo SDK 54 · iOS + Android</code> &nbsp;·&nbsp;
  <code>MIT, plugin GPL-3.0-or-later</code>
</p>

---

To let an agent pay for things you hand it something unlimited: a funded wallet's private key, or an
API key with a card behind it. Whoever holds that can move everything in reach, for as long as they
hold it, and the first sign of trouble is the balance.

This makes the key worth nothing on its own. The authority lives on chain instead — *up to $50,
until Friday* — granted from your phone with Face ID. The agent spends inside it without asking, and
**an over-limit payment is refused by the chain rather than by the agent's good behaviour**, so a
compromised agent gets no further than an honest one. Revoke with your face and it stops mid-task.

<p align="center">
  <a href="docs/ARCHITECTURE.md"><strong>How it works, in one diagram →</strong></a><br>
  <sub>Ten steps and three layers, every contract it touches on Arc testnet,<br>
  and what is deployed against what is only simulated.</sub>
</p>

## Quickstart

Needs Node 22.18+, [Foundry](https://getfoundry.sh), Xcode, and a free
[Circle client key](https://console.circle.com). Full list and the reasons behind each:
**[docs/RUN.md](docs/RUN.md)**.

```bash
git clone https://github.com/nel349/arc-agent-mandate && cd arc-agent-mandate
cp .env.example .env        # six Circle values — app and connector — plus two optional endpoints
npm install                 # also fetches five contract submodules
npm run gate                # typecheck, unit, contracts on a fork, integration
```

`npm run gate` proves the mandate engine against **a fork of Arc with the real Circle account and
the real EntryPoint** — before a phone is involved. Everything after it is wiring.

```bash
npm run ios                 # tap "Create a wallet", confirm with Face ID
```

Then give the agent you already run a connector, and a spending limit:

```bash
claude mcp add arc-mandate -s user -- node "$PWD/mcp/server.ts"
```

> **you:** what's your payment address?
> **agent:** *(shows a QR)* — you scan it in the app, set $10 and a week, confirm with Face ID
> **you:** solve the maze at https://arc-maze.vercel.app/ and spend as little as you can

The agent pays per step, the app shows each payment as it lands, and asking for more than you
granted is refused by the account. **[docs/RUN.md](docs/RUN.md)** walks all seven steps, including
the ones that bite.

### In a browser

The same app runs on mobile web, with the browser's own passkeys in place of the native module:

```bash
npm run web:export -- --to ../kuiralabs.github.io   # built from a commit, into the site's mandate/
```

A passkey belongs to a domain, so the page has to be served from the passkey domain your Circle
client key is bound to, over HTTPS. The script refuses a working tree with changes, writes
`BUILD.json` naming the commit, and writes the site's `404.html` so a reload on an inner screen
still opens the app. Live at https://kuiralabs.github.io/mandate/.

## What's built

- **A phone wallet** (iOS + Android) unlocked by Face ID, sending gasless USDC on Arc. Circle
  supports passkey wallets on web, iOS and Android — **not React Native** — so the ceremony is ours:
  `modules/arc-passkey`, `src/passkey`.
- **The allowance, on chain** — `contracts/src/session`, a port of Alchemy's ERC-6900 session-key
  plugin from EntryPoint v0.6 to v0.7, because the one deployed on Arc cannot serve a Circle wallet.
  Live at `0x669Dd1eDb85ABD00f74186d88124614EE81E6670` — every address is in
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **A connector for agents you already run** — `mcp/`. One line, and Claude Code, Cursor or Codex
  spends inside the allowance. Pairing is one QR scan with no config file and no server.
- **One gate.** `npm run gate` is typecheck, unit tests, the Solidity suite on a fork, and
  integration against Circle's live facilitator.

## Reference

| | |
|---|---|
| **[docs/RUN.md](docs/RUN.md)** | prerequisites, the seven steps end to end, and what to do when it breaks |
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | the diagram, the smart account, the session key, what the chain refuses and when, why Arc, and every address |
| **[docs/FINDINGS.md](docs/FINDINGS.md)** | thirteen things building on Arc taught us that the docs don't cover |
| **[docs/CONTRIBUTION.md](docs/CONTRIBUTION.md)** | what this contributes, and where it sits among the standards |
| [mcp/README.md](mcp/README.md) | the connector: its five tools, how pairing binds, configuration |
| [contracts/src/session/PORTING.md](contracts/src/session/PORTING.md) | every change from the v0.6 plugin, and why |
| [LICENSING.md](LICENSING.md) | MIT, except the plugin and one vendored file |
| [docs/TESTFLIGHT.md](docs/TESTFLIGHT.md) | what App Store Connect asks for, answered |
| [brand/README.md](brand/README.md) | the mark, generated from the app's own tokens |

Where to look in the code:

| | |
|---|---|
| `src/arc/mandate.ts` | granting, reading and revoking an allowance |
| `src/arc/usdc.ts` | why a dollar on Arc has two decimal scales, and how that trap is closed |
| `src/passkey/cose.ts` | the piece Circle assumes a browser did: attestation → public key |
| `mcp/server.ts` | the five tools an agent gets |
| `fixtures/` | a fake shop for exercising a 402 by hand. Nothing else uses it |

The companion seller is **[arc-maze](https://github.com/nel349/arc-maze)** — a maze that charges by
the step and pays out ERC-8004 reputation, which is what the agent above is buying from.
