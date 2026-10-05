import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";
import { databaseUrl } from "./config";

export function makePool(url: string = databaseUrl()): Pool {
  return new Pool({ connectionString: url, max: 10 });
}

/** Apply all migration SQL files in order (idempotent — they use IF NOT EXISTS). */
export async function migrate(pool: Pool): Promise<void> {
  const dir = path.join(__dirname, "..", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await pool.query(fs.readFileSync(path.join(dir, f), "utf8"));
  }
}

/** Remove all rows (used by tests to start from a clean slate). */
export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query(
    "TRUNCATE markets, chain_events, indexer_checkpoints, positions, trades, redemptions, latency_samples"
  );
}
