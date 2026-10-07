# Indexer Latency Benchmark (localhost)

_Generated 2026-10-14T23:37:16.794Z · seed 0x5eed_

**Result: detection → persistence p95 = 98.29 ms** over
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
| detection → persistence | 6000 | 52.43 | 91.64 | 98.29 | 113.67 | 137.32 | 52.65 |
| receipt → persisted | 1500 | 254.45 | 363.32 | 372.48 | 385.61 | 417.72 | 256.36 |

### detection → persistence by event

| Metric | n | p50 | p90 | p95 | p99 | max | mean |
|---|---|---|---|---|---|---|---|
| Bought | 1080 | 56.92 | 94.58 | 101.21 | 115.45 | 137.32 | 56.85 |
| Sold | 420 | 58.25 | 98.33 | 106.27 | 124.15 | 136.88 | 58.18 |
| Transfer | 4500 | 51.05 | 90 | 96.53 | 111.38 | 134.13 | 51.13 |

Logs per poll: p50 32, p95 36, max 36.
A log that arrives late in a large batch waits for the logs ahead of it, and that wait
counts toward its latency.

## Workload

| | |
|---|---|
| Trades submitted | 1500 @ 25 tx/s (10 traders, 8 markets) |
| Accepted / rejected | 1500 / 0 |
| Load window | 67.16 s, 1500 blocks, 185 polls |
| Mining | automine (one tx per block) |
| Indexer | poll 250 ms, confirmations 0 |

## Environment

| | |
|---|---|
| Chain | localhost (chainId 31337), http://127.0.0.1:8545 |
| PostgreSQL | 16.15 (Docker, localhost) |
| Node | v22.14.0 |
| Host | Windows_NT 10.0.26200 x64, Intel(R) Core(TM) Ultra 9 285K x24, 31 GB |

The raw per-log samples are in `indexer-latency-localhost-samples.csv`.
This run is on a local chain, not Sepolia. A public RPC adds network time to *receipt → persisted*,
but it does not change the detection → persistence window, which starts after `getLogs` returns.
