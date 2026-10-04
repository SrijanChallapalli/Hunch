// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PredictionMarket} from "../PredictionMarket.sol";

/// @notice Test-only: tries to re-enter the market on ETH receipt. The market's
///         nonReentrant guard must make the outer call revert atomically.
contract ReentrancyAttacker {
    PredictionMarket public immutable market;
    bool public attack;

    constructor(PredictionMarket m) {
        market = m;
    }

    function mint() external payable {
        market.mintSet{value: msg.value}();
    }

    function setAttack(bool v) external {
        attack = v;
    }

    function doMerge(uint256 shares) external {
        market.mergeSet(shares);
    }

    receive() external payable {
        if (attack) {
            // re-enter during the outer payout; guard should revert this
            market.mergeSet(1);
        }
    }
}
