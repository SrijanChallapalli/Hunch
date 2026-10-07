# Indexer Latency Benchmark (localhost)

_Generated 2026-10-14T23:40:00.299Z · seed 0x5eed_

**Result: detection → persistence p95 = 102.2 ms** over
4800 eligible logs. Target p95 ≤ 1800 ms:
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
| detection → persistence | 4800 | 53.67 | 94.77 | 102.2 | 117.17 | 140.22 | 54.27 |
| receipt → persisted | 1200 | 161.61 | 272.09 | 293.39 | 340.96 | 387.8 | 161.12 |

### detection → persistence by event

| Metric | n | p50 | p90 | p95 | p99 | max | mean |
|---|---|---|---|---|---|---|---|
| Bought | 858 | 59.78 | 100.07 | 107.58 | 124.07 | 140.22 | 59.77 |
| Sold | 342 | 57.45 | 96.59 | 105.64 | 114.41 | 138.38 | 57.64 |
| Transfer | 3600 | 52.49 | 93.25 | 100.65 | 114.68 | 136.94 | 52.64 |

Logs per poll: p50 32, p95 32, max 32.
A log that arrives late in a large batch waits for the logs ahead of it, and that wait
counts toward its latency.

## Workload

| | |
|---|---|
| Trades submitted | 1200 @ 8 tx/s (10 traders, 8 markets) |
| Accepted / rejected | 1200 / 0 |
| Load window | 154.33 s, 153 blocks, 153 polls |
| Mining | interval, one block every 1000 ms |
| Indexer | poll 250 ms, confirmations 0 |

## Environment

| | |
|---|---|
| Chain | localhost (chainId 31337), http://127.0.0.1:8545 |
| PostgreSQL | 16.15 (Docker, localhost) |
| Node | v22.14.0 |
| Host | Windows_NT 10.0.26200 x64, Intel(R) Core(TM) Ultra 9 285K x24, 31 GB |

The raw per-log samples are in `indexer-latency-localhost-1000ms-blocks-samples.csv`.
This run is on a local chain, not Sepolia. A public RPC adds network time to *receipt → persisted*,
but it does not change the detection → persistence window, which starts after `getLogs` returns.
