import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";

// One pool per server process (survives Next dev hot reloads).
const g = globalThis as unknown as { __pmPool?: Pool };

export function db(): Pool {
  if (!g.__pmPool) {
    g.__pmPool = new Pool({
      connectionString:
        process.env.DATABASE_URL ?? "postgresql://postgres:pmpass@localhost:5433/prediction_market",
      max: 5,
    });
  }
  return g.__pmPool;
}

export interface AppConfig {
  network: string;
  chainId: number;
  factory: string | null;
  rpcUrl: string;
}

/** Factory + chain from deployments/<PM_NETWORK>.json (written by scripts/deploy.ts). */
export function appConfig(): AppConfig {
  const network = process.env.PM_NETWORK ?? "localhost";
  const file = path.join(process.cwd(), "..", "deployments", `${network}.json`);
  let dep: { chainId: number; factory: string } | null = null;
  try {
    dep = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    dep = null;
  }
  return {
    network,
    chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? dep?.chainId ?? 31337),
    factory: process.env.NEXT_PUBLIC_FACTORY_ADDRESS ?? dep?.factory ?? null,
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545",
  };
}

/** Indexer progress, so every indexed view can say how fresh it is. */
export async function indexerStatus(chainId: number) {
  const r = await db().query(
    "SELECT last_confirmed_block, updated_at FROM indexer_checkpoints WHERE chain_id=$1",
    [chainId]
  );
  return r.rowCount
    ? { block: Number(r.rows[0].last_confirmed_block), updatedAt: r.rows[0].updated_at as Date }
    : null;
}
