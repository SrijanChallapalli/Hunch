// Human-readable ABIs for the calls the UI makes. Kept in sync with contracts/.
export const FACTORY_ABI = [
  "function createMarket(string question, uint64 closeTime, address resolver) payable returns (address)",
  "function marketCount() view returns (uint256)",
  "function markets(uint256) view returns (address)",
  "event MarketCreated(uint256 indexed marketId, address market, address indexed creator, address yesToken, address noToken, string question, uint64 closeTime, address resolver)",
];

export const MARKET_ABI = [
  "function question() view returns (string)",
  "function yesToken() view returns (address)",
  "function noToken() view returns (address)",
  "function creator() view returns (address)",
  "function resolver() view returns (address)",
  "function closeTime() view returns (uint64)",
  "function status() view returns (uint8)",
  "function rYes() view returns (uint256)",
  "function rNo() view returns (uint256)",
  "function lpSettled() view returns (bool)",
  "function tradingOpen() view returns (bool)",
  "function priceYes() view returns (uint256)",
  "function quoteBuy(bool isYes, uint256 ethIn) view returns (uint256)",
  "function quoteSell(bool isYes, uint256 sharesIn) view returns (uint256)",
  "function requiredCollateral() view returns (uint256)",
  "function invariantHolds() view returns (bool)",
  "function RESOLVE_GRACE() view returns (uint256)",
  "function buy(bool isYes, uint256 minSharesOut) payable returns (uint256)",
  "function sell(bool isYes, uint256 sharesIn, uint256 minProceeds) returns (uint256)",
  "function mintSet() payable",
  "function mergeSet(uint256 shares)",
  "function resolve(uint8 outcome)",
  "function forceInvalid()",
  "function redeem(uint256 shares)",
  "function refundInvalid(uint256 yesShares, uint256 noShares)",
  "function settleLP()",
];

export const TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
];

export const STATUS = ["OPEN", "RESOLVED_YES", "RESOLVED_NO", "INVALID"] as const;
