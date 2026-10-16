// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PredictionMarket} from "./PredictionMarket.sol";

/// @title MarketFactory
/// @notice Deploys and registers independent PredictionMarket instances. Each
///         market is fully isolated (own tokens, pool, collateral, state), which
///         is what lets many markets run concurrently with no cross-market bleed.
contract MarketFactory {
    /// @notice Upper bound on question length, in UTF-8 bytes. Keeps event data
    ///         and indexer rows bounded; long-form context belongs off-chain.
    uint256 public constant MAX_QUESTION_BYTES = 280;

    address[] public markets;

    event MarketCreated(
        uint256 indexed marketId,
        address market,
        address indexed creator,
        address yesToken,
        address noToken,
        string question,
        uint64 closeTime,
        address resolver
    );

    /// @notice Create a market seeded with the sent ETH as initial liquidity.
    function createMarket(string calldata question, uint64 closeTime, address resolver)
        external
        payable
        returns (address market)
    {
        require(msg.value > 0, "need seed");
        uint256 qLen = bytes(question).length;
        require(qLen > 0 && qLen <= MAX_QUESTION_BYTES, "bad question");

        PredictionMarket m = new PredictionMarket{value: msg.value}(
            question,
            closeTime,
            resolver,
            msg.sender
        );
        market = address(m);
        uint256 marketId = markets.length;
        markets.push(market);

        emit MarketCreated(
            marketId,
            market,
            msg.sender,
            address(m.yesToken()),
            address(m.noToken()),
            question,
            closeTime,
            resolver
        );
    }

    function marketCount() external view returns (uint256) {
        return markets.length;
    }
}
