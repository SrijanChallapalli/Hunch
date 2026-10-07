# Indexer Latency Benchmark (hardhat)

_Generated 2026-10-14T23:36:05.574Z · seed 0x5eed_

**Result: detection → persistence p95 = 95.2 ms** over
6000 eligible logs. Target p95 ≤ 1800 ms:
**met**.

## Definition

- **detection**: indexer receives the eligible log (provider.getLogs returns)
- **persistence**: PostgreSQL COMMIT for that event's transaction returns
- **latency**: persistence - detection, one sample per eligible log; percentiles are nearest-rank
- **receipt → persisted** is a separate metric (client receives tx receipt -> last log of that tx committed). It includes
  the poll-interval wait, so it is bounded mostly by `POLL_MS`. Don't compare it with the
  first metric.

## Results (ms)

| Metric | n | p50 | p90 | p95 | p99 | max | mean |
|---|---|---|---|---|---|---|---|
| detection → persistence | 6000 | 50.78 | 88.5 | 95.2 | 110.24 | 134.99 | 50.93 |
| receipt → persisted | 1500 | 252.55 | 356.96 | 368.32 | 381.88 | 404.99 | 251.53 |

### detection → persistence by event

| Metric | n | p50 | p90 | p95 | p99 | max | mean |
|---|---|---|---|---|---|---|---|
| Bought | 1080 | 54.5 | 92.93 | 99.26 | 115.88 | 134.99 | 55.17 |
| Sold | 420 | 55.3 | 92.48 | 99.09 | 115.04 | 127.91 | 56 |
| Transfer | 4500 | 49.5 | 87.04 | 93.68 | 107.87 | 130.89 | 49.45 |

Logs per poll: p50 32, p95 36, max 36.
A log that arrives late in a large batch waits for the logs ahead of it, and that wait
counts toward its latency.

## Workload

| | |
|---|---|
| Trades submitted | 1500 @ 25 tx/s (10 traders, 8 markets) |
| Accepted / rejected | 1500 / 0 |
| Load window | 67.12 s, 1500 blocks, 188 polls |
| Mining | automine (one tx per block) |
| Indexer | poll 250 ms, confirmations 0 |

## Environment

| | |
|---|---|
| Chain | hardhat (chainId 31337), in-process Hardhat EVM (automine) |
| PostgreSQL | 16.15 (Docker, localhost) |
| Node | v22.14.0 |
| Host | Windows_NT 10.0.26200 x64, Intel(R) Core(TM) Ultra 9 285K x24, 31 GB |

The raw per-log samples are in `indexer-latency-hardhat-samples.csv`.
This run is on a local chain, not Sepolia. A public RPC adds network time to *receipt → persisted*,
but it does not change the detection → persistence window, which starts after `getLogs` returns.
