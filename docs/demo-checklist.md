# Demo Checklist (M9)

The whole demo is scripted. [`scripts/demo.ts`](../scripts/demo.ts) runs every step
and stops on the first failed check. Its transcript is committed as
[`demo-run.md`](demo-run.md).

```bash
docker run -d --name pm-postgres -e POSTGRES_PASSWORD=pmpass \
  -e POSTGRES_DB=prediction_market -p 5433:5432 postgres:16-alpine
```

```bash
npx hardhat node
```

```bash
npm run demo
```

## End-to-end script (spec §11, M9)

- [x] Seed **8 markets** with different creators and overlapping close times.
- [x] Execute trades (buys + sells, both outcomes) across all eight.
- [x] Hard-kill the indexer process mid-stream, keep trading, and restart it. Indexed
      holdings must equal on-chain balances, with no duplicated trades or balances.
- [x] Re-deliver the full block range (duplicate delivery): raw events, trades, and
      positions stay unchanged.
- [x] Settle markets (resolver) to a YES / NO / INVALID mix and redeem a winner at
      exactly `UNIT` per share.
- [x] Demonstrate a **failed double-redemption** (reverts).
- [x] Demonstrate an **INVALID refund** (`UNIT/2` per token, exact) and a failed double refund.
- [x] Show the collateral invariant holding on all 8 markets after every phase.

## Evidence

- [x] Contract addresses (factory + 8 markets) in [`demo-run.md`](demo-run.md).
      `scripts/deploy.ts` writes `deployments/<network>.json`.
- [x] Committed `7,500`-operation simulation report:
      [`simulation-report.md`](../benchmark/results/simulation-report.md).
- [x] Benchmark run logs with p50/p95, environment, RPC, and sample count:
      [`benchmark/README.md`](../benchmark/README.md).
- [ ] Sepolia deployment: needs `SEPOLIA_RPC_URL` and a funded `DEPLOYER_KEY`. Then run
      `npx hardhat run scripts/deploy.ts --network sepolia` and commit `deployments/sepolia.json`.
- [ ] Short screen recording of the frontend core flows (record by hand).
