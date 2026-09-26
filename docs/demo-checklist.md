# Demo Checklist (M9)

> Stub — fill in as milestones land. The demo must show the resume claims are real.

## End-to-end script (spec §11, M9)

- [ ] Seed **8 markets** with different creators and overlapping close times.
- [ ] Execute trades (buys + sells, both outcomes) across all eight.
- [ ] Restart the indexer mid-stream; show no duplicated trades or balances.
- [ ] Settle a market (resolver), redeem a winner.
- [ ] Demonstrate a **failed double-redemption** (reverts).
- [ ] Demonstrate an **INVALID refund** (`UNIT/2` per token).
- [ ] Show the collateral invariant holding throughout.

## Evidence to capture

- [ ] Deployed contract addresses (factory + 8 markets + their tokens).
- [ ] Committed `7,500`-operation simulation report (attempted/succeeded/expected-reverts).
- [ ] Benchmark run log: p50/p95 detection→persistence, environment, RPC, sample count.
- [ ] Short screen recording of the core flows.
