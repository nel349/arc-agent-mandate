// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {FunctionReference} from "@circle/msca/6900/v0.7/common/Structs.sol";
import {IPluginManager} from "@circle/msca/6900/v0.7/interfaces/IPluginManager.sol";
import {SessionKeyPlugin} from "../src/session/SessionKeyPlugin.sol";
import {ISessionKeyPermissionsUpdates} from "../src/session/permissions/ISessionKeyPermissionsUpdates.sol";

/// @notice Stands the demo up on a local fork of Arc: deploys the plugin, installs it on the real
/// Circle account, and grants one mandate.
///
/// Run against `anvil --fork-url <arc>` with the EntryPoint impersonated, because that is the only
/// caller the account will accept for plugin management -- the multisig implements no runtime
/// validation, so there is no direct-call path even for the account itself.
contract SetupDemo is Script {
    address internal constant MSCA = 0xa8546Ff7D7Fcd3BBd08C0ef31E74C73DF6BcC447;
    address internal constant MULTISIG = 0x0000000C984AFf541D6cE86Bb697e68ec57873C8;
    uint8 internal constant USER_OP_VALIDATION_OWNER = 0;

    function run() external {
        address agent = vm.envAddress("AGENT_ADDRESS");
        address seller = vm.envAddress("SELLER_ADDRESS");
        uint256 mandate = vm.envUint("MANDATE_WEI");

        vm.startBroadcast();

        SessionKeyPlugin plugin = new SessionKeyPlugin();

        address[] memory keys = new address[](1);
        keys[0] = agent;
        bytes32[] memory tags = new bytes32[](1);
        tags[0] = "demo";
        bytes[][] memory initial = new bytes[][](1);
        initial[0] = new bytes[](0);

        FunctionReference[] memory dependencies = new FunctionReference[](1);
        dependencies[0] = FunctionReference({plugin: MULTISIG, functionId: USER_OP_VALIDATION_OWNER});

        IPluginManager(MSCA).installPlugin({
            plugin: address(plugin),
            manifestHash: keccak256(abi.encode(plugin.pluginManifest())),
            pluginInstallData: abi.encode(keys, tags, initial),
            dependencies: dependencies
        });

        // The mandate itself: this much, to this payee, and gas on top.
        bytes[] memory updates = new bytes[](3);
        updates[0] =
            abi.encodeCall(ISessionKeyPermissionsUpdates.updateAccessListAddressEntry, (seller, true, false));
        updates[1] = abi.encodeCall(ISessionKeyPermissionsUpdates.setNativeTokenSpendLimit, (mandate, 0));
        updates[2] = abi.encodeCall(ISessionKeyPermissionsUpdates.setGasSpendLimit, (type(uint256).max - 1, 0));
        SessionKeyPlugin(MSCA).updateKeyPermissions(agent, updates);

        vm.stopBroadcast();

        console.log("plugin  :", address(plugin));
        console.log("account :", MSCA);
        console.log("agent   :", agent);
        console.log("seller  :", seller);
    }
}
