"use client";

import Link from "next/link";
import { useState } from "react";
import { useIndexed } from "@/lib/useIndexed";
import { probYes } from "@/lib/fpmm";
import { eth, pct, relative, short } from "@/lib/format";
import { IndexerBadge, ProbBar, StatusBadge } from "@/components/Status";

interface MarketRow {
  market_address: string;
  creator_address: string;
  question: string;
  close_time: string;
  status: string;
  r_yes: string;
  r_no: string;
  trades: number;
  volume: string;
}

const FILTERS = ["All", "Open", "Settled"] as const;
const SORTS = {
  newest: "Newest",
  closing: "Closing soon",
  volume: "Most volume",
} as const;
type Sort = keyof typeof SORTS;

function compare(sort: Sort, now: number) {
  return (a: MarketRow, b: MarketRow) => {
    if (sort === "volume") {
      const d = BigInt(b.volume) - BigInt(a.volume);
      return d > 0n ? 1 : d < 0n ? -1 : 0;
    }
    if (sort === "closing") {
      // still-trading markets first, soonest deadline first; everything else after
      const ca = Number(a.close_time);
      const cb = Number(b.close_time);
      const la = a.status === "OPEN" && ca > now ? 0 : 1;
      const lb = b.status === "OPEN" && cb > now ? 0 : 1;
      return la - lb || ca - cb;
    }
    return 0; // API already returns newest first
  };
}

export default function Explore() {
  const { data, error } = useIndexed<{ indexer: { block: number } | null; markets: MarketRow[] }>("/api/markets");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const now = Date.now() / 1000;
  const needle = query.trim().toLowerCase();

  const markets = (data?.markets ?? [])
    .filter((m) =>
      filter === "All" ? true : filter === "Open" ? m.status === "OPEN" : m.status !== "OPEN"
    )
    .filter((m) => !needle || m.question.toLowerCase().includes(needle) || m.market_address.includes(needle))
    .sort(compare(sort, now));

  return (
    <div className="stack">
      <div className="row between">
        <div>
          <h1>Markets</h1>
          <p className="sub" style={{ margin: 0 }}>Binary YES/NO markets backed 1:1 by ETH collateral.</p>
        </div>
        <div className="row">
          <IndexerBadge block={data?.indexer?.block} />
          <div className="seg">
            {FILTERS.map((f) => (
              <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="row">
        <input
          type="search"
          aria-label="Search markets"
          placeholder="Search questions or addresses"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <select aria-label="Sort markets" value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ width: "auto" }}>
          {(Object.keys(SORTS) as Sort[]).map((k) => (
            <option key={k} value={k}>{SORTS[k]}</option>
          ))}
        </select>
      </div>

      {error && <div className="notice err">{error}</div>}
      {!error && data && markets.length === 0 && needle && (
        <div className="card empty">No markets match “{query.trim()}”.</div>
      )}
      {!error && data && markets.length === 0 && !needle && (
        <div className="card empty">
          No markets yet. <Link href="/create">Create one</Link> or run <span className="mono">npm run seed</span>.
        </div>
      )}

      <div className="grid">
        {markets.map((m) => {
          const p = probYes(BigInt(m.r_yes), BigInt(m.r_no));
          const closes = Number(m.close_time);
          return (
            <Link key={m.market_address} href={`/market/${m.market_address}`} className="card market-card">
              <div className="row between">
                <StatusBadge status={m.status === "OPEN" && closes <= now ? "CLOSED" : m.status} />
                <span className="small muted">
                  {m.status === "OPEN" ? (closes > now ? `closes ${relative(closes)}` : "awaiting resolution") : ""}
                </span>
              </div>
              <strong>{m.question}</strong>
              {m.status === "OPEN" ? (
                <div>
                  <div className="row between small">
                    <span className="yes-text">YES {pct(p)}</span>
                    <span className="no-text">NO {pct(1 - p)}</span>
                  </div>
                  <ProbBar p={p} />
                </div>
              ) : (
                <div className="small">
                  {m.status === "INVALID"
                    ? "Invalid: every share refunds 0.005 ETH"
                    : `${m.status === "RESOLVED_YES" ? "YES" : "NO"} won: each winning share pays 0.01 ETH`}
                </div>
              )}
              <div className="row between small muted">
                <span>{m.trades} trades · {eth(m.volume, 3)} ETH volume</span>
                <span className="mono">{short(m.market_address)}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
