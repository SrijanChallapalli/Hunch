# M1 — Threat Model

> Companion to [`decisions.md`](decisions.md). Enumerates what can go wrong, the
> mitigation, and where it is proven (on-chain guarantee vs test-only). Maps to spec
> §5 "Security requirements" and §6 invariants.

## Trust assumptions (stated plainly)

- **Resolver is trusted per market.** Access control proves *who* reported an outcome,
  **not** that the outcome is true. A malicious/compromised resolver can report the wrong
  winner. This is accepted for a testnet MVP; a decentralized oracle / dispute window is a
  non-goal (spec §2). The frontend must display a trusted-resolver warning (spec §9).
- **Creator is the sole LP.** The creator cannot withdraw backing that funds outstanding
  payouts — LP settlement is bounded by the §5 invariant and only realizable after
  resolution.
- **Testnet only.** No real-money, mainnet, or regulatory guarantees.

## Threats & mitigations

| # | Threat | Mitigation | Guarantee |
|---|---|---|---|
| T1 | **Reentrancy** on ETH-sending paths (`mergeSet`, `sell`, `redeem`, `refundInvalid`, LP settle) | Checks-Effects-Interactions ordering + `nonReentrant`; state updated and tokens burned *before* the ETH `.call` | On-chain |
| T2 | **Insolvency** — more payout promised than ETH held | §5 invariant holds every state; rounding always favors the contract (§1); fuzz boundary quantities | On-chain + invariant tests |
| T3 | **Double claim / double redeem** | Claim = burn; a burned share cannot be reused. INVALID refund burns the token too | On-chain |
| T4 | **Trading after close** | `require(block.timestamp < closeTime)` on buy/sell; state machine blocks trades once `CLOSED` | On-chain |
| T5 | **Slippage / tx-ordering (MEV, sandwiching)** | Caller supplies `maxCost` (buy) / `minProceeds` (sell) + a deadline; revert if violated | On-chain (user-supplied bound) |
| T6 | **Unauthorized mint/burn** of outcome tokens | `OutcomeToken` mint/burn restricted to its owning `PredictionMarket` | On-chain |
| T7 | **Unauthorized spend** via ERC20 allowance | `sell` pulls tokens via `transferFrom` only after allowance/balance checks; prevent selling without allowance (spec §2) | On-chain |
| T8 | **Unauthorized / re-resolution** | Only `resolver` may `resolve`, only once, only after `closeTime`; immutable after finalization | On-chain |
| T9 | **Resolver never responds** (funds stuck) | `forceInvalid()` callable by anyone after `closeTime + RESOLVE_GRACE` → INVALID refunds | On-chain |
| T10 | **Zero / dust / invalid amounts** | Reject zero amounts, insufficient liquidity, expired markets, illegal state transitions | On-chain |
| T11 | **Payout to a failing ETH receiver** blocks others | Per-caller atomic revert on failed `.call`; one caller's failure cannot corrupt global state or lock other claimants | On-chain |
| T12 | **Cross-market state bleed** (8 concurrent markets) | Each market is an isolated contract instance with its own tokens, pool, state, and balance | On-chain + integration tests |
| T13 | **Rounding mints/redeems more than backed** | Round costs up / payouts down (§1); property tests fuzz min/max/boundary quantities | On-chain + fuzz tests |
| T14 | **Indexer: duplicate / replayed events** | Idempotent upsert on `(chain_id, tx_hash, log_index)`; duplicates are no-ops on derived balances | Test-only (off-chain) |
| T15 | **Indexer: crash mid-stream** | Checkpoint-based replay from last safe block; derived state after crash == clean run | Test-only (off-chain) |
| T16 | **Chain reorg** shows wrong balances | Confirmation depth `N`; rewind to common ancestor and replay; label unconfirmed activity | Test-only (off-chain) |

## On-chain vs test-only (spec Q9)

- **Guaranteed on-chain:** solvency invariant, single-use redemption, access control on
  mint/burn/resolve, deadline enforcement, slippage bounds, reentrancy protection, market
  isolation.
- **Verified in simulation/off-chain only:** the 7,500-trade statistical coverage, indexer
  idempotency/recovery/reorg handling, and the `1.8s p95` latency number. These are
  properties of the test harness and indexer, not consensus guarantees.

## Required test coverage (traceable to threats)

- Unit: T4, T5, T6, T7, T8, T10, T11.
- Invariant/property/fuzz: T2, T3, T13; both YES and NO winner paths + INVALID path.
- Integration: T12 (eight markets, interleaved trades, no bleed) + cross-wallet transfers.
- Simulation (≥7,500 ops): T2/T3 under adversarial mixed load incl. deliberately rejected
  orders (insufficient funds, allowance, slippage, closed, wrong state).
- Indexer tests: T14, T15, T16 + portfolio reconstruction from all `Transfer` events.
