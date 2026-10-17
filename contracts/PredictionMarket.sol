// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {OutcomeToken} from "./OutcomeToken.sol";

/// @title PredictionMarket
/// @notice One binary YES/NO market. Collateral-backed by complete sets, priced
///         by a single-LP constant-product AMM (FPMM). See docs/decisions.md.
///
/// Money model (all amounts of shares are in token base units, 1e18 = 1 whole share):
///   - mint a set:  send `n * UNIT_WEI` wei -> receive n YES + n NO
///   - merge a set: burn n YES + n NO       -> receive `n * UNIT_WEI` wei
///   - winner redeem: burn n winning        -> receive `n * UNIT_WEI` wei
///   - invalid refund: burn n (either side)  -> receive `n * UNIT_WEI / 2` wei
///
/// Solvency invariant (every state): balance >= requiredCollateral()
/// (equality up to rounding dust that always favors the contract).
contract PredictionMarket is ReentrancyGuard {
    enum Status { OPEN, RESOLVED_YES, RESOLVED_NO, INVALID }

    uint256 public constant ONE = 1e18; // token base units per whole share
    uint256 public constant UNIT_WEI = 1e16; // wei paid per winning whole share (0.01 ETH)
    uint256 public constant RESOLVE_GRACE = 7 days;

    OutcomeToken public immutable yesToken;
    OutcomeToken public immutable noToken;
    address public immutable creator;
    address public immutable resolver;
    uint64 public immutable closeTime;
    string public question;

    uint256 public rYes; // YES pool reserve (base units)
    uint256 public rNo; // NO pool reserve (base units)
    Status public status;
    bool public lpSettled;

    event SetsMinted(address indexed who, uint256 shares);
    event SetsMerged(address indexed who, uint256 shares);
    event Bought(address indexed who, bool isYes, uint256 ethIn, uint256 sharesOut);
    event Sold(address indexed who, bool isYes, uint256 sharesIn, uint256 ethOut);
    event Resolved(Status status);
    event Redeemed(address indexed who, uint256 shares, uint256 ethOut);
    event Refunded(address indexed who, uint256 yesShares, uint256 noShares, uint256 ethOut);
    event LpSettled(address indexed creator, uint256 ethOut);

    constructor(
        string memory question_,
        uint64 closeTime_,
        address resolver_,
        address creator_
    ) payable {
        require(msg.value > 0, "no seed");
        require(resolver_ != address(0), "resolver=0");
        require(closeTime_ > block.timestamp, "bad close");
        question = question_;
        closeTime = closeTime_;
        resolver = resolver_;
        creator = creator_;
        yesToken = new OutcomeToken("YES outcome share", "YES");
        noToken = new OutcomeToken("NO outcome share", "NO");

        uint256 m0 = (msg.value * ONE) / UNIT_WEI; // seed sets
        yesToken.mint(address(this), m0);
        noToken.mint(address(this), m0);
        rYes = m0;
        rNo = m0; // 50/50 start => 50% implied probability
    }

    // --------------------------------------------------------------------- //
    //  Views                                                                //
    // --------------------------------------------------------------------- //

    function tradingOpen() public view returns (bool) {
        return status == Status.OPEN && block.timestamp < closeTime;
    }

    /// @dev Pre-resolution, YES supply == NO supply == sets outstanding.
    function setsOutstanding() external view returns (uint256) {
        return yesToken.totalSupply();
    }

    /// @notice ETH the contract must hold to cover all outstanding obligations.
    function requiredCollateral() public view returns (uint256) {
        if (status == Status.RESOLVED_YES) return _weiFor(yesToken.totalSupply());
        if (status == Status.RESOLVED_NO) return _weiFor(noToken.totalSupply());
        if (status == Status.INVALID) {
            return _weiFor(yesToken.totalSupply() + noToken.totalSupply()) / 2;
        }
        // OPEN: supplies are equal
        return _weiFor(yesToken.totalSupply());
    }

    function invariantHolds() external view returns (bool) {
        return address(this).balance >= requiredCollateral();
    }

    /// @notice Implied probability of YES, scaled by 1e18.
    function priceYes() external view returns (uint256) {
        return (rNo * ONE) / (rYes + rNo);
    }

    /// @notice Shares `buy(isYes, 0)` would return for `ethIn` wei at current reserves.
    function quoteBuy(bool isYes, uint256 ethIn) external view returns (uint256) {
        uint256 m = (ethIn * ONE) / UNIT_WEI;
        if (m == 0) return 0;
        uint256 k = rYes * rNo;
        return isYes ? (rYes + m) - k / (rNo + m) : (rNo + m) - k / (rYes + m);
    }

    /// @notice Wei `sell(isYes, sharesIn, 0)` would pay at current reserves.
    /// @dev Reverts "insufficient liquidity" exactly when the sell would.
    function quoteSell(bool isYes, uint256 sharesIn) external view returns (uint256) {
        if (sharesIn == 0) return 0;
        uint256 R = isYes ? _solveReturn(rYes, rNo, sharesIn) : _solveReturn(rNo, rYes, sharesIn);
        return _weiFor(R);
    }

    // --------------------------------------------------------------------- //
    //  Complete-set primitives                                              //
    // --------------------------------------------------------------------- //

    function mintSet() external payable nonReentrant {
        require(tradingOpen(), "closed");
        require(msg.value > 0, "zero");
        uint256 m = (msg.value * ONE) / UNIT_WEI;
        yesToken.mint(msg.sender, m);
        noToken.mint(msg.sender, m);
        emit SetsMinted(msg.sender, m);
    }

    function mergeSet(uint256 shares) external nonReentrant {
        require(shares > 0, "zero");
        yesToken.burn(msg.sender, shares);
        noToken.burn(msg.sender, shares);
        uint256 out = _weiFor(shares);
        _pay(msg.sender, out);
        emit SetsMerged(msg.sender, shares);
    }

    // --------------------------------------------------------------------- //
    //  Trading (FPMM, exact-input swaps)                                    //
    // --------------------------------------------------------------------- //

    /// @notice Buy outcome shares with exact ETH in; revert if out < minSharesOut.
    function buy(bool isYes, uint256 minSharesOut)
        external
        payable
        nonReentrant
        returns (uint256 sharesOut)
    {
        require(tradingOpen(), "closed");
        require(msg.value > 0, "zero");

        uint256 m = (msg.value * ONE) / UNIT_WEI; // sets minted into the pool
        yesToken.mint(address(this), m);
        noToken.mint(address(this), m);

        uint256 k = rYes * rNo;
        if (isYes) {
            uint256 newRNo = rNo + m;
            uint256 newRYes = k / newRNo; // floor: trader gets a hair more (LP bears it)
            sharesOut = (rYes + m) - newRYes;
            rYes = newRYes;
            rNo = newRNo;
            require(sharesOut >= minSharesOut, "slippage");
            yesToken.transfer(msg.sender, sharesOut);
        } else {
            uint256 newRYes = rYes + m;
            uint256 newRNo = k / newRYes;
            sharesOut = (rNo + m) - newRNo;
            rNo = newRNo;
            rYes = newRYes;
            require(sharesOut >= minSharesOut, "slippage");
            noToken.transfer(msg.sender, sharesOut);
        }
        emit Bought(msg.sender, isYes, msg.value, sharesOut);
    }

    /// @notice Sell exact outcome shares in for ETH; revert if proceeds < minProceeds.
    /// @dev Caller must approve this market for `sharesIn` of the outcome token.
    function sell(bool isYes, uint256 sharesIn, uint256 minProceeds)
        external
        nonReentrant
        returns (uint256 proceeds)
    {
        require(tradingOpen(), "closed");
        require(sharesIn > 0, "zero");

        uint256 R;
        if (isYes) {
            yesToken.transferFrom(msg.sender, address(this), sharesIn);
            R = _solveReturn(rYes, rNo, sharesIn);
            yesToken.burn(address(this), R);
            noToken.burn(address(this), R);
            rYes = rYes + sharesIn - R;
            rNo = rNo - R;
        } else {
            noToken.transferFrom(msg.sender, address(this), sharesIn);
            R = _solveReturn(rNo, rYes, sharesIn);
            noToken.burn(address(this), R);
            yesToken.burn(address(this), R);
            rNo = rNo + sharesIn - R;
            rYes = rYes - R;
        }

        proceeds = _weiFor(R);
        require(proceeds >= minProceeds, "slippage");
        _pay(msg.sender, proceeds);
        emit Sold(msg.sender, isYes, sharesIn, proceeds);
    }

    /// @dev Number of complete sets `R` to merge so the seller receives fair value.
    ///      Solves R^2 - R*(rSell+rOther+sharesIn) + sharesIn*rOther = 0 for the
    ///      smaller root. Ceil the sqrt so R rounds DOWN (contract never over-pays).
    function _solveReturn(uint256 rSell, uint256 rOther, uint256 sharesIn)
        internal
        pure
        returns (uint256 R)
    {
        uint256 B = rSell + rOther + sharesIn;
        uint256 disc = B * B - 4 * sharesIn * rOther; // always >= 0 (see docs)
        uint256 s = Math.sqrt(disc, Math.Rounding.Ceil);
        R = (B - s) / 2;
        require(R < rOther, "insufficient liquidity");
    }

    // --------------------------------------------------------------------- //
    //  Close / resolve / redeem / refund                                    //
    // --------------------------------------------------------------------- //

    /// @param outcome 1 = YES, 2 = NO, 3 = INVALID
    function resolve(uint8 outcome) external {
        require(msg.sender == resolver, "not resolver");
        require(block.timestamp >= closeTime, "not closed");
        require(status == Status.OPEN, "resolved");
        require(outcome >= 1 && outcome <= 3, "bad outcome");
        status = outcome == 1
            ? Status.RESOLVED_YES
            : outcome == 2 ? Status.RESOLVED_NO : Status.INVALID;
        emit Resolved(status);
    }

    /// @notice Anyone can force INVALID if the resolver never acts (funds-safety).
    function forceInvalid() external {
        require(block.timestamp >= closeTime + RESOLVE_GRACE, "grace");
        require(status == Status.OPEN, "resolved");
        status = Status.INVALID;
        emit Resolved(status);
    }

    function redeem(uint256 shares) external nonReentrant {
        require(shares > 0, "zero");
        require(
            status == Status.RESOLVED_YES || status == Status.RESOLVED_NO,
            "not resolved"
        );
        if (status == Status.RESOLVED_YES) {
            yesToken.burn(msg.sender, shares);
        } else {
            noToken.burn(msg.sender, shares);
        }
        uint256 out = _weiFor(shares);
        _pay(msg.sender, out);
        emit Redeemed(msg.sender, shares, out);
    }

    function refundInvalid(uint256 yesShares, uint256 noShares) external nonReentrant {
        require(status == Status.INVALID, "not invalid");
        require(yesShares > 0 || noShares > 0, "zero");
        if (yesShares > 0) yesToken.burn(msg.sender, yesShares);
        if (noShares > 0) noToken.burn(msg.sender, noShares);
        uint256 out = _weiFor(yesShares + noShares) / 2;
        _pay(msg.sender, out);
        emit Refunded(msg.sender, yesShares, noShares, out);
    }

    /// @notice Creator (sole LP) claims the pool's residual value after resolution.
    function settleLP() external nonReentrant {
        require(msg.sender == creator, "not creator");
        require(status != Status.OPEN, "not resolved");
        require(!lpSettled, "settled");
        lpSettled = true;

        uint256 out;
        if (status == Status.RESOLVED_YES) {
            uint256 b = yesToken.balanceOf(address(this));
            if (b > 0) yesToken.burn(address(this), b);
            out = _weiFor(b);
        } else if (status == Status.RESOLVED_NO) {
            uint256 b = noToken.balanceOf(address(this));
            if (b > 0) noToken.burn(address(this), b);
            out = _weiFor(b);
        } else {
            uint256 by = yesToken.balanceOf(address(this));
            uint256 bn = noToken.balanceOf(address(this));
            if (by > 0) yesToken.burn(address(this), by);
            if (bn > 0) noToken.burn(address(this), bn);
            out = _weiFor(by + bn) / 2;
        }
        if (out > 0) _pay(creator, out);
        emit LpSettled(creator, out);
    }

    // --------------------------------------------------------------------- //
    //  Internal                                                             //
    // --------------------------------------------------------------------- //

    function _weiFor(uint256 shares) internal pure returns (uint256) {
        return (shares * UNIT_WEI) / ONE; // rounds down -> dust favors contract
    }

    function _pay(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "pay failed");
    }
}
