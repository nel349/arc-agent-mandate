# Building on Arc: what we hit that the docs don't cover

Five things that cost us real time, each verified on-chain rather than inferred. Written down
because the next team will hit them too, and because they are cheap for Arc to document.

## 1. Session keys on Arc do not work with Circle's Modular Wallets

`docs.arc.io/build` names session keys as priority developer infrastructure. The only ERC-6900
session-key plugin deployed on Arc is Alchemy's, at `0x0000003E0000a96de4058e1E02a62FaaeCf23d8d`.

It cannot serve a Circle Modular Wallet. Alchemy's `v1.0.x` is **EntryPoint v0.6** and uses the
unpacked `UserOperation`; Circle's MSCA is **v0.7** and uses `PackedUserOperation`. The
`userOpValidationFunction` selectors therefore differ, which is also why Circle's multisig does
not advertise Alchemy's `IPlugin` interface id (`0xf23b1ed7`).

The failure mode is the bad one: the plugin **installs cleanly** — the manifest hash matches, the
dependency check passes — and then reverts the first time an agent tries to spend.

```bash
cast call 0xa8546Ff7D7Fcd3BBd08C0ef31E74C73DF6BcC447 "getEntryPoint()(address)" \
  --rpc-url https://rpc.testnet.arc.network
# 0x0000000071727De22E5E9d8BAf0edAc6f37da032   <- v0.7
```

The fix is in `contracts/src/session`, with every deviation recorded in `PORTING.md`.

## 2. USDC has two decimal scales over one balance, and the ERC-20 view truncates

Native USDC is 18 decimals. The ERC-20 view at `0x3600…0000` is 6 decimals. **Same balance.** So
`balanceOf` can report `0` for an account that holds money, and any code that compares or sums the
two without conversion produces a plausible wrong number rather than an obvious one.

It also means a spend limit on one rail is not a limit at all, and limits on both make the real
bound twice the displayed one. Anything enforcing a budget has to close one rail deliberately.

## 3. Well-known test keys on Arc are EIP-7702-delegated to sweepers

Every default anvil account carries a delegation designator on Arc testnet:

```bash
cast code 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC --rpc-url https://rpc.testnet.arc.network
# 0xef01006bd9b71559e3b2013596726a4e2ca1ee97189606
```

`0xef0100 || address` is EIP-7702. Those private keys are public, so anyone can install a
delegation on them, and here it points at a sweeper. Value sent to one is forwarded away as it
lands — **and a user operation still reports `success = true`**, because the transfer did not fail.

A fork inherits the delegation, so this bites in local testing too. Derive test addresses from a
project-specific seed; never use the standard ones.

## 4. `installPlugin` is unreachable except through a user operation

On a passkey-owned Circle MSCA there is no direct-call administrative path at all. A direct call
runs runtime validation, which routes to the multisig's `runtimeValidationFunction` — which
`WeightedWebauthnMultisigPlugin` does not implement.

This is coherent (a passkey cannot sign a plain transaction) but it is not written down, and it
means tooling that assumes an owner EOA can call the account will simply fail.

## 5. `FunctionReference` is a struct here, not packed bytes21

Circle's `installPlugin` is `installPlugin(address,bytes32,bytes,(address,uint8)[])`, selector
`0xf85730f4`. Alchemy's ecosystem passes `FunctionReference` as a packed `bytes21`. Client-side
helpers written against the Alchemy shape encode the wrong calldata.

---

Every claim above is exercised by tests in this repository. `npm run gate`.
