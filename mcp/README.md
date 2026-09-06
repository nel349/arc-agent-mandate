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
| `CIRCLE_CLIENT_URL`, `CIRCLE_CLIENT_KEY`, `CIRCLE_PASSKEY_DOMAIN` | the bundler the agent submits through. Arc has no public bundler, so without these a payment cannot be sent |
| `ARC_MANDATE_KEY_PATH` | where the agent's key lives (default `~/.arc-mandate/agent.key`) |

## Installing it

Once, from this directory:

```bash
claude mcp add arc-mandate node "$PWD/mcp/server.mjs"
```

Then restart the client — MCP servers are launched at startup.

Nothing secret goes in the config. The server reads this project's `.env` itself, so the path is
the only thing the client needs. For Claude Desktop, the same two fields go into
`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{ "mcpServers": { "arc-mandate": { "command": "node", "args": ["/absolute/path/to/mcp/server.mjs"] } } }
```

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
