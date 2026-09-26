# Prediction Market

An Ethereum **testnet** prediction market: users create independent binary YES/NO
markets, provide collateral, trade ERC20 outcome shares against an AMM, and claim
payouts after a trusted resolver settles. A PostgreSQL indexer reconstructs markets and
portfolios from on-chain events, with duplicate handling and crash recovery.

> **Testnet only.** No real money, no mainnet, not regulatory-compliant. See
> [`docs/threat-model.md`](docs/threat-model.md) for trust assumptions.

## Design in brief

Collateral-backed via **complete sets**: `1 UNIT (0.01 ETH)` mints `1 YES + 1 NO`, and
`1 YES + 1 NO` merges back to `1 UNIT`. Price discovery is a creator-seeded single-LP
constant-product AMM (FPMM). Because the AMM only trades already-backed tokens, solvency
reduces to one invariant:

```text
contract ETH balance == setsOutstanding × UNIT
```

Full accounting, pricing math, and the eight pre-coding decisions are in
[`docs/decisions.md`](docs/decisions.md).

## Stack

Solidity · Hardhat · TypeScript · Next.js · PostgreSQL

## Repository layout

```text
contracts/    MarketFactory, PredictionMarket, OutcomeToken
test/         unit · integration · invariants · simulation
scripts/      deploy, seed-eight-markets
frontend/     Next.js app (Explore, Create, Market, Portfolio, Activity)
indexer/      event indexer + migrations + tests
benchmark/    event-detection→persistence latency measurement + results
docs/         spec, decisions (financial model), threat model, demo checklist
```

## Milestones

| | Milestone | Status |
|---|---|---|
| M1 | Written financial & threat model | ✅ done — [`decisions.md`](docs/decisions.md), [`threat-model.md`](docs/threat-model.md) |
| M2 | Contracts: single-market full lifecycle | ⬜ |
| M3 | Factory: ≥8 independent concurrent markets | ⬜ |
| M4 | Security suite (unit/integration/invariant) | ⬜ |
| M5 | ≥7,500-operation simulation report | ⬜ |
| M6 | Indexer: storage, idempotency, crash recovery | ⬜ |
| M7 | Frontend: core flows on testnet | ⬜ |
| M8 | Benchmark: measured p50/p95 (target ≤1.8s p95) | ⬜ |
| M9 | End-to-end demo | ⬜ |

## Verification principle

The resume bullets are **acceptance criteria, not evidence**. The `7,500 trades` and
`1.8s p95` numbers are measurement targets — reproduced by committed scripts and raw run
logs, never hand-asserted. See [`docs/spec.md`](docs/spec.md) for the full specification.
