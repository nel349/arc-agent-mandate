// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {Call} from "@circle/msca/6900/v0.7/interfaces/IStandardExecutor.sol";
import {ArcMscaHarness} from "./ArcMscaHarness.sol";
import {ISessionKeyPlugin} from "../src/session/ISessionKeyPlugin.sol";
import {ISessionKeyPermissionsUpdates} from "../src/session/permissions/ISessionKeyPermissionsUpdates.sol";

/// @notice The mandate's actual bound: how much USDC an agent can move, and by which rail.
///
/// On Arc, USDC is the native token at 18 decimals *and* an ERC-20 view at `0x3600…` at 6
/// decimals over the **same balance**. A limit on one rail alone is not a limit; limits on both
/// make the real bound twice the number on screen. A mandate that names payees is therefore
/// denominated in native USDC with the ERC-20 view closed to its session key; one that names none
/// meters the ERC-20 view alone instead, which `ArcOneMeter.t.sol` covers. These tests pin the
/// native half.
contract ArcNativeSpendLimitsTest is ArcMscaHarness {
    uint256 internal constant SESSION_KEY_PK = 0xB0B;
    address internal constant PAYEE = address(0xDEAD);
    /// Arc's ERC-20 view over the same balance the native rail spends.
    address internal constant USDC_ERC20_VIEW = 0x3600000000000000000000000000000000000000;

    uint128 internal constant VERIFICATION_GAS = 100_000;
    uint128 internal constant CALL_GAS = 200_000;
    uint256 internal constant PRE_VERIFICATION_GAS = 50_000;
    uint128 internal constant MAX_FEE = 1 gwei;

    address internal sessionKey;

    function _setUpMandate(uint256 nativeLimit) private {
        sessionKey = vm.addr(SESSION_KEY_PK);
        address[] memory keys = new address[](1);
        keys[0] = sessionKey;
        vm.skip(!_forkArcAndInstall(keys));

        bytes[] memory updates = new bytes[](3);
        updates[0] = abi.encodeCall(ISessionKeyPermissionsUpdates.updateAccessListAddressEntry, (PAYEE, true, false));
        updates[1] = abi.encodeCall(ISessionKeyPermissionsUpdates.setNativeTokenSpendLimit, (nativeLimit, 0));
        // Gas is a third way to spend the same balance; unbounded here so these tests measure the
        // native limit alone. `type(uint256).max` is the engine's "no limit" sentinel, so one less.
        updates[2] = abi.encodeCall(ISessionKeyPermissionsUpdates.setGasSpendLimit, (type(uint256).max - 1, 0));
        _updatePermissions(sessionKey, updates);
    }

    function _spendLocal(address target, uint256 value, bytes memory data) private returns (uint256) {
        Call[] memory calls = new Call[](1);
        calls[0] = Call({target: target, value: value, data: data});
        (PackedUserOperation memory userOp, bytes32 hash) = _sessionKeyUserOp(
            SESSION_KEY_PK, calls, VERIFICATION_GAS, CALL_GAS, PRE_VERIFICATION_GAS, MAX_FEE, ""
        );
        return _validate(userOp, hash);
    }

    /// The safe default. A freshly added session key has `nativeTokenSpendLimit == 0` and is not
    /// bypassed, so it can move nothing until a mandate is granted. Worth pinning: if the zero
    /// value meant "no limit" instead, every new key would start unbounded.
    function test_aNewSessionKeyCanSpendNothingByDefault() public {
        sessionKey = vm.addr(SESSION_KEY_PK);
        address[] memory keys = new address[](1);
        keys[0] = sessionKey;
        vm.skip(!_forkArcAndInstall(keys));

        bytes[] memory updates = new bytes[](2);
        updates[0] = abi.encodeCall(ISessionKeyPermissionsUpdates.updateAccessListAddressEntry, (PAYEE, true, false));
        updates[1] = abi.encodeCall(ISessionKeyPermissionsUpdates.setGasSpendLimit, (type(uint256).max - 1, 0));
        _updatePermissions(sessionKey, updates);

        vm.expectRevert(ISessionKeyPlugin.PermissionsCheckFailed.selector);
        _spendLocal(PAYEE, 1, "");
    }

    function test_spendingWithinTheMandatePasses() public {
        _setUpMandate(50e18);
        _spendLocal(PAYEE, 50e18, ""); // exactly the mandate must be allowed
    }

    function test_spendingOneWeiOverTheMandateFails() public {
        _setUpMandate(50e18);
        vm.expectRevert(ISessionKeyPlugin.PermissionsCheckFailed.selector);
        _spendLocal(PAYEE, 50e18 + 1, "");
    }

    /// The limit is a running total, not a per-call cap: two calls inside one operation are summed.
    function test_theMandateIsATotalNotAPerCallCap() public {
        _setUpMandate(50e18);
        Call[] memory calls = new Call[](2);
        calls[0] = Call({target: PAYEE, value: 30e18, data: ""});
        calls[1] = Call({target: PAYEE, value: 30e18, data: ""});
        (PackedUserOperation memory userOp, bytes32 hash) = _sessionKeyUserOp(
            SESSION_KEY_PK, calls, VERIFICATION_GAS, CALL_GAS, PRE_VERIFICATION_GAS, MAX_FEE, ""
        );
        vm.expectRevert(ISessionKeyPlugin.PermissionsCheckFailed.selector);
        _validate(userOp, hash);
    }

    /// The rail decision, enforced. The ERC-20 view reaches the same balance the native limit
    /// bounds, so if a session key could call it the mandate would be worth nothing. It is not on
    /// the access list, and the default list type is ALLOWLIST, so the call is denied.
    function test_theErc20ViewIsClosedToSessionKeys() public {
        _setUpMandate(50e18);
        bytes memory transferCall = abi.encodeWithSignature("transfer(address,uint256)", PAYEE, uint256(1e6));

        vm.expectRevert(ISessionKeyPlugin.PermissionsCheckFailed.selector);
        _spendLocal(USDC_ERC20_VIEW, 0, transferCall);
    }
}
