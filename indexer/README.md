# Event Indexer (M6)

Reconstructs markets, trades, holdings, and redemption history from on-chain
events into PostgreSQL. Designed for correctness under duplicate delivery,
process crashes, and chain reorganizations.

## Design

- **Raw log store is the source of truth.** Every eligible log is written to
  `chain_events` keyed by `(chain_id, transaction_hash, log_index)`. The insert is
  `ON CONFLICT DO NOTHING`, and derived writes happen **in the same transaction**
  only when the raw row is newly inserted — so duplicate/replayed delivery is a
  no-op and processing is exactly-once.
- **Derived tables are a pure function of `chain_events`** (`markets`, `trades`,
  `redemptions`, `positions`). They can be rebuilt by replaying the raw log, which
  is how crash recovery and reorg repair work.
- **Portfolio from `Transfer`.** Holdings are reconstructed from *every* ERC20
  `Transfer` (mints, burns, trades, and plain wallet-to-wallet sends), not just
  market buy/sell — so independent token transfers are tracked correctly.
- **Checkpoints + reorgs.** After each range the checkpoint stores the block number
  and hash. On restart, if the trusted block's hash changed, the indexer rewinds,
  drops orphaned rows, and replays to a consistent state.

## Schema

See [`migrations/001_init.sql`](migrations/001_init.sql): `markets`, `chain_events`,
`indexer_checkpoints`, `positions`, `trades`, `redemptions`, `latency_samples`.

## Run

Postgres via Docker (used by tests and the benchmark):

```bash
docker run -d --name pm-postgres -e POSTGRES_PASSWORD=pmpass \
  -e POSTGRES_DB=prediction_market -p 5433:5432 postgres:16-alpine
```

Then `DATABASE_URL` defaults to `postgresql://postgres:pmpass@localhost:5433/prediction_market`
(see [`.env.example`](.env.example)). Indexer tests: `npx hardhat test test/indexer/indexer.test.ts`.
The tests truncate the database, so stop any running indexer process (same chain id 31337)
before running them.
Long-running process (kill and restart at will; it resumes from the checkpoint):
`npm run indexer -- --network localhost`. Latency benchmark: `npm run benchmark`
(see [`../benchmark`](../benchmark)).
