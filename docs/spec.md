# Prediction Market — Project Specification & Build Plan

> **Status:** M1–M9 complete (see README milestone table)  
> **Network:** Ethereum testnet (Sepolia recommended)  
> **Stack:** Solidity, Hardhat, TypeScript, Next.js, PostgreSQL  
> **Purpose:** Build and understand a complete, collateral-backed, multi-market prediction platform. Treat performance numbers below as *verification targets* until measured.

## 1. Project summary

Create an Ethereum testnet prediction market where users can create independent binary YES/NO markets, provide collateral, trade ERC20 outcome tokens, and claim winning payouts after a market closes and a trusted resolver finalizes the result. A separate PostgreSQL indexer reconstructs market activity and user portfolios from on-chain events, including after interruption or duplicate delivery.

The key differentiators are **eight simultaneously active user-created markets**, **auditable safety testing across 7,500 simulated trade operations**, and **a recoverable, measured blockchain-event indexer**.

### Resume-aligned acceptance criteria

| Resume claim | What must be demonstrably true | Evidence to save |
|---|---|---|
| Supports 8 concurrent user-created markets | Deploy/create at least 8 distinct market instances with overlapping active windows; trade and settle independently | Contract addresses, deployment script, integration test, short demo |
| ERC20 outcome shares and collateral-backed trading | Each market has YES/NO ERC20s, funded issuance/trading, tracked liabilities, and solvency checks | Contract code, invariant tests, collateral ledger |
| Closing deadlines, settlement, winner redemption | Trading blocked after deadline; authorized resolver settles; winners redeem once per burned token | State-transition and redemption tests |
| 7,500 simulated trades | Repeatable automated suite runs >=7,500 purchase/sale attempts, including rejected trades | Seeded test logs, test commands, passing results |
| Invalid-market refunds | Explicit invalid/canceled state with defined and funded refund rights | Refund design and adversarial tests |
| PostgreSQL indexer, duplicate handling, restart recovery | Idempotent writes; checkpoint-based replay; chain reorganization policy; portfolio reconstruction | Schema, indexer tests, crash/restart demo |
| 1.8-second p95 from event detection to persistence | Measure this metric with the stated definition, environment, sample count | Benchmark script and raw results; **do not claim until verified** |

## 2. Scope

### MVP (must have)
- Wallet connection on Sepolia; transaction status/error feedback.
- Create a binary market with a title, question, closing timestamp, collateral deposit, and resolver.
- Deploy or associate two ERC20 outcome tokens, YES and NO, per market.
- Display market state and current AMM quote.
- Buy and sell YES/NO with explicit slippage limits; prevent selling without allowance.
- Enforce market closing timestamp and deterministic state transitions.
- Resolve YES / NO or mark INVALID through a controlled process.
- Redeem winning tokens (burn then pay) and support refunds for invalid markets per a documented accounting model.
- Index contract events into PostgreSQL, powering market and portfolio views.
- Automated unit/integration/invariant tests and latency measurement.

### Non-goals for MVP
- Real money, mainnet deployment, regulatory/compliance-ready operation.
- CLOB matching engine, margin, leveraged positions, cross-chain support.
- Fully decentralized governance or dispute oracle.
- Tokenomics, fee farming, or a protocol governance token.

## 3. Important decisions to make **before coding**

These are design choices, **not facts established by the resume**. Document the final decisions in `docs/decisions.md`.

1. **Market mechanics:** Reuse the Speedrun Ethereum simplified average-probability AMM, or choose a different collateral-safe pricing design? If reusing it, test reserve exhaustion, monotonic quotes, round-trip trading, and solvency under extreme paths.
2. **Collateral denomination:** Use testnet ETH or a test ERC20 stablecoin? For minimal scope, use testnet ETH consistently.
3. **Payout denomination and decimals:** E.g., one full outcome share pays `0.01 ether`; ERC20 token balances internally use `18` decimals. Clearly distinguish **whole shares** from base units (`1e18`).
4. **Issuance/redemption accounting:** Who initially owns minted outcome pairs? How is the market creator's collateral represented? How are both outcomes backed when only one can win?
5. **Selling and withdrawals:** Under which conditions is ETH released back to traders, and which collateral invariant guarantees future winner payouts?
6. **Invalid outcome policy:** Define exactly who can cancel, when cancellation is allowed, and whether holders redeem at a fixed fraction or receive original collateral through an auditable contribution ledger. **Do not promise original trade price refunds unless collateral and accounting explicitly support them.**
7. **Resolution trust:** Trusted resolver is simplest for testnet. Record powers, failure modes, and whether an explicit challenge window is in scope.
8. **Indexer finality:** Are UI balances provisional until N confirmations? How are reorganizations rolled back/replayed?

