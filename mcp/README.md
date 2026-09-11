# Give your coding agent an allowance

An MCP server, so the agent you already run — Claude Code, Cursor, Codex — can spend from your
wallet inside limits you set on your phone and take back with your face.

```bash
git clone https://github.com/nel349/arc-agent-mandate && cd arc-agent-mandate && npm install
claude mcp add arc-mandate -s user -- node "$PWD/mcp/server.ts"
```

Then, in the agent:

> **you:** what's your payment address?
> **agent:** *(calls `get_pairing_address`)* → a QR code, with `0x1f94…F107` under it
>
> — you grant it $10 in the app, with Face ID —
>
> **you:** buy me the ACME filings
> **agent:** *(calls `pay`)* → paid $2. Remaining: $8.

## How pairing works, and why it is one step

The agent generates its own key on first run and **never sends it anywhere**. A mandate is granted
to an *address*, so only a public value moves, and only from the agent to you.

Granting needs nothing but that address, and the address is public, so the agent does not take the
first grant it finds. Its code also carries a one-time pairing code, and the app writes a hash of
it into the grant. After you grant, the agent asks the chain for the `SessionKeyAdded` event naming
its own address and carrying its code. Both are indexed in the event, which is what makes a single
scan enough: no second round trip, no config file, and no copy-paste back.

A grant made any other way, by a stranger or from an address typed on its own, carries no code the
agent is waiting for, and is not used. The first grant carrying a code wins, so a copy made after
yours cannot take its place. Every answer about spending names the wallet it comes from, so you can
match it to the app. To move the agent to another wallet, ask it for its code again and scan it from
that wallet. The code is also saved as `pairing-code.png` beside the agent's key.

## Tools

| | |
|---|---|
| `get_pairing_address` | the code to grant to: a QR carrying the agent's address and a one-time pairing code, for the app to scan, also saved as an image. Says which wallet the agent spends from, if one is paired |
| `check_allowance` | limit, spent, remaining and what is spendable now, read from the chain, and the agent's ERC-8004 identity, which it sets up the first time for each wallet |
| `pay` | send USDC to an address, within the allowance |
| `buy` | fetch a URL and pay if it answers `402 Payment Required` (x402), topping up the agent's escrow from the allowance when it has to |
| `top_up` | move money into the agent's escrow ahead of a run of small purchases; it counts against the same allowance |

The agent cannot exceed the allowance or keep spending after you revoke, and an allowance that
names payees cannot pay anyone else. Nor can it touch anything else in your wallet: every allowance
is an allowlist naming the three things an agent does, paying in USDC, filling its escrow at
Circle's Gateway, and setting up its own identity, so your other tokens and NFTs are out of its
reach. None of that is enforced here: the account enforces it. A
revoked or expired allowance is refused during validation, before anything runs. On the one-meter
allowance the app grants, an over-limit payment is refused when it runs instead: no money moves,
and the gas is Circle's sponsorship. This connector checks the limit before sending, so only a
connector that skipped the check reaches that refusal.

## The agent's identity

A seller that rewards agents, like the maze, credits an ERC-8004 identity and gives its badge to the
identity's owner. So the first time `check_allowance` runs for a wallet, the agent sets one up: it
registers an identity from your wallet, which therefore owns it, and links its own key to it with
its own signature. That is two operations, sponsored like its payments, and neither moves money.
The allowance names exactly those two calls on the registry, and not the ones that would move an
identity.

`check_allowance` then reports the identity's number, and the agent gives it wherever a seller asks
for an agent id: for the maze, `POST /game?agent=<id>`. What the agent earns is written to that
identity, and the badge goes to your wallet. Pair the agent with another wallet and it sets up
another identity, owned by that one.

## Configuration

| | |
|---|---|
| `ARC_RPC_URL` | defaults to Arc testnet |
| `ARC_SESSION_KEY_PLUGIN` | the mandate plugin |
| `CIRCLE_CLIENT_URL`, `CIRCLE_CLIENT_KEY`, `CIRCLE_PASSKEY_DOMAIN` | the bundler the agent submits through. Arc has no public bundler, so without these a payment cannot be sent |
| `ARC_MANDATE_KEY_PATH` | where the agent's key lives (default `~/.arc-mandate/agent.key`). The code image is saved beside it |
| `ARC_ACCOUNT` | a wallet to spend from without pairing, for a connector you point at your own wallet by hand. Still checked against the chain before every use |

