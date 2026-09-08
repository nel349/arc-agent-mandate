# Give your coding agent an allowance

An MCP server, so the agent you already run — Claude Code, Cursor, Codex — can spend from your
wallet inside limits you set on your phone and take back with your face.

```bash
claude mcp add arc-mandate -- node /path/to/arc-agent-mandate/mcp/server.ts
```

Then, in the agent:

> **you:** what's your payment address?
> **agent:** *(calls `get_pairing_address`)* → `0x1f94…F107`
>
> — you grant it $10 in the app, with Face ID —
>
> **you:** buy me the ACME filings
> **agent:** *(calls `pay`)* → paid $2. Remaining: $8.

## How pairing works, and why it is one step

The agent generates its own key on first run and **never sends it anywhere**. A mandate is granted
to an *address*, so only a public value moves, and only from the agent to you.

After you grant, the agent finds the rest by itself: it watches for `SessionKeyAdded` naming its
own address, which tells it which account authorised it. That argument is indexed in the event,
which is what makes a single scan enough — there is no second round trip, no config file, and no
copy-paste back.

## Tools

| | |
|---|---|
| `get_pairing_address` | the address to grant to |
| `check_allowance` | limit, spent, remaining — read from the chain |
| `pay` | send USDC within the allowance |

The agent cannot exceed the allowance, pay someone it was not granted, or keep spending after you
revoke. None of that is enforced here — it is enforced by the account, during validation, so a
refused payment never even costs gas.

## Configuration

| | |
|---|---|
| `ARC_RPC_URL` | defaults to Arc testnet |
| `ARC_SESSION_KEY_PLUGIN` | the mandate plugin |
| `ARC_PLUGIN_FROM_BLOCK` | the plugin's deployment block. **Set this** — without it the agent only searches recent history, because `eth_getLogs` is capped at 10,000 blocks and scanning past the floor gets the whole lookup rate-limited |
| `CIRCLE_CLIENT_URL`, `CIRCLE_CLIENT_KEY`, `CIRCLE_PASSKEY_DOMAIN` | the bundler the agent submits through. Arc has no public bundler, so without these a payment cannot be sent |
| `ARC_MANDATE_KEY_PATH` | where the agent's key lives (default `~/.arc-mandate/agent.key`) |

## Installing it

```bash
claude mcp add-json arc-mandate '{
  "command": "npx", "args": ["-y", "@kuiralabs/arc-mandate"],
  "env": {
    "CIRCLE_CLIENT_URL": "https://modular-sdk.circle.com/v1/rpc/w3s/buidl",
    "CIRCLE_CLIENT_KEY": "TEST_CLIENT_KEY:…",
    "CIRCLE_PASSKEY_DOMAIN": "your-passkey-domain"
  } }'
```

Restart the client afterwards — MCP servers are launched at startup.

Working in this repo instead of installing the package? Point it at the file and drop the `env`
block; the server reads this project's `.env` on its own:

```bash
cd /path/to/arc-agent-mandate
claude mcp add arc-mandate -s user -- node "$PWD/mcp/server.ts"
claude mcp list | grep arc-mandate      # confirm the path; $PWD is your shell's, not ours
```

Without `-s user` this lands in local scope, which is bound to the directory you ran it in and
shadows every other scope. A wrong path here surfaces later as `CONNECTION_CLOSED` and names
nothing, so it is worth the one extra line to check.

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

Ask the agent for its address. It prints a code.

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
