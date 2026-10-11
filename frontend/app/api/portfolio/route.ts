import { NextResponse } from "next/server";
import { appConfig, db, indexerStatus } from "@/lib/db";

export const dynamic = "force-dynamic";

/** A holder's indexed positions (from every ERC20 Transfer) and settlement history. */
export async function GET(req: Request) {
  const { chainId } = appConfig();
  const holder = new URL(req.url).searchParams.get("holder")?.toLowerCase();
  if (!holder || !/^0x[0-9a-f]{40}$/.test(holder)) {
    return NextResponse.json({ error: "holder must be an address" }, { status: 400 });
  }
  try {
    const positions = (
      await db().query(
        `SELECT p.market_address, p.token, p.balance::text, m.question, m.status,
                extract(epoch from m.close_time)::bigint AS close_time,
                coalesce((SELECT balance FROM positions x WHERE x.chain_id=p.chain_id AND x.market_address=p.market_address
                           AND x.token='YES' AND x.holder=p.market_address), 0)::text AS r_yes,
                coalesce((SELECT balance FROM positions x WHERE x.chain_id=p.chain_id AND x.market_address=p.market_address
                           AND x.token='NO' AND x.holder=p.market_address), 0)::text AS r_no
           FROM positions p JOIN markets m ON m.chain_id=p.chain_id AND m.market_address=p.market_address
          WHERE p.chain_id=$1 AND p.holder=$2 AND p.balance > 0
          ORDER BY m.created_block DESC, p.token DESC`,
        [chainId, holder]
      )
    ).rows;
    const settlements = (
      await db().query(
        `SELECT r.transaction_hash, r.market_address, r.kind, r.shares::text, r.eth_amount::text, r.block_number, m.question
           FROM redemptions r JOIN markets m ON m.chain_id=r.chain_id AND m.market_address=r.market_address
          WHERE r.chain_id=$1 AND r.holder=$2 ORDER BY r.block_number DESC`,
        [chainId, holder]
      )
    ).rows;
    return NextResponse.json({ indexer: await indexerStatus(chainId), positions, settlements });
  } catch (e: any) {
    return NextResponse.json({ error: `indexer database unavailable: ${e.message}` }, { status: 503 });
  }
}
