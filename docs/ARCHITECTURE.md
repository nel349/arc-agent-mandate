# Architecture

How an agent spends your money, and why it cannot overspend.

[![A phone grants an allowance, an agent pays a maze per step under it, and the chain refuses
anything past the limit](architecture.png)](architecture.png)

<sub>Ten steps, three layers — a phone and a laptop off chain, Circle's services between, and Arc
testnet underneath. Dashed lines and `NOT DEPLOYED` mark what is written and tested but not on chain;
`SIMULATED` marks the Chainlink workflow, which runs in the CRE simulator and has not yet read Arc.
Click for full size.</sub>

<sub>The picture is drawn in [`ARCHITECTURE.html`](ARCHITECTURE.html), which is where to change it:
open that, edit, and re-export `architecture.png`. It is a PNG, so nothing makes it follow the code
— if the plugin is redeployed or `MazeVerdict` ships, the image and the table below both need
updating by hand.</sub>

## The short version

Your wallet is a **smart contract account**, not a key — Circle's Modular Wallet, built to
**ERC-6900**, which describes an account assembled from swappable pieces. Your passkey does not own
it directly; a piece called `WeightedWebauthnMultisigPlugin` does the face check on its behalf.
Payments arrive as **ERC-4337 user operations**: you sign an instruction, and the account validates
it before anything moves.

An allowance is a **session key**: a second key with limited authority, which the account checks
against rules stored on-chain. Granting one installs a piece that holds those rules: a spend cap, an
expiry and a gas budget, and optionally a list of who may be paid.

The phone and the agent never talk directly. The agent shows a QR carrying its address and a
one-time pairing code; the phone writes a grant carrying a hash of that code; the agent finds its
own grant by watching the chain for it. The blockchain is the only link between the two machines.

## What the chain refuses, and when

A revoked or expired allowance is refused during validation, before anything runs.

The app meters an allowance on one rail (see *Why Arc*, below), where an over-limit payment is
refused when it runs instead: the operation is included and reverts, no money moves, and the gas is
Circle's sponsorship rather than yours. The connector checks the limit before sending, so only a
connector that skipped the check ever reaches that refusal.

Revoking removes the agent's authority at the account level in one transaction. A cancelled card
still leaves recurring charges; a rotated API key still leaves live sessions. What a revoke cannot
recall is money the agent had already moved into its x402 escrow, which counted against the
allowance when it moved. The connector moves only what the next purchase needs, unless it is asked
to top up ahead of time.

## Why this did not already work on Arc

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

Done properly, installation fails on an interface check. The trap is the obvious shortcut around it,
which makes installation *succeed* and moves the failure to the first time an agent tries to spend.

`contracts/src/session` is that plugin rebuilt against v0.7. The rules themselves — caps, recipient
lists, expiry — are untouched, because they were never the broken part.
[PORTING.md](../contracts/src/session/PORTING.md) records every change and why.

## Why Arc

On most chains a dollar is a token contract, and a spending limit is whatever you manage to parse out
of calldata. On Arc **the dollar is the currency itself**, with an ERC-20 view over the same balance,
so the account's own rules can meter it directly. The plugin supports both: a limit on the native
value field, and a limit on the ERC-20 view.

The app grants on the ERC-20 view, because it is the only rail that covers everything an agent does.
A direct payment and the `approve` that funds an x402 escrow both go through it, so one limit bounds
all of it and the phone can show a single number that is the whole truth. The native limit is left at
zero, which refuses any payment carrying value, so there is no second meter to escape through.
`contracts/test/ArcOneMeter.t.sol` is the evidence.

Two costs come with that, and neither is hidden. An over-limit payment is refused when it runs rather
than before it runs (the gas is sponsored, and the connector checks the limit first). And the
allowance cannot be narrowed to named payees, because on this rail the account sees the token
contract as the target, not the recipient. The contracts also support a scoped allowance: a payee
list on the native rail, where an over-limit payment is refused during validation and costs nothing.
The app does not offer it yet, because an agent shopping the open web does not know who it will pay.

## The contracts

Chain **5042002**, explorer [testnet.arcscan.app](https://testnet.arcscan.app). The chain itself
comes from viem's own `arcTestnet`; these addresses are this app's, in `src/arc/chain.ts`, each
verified deployed by direct `eth_getCode`.

| Contract | Role | Address on Arc testnet |
|---|---|---|
| `SessionKeyPlugin` | our EntryPoint v0.7 port; enforces the allowance | `0x669Dd1eDb85ABD00f74186d88124614EE81E6670` |
| `WeightedWebauthnMultisigPlugin` | Circle's owner plugin; the passkey | `0x0000000C984AFf541D6cE86Bb697e68ec57873C8` |
| EntryPoint v0.7 | validates and runs user operations | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| USDC (ERC-20 view) | the metered rail | `0x3600000000000000000000000000000000000000` |
| `GatewayWallet` | agent escrow; x402 settlement | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` |
| ERC-8004 Identity | the agent's identity, owned by the wallet | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 Reputation | scores from third parties | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| ERC-8004 Validation | the third registry; known to the app, not used by it yet | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` |
| `CohortZero` | the maze's badge, 100 places | `0xe5A8fAEf7139d04582C7E17C3F615710343b53a3` |
| `MazeVerdict` | receives Chainlink CRE reports | not deployed |

## Why we built it

We wanted to build something real on Arc and find out what it takes. It turned out to take more than
expected: session keys are listed as priority infrastructure but the only one deployed on Arc cannot
serve a Circle wallet, and Circle's wallets do not reach React Native at all — so a phone app on a
chain whose whole argument is that dollars are the currency was not buildable without closing both
gaps first.

So we closed them, and the app is what proves they are closed. The allowance is a genuine product and
we would ship it; the port and the passkey bridge are the parts anyone else can pick up.

- [FINDINGS.md](FINDINGS.md) — thirteen things this cost us to learn, each verified on chain
- [CONTRIBUTION.md](CONTRIBUTION.md) — what this contributes, and where it sits among the standards
