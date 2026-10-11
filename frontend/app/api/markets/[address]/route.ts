import { NextResponse } from "next/server";
import { appConfig, db, indexerStatus } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Indexed history for one market: trades, redemptions, and top holders. */
export async function GET(_req: Request, { params }: { params: { address: string } }) {
  const { chainId } = appConfig();
  const market = params.address.toLowerCase();
  try {
    const q = (sql: string) => db().query(sql, [chainId, market]).then((r) => r.rows);
    const [trades, redemptions, holders] = await Promise.all([
      q(`SELECT transaction_hash, trader, side, is_yes, eth_amount::text, shares::text, block_number
           FROM trades WHERE chain_id=$1 AND market_address=$2 ORDER BY block_number DESC, log_index DESC LIMIT 50`),
      q(`SELECT transaction_hash, holder, kind, shares::text, eth_amount::text, block_number
           FROM redemptions WHERE chain_id=$1 AND market_address=$2 ORDER BY block_number DESC, log_index DESC LIMIT 50`),
      q(`SELECT holder, token, balance::text FROM positions
           WHERE chain_id=$1 AND market_address=$2 AND balance > 0 AND holder <> $2
           ORDER BY balance DESC LIMIT 20`),
    ]);
    return NextResponse.json({ indexer: await indexerStatus(chainId), trades, redemptions, holders });
  } catch (e: any) {
    return NextResponse.json({ error: `indexer database unavailable: ${e.message}` }, { status: 503 });
  }
}
