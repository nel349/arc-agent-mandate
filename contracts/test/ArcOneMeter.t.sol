// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Call} from "@circle/msca/6900/v0.7/interfaces/IStandardExecutor.sol";
import {ArcMscaHarness} from "./ArcMscaHarness.sol";
import {ISessionKeyPlugin} from "../src/session/ISessionKeyPlugin.sol";
import {ISessionKeyPermissionsUpdates} from "../src/session/permissions/ISessionKeyPermissionsUpdates.sol";

/// @notice Can one limit bound everything an agent does, instead of two?
///
/// **The problem this is testing a way out of.** Arc's dollar is reachable two ways -- natively,
/// where the mandate's native limit counts `call.value`, and through the ERC-20 view at
/// `0x3600…`, where a separate ERC-20 limit counts the amount in the calldata. The plugin meters
/// them independently and neither draws down the other, so a mandate carrying both permits their
/// sum. That forces a person to understand two numbers, or be shown one that is not the truth.
///
/// **The way out.** Nothing requires direct payments to use the native rail. If every payment an
/// agent makes goes through the ERC-20 view -- `transfer` to pay someone, `approve` to fund an
/// x402 escrow -- then one ERC-20 limit meters all of it, and the native limit can be set to zero
/// so no value-carrying call is possible at all. One number, one meter, and the number is true.
///
/// This suite is the evidence for that claim, and for its cost.
///
/// **One thing it cannot show here.** Arc's ERC-20 view is not an ordinary contract: it delegates
/// balance movement to a native precompile at `0x1800…`, which Foundry cannot simulate, so an
/// executed `transfer` reverts on a fork with `StackUnderflow` no matter how the mandate is set.
/// `approve` is unaffected, being pure storage. So `transfer` is proven here as far as validation
/// and metering, and the rest was proven against the live chain: a real `transfer` on `0x3600`
/// moved 0.12 USDC and the recipient's *native* balance rose by exactly that, which is the whole
/// claim -- a payment on this rail is indistinguishable from a native one to whoever receives it.
contract ArcOneMeterTest is ArcMscaHarness {
    uint256 internal constant SESSION_KEY_PK = 0xBEEF;

    address internal constant USDC_ERC20_VIEW = 0x3600000000000000000000000000000000000000;
    address internal constant GATEWAY = 0x0077777d7EBA4688BDeF3E311b846F25870A19B9;
    address internal constant PAYEE = address(0xDEAD);

    /// The whole mandate, at ERC-20 scale. 20 USDC.
    uint256 internal constant LIMIT = 20e6;

    address internal sessionKey;

    /// One limit, on the rail everything travels.
    ///
    /// The native limit is left at its default of zero, which refuses any call carrying value.
    /// That is not a restriction to work around -- it is what makes the ERC-20 limit the *whole*
    /// mandate rather than half of it.
    function _grantOneMeter() private {
        sessionKey = vm.addr(SESSION_KEY_PK);
        address[] memory keys = new address[](1);
        keys[0] = sessionKey;
        vm.skip(!_forkArcAndInstall(keys));
        SESSION_KEY_PK_FOR_SPEND = SESSION_KEY_PK;

        bytes[] memory updates = new bytes[](4);
        updates[0] = abi.encodeCall(
            ISessionKeyPermissionsUpdates.setAccessListType,
            (ISessionKeyPlugin.ContractAccessControlType.DENYLIST)
        );
        // On the list with selector checking, which is the only way to reach the ERC-20 gate.
        updates[1] = abi.encodeCall(
            ISessionKeyPermissionsUpdates.updateAccessListAddressEntry, (USDC_ERC20_VIEW, true, true)
        );
        updates[2] =
            abi.encodeCall(ISessionKeyPermissionsUpdates.setERC20SpendLimit, (USDC_ERC20_VIEW, LIMIT, 0));
        updates[3] = abi.encodeCall(ISessionKeyPermissionsUpdates.setGasSpendLimit, (type(uint256).max - 1, 0));
        _updatePermissions(sessionKey, updates);
    }

    function _execute(address target, uint256 value, bytes memory data) private {
        Call[] memory calls = new Call[](1);
        calls[0] = Call({target: target, value: value, data: data});
        vm.prank(MSCA);
        plugin.executeWithSessionKey(calls, sessionKey);
    }

    // ------------------------------------------------------------- one meter covers both uses

    /// Paying a person, through the ERC-20 view rather than as native value. Validation only --
    /// see the note above about the precompile.
    function test_payingSomeoneIsPermittedOnTheOneRail() public {
        _grantOneMeter();
        _spendOn(USDC_ERC20_VIEW, 0, abi.encodeCall(IERC20.transfer, (PAYEE, 5e6)));
    }

    /// Funding an x402 escrow, through the same meter.
    function test_fundingAnEscrowGoesThroughTheSameMeter() public {
        _grantOneMeter();
        _execute(USDC_ERC20_VIEW, 0, abi.encodeCall(IERC20.approve, (GATEWAY, 5e6)));
    }

    /// **The claim that makes one number honest.** Successive spends draw down the *same*
    /// allowance, so 20 spent across several calls is 20 -- not 20 each.
    ///
    /// Written with approvals because those are what a fork can execute. The plugin does not
    /// distinguish: `_getTokenSpendAmount` reads the amount out of the calldata for `transfer` and
    /// `approve` alike, and `ArcErc20SpendLimits` already meters a `transfer` through that same
    /// path. So the aggregate below is the behaviour a mixed run of payments and top-ups gets.
    function test_successiveSpendsShareOneAllowance() public {
        _grantOneMeter();
        _execute(USDC_ERC20_VIEW, 0, abi.encodeCall(IERC20.approve, (GATEWAY, 12e6)));
        _execute(USDC_ERC20_VIEW, 0, abi.encodeCall(IERC20.approve, (GATEWAY, 8e6)));

        // 20 of 20 is gone; a further cent is refused.
        vm.expectRevert(
            abi.encodeWithSelector(
                ISessionKeyPlugin.ERC20SpendLimitExceeded.selector, MSCA, sessionKey, USDC_ERC20_VIEW
            )
        );
        _execute(USDC_ERC20_VIEW, 0, abi.encodeCall(IERC20.transfer, (PAYEE, 1e4)));
    }

    // ------------------------------------------------------------------ and nothing escapes it

    /// The native rail is shut, so there is no second way to move money and nothing to meter twice.
    /// This is the load-bearing half: leaving a native limit set would reintroduce the two-number
    /// problem the whole shape exists to remove.
    function test_theNativeRailIsShutSoThereIsNoSecondMeter() public {
        _grantOneMeter();
        vm.expectRevert(
            abi.encodeWithSelector(
                ISessionKeyPlugin.NativeTokenSpendLimitExceeded.selector, MSCA, sessionKey
            )
        );
        _execute(PAYEE, 1, "");
    }

    /// A contract call carrying value is refused for the same reason, so "pay a contract" cannot
    /// smuggle native money past the meter either.
    function test_aValueCarryingContractCallIsAlsoRefused() public {
        _grantOneMeter();
        vm.expectRevert(
            abi.encodeWithSelector(
                ISessionKeyPlugin.NativeTokenSpendLimitExceeded.selector, MSCA, sessionKey
            )
        );
        _execute(GATEWAY, 1, abi.encodeWithSignature("deposit(address,uint256)", USDC_ERC20_VIEW, uint256(1)));
    }

    /// `transferFrom` would move the same dollars unmetered -- `_getTokenSpendAmount` returns zero
    /// for it -- and the selector gate is what refuses it.
    function test_transferFromCannotSlipPastTheMeter() public {
        _grantOneMeter();
        vm.expectRevert(ISessionKeyPlugin.PermissionsCheckFailed.selector);
        _spendOn(USDC_ERC20_VIEW, 0, abi.encodeCall(IERC20.transferFrom, (MSCA, PAYEE, 1)));
    }

    /// Calling the Gateway itself stays permitted, since a deposit that carries no value spends
    /// nothing on its own -- the money moved when the approval was metered.
    function test_theGatewayIsStillReachableForTheDepositItself() public {
        _grantOneMeter();
        _spendOn(GATEWAY, 0, abi.encodeWithSignature(
            "depositFor(address,address,uint256)", USDC_ERC20_VIEW, PAYEE, uint256(1e6)
        ));
    }

    // ------------------------------------------------------------------------------- the cost

    /// **What one number costs.** A native over-spend is refused during *validation*, so it never
    /// reaches a bundle. An ERC-20 over-spend passes validation and is caught during *execution*,
    /// so the operation is bundled and paid for before being rejected. Moving everything onto this
    /// rail moves every refusal to the expensive side of that line.
    ///
    /// The money is still bounded either way, and gas is sponsored, so the cost is Circle's rather
    /// than the user's -- but the connector should check the limit before sending rather than
    /// letting the chain refuse, because here the chain refuses late.
    function test_refusalsNowCostGasBecauseTheyHappenAtExecution() public {
        _grantOneMeter();
        bytes memory overLimit = abi.encodeCall(IERC20.approve, (GATEWAY, LIMIT + 1));

        _spendOn(USDC_ERC20_VIEW, 0, overLimit); // validation does not object

        vm.expectRevert(
            abi.encodeWithSelector(
                ISessionKeyPlugin.ERC20SpendLimitExceeded.selector, MSCA, sessionKey, USDC_ERC20_VIEW
            )
        );
        _execute(USDC_ERC20_VIEW, 0, overLimit);
    }

    // ------------------------------------------------------------- what one meter cannot keep

    /// **The feature this shape gives up, and the reason a scoped mandate must not use it.**
    ///
    /// On the native rail the payee *is* the call's target, so the access list scopes who an agent
    /// may pay. On this rail the target is always the ERC-20 view and the recipient is an argument
    /// inside the calldata -- which the plugin never reads. `_getTokenSpendAmount` reaches past it
    /// to the amount, and nothing else looks. `RecipientAddressLib` exists in Circle's tree for
    /// exactly this and our plugin does not use it.
    ///
    /// So: a mandate that names payees has to keep the native rail, where naming them means
    /// something. A mandate that names none -- the app's default, because an agent shopping the
    /// open web does not know who it will pay -- loses nothing by moving here.
    function test_payeeScopingDoesNotSurviveOnThisRail() public {
        _grantOneMeter();
        // Deny the payee by name, as explicitly as a denylist can.
        bytes[] memory deny = new bytes[](1);
        deny[0] = abi.encodeCall(
            ISessionKeyPermissionsUpdates.updateAccessListAddressEntry, (PAYEE, true, false)
        );
        _updatePermissions(sessionKey, deny);

        // A direct payment to it is refused...
        vm.expectRevert(ISessionKeyPlugin.PermissionsCheckFailed.selector);
        _spendOn(PAYEE, 1, "");

        // ...and the same payment through the ERC-20 view is not, because the list never sees it.
        _spendOn(USDC_ERC20_VIEW, 0, abi.encodeCall(IERC20.transfer, (PAYEE, 1e6)));
    }
}
