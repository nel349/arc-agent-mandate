// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {ArcMscaHarness} from "./ArcMscaHarness.sol";
import {ISessionKeyPermissionsUpdates} from "../src/session/permissions/ISessionKeyPermissionsUpdates.sol";

/// @notice A mandate's expiry.
///
/// Unlike a spend limit, an expired key does not revert. The plugin packs `validAfter` and
/// `validUntil` into the validation data and the **EntryPoint** enforces the window -- so what
/// has to be correct here is the encoding, and an off-by-one in the bit positions would silently
/// hand the EntryPoint a window nobody chose.
contract ArcTimeRangeTest is ArcMscaHarness {
    uint256 internal constant SESSION_KEY_PK = 0xDECAF;
    address internal constant PAYEE = address(0xDEAD);

    function _setUpMandate(uint48 validAfter, uint48 validUntil) private returns (address sessionKey) {
        sessionKey = vm.addr(SESSION_KEY_PK);
        address[] memory keys = new address[](1);
        keys[0] = sessionKey;
        vm.skip(!_forkArcAndInstall(keys));
        SESSION_KEY_PK_FOR_SPEND = SESSION_KEY_PK;

        bytes[] memory updates = new bytes[](4);
        updates[0] = abi.encodeCall(ISessionKeyPermissionsUpdates.updateAccessListAddressEntry, (PAYEE, true, false));
        updates[1] = abi.encodeCall(ISessionKeyPermissionsUpdates.setGasSpendLimit, (type(uint256).max - 1, 0));
        updates[2] = abi.encodeCall(ISessionKeyPermissionsUpdates.setNativeTokenSpendLimit, (100e18, 0));
        updates[3] = abi.encodeCall(ISessionKeyPermissionsUpdates.updateTimeRange, (validAfter, validUntil));
        _updatePermissions(sessionKey, updates);
    }

    /// Layout: authorizer in the low 160 bits, `validUntil` at 160, `validAfter` at 208.
    function _unpack(uint256 validationData)
        private
        pure
        returns (uint160 authorizer, uint48 validUntil, uint48 validAfter)
    {
        authorizer = uint160(validationData);
        validUntil = uint48(validationData >> 160);
        validAfter = uint48(validationData >> 208);
    }

    function test_theMandatesWindowReachesTheEntryPointIntact() public {
        uint48 validAfter = 1_800_000_000;
        uint48 validUntil = 1_900_000_000;
        _setUpMandate(validAfter, validUntil);

        (uint160 authorizer, uint48 gotUntil, uint48 gotAfter) = _unpack(_spendOn(PAYEE, 1e18, ""));

        assertEq(authorizer, 0, "SIG_VALIDATION_PASSED");
        assertEq(gotUntil, validUntil, "validUntil must survive the packing");
        assertEq(gotAfter, validAfter, "validAfter must survive the packing");
    }

    /// A mandate granted with no explicit window returns zeros, which the EntryPoint reads as
    /// "no restriction" -- so an expiry is something the product must set, not something it gets.
    function test_anUnsetWindowIsUnboundedRatherThanClosed() public {
        _setUpMandate(0, 0);
        (, uint48 gotUntil, uint48 gotAfter) = _unpack(_spendOn(PAYEE, 1e18, ""));
        assertEq(gotUntil, 0, "zero validUntil means no expiry to the EntryPoint");
        assertEq(gotAfter, 0);
    }
}
