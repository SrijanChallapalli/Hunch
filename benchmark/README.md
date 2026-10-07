# Benchmarks (M5, M8)

## M8: indexer event detection → persistence latency

[`measure-indexer.ts`](measure-indexer.ts) deploys a factory and 8 markets. It then
drives a seeded buy/sell workload from 10 traders at a fixed rate while the indexer
polls, and reads the per-log samples back out of PostgreSQL.

```text
detection   = indexer receives the eligible log (provider.getLogs returns)
persistence = PostgreSQL COMMIT for that event's transaction returns
latency_ms  = persistence - detection        (one sample per eligible log, nearest-rank percentiles)
```

`receipt → persisted` is reported separately: it runs from the moment the client sees
the tx receipt to the commit of the tx's last log. It includes the poll-interval wait,
so the two metrics are never mixed.

### Measured results (2026-10-14)

| Run | Chain / mining | Samples | p50 | p95 | p99 | receipt → persisted p95 | ≤ 1.8 s p95 |
|---|---|---|---|---|---|---|---|
| [hardhat](results/indexer-latency-hardhat.md) | in-process EVM, automine | 6,000 | 50.8 ms | 95.2 ms | 110.2 ms | 368 ms | ✅ |
| [localhost](results/indexer-latency-localhost.md) | `hardhat node` JSON-RPC, automine | 6,000 | 52.4 ms | 98.3 ms | 113.7 ms | 372 ms | ✅ |
| [localhost, 1 s blocks](results/indexer-latency-localhost-1000ms-blocks.md) | JSON-RPC, interval mining | 4,800 | 53.7 ms | 102.2 ms | 117.2 ms | 293 ms | ✅ |

Settings: poll every 250 ms, 0 confirmations, PostgreSQL 16 in Docker on the same
host. Each report records the full environment, and the raw samples sit next to it
as `*-samples.csv`.

**Scope:** these runs used a local chain. A Sepolia run would add public-RPC time to
`receipt → persisted`. It would not change detection → persistence, because that
window starts only after `getLogs` has returned.

### Reproduce

```bash
docker run -d --name pm-postgres -e POSTGRES_PASSWORD=pmpass \
  -e POSTGRES_DB=prediction_market -p 5433:5432 postgres:16-alpine
```

```bash
npm run benchmark
```

```bash
npx hardhat node
```

```bash
npm run benchmark -- --network localhost
```

```bash
BENCH_BLOCK_MS=1000 BENCH_RATE=8 BENCH_TRADES=1200 npm run benchmark -- --network localhost
```

Knobs: `BENCH_TRADES` (1500), `BENCH_RATE` tx/s (25), `BENCH_TRADERS` (10),
`POLL_MS` (250), `BENCH_BLOCK_MS` (0 = automine), `INDEXER_CONFIRMATIONS` (0).

## M5: 7,500-operation simulation

See [`results/simulation-report.md`](results/simulation-report.md), produced by
`npm run sim` ([`../test/simulation/run-7500.ts`](../test/simulation/run-7500.ts)).
