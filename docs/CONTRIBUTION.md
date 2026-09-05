# What this contributes to Arc

The app is the demo. These are the pieces that outlive it, and both fill gaps that Arc's own
documentation makes visible.

## 1. Session keys that actually work with Circle Modular Wallets

`docs.arc.io/build` lists session keys among the account-abstraction primitives Arc wants
developers using. Today, on Arc, you cannot give a Circle smart account one.

A Circle Modular Wallet is an **ERC-6900** account: a contract assembled from swappable pieces,
where even the passkey check is delegated to one of them. Payments arrive as **ERC-4337 user
operations**, which the account validates before anything moves. A session key is a piece that
holds rules — a spend cap, who may be paid, an expiry — and checks each payment against them.

The piece exists. Alchemy wrote a good one and it is deployed on Arc. But **ERC-4337 changed shape
between v0.6 and v0.7**: gas figures were packed into single words, which changed the signature of
the validation function and therefore its selector. Circle's accounts run **EntryPoint v0.7**; the
deployed plugin is **v0.6**. They cannot talk, and the failure is quiet — the obvious way around
the version check makes installation succeed and moves the break to the first attempted payment.

`contracts/src/session` is that plugin rebuilt against Circle's v0.7 interfaces: `PackedUserOperation`
throughout, and gas accounting redone against v0.7's explicit paymaster fields rather than v0.6's
approximation — a change Alchemy's own comment asked for. The permission engine is untouched,
because it was never the broken part. GPL-3.0, as the original is, with every deviation in
`PORTING.md` so it can be reviewed rather than trusted.

**Proof, not claims:** 26 contract tests run against a fork of Arc with the plugin installed on a
real Circle account, its real WebAuthn owner plugin and the real EntryPoint. 13 integration tests
drive signed user operations through that EntryPoint and assert money moved, refusals cost
nothing, and revocation took effect.

## 2. Circle Modular Wallets on React Native

App Kit is web-only, and `docs.arc.io/integrate` lists no mobile SDK. Circle supports passkey
smart accounts on web, iOS and Android — not React Native, which is what most teams build phone
apps in.

Their TypeScript packages do run there. The WebAuthn ceremony does not, because it is the one
OS-deep part. `modules/arc-passkey` and `src/passkey` close that: a native ceremony on each
platform, and everything above the OS boundary — CBOR, COSE, SPKI, base64url — in TypeScript
where it is tested. Including the piece Circle assumes a browser already did, turning an
attestation object into the DER public key their SDK expects.

This is what makes an Arc wallet possible on a phone at all, and it is the part nobody should
have to build twice.

## 3. A way for real agents to use it

An allowance nothing can reach is not worth much. The gap between "the chain enforces a limit"
and "my agent spends inside one" is where this usually dies, and the honest fix was to stop
inventing a pairing flow and plug into the agent people already run.

`mcp/` is an MCP server, so Claude Code, Cursor and Codex all work the same way:

```bash
claude mcp add arc-mandate -- node .../mcp/server.mjs
```

The agent makes its own key, never sends it anywhere, and shows a public address. You grant to
that address from your phone. It then finds the granting account **by itself**, by watching for
`SessionKeyAdded` naming its own address — that argument is indexed in the event, which is what
makes a single scan enough with no second round trip and no config file.

It submits its own operations over a plain RPC, fronting gas and being reimbursed by the account:
about 0.028 USDC per payment at Arc testnet's present fees, roughly 36 payments per dollar. Circle's bundler would sponsor it
outright — we checked — but reaching it needs the app's client key and a domain-bound header, and
an agent should not need the wallet vendor's credential to spend an allowance it already has.

## 4. Five things the docs don't warn about

See [FINDINGS.md](FINDINGS.md). The dual-decimal USDC trap is the one most likely to cost someone
real money: `balanceOf` can read zero for an account that holds funds, and a budget enforced on
one rail is not enforced at all.

---

## Where this sits among the standards

Worth being precise about, because the idea is not ours and claiming otherwise would be both
wrong and weaker than the truth.

| | status | us |
|---|---|---|
| **ERC-4337 v0.7** | live, deployed on Arc | **We use it, correctly.** Circle's account is v0.7; the port was making a v0.6 plugin speak it. |
| **ERC-6900** | Draft — and the current draft says *modules* | Circle's Modular Wallets implement the older *plugin* generation. Not our choice; we inherit it by targeting their wallet. |
| **ERC-7715** | Draft — `wallet_requestExecutionPermissions` | We do **not** implement it. It assumes a JSON-RPC channel from a dapp to a wallet; ours is a phone granting out of band. Its vocabulary still describes what we do. |
| **ERC-7710** | Draft — on-chain delegation manager | Not used. Circle's account enforces through ERC-6900, so there is no delegation manager to speak to. |
| **EIP-7702** | live on Arc | Not our path, and correctly so — the account is a passkey smart account, not an EOA. |

**The concept is an emerging standard, and others have shipped it.** MetaMask's Delegation Toolkit
implements ERC-7715 over ERC-7710, and their own example is an agent spending a capped amount of
USDC per day. We are not inventing bounded agent spending.

**What is missing is not the idea. It is the wiring on this stack.** Nobody has bounded agent
spending working against Circle Modular Wallets, and the reason is concrete rather than
philosophical: the only session-key plugin deployed on Arc is built for a different EntryPoint
than Circle's accounts use. That is the gap we closed, and connecting it to the agent tooling
people already run is the rest of it.

If ERC-7715 stabilises and Circle's accounts grow a delegation manager, the right move is to
speak that shape rather than ours. The permission vocabulary here — a native-token allowance, a
payee list, an expiry — was chosen to map onto it cleanly for that reason.

---

## Why this matters for Arc specifically

Arc's argument is that a dollar is the unit of account. That argument is strongest where dollars
are actually spent, which is a phone — and it is exactly where the tooling stops today.

The demo is deliberately narrow to make the point checkable: an agent is given an allowance, spends
inside it unattended, is refused by the chain when it tries to exceed it, and goes inert the moment
it is revoked. `npm run demo`.
