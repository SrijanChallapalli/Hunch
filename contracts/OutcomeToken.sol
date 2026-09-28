// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title OutcomeToken
/// @notice A YES or NO outcome share. One per outcome, two per market.
/// @dev Mint and burn are restricted to the owning PredictionMarket, which is
///      the account that deploys this token (set once in the constructor).
contract OutcomeToken is ERC20 {
    address public immutable market;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        market = msg.sender;
    }

    modifier onlyMarket() {
        require(msg.sender == market, "OutcomeToken: only market");
        _;
    }

    function mint(address to, uint256 amount) external onlyMarket {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyMarket {
        _burn(from, amount);
    }
}
