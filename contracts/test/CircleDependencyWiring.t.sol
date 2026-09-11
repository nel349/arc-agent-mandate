// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import {IPlugin} from "@circle/msca/6900/v0.7/interfaces/IPlugin.sol";

/// @notice Pins the facts the mandate plugin's dependency wiring rests on.
///
/// The mandate plugin declares `dependencyInterfaceIds` and Circle's `PluginManager` checks each
/// one with `ERC165Checker.supportsInterface` against the already-installed plugin it points at.
/// Everything asserted here was established by reading and by direct RPC; these tests exist so a
/// submodule bump that changes any of it fails loudly instead of at install time on-chain.
///
/// Why the plugin needed porting at all is in `contracts/src/session/PORTING.md`.
contract CircleDependencyWiringTest is Test {
    /// Alchemy's `IPlugin` interface id. Their plugins advertise it; Circle's do not, because
    /// Alchemy's v1.0.x interface is built on 4337 v0.6 `UserOperation` while Circle's is on v0.7
    /// `PackedUserOperation`, which changes two selectors and therefore the XOR.
    bytes4 internal constant ALCHEMY_IPLUGIN_INTERFACE_ID = 0xf23b1ed7;

    /// The WeightedWebauthnMultisigPlugin installed on Circle MSCAs on Arc testnet. This is the
    /// plugin the mandate's owner-gated management functions must validate through.
    address internal constant ARC_CIRCLE_MULTISIG = 0x0000000C984AFf541D6cE86Bb697e68ec57873C8;

    function test_circleAndAlchemyPluginInterfaceIdsDiffer() public pure {
        assertTrue(
            type(IPlugin).interfaceId != ALCHEMY_IPLUGIN_INTERFACE_ID,
            "Circle and Alchemy IPlugin ids collided; the 4337 version split may have closed"
        );
    }

    /// Pinned so the assertion is reproducible and cached rather than re-fetched every run. Bump
    /// deliberately; a moving head would make this test's meaning change without an edit.
    uint256 internal constant ARC_FORK_BLOCK = 60219238;

    function test_deployedMultisigSatisfiesTheDependencyCheck() public {
        // Skip rather than fail when the RPC is not configured. A missing endpoint says nothing
        // about the code under test, and a hard failure there trains people to ignore red.
        string memory rpc = vm.envOr("ARC_TESTNET_RPC_URL", string(""));
        vm.skip(bytes(rpc).length == 0);
        vm.createSelectFork(rpc, ARC_FORK_BLOCK);

        // The exact predicate PluginManager runs. OZ's checker also requires that the target
        // answer false for 0xffffffff, so this is stricter than a bare supportsInterface call.
        assertTrue(
            ERC165Checker.supportsInterface(ARC_CIRCLE_MULTISIG, type(IPlugin).interfaceId),
            "multisig no longer satisfies the dependency check for Circle's IPlugin id"
        );
        assertFalse(
            IERC165(ARC_CIRCLE_MULTISIG).supportsInterface(ALCHEMY_IPLUGIN_INTERFACE_ID),
            "multisig now advertises Alchemy's IPlugin id; re-check the 4337 version assumption"
        );
    }
}
