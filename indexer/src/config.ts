export const DEFAULT_DATABASE_URL =
  "postgresql://postgres:pmpass@localhost:5433/prediction_market";

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

/**
 * Read an integer >= `min` from the environment. A typo like
 * INDEXER_CONFIRMATIONS=two would otherwise become NaN and silently stall the
 * poll loop, so fail at startup instead.
 */
export function intEnv(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`${name} must be an integer >= ${min}, got "${raw}"`);
  }
  return n;
}

// Confirmation depth for durable views. 0 is appropriate for the local
// detection->persistence latency benchmark (see benchmark/ and docs/decisions.md §8).
export const CONFIRMATIONS = intEnv("INDEXER_CONFIRMATIONS", 0);

// How many blocks to rewind when a reorg is detected at the checkpoint height.
export const REORG_DEPTH = intEnv("INDEXER_REORG_DEPTH", 5, 1);

export const ZERO = "0x0000000000000000000000000000000000000000";
