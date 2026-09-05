# Give your coding agent an allowance

An MCP server, so the agent you already run — Claude Code, Cursor, Codex — can spend from your
wallet inside limits you set on your phone and take back with your face.

```bash
claude mcp add arc-mandate -- node /path/to/arc-agent-mandate/mcp/server.mjs
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
| `ARC_SUBMITTER_KEY` | overrides who submits; by default the agent submits its own |
| `ARC_MANDATE_KEY_PATH` | where the agent's key lives (default `~/.arc-mandate/agent.key`) |

## Why the agent needs a small float, and why that is the right trade

The agent submits its own operations over a plain RPC. It fronts the transaction gas and the
account reimburses it, so the float drains slowly — **measured at ~0.0014 USDC per payment, about
700 payments per dollar.** The grant sends this float, so one Face ID both authorises the agent
and funds it.

The alternative was Circle's bundler, and its paymaster **will** sponsor an agent's spend — we
checked. It was rejected on developer experience rather than capability: reaching it needs the
app's `CIRCLE_CLIENT_KEY` plus an `X-AppInfo` header matching the registered passkey domain. That
is the wallet vendor's credential, and an agent should not need it to spend an allowance it was
already granted. Arc's own RPC does not bundle, so there was no third door.

The float is also the right security shape. It is the agent's own money: if the agent is
compromised, the attacker gets a dollar of gas and whatever the mandate still allows — never the
wallet.
