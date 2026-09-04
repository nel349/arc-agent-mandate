// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Call} from "@circle/msca/6900/v0.7/interfaces/IStandardExecutor.sol";
import {ArcMscaHarness} from "./ArcMscaHarness.sol";
import {ISessionKeyPlugin} from "../src/session/ISessionKeyPlugin.sol";
import {ISessionKeyPermissionsUpdates} from "../src/session/permissions/ISessionKeyPermissionsUpdates.sol";

/// @notice The ERC-20 spend limit, and the two ways it is weaker than the native one.
///
/// The mandate does not use this path -- USDC is bounded natively and the ERC-20 view at
/// `0x3600…` is kept off the access list entirely. This suite exists to *demonstrate* why, rather
/// than assert it in prose, and because a future mandate over some other token would rely on it.
contract ArcErc20SpendLimitsTest is ArcMscaHarness {
    uint256 internal constant SESSION_KEY_PK = 0xC0FFEE;
    address internal constant TOKEN = address(0x7000);
    address internal constant PAYEE = address(0xDEAD);

    address internal sessionKey;

    function _setUpMandate(bool withSpendLimit, uint256 limit, bool checkSelectors) private {
        sessionKey = vm.addr(SESSION_KEY_PK);
        address[] memory keys = new address[](1);
        keys[0] = sessionKey;
        vm.skip(!_forkArcAndInstall(keys));
        SESSION_KEY_PK_FOR_SPEND = SESSION_KEY_PK;

        bytes[] memory updates = new bytes[](withSpendLimit ? 3 : 2);
        updates[0] =
            abi.encodeCall(ISessionKeyPermissionsUpdates.updateAccessListAddressEntry, (TOKEN, true, checkSelectors));
        updates[1] = abi.encodeCall(ISessionKeyPermissionsUpdates.setGasSpendLimit, (type(uint256).max - 1, 0));
        if (withSpendLimit) {
            updates[2] = abi.encodeCall(ISessionKeyPermissionsUpdates.setERC20SpendLimit, (TOKEN, limit, 0));
        }
        _updatePermissions(sessionKey, updates);
    }

    function _execute(bytes memory data) private {
        Call[] memory calls = new Call[](1);
        calls[0] = Call({target: TOKEN, value: 0, data: data});
        vm.prank(MSCA);
        plugin.executeWithSessionKey(calls, sessionKey);
    }

    function test_transferWithinTheLimitPassesValidation() public {
        _setUpMandate(true, 100e6, false);
        _spendOn(TOKEN, 0, abi.encodeCall(IERC20.transfer, (PAYEE, 100e6)));
    }

    /// **The first weakness.** A native over-spend is refused during *validation*, so it never
    /// reaches a bundle and costs nothing. An ERC-20 over-spend passes validation and is caught
    /// during *execution* -- so the operation is bundled and paid for before being rejected.
    /// The money is still bounded; the gas is not.
    function test_anOverLimitTransferPassesValidationAndIsOnlyCaughtAtExecution() public {
        _setUpMandate(true, 100e6, false);
        bytes memory overLimit = abi.encodeCall(IERC20.transfer, (PAYEE, 100e6 + 1));

        _spendOn(TOKEN, 0, overLimit); // validation does not object

        vm.expectRevert(
            abi.encodeWithSelector(ISessionKeyPlugin.ERC20SpendLimitExceeded.selector, MSCA, sessionKey, TOKEN)
        );
        _execute(overLimit);
    }

    /// **The second weakness, and a correction.** An earlier note said `transferFrom` was an
    /// unmetered hole; a later one said the engine rejects any selector but `transfer`/`approve`
    /// on a limited token. The later note was wrong in the case that matters.
    ///
    /// `_checkCallPermissions` returns early -- `if (!contractData.checkSelectors) return true;` --
    /// **before** reaching the ERC-20 selector gate. So the gate applies only when the token was
    /// allowlisted with `checkSelectors = true`. Allowlisted without it, `transferFrom` validates,
    /// and `_getTokenSpendAmount` returns 0 for it at execution, so it is never metered either.
    function test_theSelectorGateAppliesOnlyWhenCheckSelectorsIsSet() public {
        _setUpMandate(true, 100e6, false);
        // Unbounded transferFrom, permitted and unmetered.
        _spendOn(TOKEN, 0, abi.encodeCall(IERC20.transferFrom, (MSCA, PAYEE, type(uint256).max)));
    }

    function test_withCheckSelectorsTheGateRejectsTransferFrom() public {
        _setUpMandate(true, 100e6, true);
        bytes[] memory allow = new bytes[](1);
        allow[0] = abi.encodeCall(
            ISessionKeyPermissionsUpdates.updateAccessListFunctionEntry, (TOKEN, IERC20.transfer.selector, true)
        );
        _updatePermissions(sessionKey, allow);

        vm.expectRevert(ISessionKeyPlugin.PermissionsCheckFailed.selector);
        _spendOn(TOKEN, 0, abi.encodeCall(IERC20.transferFrom, (MSCA, PAYEE, 1)));
    }

    /// **The third weakness.** Allowlisting a token *without* a spend limit leaves
    /// `isERC20WithSpendLimit` false, which disables the selector gate and the metering together.
    /// Nothing warns you, and the key is unbounded on that token.
    function test_anAllowlistedTokenWithNoLimitIsCompletelyUnbounded() public {
        _setUpMandate(false, 0, false);
        _spendOn(TOKEN, 0, abi.encodeCall(IERC20.transfer, (PAYEE, type(uint256).max)));
    }
}
