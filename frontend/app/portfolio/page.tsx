"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { isAddress } from "ethers";
import { useWallet } from "@/lib/wallet";
import { useIndexed } from "@/lib/useIndexed";
import { ONE, UNIT_WEI, probYes } from "@/lib/fpmm";
import { eth, shares, short } from "@/lib/format";
import { IndexerBadge, StatusBadge } from "@/components/Status";

interface Position {
  market_address: string;
  token: "YES" | "NO";
  balance: string;
  question: string;
  status: string;
  close_time: string;
  r_yes: string;
  r_no: string;
}
interface Settlement {
  transaction_hash: string;
  market_address: string;
  kind: string;
  shares: string;
  eth_amount: string;
  block_number: string;
  question: string;
}

/** Value in wei: payout if settled, or mark-to-market at the pool's implied price if open. */
function value(p: Position): { wei: bigint; claimable: boolean } {
  const bal = BigInt(p.balance);
  const full = (bal * UNIT_WEI) / ONE;
  if (p.status === "RESOLVED_YES") return { wei: p.token === "YES" ? full : 0n, claimable: p.token === "YES" };
  if (p.status === "RESOLVED_NO") return { wei: p.token === "NO" ? full : 0n, claimable: p.token === "NO" };
  if (p.status === "INVALID") return { wei: full / 2n, claimable: true };
  const prob = probYes(BigInt(p.r_yes), BigInt(p.r_no));
  const ppm = BigInt(Math.round((p.token === "YES" ? prob : 1 - prob) * 1e6));
  return { wei: (full * ppm) / 1_000_000n, claimable: false };
}

export default function Portfolio() {
  const w = useWallet();
  const [holder, setHolder] = useState("");
  const [fromLink, setFromLink] = useState(false);
  useEffect(() => {
    // links from Activity / Market pages pass ?holder=
    const q = new URLSearchParams(window.location.search).get("holder");
    if (q) {
      setHolder(q);
      setFromLink(true);
    }
  }, []);
  useEffect(() => {
    if (w.account && !fromLink) setHolder(w.account);
  }, [w.account, fromLink]);

  const valid = isAddress(holder);
  const { data, error } = useIndexed<{ indexer: { block: number } | null; positions: Position[]; settlements: Settlement[] }>(
    valid ? `/api/portfolio?holder=${holder}` : null
  );

  const positions = data?.positions ?? [];
  const total = positions.reduce((s, p) => s + value(p).wei, 0n);
  const claimable = positions.filter((p) => value(p).claimable && value(p).wei > 0n);

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <h1>Portfolio</h1>
          <p className="sub" style={{ margin: 0 }}>
            Built from every ERC20 transfer, so shares sent between wallets show up too.
          </p>
        </div>
        <IndexerBadge block={data?.indexer?.block} />
      </div>

      <div className="card row">
        <label style={{ flex: 1 }}>
          Address
          <input className="mono" value={holder} onChange={(e) => setHolder(e.target.value.trim())} placeholder="0x… (or connect a wallet)" />
        </label>
      </div>

      {error && <div className="notice err">{error}</div>}

      {valid && data && (
        <>
          <div className="grid">
            <div className="card">
              <div className="muted small">Estimated value</div>
              <div className="big num">{eth(total)} ETH</div>
              <div className="muted small">Open positions use the pool&apos;s implied price</div>
            </div>
            <div className="card">
              <div className="muted small">Ready to claim</div>
              <div className="big num">{claimable.length}</div>
              <div className="muted small">positions in settled markets</div>
            </div>
          </div>

          <div className="card table-wrap">
            <h2>Positions</h2>
            {positions.length === 0 ? (
              <div className="empty">No outcome shares held.</div>
            ) : (
              <table>
                <thead>
                  <tr><th>Market</th><th>Side</th><th>Shares</th><th>Value</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {positions.map((p) => {
                    const v = value(p);
                    return (
                      <tr key={p.market_address + p.token}>
                        <td><Link href={`/market/${p.market_address}`}>{p.question}</Link></td>
                        <td className={p.token === "YES" ? "yes-text" : "no-text"}>{p.token}</td>
                        <td className="num">{shares(p.balance)}</td>
                        <td className="num">{eth(v.wei)} ETH</td>
                        <td><StatusBadge status={p.status} /></td>
                        <td>{v.claimable && v.wei > 0n && <Link href={`/market/${p.market_address}`}>Claim →</Link>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="card table-wrap">
            <h2>Redemptions and refunds</h2>
            {data.settlements.length === 0 ? (
              <div className="empty">None yet.</div>
            ) : (
              <table>
                <thead><tr><th>Market</th><th>Kind</th><th>Shares</th><th>Paid</th><th>Block</th></tr></thead>
                <tbody>
                  {data.settlements.map((s) => (
                    <tr key={s.transaction_hash + s.kind}>
                      <td><Link href={`/market/${s.market_address}`}>{s.question}</Link></td>
                      <td>{s.kind}</td>
                      <td className="num">{shares(s.shares)}</td>
                      <td className="num">{eth(s.eth_amount)} ETH</td>
                      <td className="mono" title={s.transaction_hash}>{s.block_number} · {short(s.transaction_hash)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