## 4. User journeys

### Create market
1. User connects wallet and submits question, close date, and deposit.
2. Frontend validates inputs and calls `MarketFactory.createMarket(...)`.
3. Factory deploys/registers a unique market and its YES/NO tokens.
4. `MarketCreated` emitted; indexer persists market metadata.
5. Market appears in Explore.

### Buy YES / NO
1. User opens an active market and requests quantity.
2. Frontend reads current quote and applies slippage tolerance to calculate `maxCost`.
3. User sends ETH with buy transaction.
4. Market validates trading state, liquidity, quantity, cost and `msg.value`; updates accounting; transfers appropriate outcome shares; returns excess ETH where applicable.
5. Events emitted; indexer updates trades, balances and activity.

### Sell YES / NO
1. User obtains quote and sets `minProceeds`.
2. User approves outcome token allowance to market contract if insufficient.
3. Market calls `transferFrom`, checks allowance/balance, applies AMM/accounting, pays proceeds, emits event.
4. State and portfolio refresh from chain/indexer.

### Close, resolve and redeem
1. At or after close timestamp, trading is blocked.
2. Authorized resolver finalizes YES / NO / INVALID according to documented policy.
3. If YES or NO: holder redeems any amount of winning token; token is burned and ETH paid in one atomic transaction.
4. If INVALID: holder claims the defined refund entitlement; cannot redeem the same entitlement twice.
5. Persist `MarketResolved`, `Redeemed`, `Refunded` events.

## 5. Contract architecture

```text
MarketFactory.sol
  ├─ creates/registers PredictionMarket.sol instances
  └─ emits MarketCreated(marketId, marketAddress, creator, ...)

PredictionMarket.sol  [one per market]
  ├─ owns/controls collateral and market pricing/state
  ├─ references YES and NO OutcomeToken contracts
  ├─ buy / sell / close / resolve / redeem / refund
  └─ emits trading and settlement events

OutcomeToken.sol  [two per market]
  └─ ERC20 balances, allowances, restricted mint/burn permissions

Resolver  [trusted address or separate contract for MVP]
  └─ authorizes YES / NO / INVALID result
```

### Suggested market state machine

```text
OPEN --(deadline reached)--> CLOSED
CLOSED --(valid result)--> RESOLVED_YES / RESOLVED_NO
CLOSED --(invalid result)--> INVALID

Only OPEN can trade.
Only RESOLVED_* can redeem winning shares.
Only INVALID can claim invalid-market refunds.
No state transition back to OPEN after resolution.
```

### Candidate functions (interfaces to refine)

```solidity
// Factory
function createMarket(
    string calldata question,
    uint64 closeTime,
    address resolver
) external payable returns (address market);

// Market (illustrative only)
function quoteBuy(bool isYes, uint256 shares) external view returns (uint256 cost);
function quoteSell(bool isYes, uint256 shares) external view returns (uint256 proceeds);
function buy(bool isYes, uint256 shares, uint256 maxCost) external payable;
function sell(bool isYes, uint256 shares, uint256 minProceeds) external;
function resolve(uint8 outcome) external; // restricted; YES/NO/INVALID
function redeem(uint256 winningShares) external;
function refundInvalid(uint256 sharesYes, uint256 sharesNo) external;
```

> These signatures are starting points. The invalid-market accounting model and authorization model must be defined before treating them as final.

### Security requirements
- Checks–Effects–Interactions and reentrancy protection on functions that transfer ETH.
- Correct ERC20 allowances and restricted mint/burn behavior; use safe transfer helpers.
- Reject zero amounts, insufficient liquidity, expired markets, invalid status changes.
- Enforce user `maxCost` / `minProceeds` and deadlines to limit slippage and transaction-order manipulation.
- Avoid rounding that can mint or redeem more liability than locked collateral; fuzz boundary quantities.
- Revert atomically on payout failure; track refunds/redemptions through burned balances or claim accounting.
- Restrict market resolution and ensure it cannot be changed after finalization.
- Document trusted-resolver risk: access control doesn't prove the reported outcome is true.

