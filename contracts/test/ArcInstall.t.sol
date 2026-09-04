// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {ArcMscaHarness} from "./ArcMscaHarness.sol";

/// @notice The claim this whole port rests on: the plugin installs onto a real Circle account.
contract ArcInstallTest is ArcMscaHarness {
    function test_installsOntoARealCircleMsca() public {
        address agent = makeAddr("agent");
        address[] memory keys = new address[](1);
        keys[0] = agent;

        vm.skip(!_forkArcAndInstall(keys));

        // Read on the plugin, not through the account: the loupe views are not in the manifest's
        // `executionFunctions`, so the account does not route them and answers `SJG`. They take
        // the account as a parameter precisely because they are meant to be called this way.
        address[] memory installed = plugin.sessionKeysOf(MSCA);
        assertEq(installed.length, 1, "the mandate's session key should be registered");
        assertEq(installed[0], agent);
        assertTrue(plugin.isSessionKeyOf(MSCA, agent), "agent must be a session key");
    }
}
