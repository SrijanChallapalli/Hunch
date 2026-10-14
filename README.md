# Hunch

**Back your hunch with ETH.** Hunch is a prediction market on the Ethereum testnet.
Anyone can open a YES/NO question, fund it with ETH, and let people trade on the answer.
When the deadline passes, a resolver calls it and winners cash out.

I built it to learn how a prediction market stays solvent when everyone wants their money
back at once. Every share is backed by real collateral, eight markets can run side by side
without touching each other, and a PostgreSQL indexer keeps the books. You can kill the
indexer mid-stream and it picks up where it left off, without double-counting anything.

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
| M1 | Written financial & threat model | ✅ [`decisions.md`](docs/decisions.md), [`threat-model.md`](docs/threat-model.md) |
| M2 | Contracts: single-market full lifecycle | ✅ [`lifecycle.test.ts`](test/unit/lifecycle.test.ts) |
| M3 | Factory: ≥8 independent concurrent markets | ✅ [`concurrent.test.ts`](test/integration/concurrent.test.ts) |
| M4 | Security suite (unit/integration/invariant) | ✅ [`security.test.ts`](test/invariants/security.test.ts): 17 tests passing overall |
| M5 | ≥7,500-operation simulation report | ✅ 7,500 ops, 0 solvency failures: [`simulation-report.md`](benchmark/results/simulation-report.md) |
| M6 | Indexer: storage, idempotency, crash recovery | ✅ [`indexer/`](indexer), [`indexer.test.ts`](test/indexer/indexer.test.ts) |
| M7 | Frontend: core flows | ✅ on a local node: [`frontend/`](frontend). Sepolia deploy needs an RPC URL + funded key |
| M8 | Benchmark: measured p50/p95 (target ≤1.8s p95) | ✅ **p95 95–102 ms** over 4,800–6,000 samples: [`benchmark/`](benchmark) |
| M9 | End-to-end demo | ✅ scripted, with the indexer killed and restarted: [`demo-run.md`](docs/demo-run.md) |

## Results at a glance

- **Solvency:** the 7,500-operation seeded run (8 markets, 10 traders, 1,272 deliberately
  rejected orders) shows 0 solvency failures across 6,236 invariant checks.
- **Indexer latency:** detection → persistence p50 ≈ 51–54 ms, p95 ≈ 95–102 ms, p99 ≤ 118 ms,
  across in-process, JSON-RPC, and 1-second-block runs on a local chain with PostgreSQL 16.
  The 1.8 s target is met. Environment and raw samples are committed with each report.
- **Recovery:** after a hard kill and restart, all 224 indexed balances match on-chain
  ERC20 balances, and replaying every block changes nothing.

## Quickstart

```bash
npm install
```

```bash
docker run -d --name pm-postgres -e POSTGRES_PASSWORD=pmpass -e POSTGRES_DB=prediction_market -p 5433:5432 postgres:16-alpine
```

```bash
npm test
```

```bash
npx hardhat node
```

```bash
npm run demo
```

Other entry points: `npm run sim` (M5), `npm run benchmark` (M8), and
`npm run deploy|seed|indexer -- --network localhost` + `cd frontend && npm run dev` (M7).
See [`frontend/README.md`](frontend/README.md).

## Verification principle

The resume bullets are **acceptance criteria, not evidence**. The `7,500 trades` and
`1.8s p95` numbers are measurement targets — reproduced by committed scripts and raw run
logs, never hand-asserted. See [`docs/spec.md`](docs/spec.md) for the full specification.