## 6. Collateral model and invariants

**Choose a solvency model explicitly.** Do not assume an AMM automatically remains solvent.

At minimum, define for every reachable state:

```text
contract ETH balance >= maximum outstanding valid-result payout liability
                      + any separate, simultaneously owed refund liability
```

The exact liability computation depends on who owns outstanding YES/NO shares, whether treasury-held shares can redeem, and how INVALID refunds work. Include LP settlement and fee liabilities in the accounting. Distinguish contract-held tokens from user-held tokens; avoid double-counting promises that cannot occur simultaneously.

Tests must verify:
- Every accepted trade preserves the selected collateral invariant.
- No one can withdraw collateral needed for outstanding payouts.
- An outcome share cannot produce more than its intended payout through repeat claims.
- Total redeemed + remaining claimable obligations never exceeds legitimate collateral and proceeds.
- Both YES and NO outcomes are covered under tested trade paths.
- Invalid-market refunds and LP claims cannot spend the same ETH twice.

## 7. PostgreSQL event indexer

### Responsibilities
- Subscribe to contract events and/or poll chain logs using RPC.
- Start from a recorded deployment block; record all relevant market addresses.
- Store raw logs and transaction identifiers so derived tables can be rebuilt.
- Upsert events idempotently with a unique `(chain_id, transaction_hash, log_index)` key **for a given canonical chain view**; account for reverted/reorganized blocks.
- Persist confirmed checkpoints transactionally alongside event processing.
- Replay from last safe block after process crash, using idempotent inserts.
- Materialize query-friendly tables for market status, trades, holdings and redemption history.

### Suggested schema

```sql
CREATE TABLE markets (
  chain_id BIGINT NOT NULL,
  market_address TEXT NOT NULL,
  creator_address TEXT NOT NULL,
  question TEXT NOT NULL,
  close_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  created_block BIGINT NOT NULL,
  PRIMARY KEY (chain_id, market_address)
);

CREATE TABLE chain_events (
  chain_id BIGINT NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  market_address TEXT NOT NULL,
  event_name TEXT NOT NULL,
  payload JSONB NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  persisted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, transaction_hash, log_index)
);

CREATE TABLE indexer_checkpoints (
  chain_id BIGINT PRIMARY KEY,
  last_confirmed_block BIGINT NOT NULL,
  last_confirmed_block_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add derived tables: trades, redemptions, market_tokens,
-- positions, portfolio_snapshots as needed.
```

**Portfolio correctness:** Decide whether to derive balances from every token `Transfer` event (including wallet-to-wallet transfers) or read ERC20 balances from the chain and cache them. Deriving positions only from market buy/sell events will miss independent ERC20 transfers.

### Recovery and reorganizations
1. On startup load checkpoint for each chain.
2. Compare saved block hash with canonical RPC block at that height.
3. On mismatch, rewind to an earlier common ancestor and rebuild affected derived rows.
4. Fetch historical logs from safe checkpoint, replay deterministically and idempotently.
5. Advance checkpoint only after the corresponding writes commit.
6. Use a confirmation depth for durable views and separately label unconfirmed activity if displaying it.

### Latency measurement

Define `event detection → persistence` precisely:

```text
detection timestamp = when indexer first receives/observes the eligible log
persistence timestamp = successful DB transaction commit for the event
latency_ms = persistence timestamp - detection timestamp
p95 = 95th percentile of latency_ms across measured eligible events
```

Also consider an independent `block inclusion → indexed` latency, which captures RPC notification lag and confirmations. Do **not** conflate these metrics.

For the resume's **1.8-second p95**, preserve a run log with environment, count, time window, testnet/RPC provider, confirmation policy and raw samples. Verify that the implementation actually achieves the number.

## 8. Testing plan

### Unit tests
- Factory input validation and market ID/address uniqueness.
- Token creation, permissions, balances and approvals.
- Trading price calculations, rounding, minimum/maximum quantities.
- Closing deadline before/at/after timestamp.
- Resolution access control, finality and invalid result rules.
- Slippage limits; exact payable ETH and excess refunds.
- Burn-to-redeem behavior and atomic rollback on ETH failure.

### Integration tests
- Create eight markets with different creators/close times.
- Concurrent or interleaved trading across all eight; no cross-market state bleed.
- Resolve YES in some, NO in others, INVALID in at least one.
- Transfer outcome tokens between wallets and confirm portfolio tracking.
- Restart indexer midstream, re-fetch logs and confirm no duplicated trades or balances.

