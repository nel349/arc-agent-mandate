# A service that charges for what it does

`seller.mjs` is a small HTTP service that answers a question for USDC. Ask without paying and it
replies **402 Payment Required** with a price and an address; pay, ask again, and it answers.

It reads the chain before answering, so an unpaid request gets nothing. Nothing here takes the
agent's word for anything.

```bash
SELLER_ADDRESS=0xYourPayee npm run seller
```

| | |
| --- | --- |
| `SELLER_ADDRESS` | where payment must land. Required — it decides who gets paid |
| `SELLER_PRICE` | USDC per query, default `0.05` |
| `ARC_RPC_URL` | which chain to read, default Arc testnet |
| `SELLER_PORT` | default `4021` |

## What used to be here

A scripted buyer and a narrated walkthrough, both against a forked Arc. They were removed rather
than kept.

What they demonstrated — that a chain refuses a payment past its limit, and that revoking works —
is proven far better by the 30 contract tests and 23 integration tests, which run against the same
fork without a story wrapped around them. And what they could not demonstrate is the only part
that was ever interesting: an actual agent deciding to spend. `demo/agent.mjs` was a function
called `buy()`.

The plugin is deployed on Arc testnet now and mandates are granted from a real phone, so the
demonstration is an agent with the MCP connector installed, paying this seller on a chain anyone
can check. See `mcp/README.md`.
