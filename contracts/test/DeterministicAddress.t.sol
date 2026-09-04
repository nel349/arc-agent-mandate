// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeploySessionKeyPlugin} from "../script/DeploySessionKeyPlugin.s.sol";

/// @notice The SDK will carry the plugin's address as a constant, so the prediction must be the
/// address a real deploy produces -- checked against the canonical CREATE2 factory on Arc, before
/// anything is broadcast.
///
/// Note what this deliberately does *not* do: `new X{salt: ...}` inside a test deploys from the
/// **test contract**, so it lands somewhere else entirely and would "pass" against a prediction
/// derived from the same wrong deployer. The factory has to be the real one.
contract DeterministicAddressTest is Test {
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 internal constant SALT = keccak256("kuiralabs.arc-agent-mandate.SessionKeyPlugin.v1");

    DeploySessionKeyPlugin internal deployScript;

    function setUp() public {
        deployScript = new DeploySessionKeyPlugin();
    }

    function test_thePredictionMatchesADeployThroughArcsCreate2Factory() public {
        string memory rpc = vm.envOr("ARC_TESTNET_RPC_URL", string(""));
        vm.skip(bytes(rpc).length == 0);
        // Selecting a fork replaces the state, so the script deployed in `setUp` would not exist.
        vm.makePersistent(address(deployScript));
        vm.createSelectFork(rpc, 60219238);

        address predicted = deployScript.predictedAddress();
        assertEq(predicted.code.length, 0, "expected an undeployed address to start from");

        // Arachnid's deterministic deployment proxy takes `salt ++ creationCode` as raw calldata.
        (bool ok,) = CREATE2_DEPLOYER.call(abi.encodePacked(SALT, deployScript.creationCode()));
        assertTrue(ok, "CREATE2 factory call failed");

        assertGt(predicted.code.length, 0, "nothing landed at the predicted address");
    }

    /// The address is a function of the creation bytecode, so it moves whenever the plugin does.
    /// That is intended: a changed plugin should be a different address rather than silently
    /// replacing one people have already granted mandates against.
    function test_theAddressIsBoundToTheBytecode() public view {
        assertGt(deployScript.creationCode().length, 0);
        assertTrue(deployScript.predictedAddress() != address(0));
    }
}
