// This file is part of Modular Account.
//
// Copyright 2024 Alchemy Insights, Inc.
//
// SPDX-License-Identifier: GPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU General
// Public License as published by the Free Software Foundation, either version 3 of the License, or (at your
// option) any later version.
//
// This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the
// implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
// more details.
//
// You should have received a copy of the GNU General Public License along with this program. If not, see
// <https://www.gnu.org/licenses/>.

pragma solidity ^0.8.22;

import {SetValue} from "./Constants.sol";

/// @title Cast Library
/// @author Alchemy
/// @notice Library for various data type conversions.
/// @dev PORTED. Alchemy's original also converts to and from `FunctionReference`, their packed
/// `bytes21` encoding of (plugin, functionId). Circle passes `FunctionReference` as a struct
/// tuple instead, so those overloads would put two incompatible types of one name into a single
/// plugin. The session plugin calls neither, so they are deleted here -- by deletion from the
/// upstream file, never retyped, because the bodies are bit-exact and a hand-copied shift is a
/// silent wrong answer rather than a compile error.
library CastLib {

    /// @dev Input array is not verified. If used with non address type array input, return data will be incorrect.
    function toAddressArray(SetValue[] memory values) internal pure returns (address[] memory addresses) {
        bytes32[] memory valuesBytes;

        assembly ("memory-safe") {
            valuesBytes := values
        }

        uint256 length = values.length;
        for (uint256 i = 0; i < length; ++i) {
            valuesBytes[i] >>= 96;
        }

        assembly ("memory-safe") {
            addresses := valuesBytes
        }

        return addresses;
    }


    function toSetValue(address value) internal pure returns (SetValue) {
        return SetValue.wrap(bytes30(bytes20(value)));
    }
}
