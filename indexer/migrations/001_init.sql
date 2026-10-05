-- M6 indexer schema. Raw logs are the source of truth; derived tables are a pure
-- function of chain_events and can be rebuilt by replaying them (crash/reorg safe).

CREATE TABLE IF NOT EXISTS markets (
  chain_id          BIGINT      NOT NULL,
  market_address    TEXT        NOT NULL,
  creator_address   TEXT        NOT NULL,
  yes_token         TEXT        NOT NULL,
  no_token          TEXT        NOT NULL,
  question          TEXT        NOT NULL,
  close_time        TIMESTAMPTZ NOT NULL,
  resolver_address  TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'OPEN',
  created_block     BIGINT      NOT NULL,
  PRIMARY KEY (chain_id, market_address)
);

-- Append-only raw event log. Idempotency hinges on this primary key.
CREATE TABLE IF NOT EXISTS chain_events (
  chain_id          BIGINT      NOT NULL,
  transaction_hash  TEXT        NOT NULL,
  log_index         INTEGER     NOT NULL,
  block_number      BIGINT      NOT NULL,
  block_hash        TEXT        NOT NULL,
  address           TEXT        NOT NULL,
  market_address    TEXT,
  event_name        TEXT        NOT NULL,
  payload           JSONB       NOT NULL,
  observed_at       TIMESTAMPTZ NOT NULL,
  persisted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, transaction_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_events_block ON chain_events (chain_id, block_number, log_index);

CREATE TABLE IF NOT EXISTS indexer_checkpoints (
  chain_id                  BIGINT      PRIMARY KEY,
  last_confirmed_block      BIGINT      NOT NULL,
  last_confirmed_block_hash TEXT        NOT NULL,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Derived: token holdings, reconstructed from ALL ERC20 Transfer events
-- (mints, burns, trades, and plain wallet-to-wallet transfers).
CREATE TABLE IF NOT EXISTS positions (
  chain_id        BIGINT        NOT NULL,
  market_address  TEXT          NOT NULL,
  token           TEXT          NOT NULL,          -- 'YES' | 'NO'
  holder          TEXT          NOT NULL,
  balance         NUMERIC(80,0) NOT NULL DEFAULT 0,
  PRIMARY KEY (chain_id, market_address, token, holder)
);

CREATE TABLE IF NOT EXISTS trades (
  chain_id          BIGINT        NOT NULL,
  transaction_hash  TEXT          NOT NULL,
  log_index         INTEGER       NOT NULL,
  market_address    TEXT          NOT NULL,
  trader            TEXT          NOT NULL,
  side              TEXT          NOT NULL,          -- 'BUY' | 'SELL'
  is_yes            BOOLEAN       NOT NULL,
  eth_amount        NUMERIC(80,0) NOT NULL,
  shares            NUMERIC(80,0) NOT NULL,
  block_number      BIGINT        NOT NULL,
  PRIMARY KEY (chain_id, transaction_hash, log_index)
);

CREATE TABLE IF NOT EXISTS redemptions (
  chain_id          BIGINT        NOT NULL,
  transaction_hash  TEXT          NOT NULL,
  log_index         INTEGER       NOT NULL,
  market_address    TEXT          NOT NULL,
  holder            TEXT          NOT NULL,
  kind              TEXT          NOT NULL,          -- 'REDEEM' | 'REFUND'
  shares            NUMERIC(80,0) NOT NULL,
  eth_amount        NUMERIC(80,0) NOT NULL,
  block_number      BIGINT        NOT NULL,
  PRIMARY KEY (chain_id, transaction_hash, log_index)
);

-- Benchmark (M8): one row per eligible log, detection -> persistence latency.
CREATE TABLE IF NOT EXISTS latency_samples (
  chain_id          BIGINT            NOT NULL,
  transaction_hash  TEXT              NOT NULL,
  log_index         INTEGER           NOT NULL,
  detection_ms      DOUBLE PRECISION  NOT NULL,
  persistence_ms    DOUBLE PRECISION  NOT NULL,
  latency_ms        DOUBLE PRECISION  NOT NULL,
  PRIMARY KEY (chain_id, transaction_hash, log_index)
);