### 7,500-trade simulation
- Fixed random seed(s), deterministic inputs, explicit operation counter.
- Include buys and sells, both outcomes, multiple users and eight active markets.
- Include deliberately rejected orders: insufficient funds, allowance, slippage, market closed, wrong state.
- After each accepted operation (or every batch), check collateral solvency.
- After resolution test multiple partial redemptions, double-claim attempts, invalid refunds and failed ETH receivers.
- Record number attempted, number successful, expected reverts, unexpected errors, and elapsed time.

### Property/invariant tests
- Successful redemptions cannot exceed backed liabilities.
- Token transfer/approval cannot allow an unauthorized spend.
- Resolving or closing one market does not change another market's state.
- Duplicate indexed events have no effect on derived portfolio balances.
- Crash/replay reaches the same derived state as a clean uninterrupted run.

## 9. Frontend requirements

| Page | Elements |
|---|---|
| Explore | Question, state, close date, current YES/NO quote, market links |
| Create | Question form, close date, collateral, resolver disclosure, wallet confirmation |
| Market detail | Market metadata, quote, amount, slippage tolerance, Buy/Sell, token allowance, transaction history |
| Portfolio | Holdings per market/outcome, cost basis where derivable, claimable amounts, redemption action |
| Activity | Recent trades, indexed blocks, resolution/refund history |

Display warnings when a market is unconfirmed, resolved, invalid, or uses a trusted resolver. Distinguish on-chain state from indexed/cache data when the indexer lags.

## 10. Suggested repository layout

```text
prediction-market/
├── contracts/
│   ├── MarketFactory.sol
│   ├── PredictionMarket.sol
│   └── OutcomeToken.sol
├── test/
│   ├── unit/
│   ├── integration/
│   ├── invariants/
│   └── simulation/
├── scripts/
│   ├── deploy.ts
│   └── seed-eight-markets.ts
├── frontend/
│   ├── app/
│   ├── components/
│   └── lib/
├── indexer/
│   ├── src/
│   ├── migrations/
│   └── tests/
├── benchmark/
│   ├── measure-indexer.ts
│   └── results/
├── docs/
│   ├── decisions.md
│   ├── threat-model.md
│   └── demo-checklist.md
├── hardhat.config.ts
└── README.md
```

## 11. Milestones and definition of done

- [x] **M1 — Written financial model:** Specify issuance, payouts, pricing, LP ownership, solvency invariant and invalid refunds.
- [x] **M2 — Contracts:** Deploy a single market and exercise full buy/sell/close/resolve/redeem/refund lifecycle.
- [x] **M3 — Factory:** Create at least eight independent markets with overlapping active windows.
- [x] **M4 — Security suite:** All unit/integration/property tests passing, especially collateral and reentrancy.
- [x] **M5 — Simulation:** Reproducible >=7,500-operation report saved to repo.
- [x] **M6 — Indexer:** Raw event storage, position materialization, idempotency and crash recovery verified.
- [x] **M7 — Frontend:** All core flows usable on Ethereum testnet.
- [x] **M8 — Benchmark:** Run event-detection-to-persistence benchmark and report measured p50/p95, including whether <=1.8s p95 is achieved.
- [x] **M9 — Demo:** Seed eight markets, execute trades, restart indexer, settle market, redeem winner, demonstrate failed double redemption and invalid refund.

## 12. Questions to resolve while building

1. Does every new market deploy its own ERC20 contracts or use a shared multi-token architecture? (Resume specifically says ERC20 outcome shares.)
2. How is a market creator's initial deposit represented, and when may that creator recover funds?
3. If all available YES shares are sold, does the pricing system halt gracefully and stay solvent?
4. How do partial refunds work if an INVALID market has already seen secondary trading?
5. What precisely makes a market invalid vs a valid NO outcome?
6. Are ERC20 outcome tokens transferable between arbitrary wallets? If yes, how are positions indexed?
7. What if the resolver never responds? Is there a timeout/cancel path?
8. How do indexing lag and blockchain reorgs affect visible portfolio balances?
9. Which security properties are guaranteed on-chain versus only tested in simulation?
10. What exact performance experiment supports the p95 number?

---

**Project principle:** Favor correctness, reproducible measurements and explainable design over feature count. The resume bullets are the acceptance criteria, not a substitute for evidence.
