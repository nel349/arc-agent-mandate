// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Call} from "@circle/msca/6900/v0.7/interfaces/IStandardExecutor.sol";
import {ArcMscaHarness} from "./ArcMscaHarness.sol";
import {ISessionKeyPlugin} from "../src/session/ISessionKeyPlugin.sol";
import {ISessionKeyPermissionsUpdates} from "../src/session/permissions/ISessionKeyPermissionsUpdates.sol";

/// @notice Opening the ERC-20 rail far enough to buy things, without opening it far enough to
///         empty the wallet.
///
/// **Why this shape exists.** An agent cannot pay a standards-compliant x402 seller by signing as
/// the account: Circle's Gateway verifies payments with `ecrecover` against the payer's own
/// address, so a contract wallet is refused however it signs. What works instead is escrow --
/// `depositFor` lets the account fund the *agent's* Gateway balance, and the agent then pays with
/// its own key as an ordinary EOA. The agent still never holds spendable money; the escrow can
/// only leave as a payment.
///
/// The cost is that funding an escrow needs `approve` on the ERC-20 view at `0x3600…`, and the
/// mandate denies that view outright today -- for good reason, since an ERC-20 call carries
/// `value == 0` and the native limit never sees it. `ArcPayeeScope` proves that denial is what
/// makes an unscoped mandate honest.
///
/// So the rail cannot simply be opened. It has to be opened *and* metered, and the three
/// weaknesses `ArcErc20SpendLimits` records all apply here. This suite pins the exact
/// configuration that survives them, and the one hole it does not close.
contract ArcGatewayTopUpTest is ArcMscaHarness {
    uint256 internal constant SESSION_KEY_PK = 0xA11CE;

    address internal constant USDC_ERC20_VIEW = 0x3600000000000000000000000000000000000000;
    /// Circle's Gateway Wallet on Arc, where an agent's escrow lives.
    address internal constant GATEWAY = 0x0077777d7EBA4688BDeF3E311b846F25870A19B9;
    address internal constant PAYEE = address(0xDEAD);

    /// The x402 budget: the most that may ever reach the agent's escrow.
    uint256 internal constant ONLINE_BUDGET = 5e6;
    /// The ordinary native limit the app always sets. Present here because the two are metered
    /// separately -- there is no single number covering both rails, and a grant that sets only an
    /// online budget can pay nobody directly.
    uint256 internal constant NATIVE_LIMIT = 5e18;

    bytes4 internal constant DEPOSIT_FOR = bytes4(keccak256("depositFor(address,address,uint256)"));

    address internal sessionKey;

    /// The mandate as the app would grant it once an online budget is set.
    ///
    /// Six updates, and the four that are not routine are load-bearing:
    ///
    /// - `DENYLIST`, so an agent that does not know who it will pay can still pay somebody.
    /// - the ERC-20 view **on the list with `checkSelectors`**, which is the only way to reach the
    ///   plugin's ERC-20 selector gate. Listed without it, the denylist branch returns early and
    ///   the gate never runs.
    /// - `transfer` denied by name, so the rail can fund an escrow and cannot pay a stranger.
    /// - an ERC-20 spend limit, which both meters `approve` and is what sets
    ///   `isERC20WithSpendLimit` -- without it the gate is inert and the key is unbounded on this
    ///   token, which is `ArcErc20SpendLimits`' third weakness.
    function _grantWithOnlineBudget() private {
        sessionKey = vm.addr(SESSION_KEY_PK);
        address[] memory keys = new address[](1);
        keys[0] = sessionKey;
        vm.skip(!_forkArcAndInstall(keys));
        SESSION_KEY_PK_FOR_SPEND = SESSION_KEY_PK;

        bytes[] memory updates = new bytes[](6);
        updates[0] = abi.encodeCall(
            ISessionKeyPermissionsUpdates.setAccessListType,
            (ISessionKeyPlugin.ContractAccessControlType.DENYLIST)
        );
        updates[1] = abi.encodeCall(
            ISessionKeyPermissionsUpdates.updateAccessListAddressEntry, (USDC_ERC20_VIEW, true, true)
        );
        updates[2] = abi.encodeCall(
            ISessionKeyPermissionsUpdates.updateAccessListFunctionEntry,
            (USDC_ERC20_VIEW, IERC20.transfer.selector, true)
        );
        updates[3] = abi.encodeCall(
            ISessionKeyPermissionsUpdates.setERC20SpendLimit, (USDC_ERC20_VIEW, ONLINE_BUDGET, 0)
        );
        updates[4] = abi.encodeCall(ISessionKeyPermissionsUpdates.setGasSpendLimit, (type(uint256).max - 1, 0));
        updates[5] =
            abi.encodeCall(ISessionKeyPermissionsUpdates.setNativeTokenSpendLimit, (NATIVE_LIMIT, 0));
        _updatePermissions(sessionKey, updates);
    }

    function _execute(address target, bytes memory data) private {
        Call[] memory calls = new Call[](1);
        calls[0] = Call({target: target, value: 0, data: data});
        vm.prank(MSCA);
        plugin.executeWithSessionKey(calls, sessionKey);
    }

    // ------------------------------------------------------------------ what the shape permits

    /// The point of the whole configuration: the agent may approve the Gateway, up to the budget.
    function test_approvingTheGatewayIsPermittedAndMetered() public {
        _grantWithOnlineBudget();
        _execute(USDC_ERC20_VIEW, abi.encodeCall(IERC20.approve, (GATEWAY, ONLINE_BUDGET)));
    }

    /// The deposit itself is an ordinary contract call to an address the denylist does not name,
    /// so nothing special is needed to permit it -- which is worth pinning, because it means the
    /// mandate never has to know the Gateway's address.
    function test_theGatewayIsReachableWithoutBeingNamed() public {
        _grantWithOnlineBudget();
        _spendOn(GATEWAY, 0, abi.encodeWithSelector(DEPOSIT_FOR, USDC_ERC20_VIEW, address(this), 1e6));
    }

    /// Opening the rail must not close the ordinary one.
    ///
    /// The two limits are independent: the native one bounds direct payments, the ERC-20 one
    /// bounds what reaches escrow, and neither draws down the other. So a mandate with an online
    /// budget permits `NATIVE_LIMIT + ONLINE_BUDGET` in total, which is what the phone has to say
    /// rather than showing one number and meaning another.
    function test_nativePaymentsStillWork() public {
        _grantWithOnlineBudget();
        _spendOn(PAYEE, NATIVE_LIMIT, "");
    }

    // -------------------------------------------------------------------- what it still refuses

    /// The rail may fund an escrow and may not pay a stranger. Refused during *validation*, so it
    /// never reaches a bundle -- unlike an over-budget approve below.
    function test_transferOnTheErc20RailStaysShut() public {
        _grantWithOnlineBudget();
        vm.expectRevert(ISessionKeyPlugin.PermissionsCheckFailed.selector);
        _spendOn(USDC_ERC20_VIEW, 0, abi.encodeCall(IERC20.transfer, (PAYEE, 1e6)));
    }

    /// `transferFrom` is the selector `ArcErc20SpendLimits` found unmetered when the gate is off.
    /// With `checkSelectors` set, the gate rejects it.
    function test_transferFromIsRefused() public {
        _grantWithOnlineBudget();
        vm.expectRevert(ISessionKeyPlugin.PermissionsCheckFailed.selector);
        _spendOn(USDC_ERC20_VIEW, 0, abi.encodeCall(IERC20.transferFrom, (MSCA, PAYEE, 1)));
    }

    /// The budget binds. Note *where* it binds: an over-budget approve passes validation and is
    /// caught at execution, so the operation is bundled and paid for before being rejected. The
    /// money is bounded; the gas is not. That is inherent to the plugin's ERC-20 path, and it is
    /// why the connector checks the budget before sending rather than relying on this.
    function test_anOverBudgetApproveIsCaughtAtExecution() public {
        _grantWithOnlineBudget();
        bytes memory overBudget = abi.encodeCall(IERC20.approve, (GATEWAY, ONLINE_BUDGET + 1));

        _spendOn(USDC_ERC20_VIEW, 0, overBudget); // validation does not object

        vm.expectRevert(
            abi.encodeWithSelector(
                ISessionKeyPlugin.ERC20SpendLimitExceeded.selector, MSCA, sessionKey, USDC_ERC20_VIEW
            )
        );
        _execute(USDC_ERC20_VIEW, overBudget);
    }

    /// Approving twice cannot spend the budget twice: the plugin counts the approved amount every
    /// time, whether or not an allowance already exists. Without that, a top-up loop would be a
    /// way to drain the wallet one approval at a time.
    function test_repeatedApprovalsCannotExceedTheBudgetInAggregate() public {
        _grantWithOnlineBudget();
        _execute(USDC_ERC20_VIEW, abi.encodeCall(IERC20.approve, (GATEWAY, ONLINE_BUDGET)));

        vm.expectRevert(
            abi.encodeWithSelector(
                ISessionKeyPlugin.ERC20SpendLimitExceeded.selector, MSCA, sessionKey, USDC_ERC20_VIEW
            )
        );
        _execute(USDC_ERC20_VIEW, abi.encodeCall(IERC20.approve, (GATEWAY, 1)));
    }

    // ------------------------------------------------------------------ the hole this leaves

    /// **The one thing this configuration cannot do**, recorded rather than hidden.
    ///
    /// The plugin meters *how much* is approved and has no opinion about *who* is approved --
    /// `_getTokenSpendAmount` reads the amount out of the calldata and never looks at the spender.
    /// So a compromised agent can approve an address of its choosing, and spend the online budget
    /// somewhere other than the Gateway.
    ///
    /// The exposure is exactly the budget, which is the argument for keeping it small and topping
    /// up often rather than granting a large one once. It cannot be closed inside the plugin
    /// without teaching it to decode a spender, which is a change to the ported contract.
    function test_theApprovedSpenderIsNotConstrained() public {
        _grantWithOnlineBudget();
        _execute(USDC_ERC20_VIEW, abi.encodeCall(IERC20.approve, (PAYEE, ONLINE_BUDGET)));
    }
}
