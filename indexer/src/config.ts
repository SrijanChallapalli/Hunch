export const DEFAULT_DATABASE_URL =
  "postgresql://postgres:pmpass@localhost:5433/prediction_market";

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

// Confirmation depth for durable views. 0 is appropriate for the local
// detection->persistence latency benchmark (see benchmark/ and docs/decisions.md §8).
export const CONFIRMATIONS = Number(process.env.INDEXER_CONFIRMATIONS ?? 0);

// How many blocks to rewind when a reorg is detected at the checkpoint height.
export const REORG_DEPTH = Number(process.env.INDEXER_REORG_DEPTH ?? 5);

export const ZERO = "0x0000000000000000000000000000000000000000";
