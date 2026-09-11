# SessionKeyPlugin, ported to Circle's ERC-6900 v0.7

Derived from [Alchemy's Modular Account](https://github.com/alchemyplatform/modular-account),
branch `v1.0.x`, © 2024 Alchemy Insights, Inc., **GPL-3.0-or-later**. This derivative keeps that
licence. Upstream files retain their headers; every file here is either unmodified or carries a
`PORTED` comment at the point of change.

## Why a port was needed

Alchemy's `v1.0.x` targets **EntryPoint v0.6** and the unpacked `UserOperation`. Circle's MSCA is
**EntryPoint v0.7** and uses `PackedUserOperation` — verified on-chain: the account's
`getEntryPoint()` returns `0x0000000071727De22E5E9d8BAf0edAc6f37da032`.

That changes the `userOpValidationFunction` selector, which is why Circle's multisig does not
advertise Alchemy's `IPlugin` id (`0xf23b1ed7`). **The SessionKeyPlugin already deployed on Arc at
`0x0000003E0000a96de4058e1E02a62FaaeCf23d8d` is the v0.6 build**: against a Circle account it
passes every install-time check and then reverts the first time an agent tries to spend.

## What changed

- **`UserOperation` → `PackedUserOperation`** throughout, and account-facing types now come from
  Circle's `msca/6900/v0.7` rather than Alchemy's equivalents.
- **Gas accounting** (`SessionKeyPermissions.sol`). v0.6 had no separate paymaster gas limits, so
  the original multiplied `verificationGasLimit` by 3 to approximate them, and left a comment
  asking for exactly this update. v0.7 carries `paymasterVerificationGasLimit` and
  `paymasterPostOpGasLimit` explicitly, so the estimate is replaced by the real figure, mirroring
  `EntryPoint._getRequiredPrefund`.
- **`onInstall`.** Alchemy's `BasePlugin` splits this into a public method delegating to an
  internal `_onInstall`; Circle's has no internal half, so the body moved up. The
  `isNotInitialized` guard still runs first.
- **OpenZeppelin 4 → 5.** `toEthSignedMessageHash` moved to `MessageHashUtils`, and `tryRecover`
  returns a third value.
- **`CastLib` trimmed** to the two functions the plugin calls. Its other overloads convert to
  Alchemy's packed `bytes21` `FunctionReference`; Circle passes that as a struct tuple, so keeping
  them would put two incompatible types of the same name in one plugin.
- **`NotImplemented`** is imported from Circle's `shared/common/Errors.sol`, where it is declared
  file-level rather than on `BasePlugin`.

- **The runtime owner dependency is removed.** Upstream declares two dependencies, runtime and
  user-op, both pointing at the owner plugin. On a Circle passkey MSCA the runtime one cannot
  work *and* cannot install: `WeightedWebauthnMultisigPlugin` implements no
  `runtimeValidationFunction`, and `PluginManager` keeps dependencies in a set, so a second
  identical `{multisig, USER_OP_VALIDATION_OWNER}` reverts `ItemAlreadyExists()`. The four
  management selectors are therefore left with **no** runtime validation function, which is a
  deny — `BaseMSCA._processPreRuntimeHooksAndValidation` reverts on an empty reference. A mandate
  can only be granted, re-scoped or revoked through a user operation, which is the only thing a
  passkey can authorise. There is no direct-call administrative path, for us or anyone.

**Unchanged:** the permission engine itself — spend limits, refresh intervals, time ranges, access
lists, required paymaster — and the manifest's split between owner-gated management and
session-key spending. Those are the reason to port rather than rewrite.

`dependencyInterfaceIds` needed **no edit**: Alchemy already wrote it as `type(IPlugin).interfaceId`,
so compiling against Circle's interface rebinds it to Circle's id.

## Behaviour now covered

`test/ArcMscaHarness.sol` forks Arc testnet and installs the plugin on the deployed Circle MSCA,
alongside its real multisig and EntryPoint v0.7. On top of it:

- **`ArcGasLimits.t.sol`** — the rewritten prefund arithmetic. The exact v0.7 charge passes and one
  wei over reverts, with and without a paymaster, and the paymaster's two gas limits are shown to
  be *counted* rather than merely parsed. Nothing else exercises this expression.
- **`ArcNativeSpendLimits.t.sol`**: the bound on a scoped mandate, the kind that names payees. A
  new session key can spend nothing until granted, the limit is a running total rather than a
  per-call cap, and the ERC-20 view at `0x3600…` is unreachable, which is what makes the native
  limit a real limit there.

Three behaviours surfaced that are worth knowing before reading the tests:

1. **A permission failure reverts** with `PermissionsCheckFailed()`; it does not return
   `SIG_VALIDATION_FAILED`. An over-budget operation is a revert during validation, not a soft
   signature failure a bundler drops quietly.
2. **The default access list is ALLOWLIST and empty**, so a session key can reach nothing until an
   address is added. The safe configuration is the default.
3. **A zero native spend limit denies**, rather than meaning "unlimited". The engine's sentinel for
   no limit is `type(uint256).max`.

- **`ArcErc20SpendLimits.t.sol`**: the ERC-20 rail's weaknesses, tested rather than asserted.
  Three, relative to the native limit: the amount is enforced during execution
  rather than validation, so an over-limit payment is bundled and paid for before being rejected;
  the selector gate is skipped entirely unless the token was allowlisted with
  `checkSelectors = true`, leaving `transferFrom` permitted and unmetered; and a token allowlisted
  with no spend limit at all is silently unbounded.
- **`ArcOneMeter.t.sol`**: the allowance the app actually grants. The ERC-20 view is listed with
  `checkSelectors` and given a spend limit, and the native limit is left at zero, so one meter
  bounds every payment and every escrow `approve`. That closes the second and third weaknesses
  above. The first remains, which is why the connector checks the limit before sending.
- **`ArcTimeRange.t.sol`** — expiry is not a revert. The plugin packs `validAfter`/`validUntil`
  into the validation data and the EntryPoint enforces the window, so what must be right is the
  bit layout. An unset window returns zeros, which the EntryPoint reads as no restriction — an
  expiry is something the product sets, not something a mandate gets by default.

## Deployed

On Arc testnet at `0x669Dd1eDb85ABD00f74186d88124614EE81E6670`, block 60,625,268, through
`contracts/script/DeploySessionKeyPlugin.s.sol` at a deterministic address. The phone app installs
it on real Circle accounts with a passkey-signed user operation, which is the only way
`installPlugin` can be reached on these accounts (see [FINDINGS.md](../../../docs/FINDINGS.md)).
