// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {Call} from "@circle/msca/6900/v0.7/interfaces/IStandardExecutor.sol";
import {ArcMscaHarness} from "./ArcMscaHarness.sol";
import {ISessionKeyPlugin} from "../src/session/ISessionKeyPlugin.sol";
import {ISessionKeyPermissionsUpdates} from "../src/session/permissions/ISessionKeyPermissionsUpdates.sol";

/// @notice Who a mandate may pay — the question the product answers one way and the plugin
///         answers another.
///
/// `PRODUCT.md` states the mandate bounds **how much and for how long, not who**, and the app
/// grants accordingly: `buildGrantCalls` is called with an empty `payees` array, because an agent
/// shopping the open web does not know who it will pay until it finds a service.
///
/// The plugin disagrees. A session key's access control defaults to `ALLOWLIST` (enum value 0),
/// and `_checkCallPermissions` opens with `if (!contractData.isOnList) return false` — which
/// applies to a plain value transfer to an EOA, not only to contract calls. An empty allowlist is
/// therefore not "anyone", it is "no one".
///
/// Every other suite here, and the demo script, grant with the payee explicitly listed, so none of
/// them exercise the path the app actually takes. These tests do.
contract ArcPayeeScopeTest is ArcMscaHarness {
    uint256 internal constant SESSION_KEY_PK = 0xB0B;
    address internal constant PAYEE = address(0xDEAD);
    address internal constant USDC_ERC20_VIEW = 0x3600000000000000000000000000000000000000;

    uint128 internal constant VERIFICATION_GAS = 100_000;
    uint128 internal constant CALL_GAS = 200_000;
    uint256 internal constant PRE_VERIFICATION_GAS = 50_000;
    uint128 internal constant MAX_FEE = 1 gwei;

    address internal sessionKey;

    /// A mandate granted the way the app grants one: a limit, gas, and no payees named.
    function _grantWithoutPayees() private {
        sessionKey = vm.addr(SESSION_KEY_PK);
        address[] memory keys = new address[](1);
        keys[0] = sessionKey;
        vm.skip(!_forkArcAndInstall(keys));

        bytes[] memory updates = new bytes[](2);
        updates[0] = abi.encodeCall(ISessionKeyPermissionsUpdates.setNativeTokenSpendLimit, (50e18, 0));
        updates[1] = abi.encodeCall(ISessionKeyPermissionsUpdates.setGasSpendLimit, (type(uint256).max - 1, 0));
        _updatePermissions(sessionKey, updates);
    }

    function _apply(bytes memory update) private {
        bytes[] memory updates = new bytes[](1);
        updates[0] = update;
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

    /// The bug. A mandate granted with no payees — the only kind the app grants — cannot move a
    /// single wei, to anybody, despite carrying a 50 USDC limit and unbounded gas.
    function test_anAllowanceWithNoPayeesCanSpendNothing() public {
        _grantWithoutPayees();
        vm.expectRevert(ISessionKeyPlugin.PermissionsCheckFailed.selector);
        _spendLocal(PAYEE, 1, "");
    }

    /// The fix. `DENYLIST` inverts the default: anything not named is allowed, which is what
    /// "bounds how much and for how long, not who" actually requires.
    function test_denylistIsWhatMakesAnUnscopedAllowanceSpendable() public {
        _grantWithoutPayees();
        _apply(
            abi.encodeCall(
                ISessionKeyPermissionsUpdates.setAccessListType,
                (ISessionKeyPlugin.ContractAccessControlType.DENYLIST)
            )
        );
        _spendLocal(PAYEE, 1e18, "");
    }

    /// The cost of the fix, and the reason it cannot be applied on its own.
    ///
    /// Arc's USDC is the native token *and* an ERC-20 view over the same balance. Today that view
    /// is closed to session keys only because an empty allowlist closes everything. Invert to a
    /// denylist and the rail opens: the key can move the same dollars through `transfer`, where
    /// the native spend limit does not see them, because an ERC-20 call carries `value == 0`.
    function test_denylistAloneReopensTheErc20Rail() public {
        _grantWithoutPayees();
        _apply(
            abi.encodeCall(
                ISessionKeyPermissionsUpdates.setAccessListType,
                (ISessionKeyPlugin.ContractAccessControlType.DENYLIST)
            )
        );
        _spendLocal(USDC_ERC20_VIEW, 0, abi.encodeWithSignature("transfer(address,uint256)", PAYEE, uint256(1e6)));
    }

    /// The complete fix *for a mandate metered natively*: invert the list, then name the one rail
    /// that must stay shut.
    ///
    /// **Superseded for the unscoped case, and kept because it is still the scoped one.** An
    /// unscoped mandate no longer shuts this rail -- it moves onto it, meters everything there
    /// with a single ERC-20 limit, and leaves the native limit at zero. That is what lets a person
    /// be shown one number that is the whole truth; see `ArcOneMeter`. A mandate that *names*
    /// payees still uses the shape below, because the ERC-20 rail cannot scope a payee: the access
    /// list sees the token as the target and never reads the recipient out of the calldata.
    function test_denyingTheErc20ViewClosesTheSecondRailAgain() public {
        _grantWithoutPayees();
        _apply(
            abi.encodeCall(
                ISessionKeyPermissionsUpdates.setAccessListType,
                (ISessionKeyPlugin.ContractAccessControlType.DENYLIST)
            )
        );
        _apply(
            abi.encodeCall(
                ISessionKeyPermissionsUpdates.updateAccessListAddressEntry, (USDC_ERC20_VIEW, true, false)
            )
        );

        // Ordinary payments still work…
        _spendLocal(PAYEE, 1e18, "");

        // …and the second rail is shut.
        vm.expectRevert(ISessionKeyPlugin.PermissionsCheckFailed.selector);
        _spendLocal(USDC_ERC20_VIEW, 0, abi.encodeWithSignature("transfer(address,uint256)", PAYEE, uint256(1e6)));
    }
}
