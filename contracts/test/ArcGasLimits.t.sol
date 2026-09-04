// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.24;

import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {Call} from "@circle/msca/6900/v0.7/interfaces/IStandardExecutor.sol";
import {ArcMscaHarness} from "./ArcMscaHarness.sol";
import {ISessionKeyPlugin} from "../src/session/ISessionKeyPlugin.sol";
import {ISessionKeyPermissionsUpdates} from "../src/session/permissions/ISessionKeyPermissionsUpdates.sol";

/// @notice The gas spend limit, which is the one part of the port whose arithmetic was rewritten.
///
/// v0.6 approximated the paymaster's share by tripling `verificationGasLimit`. v0.7 states
/// `paymasterVerificationGasLimit` and `paymasterPostOpGasLimit` outright, so the port mirrors
/// `EntryPoint._getRequiredPrefund` instead. These tests exist because that expression decides
/// whether an agent's gas spending is bounded, and nothing else in the suite touches it.
contract ArcGasLimitsTest is ArcMscaHarness {
    uint256 internal constant SESSION_KEY_PK = 0xA11CE;

    uint128 internal constant VERIFICATION_GAS = 100_000;
    uint128 internal constant CALL_GAS = 200_000;
    uint256 internal constant PRE_VERIFICATION_GAS = 50_000;
    uint128 internal constant MAX_FEE = 1 gwei;

    /// The target the mandate permits. The default access list type is ALLOWLIST and it starts
    /// empty, so a session key can reach nothing until an address is added -- the safe default,
    /// and the reason every test here allowlists before it can measure gas.
    address internal constant PAYEE = address(0xDEAD);

    /// A permission failure **reverts** with this rather than returning SIG_VALIDATION_FAILED.
    /// Worth stating plainly: an over-budget op is not a soft "invalid signature" the bundler
    /// can drop quietly, it is a revert during validation.
    function _expectPermissionsRevert() private {
        vm.expectRevert(ISessionKeyPlugin.PermissionsCheckFailed.selector);
    }

    function _setUpMandate() private returns (address sessionKey) {
        sessionKey = vm.addr(SESSION_KEY_PK);
        address[] memory keys = new address[](1);
        keys[0] = sessionKey;
        vm.skip(!_forkArcAndInstall(keys));

        bytes[] memory updates = new bytes[](1);
        updates[0] = abi.encodeCall(ISessionKeyPermissionsUpdates.updateAccessListAddressEntry, (PAYEE, true, false));
        _updatePermissions(sessionKey, updates);
    }

    function _noCalls() private pure returns (Call[] memory calls) {
        calls = new Call[](1);
        calls[0] = Call({target: PAYEE, value: 0, data: ""});
    }

    function _setGasLimit(address sessionKey, uint256 limit) private {
        bytes[] memory updates = new bytes[](1);
        updates[0] = abi.encodeCall(ISessionKeyPermissionsUpdates.setGasSpendLimit, (limit, 0));
        _updatePermissions(sessionKey, updates);
    }

    /// Without a paymaster the charge is (verification + call + preVerification) * maxFee.
    function test_gasLimitIsMeteredWithoutAPaymaster() public {
        address sessionKey = _setUpMandate();
        uint256 exactCost = (uint256(VERIFICATION_GAS) + CALL_GAS + PRE_VERIFICATION_GAS) * MAX_FEE;

        _setGasLimit(sessionKey, exactCost);
        (PackedUserOperation memory userOp, bytes32 hash) = _sessionKeyUserOp(
            SESSION_KEY_PK, _noCalls(), VERIFICATION_GAS, CALL_GAS, PRE_VERIFICATION_GAS, MAX_FEE, ""
        );
        _validate(userOp, hash); // must not revert
    }

    function test_gasLimitRejectsOneWeiOverBudget() public {
        address sessionKey = _setUpMandate();
        uint256 exactCost = (uint256(VERIFICATION_GAS) + CALL_GAS + PRE_VERIFICATION_GAS) * MAX_FEE;

        _setGasLimit(sessionKey, exactCost - 1);
        (PackedUserOperation memory userOp, bytes32 hash) = _sessionKeyUserOp(
            SESSION_KEY_PK, _noCalls(), VERIFICATION_GAS, CALL_GAS, PRE_VERIFICATION_GAS, MAX_FEE, ""
        );
        _expectPermissionsRevert();
        _validate(userOp, hash);
    }

    /// The substance of the port. A paymaster adds its two v0.7 gas limits to the charge, and
    /// those are read from fixed offsets inside `paymasterAndData`. Under v0.6's tripling
    /// heuristic this op would have been metered at a different figure entirely.
    function test_paymasterGasLimitsAreCountedFromTheirV07Fields() public {
        address sessionKey = _setUpMandate();

        uint128 paymasterVerificationGas = 30_000;
        uint128 paymasterPostOpGas = 40_000;
        bytes memory paymasterAndData = abi.encodePacked(
            address(0xBEEF), paymasterVerificationGas, paymasterPostOpGas
        );

        uint256 expected = (
            uint256(VERIFICATION_GAS) + CALL_GAS + PRE_VERIFICATION_GAS
                + paymasterVerificationGas + paymasterPostOpGas
        ) * MAX_FEE;

        // Exactly the prefund passes...
        _setGasLimit(sessionKey, expected);
        (PackedUserOperation memory userOp, bytes32 hash) = _sessionKeyUserOp(
            SESSION_KEY_PK, _noCalls(), VERIFICATION_GAS, CALL_GAS, PRE_VERIFICATION_GAS, MAX_FEE, paymasterAndData
        );
        _validate(userOp, hash); // the exact v0.7 prefund must pass

        // ...and a limit set one wei below it does not, which is what pins the paymaster fields
        // as *counted* rather than merely parsed.
        _setGasLimit(sessionKey, expected - 1);
        (userOp, hash) = _sessionKeyUserOp(
            SESSION_KEY_PK, _noCalls(), VERIFICATION_GAS, CALL_GAS, PRE_VERIFICATION_GAS, MAX_FEE, paymasterAndData
        );
        _expectPermissionsRevert();
        _validate(userOp, hash);
    }

    /// Reading the paymaster fields from an empty `paymasterAndData` would revert on the slice.
    /// The port guards that; this pins the guard, because the unsponsored path is the common one.
    function test_emptyPaymasterDataDoesNotRevertTheSlice() public {
        address sessionKey = _setUpMandate();
        _setGasLimit(sessionKey, type(uint256).max - 1);
        (PackedUserOperation memory userOp, bytes32 hash) = _sessionKeyUserOp(
            SESSION_KEY_PK, _noCalls(), VERIFICATION_GAS, CALL_GAS, PRE_VERIFICATION_GAS, MAX_FEE, ""
        );
        _validate(userOp, hash); // must not revert
    }
}
