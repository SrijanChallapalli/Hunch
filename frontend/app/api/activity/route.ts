import { NextResponse } from "next/server";
import { appConfig, db, indexerStatus } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Latest indexed trades, redemptions, refunds, and market creations across all markets. */
export async function GET() {
  const { chainId } = appConfig();
  try {
    const rows = (
      await db().query(
        `SELECT * FROM (
           SELECT t.block_number, t.log_index, t.transaction_hash, t.market_address, t.trader AS who,
                  t.side AS kind, t.is_yes, t.eth_amount::text, t.shares::text, m.question
             FROM trades t JOIN markets m USING (chain_id, market_address) WHERE t.chain_id=$1
           UNION ALL
           SELECT r.block_number, r.log_index, r.transaction_hash, r.market_address, r.holder,
                  r.kind, NULL, r.eth_amount::text, r.shares::text, m.question
             FROM redemptions r JOIN markets m USING (chain_id, market_address) WHERE r.chain_id=$1
           UNION ALL
           SELECT m.created_block, -1, NULL, m.market_address, m.creator_address,
                  'CREATE', NULL, NULL, NULL, m.question
             FROM markets m WHERE m.chain_id=$1
         ) a ORDER BY block_number DESC, log_index DESC LIMIT 100`,
        [chainId]
      )
    ).rows;
    return NextResponse.json({ indexer: await indexerStatus(chainId), activity: rows });
  } catch (e: any) {
    return NextResponse.json({ error: `indexer database unavailable: ${e.message}` }, { status: 503 });
  }
}
