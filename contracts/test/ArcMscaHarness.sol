// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {FunctionReference} from "@circle/msca/6900/v0.7/common/Structs.sol";
import {IPluginManager} from "@circle/msca/6900/v0.7/interfaces/IPluginManager.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {Call} from "@circle/msca/6900/v0.7/interfaces/IStandardExecutor.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ISessionKeyPlugin} from "../src/session/ISessionKeyPlugin.sol";
import {SessionKeyPlugin} from "../src/session/SessionKeyPlugin.sol";

/// @notice The ported plugin installed on the **real** Circle MSCA, over a fork of Arc testnet.
///
/// Nothing here is a stand-in. The account, its WeightedWebauthnMultisigPlugin and EntryPoint
/// v0.7 are the deployed contracts; only the session plugin is ours. Rebuilding Circle's stack
/// locally would test our reconstruction of it rather than the thing we have to work against.
///
/// The test impersonates the **EntryPoint**, which is the account's own execution path once a
/// user operation has been validated (`BaseMSCA` skips runtime validation exactly when
/// `msg.sender == ENTRY_POINT`). Only the WebAuthn signature check is skipped, because a passkey
/// signature cannot be produced inside Foundry; the manifest hash, ERC-165 dependency check,
/// selector-collision check and every storage write run as they would on-chain.
///
/// Impersonating the account itself does **not** work, and the reason is worth recording: a
/// direct call runs runtime validation, which routes to the multisig's `runtimeValidationFunction`
/// -- a function `WeightedWebauthnMultisigPlugin` does not implement. So on a passkey-owned Circle
/// MSCA, `installPlugin` is reachable *only* through a user operation. There is no direct-call
/// administrative path, for us or for anyone.
abstract contract ArcMscaHarness is Test {
    /// A Circle MSCA on Arc testnet, passkey-owned, created during the W1 spike.
    address internal constant MSCA = 0xa8546Ff7D7Fcd3BBd08C0ef31E74C73DF6BcC447;
    /// The WeightedWebauthnMultisigPlugin it was created with, and the mandate's owner dependency.
    address internal constant MULTISIG = 0x0000000C984AFf541D6cE86Bb697e68ec57873C8;
    /// `BaseMultisigPlugin.FunctionId.USER_OP_VALIDATION_OWNER`, the enum's only member.
    uint8 internal constant USER_OP_VALIDATION_OWNER = 0;

    /// EntryPoint v0.7, which the account returns from `getEntryPoint()`.
    address internal constant ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    uint256 internal constant ARC_FORK_BLOCK = 60219238;

    SessionKeyPlugin internal plugin;

    /// @return true when a fork was selected; false when no RPC is configured and the caller
    ///         should skip. Kept explicit so a missing endpoint never reads as a real failure.
    function _forkArcAndInstall(address[] memory initialSessionKeys) internal returns (bool) {
        string memory rpc = vm.envOr("ARC_TESTNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return false;
        vm.createSelectFork(rpc, ARC_FORK_BLOCK);

        plugin = new SessionKeyPlugin();

        // One dependency: the multisig's owner validation, which gates mandate management.
        // See SessionKeyPlugin's manifest for why the upstream runtime slot is gone.
        FunctionReference[] memory dependencies = new FunctionReference[](1);
        dependencies[0] = FunctionReference({plugin: MULTISIG, functionId: USER_OP_VALIDATION_OWNER});

        bytes32[] memory tags = new bytes32[](initialSessionKeys.length);
        bytes[][] memory permissionUpdates = new bytes[][](initialSessionKeys.length);
        for (uint256 i = 0; i < initialSessionKeys.length; ++i) {
            tags[i] = bytes32(uint256(i + 1));
            permissionUpdates[i] = new bytes[](0);
        }

        // Computed before the prank on purpose: `pluginManifest()` is an external call, and
        // evaluating it inside the argument list would consume `vm.prank` before `installPlugin`
        // is ever reached -- leaving the account to run runtime validation and revert.
        bytes32 manifestHash = keccak256(abi.encode(plugin.pluginManifest()));

        vm.prank(ENTRY_POINT);
        IPluginManager(MSCA).installPlugin({
            plugin: address(plugin),
            manifestHash: manifestHash,
            pluginInstallData: abi.encode(initialSessionKeys, tags, permissionUpdates),
            dependencies: dependencies
        });
        return true;
    }

    // ---------------------------------------------------------------- user operation building

    /// Builds a session-key user operation, signed by `sessionKeyPk`, with v0.7 packed gas fields.
    ///
    /// `accountGasLimits` packs verification into the high 128 bits and call into the low;
    /// `gasFees` packs priority fee high and max fee low. Getting either order wrong is silent --
    /// the numbers simply mean something else -- so they are built here once.
    function _sessionKeyUserOp(
        uint256 sessionKeyPk,
        Call[] memory calls,
        uint128 verificationGasLimit,
        uint128 callGasLimit,
        uint256 preVerificationGas,
        uint128 maxFeePerGas,
        bytes memory paymasterAndData
    ) internal view returns (PackedUserOperation memory userOp, bytes32 userOpHash) {
        address sessionKey = vm.addr(sessionKeyPk);
        userOp = PackedUserOperation({
            sender: MSCA,
            // The plugin requires the session key to own the nonce key, so that ops from one key
            // are sequential and a bundle cannot invalidate its own later entries.
            nonce: uint256(uint192(uint160(sessionKey))) << 64,
            initCode: "",
            callData: abi.encodeCall(ISessionKeyPlugin.executeWithSessionKey, (calls, sessionKey)),
            accountGasLimits: bytes32((uint256(verificationGasLimit) << 128) | uint256(callGasLimit)),
            preVerificationGas: preVerificationGas,
            gasFees: bytes32(uint256(maxFeePerGas)), // priority fee high 128 left at zero
            paymasterAndData: paymasterAndData,
            signature: ""
        });
        userOpHash = keccak256(abi.encode(userOp.sender, userOp.nonce, userOp.callData));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(sessionKeyPk, MessageHashUtils.toEthSignedMessageHash(userOpHash));
        userOp.signature = abi.encodePacked(r, s, v);
    }

    /// The account's own call into the plugin during validation.
    function _validate(PackedUserOperation memory userOp, bytes32 userOpHash) internal returns (uint256) {
        vm.prank(MSCA);
        return plugin.userOpValidationFunction(
            uint8(ISessionKeyPlugin.FunctionId.USER_OP_VALIDATION_SESSION_KEY), userOp, userOpHash
        );
    }

    /// Applies permission updates as the account would.
    function _updatePermissions(address sessionKey, bytes[] memory updates) internal {
        vm.prank(MSCA);
        plugin.updateKeyPermissions(sessionKey, updates);
    }

    // Gas figures for suites that are measuring something other than gas. Any consistent values
    // work; these are ordinary, and each suite that cares about gas sets its own.
    uint128 internal constant DEFAULT_VERIFICATION_GAS = 100_000;
    uint128 internal constant DEFAULT_CALL_GAS = 200_000;
    uint256 internal constant DEFAULT_PRE_VERIFICATION_GAS = 50_000;
    uint128 internal constant DEFAULT_MAX_FEE = 1 gwei;

    /// One call, validated as the account would validate it. Returns the packed validation data.
    function _spendOn(address target, uint256 value, bytes memory data) internal returns (uint256) {
        Call[] memory calls = new Call[](1);
        calls[0] = Call({target: target, value: value, data: data});
        (PackedUserOperation memory userOp, bytes32 hash) = _sessionKeyUserOp(
            SESSION_KEY_PK_FOR_SPEND,
            calls,
            DEFAULT_VERIFICATION_GAS,
            DEFAULT_CALL_GAS,
            DEFAULT_PRE_VERIFICATION_GAS,
            DEFAULT_MAX_FEE,
            ""
        );
        return _validate(userOp, hash);
    }

    /// The key `_spendOn` signs with. Each suite sets it once, in place of threading a private key
    /// through every call.
    uint256 internal SESSION_KEY_PK_FOR_SPEND;
}