## Installing it

From a clone of this repository, which is how it installs today:

```bash
cd /path/to/arc-agent-mandate
claude mcp add arc-mandate -s user -- node "$PWD/mcp/server.ts"
claude mcp list | grep arc-mandate      # confirm the path; $PWD is your shell's, not ours
```

The server reads this project's `.env` on its own, so nothing secret goes into your client's
config. Restart the client afterwards: MCP servers are launched at startup.

Without `-s user` this lands in local scope, which is bound to the directory you ran it in and
shadows every other scope. A wrong path here surfaces later as `CONNECTION_CLOSED` and names
nothing, so it is worth the one extra line to check.

### Once the package is published

The connector is packaged as `@kuiralabs/arc-mandate` but is not on npm yet, so this answers 404
until it is. Then it installs without a clone, with the values in the client's config:

```bash
claude mcp add-json arc-mandate '{
  "command": "npx", "args": ["-y", "@kuiralabs/arc-mandate"],
  "env": {
    "CIRCLE_CLIENT_URL": "https://modular-sdk.circle.com/v1/rpc/w3s/buidl",
    "CIRCLE_CLIENT_KEY": "TEST_CLIENT_KEY:…",
    "CIRCLE_PASSKEY_DOMAIN": "your-passkey-domain"
  } }'
```

### Why you bring your own key

Arc has no public bundler. Circle's is the only way to get a user operation on chain, and their
Gas Station is what pays the gas so that neither you nor the agent has to — which means somebody's
account is paying, and for a developer tool that is yours.

Shipping a key in the package would make this install a single line with nothing to configure. It
would also mean every user's gas came out of one policy, which is a bill rather than a design. The
honest version of a tool at this stage is that you bring your own; the version that hides the key
is a service, and a service charges for it up front.

**You do not need it to start.** Pairing and reading an allowance use a public RPC and work with no
configuration at all. The first time you try to *pay*, the connector explains exactly what to do —
it does not simply fail with the names of three environment variables.

That is the whole developer setup. Everything after it is scanning.

## Using it

Ask the agent for its address. It prints a code, and saves it as an image beside its key.

Scan the code in the app, choose an amount and how long it lasts, confirm with Face ID.

That is the whole thing. From then on the agent spends inside the allowance without asking, and
cannot spend outside it however it is asked — not because it is well behaved, but because the
account refuses.

## Why the agent holds nothing

An allowance is authority, not a balance. An agent that keeps even a fraction of a dollar has
broken that promise, and a person who sees money trickle out to agents will not trust the
mechanism however small the trickle is.

That rules out having the agent submit for itself. A user operation travels inside an ordinary
transaction, and a transaction's sender must hold a balance before it can send one — so a
self-submitting agent has to be funded first and is left with dust afterwards, which nothing ever
returns. The account has no claim on it; only the agent's own key can send it back.

So the agent hands its operations to a bundler. On Arc there is exactly one — Circle's — and that
is checked rather than assumed: Arc's public RPC answers `eth_supportedEntryPoints` with "method
not supported", while Circle's returns EntryPoint v0.7.

**The credential that needs is not a secret.** It is the same client key the mobile app already
ships inside its bundle, bound to a passkey domain, and it authorises nothing by itself: a spend
still requires a session-key signature the mandate permits. Handing it to the agent gives away no
authority, which is what makes this a better trade than leaving money behind.

The paymaster then covers the operation, so the **account** pays no gas either. That closes a
second problem which is easy to miss: submitting directly, the account was billed for everything
the agent did and the mandate never counted it, because the spend limit bounds `call.value` and
gas is not `call.value`. An agent could send a trivial amount inside an expensive operation and
cost the account far more than its allowance. Sponsored, there is nothing to bill.

The security shape is unchanged and simpler to state: a compromised agent gets whatever the
mandate still allows, and nothing else — no float, no wallet.
