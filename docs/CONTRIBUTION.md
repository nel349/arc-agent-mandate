# What this contributes to Arc

The app is the demo. These are the pieces that outlive it, and both fill gaps that Arc's own
documentation makes visible.

## 1. Session keys that actually work with Circle Modular Wallets

`docs.arc.io/build` lists session keys among the account-abstraction primitives Arc wants
developers using. The only one deployed on Arc is built for **EntryPoint v0.6**, and Circle's
Modular Wallets are **v0.7** — so today, on Arc, you cannot give a Circle smart account a bounded
session key. It installs and then reverts at first use.

`contracts/src/session` is that plugin ported onto Circle's ERC-6900 v0.7 interfaces:
`PackedUserOperation` throughout, gas accounting rebuilt on v0.7's explicit paymaster limits to
mirror `EntryPoint._getRequiredPrefund`, and the owner dependency reduced to the one Circle's
multisig can actually satisfy. GPL-3.0, as the original is. Every deviation is in `PORTING.md`
with the reasoning, so it can be reviewed rather than trusted.

**Proof, not claims:** 26 contract tests run against a fork of Arc with the plugin installed on a
real Circle account, its real WebAuthn multisig and the real EntryPoint. 13 integration tests
drive signed user operations through that EntryPoint and assert money moved, refusals cost
nothing, and revocation takes effect.

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

## 3. Five things the docs don't warn about

See [FINDINGS.md](FINDINGS.md). The dual-decimal USDC trap is the one most likely to cost someone
real money: `balanceOf` can read zero for an account that holds funds, and a budget enforced on
one rail is not enforced at all.

---

## Why this matters for Arc specifically

Arc's argument is that a dollar is the unit of account. That argument is strongest where dollars
are actually spent, which is a phone — and it is exactly where the tooling stops today.

The demo is deliberately narrow to make the point checkable: an agent is given an allowance, spends
inside it unattended, is refused by the chain when it tries to exceed it, and goes inert the moment
it is revoked. `npm run demo`.
