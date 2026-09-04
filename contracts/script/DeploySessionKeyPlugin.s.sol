// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SessionKeyPlugin} from "../src/session/SessionKeyPlugin.sol";

/// @notice Deploys the ported session key plugin at a deterministic address.
///
/// CREATE2 rather than CREATE, for one reason that matters to the product: the plugin lands on the
/// same address on Arc testnet and Arc mainnet, so the SDK ships one constant instead of a
/// per-chain lookup, and the address can be computed and reviewed **before** anything is deployed.
///
/// The address is a function of (deployer, salt, creation bytecode), so it moves whenever the
/// plugin source or the compiler settings move. That is a feature: `predictedAddress()` is how you
/// notice, and the settings are pinned in `foundry.toml` to Circle's exactly.
contract DeploySessionKeyPlugin is Script {
    /// The canonical CREATE2 factory, present on Arc (verified: 69 bytes at this address).
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    /// Namespaced so an unrelated deployment cannot collide with ours by reusing a zero salt.
    bytes32 internal constant SALT = keccak256("kuiralabs.arc-agent-mandate.SessionKeyPlugin.v1");

    function creationCode() public pure returns (bytes memory) {
        return type(SessionKeyPlugin).creationCode;
    }

    /// Where the plugin will land, computable without deploying anything.
    function predictedAddress() public pure returns (address) {
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(bytes1(0xff), CREATE2_DEPLOYER, SALT, keccak256(creationCode()))
                    )
                )
            )
        );
    }

    function run() external {
        address predicted = predictedAddress();
        console.log("SessionKeyPlugin predicted address:", predicted);

        if (predicted.code.length > 0) {
            console.log("Already deployed at this address; nothing to do.");
            return;
        }

        vm.startBroadcast();
        SessionKeyPlugin plugin = new SessionKeyPlugin{salt: SALT}();
        vm.stopBroadcast();

        require(address(plugin) == predicted, "deployed address diverged from the prediction");
        console.log("Deployed SessionKeyPlugin at:", address(plugin));
    }
}
