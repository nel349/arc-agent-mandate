// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import {IPlugin} from "@circle/msca/6900/v0.7/interfaces/IPlugin.sol";
import {
    ManifestAssociatedFunction,
    ManifestAssociatedFunctionType,
    PluginManifest
} from "@circle/msca/6900/v0.7/common/PluginManifest.sol";
import {ISessionKeyPlugin} from "../src/session/ISessionKeyPlugin.sol";
import {SessionKeyPlugin} from "../src/session/SessionKeyPlugin.sol";

/// @notice Asserts that the port produced the plugin the design argued for.
///
/// Compiling is not the claim. The claims are that the plugin speaks Circle's ERC-6900 v0.7
/// rather than Alchemy's, that its dependency resolves to the WebAuthn multisig already
/// installed on the account, and that management is owner-gated while spending is not.
///
/// See `agent-mandate/MANDATE_DESIGN.md` in the planning repo.
contract PortedSessionKeyPluginTest is Test {
    /// Alchemy's `IPlugin` id, built on 4337 v0.6 `UserOperation`. The plugin deployed on Arc at
    /// 0x0000003E... still advertises this, which is why it cannot serve a Circle account.
    bytes4 internal constant ALCHEMY_IPLUGIN_INTERFACE_ID = 0xf23b1ed7;

    SessionKeyPlugin internal plugin;

    function setUp() public {
        plugin = new SessionKeyPlugin();
    }

    function test_advertisesCirclesPluginInterfaceNotAlchemys() public view {
        assertTrue(plugin.supportsInterface(type(IPlugin).interfaceId), "must be a Circle v0.7 plugin");
        assertFalse(
            plugin.supportsInterface(ALCHEMY_IPLUGIN_INTERFACE_ID),
            "still advertising Alchemy's id; the port did not change the interface it implements"
        );
    }

    /// The install-time check. `PluginManager` runs `ERC165Checker.supportsInterface` for each
    /// declared dependency id, so declaring Circle's own `IPlugin` is what lets the dependency
    /// resolve to their multisig -- and needs no magic constant, because Alchemy already wrote
    /// this as `type(IPlugin).interfaceId` and the recompile rebinds it.
    function test_dependenciesAreDeclaredAsCirclesPluginInterface() public view {
        PluginManifest memory manifest = plugin.pluginManifest();
        assertEq(manifest.dependencyInterfaceIds.length, 1, "only the user-op owner dependency remains");
        assertEq(manifest.dependencyInterfaceIds[0], type(IPlugin).interfaceId);
    }

    /// Upstream also declared a *runtime* owner dependency. It is gone, and its absence is the
    /// design rather than an omission: the multisig implements no `runtimeValidationFunction`,
    /// and `PluginManager` stores dependencies in a set, so a second identical
    /// `{multisig, USER_OP_VALIDATION_OWNER}` reverts `ItemAlreadyExists()` at install.
    ///
    /// Leaving the management selectors with no runtime validation function is a **deny** --
    /// `BaseMSCA._processPreRuntimeHooksAndValidation` reverts on an empty reference -- so a
    /// mandate can only be changed through a user operation, which is what a passkey signs.
    function test_mandateManagementHasNoDirectCallPath() public view {
        PluginManifest memory manifest = plugin.pluginManifest();
        assertEq(
            manifest.runtimeValidationFunctions.length,
            0,
            "a runtime validation function here would be a direct-call path around the passkey"
        );
    }

    /// The product, expressed as a manifest: granting, revoking and re-scoping a mandate route to
    /// the owner (a passkey prompt), while the agent's own spending does not.
    function test_managementIsOwnerGatedAndSpendingIsNot() public view {
        PluginManifest memory manifest = plugin.pluginManifest();
        assertEq(manifest.userOpValidationFunctions.length, 5);

        assertEq(
            uint8(_validationTypeOf(manifest, ISessionKeyPlugin.executeWithSessionKey.selector)),
            uint8(ManifestAssociatedFunctionType.SELF),
            "an agent spending inside its mandate must not require the owner"
        );

        bytes4[4] memory ownerGated = [
            ISessionKeyPlugin.addSessionKey.selector,
            ISessionKeyPlugin.removeSessionKey.selector,
            ISessionKeyPlugin.rotateSessionKey.selector,
            ISessionKeyPlugin.updateKeyPermissions.selector
        ];
        for (uint256 i = 0; i < ownerGated.length; ++i) {
            assertEq(
                uint8(_validationTypeOf(manifest, ownerGated[i])),
                uint8(ManifestAssociatedFunctionType.DEPENDENCY),
                "changing a mandate must go through the owner"
            );
        }
    }

    /// The multisig on Arc must satisfy the very check `PluginManager` will run against it.
    function test_arcMultisigSatisfiesThisPluginsDeclaredDependency() public {
        string memory rpc = vm.envOr("ARC_TESTNET_RPC_URL", string(""));
        vm.skip(bytes(rpc).length == 0);
        // Selecting a fork swaps the whole state, so a contract deployed in `setUp` is simply not
        // there afterwards -- which reverts as a call to an empty address rather than as a failed
        // assertion. Persist it across the switch instead of redeploying and losing the identity.
        vm.makePersistent(address(plugin));
        vm.createSelectFork(rpc, 60219238);

        PluginManifest memory manifest = plugin.pluginManifest();
        address multisig = 0x0000000C984AFf541D6cE86Bb697e68ec57873C8;
        for (uint256 i = 0; i < manifest.dependencyInterfaceIds.length; ++i) {
            assertTrue(
                ERC165Checker.supportsInterface(multisig, manifest.dependencyInterfaceIds[i]),
                "the installed multisig does not satisfy a dependency this plugin declares"
            );
        }
    }

    function _validationTypeOf(PluginManifest memory manifest, bytes4 selector)
        private
        pure
        returns (ManifestAssociatedFunctionType)
    {
        for (uint256 i = 0; i < manifest.userOpValidationFunctions.length; ++i) {
            ManifestAssociatedFunction memory entry = manifest.userOpValidationFunctions[i];
            if (entry.executionSelector == selector) return entry.associatedFunction.functionType;
        }
        revert("selector absent from userOpValidationFunctions");
    }
}
