# Building on Arc: what we hit that the docs don't cover

Five things that cost us real time, each verified on-chain rather than inferred. Written down
because the next team will hit them too, and because they are cheap for Arc to document.

## 1. Session keys on Arc do not work with Circle's Modular Wallets

`docs.arc.io/build` names session keys as priority developer infrastructure. The only ERC-6900
session key plugin deployed on Arc is Alchemy's, at `0x0000003E0000a96de4058e1E02a62FaaeCf23d8d`.
It cannot serve a Circle Modular Wallet, and the reason is a version gap nobody would find without
trying to use both together.

**ERC-4337 changed shape between v0.6 and v0.7.** Gas figures that had their own fields were packed
into single words. That changes the signature of the function an account calls to validate a
payment, and therefore its selector:

```solidity
userOpValidationFunction(uint8, UserOperation,       bytes32)   // v0.6
userOpValidationFunction(uint8, PackedUserOperation, bytes32)   // v0.7
```

Circle's accounts run **EntryPoint v0.7**. The deployed plugin is built for **v0.6**. Different
selector, so different `IPlugin` interface id — which is also why Circle's owner plugin does not
advertise `0xf23b1ed7`.

```bash
cast call 0xa8546Ff7D7Fcd3BBd08C0ef31E74C73DF6BcC447 "getEntryPoint()(address)" \
  --rpc-url https://rpc.testnet.arc.network
# 0x0000000071727De22E5E9d8BAf0edAc6f37da032   <- v0.7
```

**The failure mode is the dangerous one.** Installed properly, it fails an interface check up
front — annoying but obvious. The trap is the shortcut most people reach for next: `PluginManager`
special-cases a dependency pointing at the account itself, so routing around the check makes
installation **succeed**. `BaseMSCA` has no matching case during validation, so it fails instead
at the first attempt to spend. Confirmed by pointing a dependency at `0xdeadbeef` and getting the
identical revert.

The plugin rebuilt against v0.7 is in `contracts/src/session`, with every change recorded in
`PORTING.md`. The rules it enforces are untouched; only the parts that connect it to the account
changed.

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

## 6. Reading payment history is harder than the EIP-7708 story suggests

Arc emits `Transfer` logs for native value, which sounds like an activity feed for free. Three
things get in the way.

**Two emitters, and they double-count.** In a 300-block sample, 1,707 transactions emitted
`Transfer` from *both* the system emitter `0xffff…fffe` (18 decimals) and the USDC ERC-20 view
`0x3600…` (6 decimals) — same sender, same recipient, same amount at two scales:

```
sys    from 0x8338c8f0… to 0x49f9636f… value 9748229000000000000
erc20  from 0x8338c8f0… to 0x49f9636f… value 9748229
```

Reading both counts every payment twice.

**The RPC caps on two axes at once.** `eth_getLogs` is limited to 10,000 blocks *and* 20,000
results. Arc runs around 46 logs per block, so an unfiltered 10,000-block query would ask for
roughly 460,000 — it fails rather than truncating. Any history read has to filter by an indexed
topic, not by range alone.

**A local fork emits none of it.** Anvil forking Arc reproduces the accounts and the contracts,
but not the chain's native-transfer logs — a payment through the EntryPoint produces only the
EntryPoint's own events. So a feed built on `Transfer` cannot be developed or tested against a
fork.

The way through is `UserOperationEvent`, which the EntryPoint emits on both the fork and the real
chain. It is indexed by `sender`, so the query stays small; and its `nonce` identifies the agent,
because the session key plugin requires the key to own the nonce key:

```
nonce >> 64  ==  the session key's address
```

## 7. A Circle smart account is reachable without Circle

Circle is the WebAuthn relying party for registration and login, and their modular transport is
the default RPC. That reads like a dependency for getting back to your own account, and for a
wallet that calls itself non-custodial the difference matters.

It is not one, and their SDK says so if you read the address path. `toCircleSmartAccount` asks
their API for the address **only** when handed their own transport:

```js
if (client.transport.key === MODULAR_WALLETS_TRANSPORT_KEY) { /* ask Circle */ }
...
getAddress: async () => address ?? walletAddress ?? computeAddress(owner)
```

`computeAddress` is a CREATE2 computation over published constants — the factory, the proxy
creation code, the MSCA implementation, the multisig plugin and its manifest hash — with a zero
salt, mixed with a sender derived from the credential's public key. Hand it any ordinary RPC and
it never calls them.

Checked against the live API with a throwaway P-256 key: **Circle returned byte-identical the
address computed offline.**

Signing was never theirs either. Circle issues the registration options, but assertions go
through ox's `WebAuthnP256` against whatever `rpId` you pin — here our own domain, not Circle's.
That is also why `rpId` must be passed explicitly: it defaults to `window.location.hostname`,
which on React Native is the Metro dev server, and iOS then refuses every assertion *after* a
successful registration.

So the standing dependency is convenience, not custody and not reachability. The obligation it
creates is on the application: **persist the credential id and public key**, because they are
the whole input to the derivation. Recovery being possible and recovery being implemented are
different claims.

The risk worth guarding is silent drift. Those constants live in the SDK, and a version bump
that moves any of them moves every address ever derived — with no error, just funds at an
address nobody can reach. `integration/rp-independence.test.mjs` pins a fixed public key to a
known address so that turns into a failing test.

## 8. An empty allowlist is not "anyone" — it is "no one"

A session key's contract access control defaults to `ALLOWLIST`, which is enum value zero, so it
is what every freshly added key gets. The natural reading is that an allowlist with nothing on it
imposes no restriction yet. It is the opposite, and the per-call check says so in its first line:

```solidity
if (accessControlType == ContractAccessControlType.ALLOWLIST) {
    if (!contractData.isOnList) return false;
```

`target` here is the target of **any** call, including a plain value transfer to an ordinary
address. There is no branch that exempts a call with empty calldata. So a key granted a spend
limit, a gas limit and an expiry — but no named payees — cannot move a single wei to anybody,
while every view function reports a healthy mandate with the full limit unspent.

This is easy to miss because the obvious test does not catch it. A suite that grants to a payee
and then spends to that payee passes; so does one that checks an unnamed payee is refused. Both
describe an allowlist working correctly. Nothing exercises the empty list unless you write that
case deliberately.

**The fix is not `ALLOW_ALL_ACCESS`.** That setting disables contract access control entirely,
and on Arc that is precisely the thing you cannot afford: the dollar is the native token *and* an
ERC-20 view over the same balance, so a key that may call anything can move the same money
through `transfer`, where a native spend limit never sees it — an ERC-20 call carries
`value == 0`. Under an allowlist that call was refused for being unlisted, which means the second
rail was closed by accident rather than on purpose.

What works is a **denylist with the second rail named on it**: anyone may be paid, except the
ERC-20 view. `contracts/test/ArcPayeeScope.t.sol` pins all three steps against the real plugin on
a fork — the empty allowlist spending nothing, the denylist reopening the ERC-20 rail, and naming
that rail closing it again.

The general lesson is worth more than the specific one: when a permission model defaults to a
mode whose empty state is total denial, "unconfigured" and "unrestricted" look identical from
every getter, and only differ when someone tries to spend.

---

Every claim above is exercised by tests in this repository — `npm run gate` — with one exception,
stated where it appears: the comparison against Circle's live address API needs their network and
a browser `window`, so what the gate holds is the offline derivation it was checked against.
