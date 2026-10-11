import { NextResponse } from "next/server";
import { appConfig, db, indexerStatus } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * All indexed markets. Pool reserves come from the market contract's own indexed
 * YES/NO balances (rYes/rNo == tokens the pool holds), so price needs no RPC call.
 */
export async function GET() {
  const { chainId } = appConfig();
  try {
    const r = await db().query(
      `SELECT m.market_address, m.creator_address, m.question, extract(epoch from m.close_time)::bigint AS close_time,
              m.resolver_address, m.status, m.created_block,
              coalesce((SELECT balance FROM positions p WHERE p.chain_id=m.chain_id AND p.market_address=m.market_address
                         AND p.token='YES' AND p.holder=m.market_address), 0)::text AS r_yes,
              coalesce((SELECT balance FROM positions p WHERE p.chain_id=m.chain_id AND p.market_address=m.market_address
                         AND p.token='NO' AND p.holder=m.market_address), 0)::text AS r_no,
              (SELECT count(*) FROM trades t WHERE t.chain_id=m.chain_id AND t.market_address=m.market_address)::int AS trades,
              (SELECT coalesce(sum(eth_amount),0) FROM trades t WHERE t.chain_id=m.chain_id AND t.market_address=m.market_address)::text AS volume
         FROM markets m WHERE m.chain_id=$1
        ORDER BY m.created_block DESC`,
      [chainId]
    );
    return NextResponse.json({ indexer: await indexerStatus(chainId), markets: r.rows });
  } catch (e: any) {
    return NextResponse.json({ error: `indexer database unavailable: ${e.message}` }, { status: 503 });
  }
}
