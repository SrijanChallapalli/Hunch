// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PredictionMarket} from "../PredictionMarket.sol";

/// @notice Test-only: a holder that cannot accept ETH. A payout to it must make
///         the redeem revert atomically, leaving tokens and collateral intact.
contract RejectETH {
    PredictionMarket public immutable market;

    constructor(PredictionMarket m) {
        market = m;
    }

    function doRedeem(uint256 shares) external {
        market.redeem(shares);
    }
    // intentionally no receive() / fallback(): cannot accept ETH
}
