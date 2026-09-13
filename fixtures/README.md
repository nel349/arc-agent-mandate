# A fake shop, for faking a paid API

**Nothing in this project uses this.** Not the app, not the connector, not the mandate. It is not
part of any flow and must never be started as part of one — it runs when you ask for it, or not at
all.

It answers a question for USDC. Ask without paying and it replies **402 Payment Required** with a
price and an address; pay, ask again, and it answers. It reads the chain before answering, so an
unpaid request gets nothing.

Why it is not part of the demonstration: a counterparty you start yourself, on localhost, moments
earlier, is not a counterparty. It is paying a script you control — which proves nothing that a
plain transfer does not, and reads as theatre to anyone watching. Showing a purchase is only worth
it against a service you did not write.

What the product actually claims needs none of this: an allowance granted on a phone, an agent on
another machine spending inside it unattended, the chain refusing it past the limit, and the whole
thing going inert on revoke. All of that is visible in the wallet and on a block explorer.

```bash
SELLER_ADDRESS=0xYourPayee node fixtures/seller.ts
```

| | |
| --- | --- |
| `SELLER_ADDRESS` | where payment must land. Required — it decides who gets paid |
| `SELLER_PRICE` | USDC per query, default `0.05`, on the **native** rail |
| `ARC_RPC_URL` | which chain to read, default Arc testnet |
| `SELLER_PORT` | default `4021` |

`SELLER_PRICE` is parsed at 18 decimals and settlement is checked with `getBalance`, so this shop
is watching Arc's native USDC and nothing else. A payment made over the ERC-20 view — which is the
rail the app's allowance actually meters — moves real money and this seller never sees it. That is
a property of the fixture, not of the mandate; it is one more reason it is not part of any flow.

## What used to be here

A scripted buyer and a narrated walkthrough, both against a forked Arc. They were removed rather
than kept.

What they demonstrated — that a chain refuses a payment past its limit, and that revoking works —
is proven far better by the contract and integration suites, which run against the same
fork without a story wrapped around them. And what they could not demonstrate is the only part
that was ever interesting: an actual agent deciding to spend. The old `agent.ts` did not decide
anything — it was a function called `buy()`, and a script that always buys is not an agent under a
budget, it is a transfer with extra steps.

The plugin is deployed on Arc testnet now and mandates are granted from a real phone, so the
demonstration is an agent with the MCP connector installed, paying this seller on a chain anyone
can check. See `mcp/README.md`.
