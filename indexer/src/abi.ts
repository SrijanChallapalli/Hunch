import { Interface } from "ethers";

// Minimal event ABIs the indexer decodes. Kept here so the indexer does not
// depend on Hardhat build artifacts at runtime.
export const factoryIface = new Interface([
  "event MarketCreated(uint256 indexed marketId, address market, address indexed creator, address yesToken, address noToken, string question, uint64 closeTime, address resolver)",
]);

export const marketIface = new Interface([
  "event Bought(address indexed who, bool isYes, uint256 ethIn, uint256 sharesOut)",
  "event Sold(address indexed who, bool isYes, uint256 sharesIn, uint256 ethOut)",
  "event Resolved(uint8 status)",
  "event Redeemed(address indexed who, uint256 shares, uint256 ethOut)",
  "event Refunded(address indexed who, uint256 yesShares, uint256 noShares, uint256 ethOut)",
  "event SetsMinted(address indexed who, uint256 shares)",
  "event SetsMerged(address indexed who, uint256 shares)",
  "event LpSettled(address indexed creator, uint256 ethOut)",
]);

export const tokenIface = new Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export const STATUS_NAME: Record<number, string> = {
  0: "OPEN",
  1: "RESOLVED_YES",
  2: "RESOLVED_NO",
  3: "INVALID",
};
