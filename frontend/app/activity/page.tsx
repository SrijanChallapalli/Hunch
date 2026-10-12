"use client";

import Link from "next/link";
import { useIndexed } from "@/lib/useIndexed";
import { eth, shares, short } from "@/lib/format";
import { IndexerBadge } from "@/components/Status";

interface Row {
  block_number: string;
  transaction_hash: string | null;
  market_address: string;
  who: string;
  kind: "BUY" | "SELL" | "REDEEM" | "REFUND" | "CREATE";
  is_yes: boolean | null;
  eth_amount: string | null;
  shares: string | null;
  question: string;
}

function describe(r: Row): React.ReactNode {
  const side = r.is_yes === null ? "" : r.is_yes ? "YES" : "NO";
  const cls = r.is_yes ? "yes-text" : "no-text";
  switch (r.kind) {
    case "BUY":
      return <>bought <span className={cls}>{shares(r.shares!)} {side}</span> for {eth(r.eth_amount!)} ETH</>;
    case "SELL":
      return <>sold <span className={cls}>{shares(r.shares!)} {side}</span> for {eth(r.eth_amount!)} ETH</>;
    case "REDEEM":
      return <>redeemed {shares(r.shares!)} winning shares for {eth(r.eth_amount!)} ETH</>;
    case "REFUND":
      return <>was refunded {eth(r.eth_amount!)} ETH for {shares(r.shares!)} shares</>;
    case "CREATE":
      return <>created a market</>;
  }
}

export default function Activity() {
  const { data, error } = useIndexed<{ indexer: { block: number } | null; activity: Row[] }>("/api/activity");
  return (
    <div className="stack">
      <div className="row between">
        <div>
          <h1>Activity</h1>
          <p className="sub" style={{ margin: 0 }}>The latest 100 indexed events across every market.</p>
        </div>
        <IndexerBadge block={data?.indexer?.block} />
      </div>
      {error && <div className="notice err">{error}</div>}
      <div className="card table-wrap">
        {data && data.activity.length === 0 && <div className="empty">No activity yet.</div>}
        {data && data.activity.length > 0 && (
          <table>
            <thead><tr><th>Block</th><th>Who</th><th>What</th><th>Market</th></tr></thead>
            <tbody>
              {data.activity.map((r, i) => (
                <tr key={`${r.transaction_hash}-${r.kind}-${i}`}>
                  <td className="mono">{r.block_number}</td>
                  <td className="mono"><Link href={`/portfolio?holder=${r.who}`}>{short(r.who)}</Link></td>
                  <td>{describe(r)}</td>
                  <td><Link href={`/market/${r.market_address}`}>{r.question}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
