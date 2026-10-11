"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { short, STATUS_LABEL } from "@/lib/format";

/** Shows the latest transaction's lifecycle: wallet prompt → pending → mined / failed. */
export function TxStatus() {
  const { tx } = useWallet();
  if (tx.kind === "idle") return null;
  if (tx.kind === "wallet") return <div className="notice">{tx.label}: confirm in your wallet…</div>;
  if (tx.kind === "pending")
    return <div className="notice warn">{tx.label}: pending <span className="mono">{short(tx.hash)}</span></div>;
  if (tx.kind === "mined")
    return (
      <div className="notice ok">
        {tx.label}: confirmed in block {tx.block} <span className="mono">{short(tx.hash)}</span>
      </div>
    );
  return <div className="notice err">{tx.label} failed: {tx.error}</div>;
}

/**
 * Labels indexed (PostgreSQL) data with how far the indexer has got relative to
 * the chain head, so a lagging indexer is never mistaken for on-chain state.
 */
export function IndexerBadge({ block }: { block: number | null | undefined }) {
  const { read, refreshKey } = useWallet();
  const [head, setHead] = useState<number | null>(null);
  useEffect(() => {
    read?.getBlockNumber().then(setHead).catch(() => setHead(null));
  }, [read, block, refreshKey]);
  if (block === null || block === undefined) {
    return <span className="badge">Indexer not running</span>;
  }
  const lag = head !== null ? Math.max(0, head - block) : null;
  return (
    <span className="badge" title="This view is built from the PostgreSQL indexer, not read live from the chain">
      Indexed to block {block}
      {lag !== null && (lag === 0 ? " · in sync" : ` · ${lag} block${lag === 1 ? "" : "s"} behind`)}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function ProbBar({ p }: { p: number }) {
  return (
    <div className="prob" role="img" aria-label={`YES ${(p * 100).toFixed(1)}%`}>
      <div style={{ width: `${(p * 100).toFixed(2)}%` }} />
    </div>
  );
}
