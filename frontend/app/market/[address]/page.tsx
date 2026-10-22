"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Contract, formatUnits, isAddress, parseEther, parseUnits } from "ethers";
import { useWallet } from "@/lib/wallet";
import { useIndexed } from "@/lib/useIndexed";
import { MARKET_ABI, STATUS, TOKEN_ABI } from "@/lib/abi";
import { ONE, UNIT_WEI, probYes, quoteBuy, quoteSell, withSlippage } from "@/lib/fpmm";
import { eth, pct, relative, shares, short, when } from "@/lib/format";
import { IndexerBadge, ProbBar, StatusBadge, TxStatus } from "@/components/Status";

interface Live {
  question: string;
  status: (typeof STATUS)[number];
  closeTime: number;
  grace: number;
  rYes: bigint;
  rNo: bigint;
  creator: string;
  resolver: string;
  yesToken: string;
  noToken: string;
  lpSettled: boolean;
  balance: bigint;
  required: bigint;
  chainNow: number;
  myYes: bigint;
  myNo: bigint;
}

export default function MarketPage({ params }: { params: { address: string } }) {
  const address = params.address;
  const w = useWallet();
  const [live, setLive] = useState<Live | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!w.read || !isAddress(address)) return;
    try {
      const m = new Contract(address, MARKET_ABI, w.read);
      const [question, status, closeTime, grace, rYes, rNo, creator, resolver, yesToken, noToken, lpSettled, required, block] =
        await Promise.all([
          m.question(), m.status(), m.closeTime(), m.RESOLVE_GRACE(), m.rYes(), m.rNo(), m.creator(), m.resolver(),
          m.yesToken(), m.noToken(), m.lpSettled(), m.requiredCollateral(), w.read.getBlock("latest"),
        ]);
      const balance = await w.read.getBalance(address);
      let myYes = 0n;
      let myNo = 0n;
      if (w.account) {
        [myYes, myNo] = await Promise.all([
          new Contract(yesToken, TOKEN_ABI, w.read).balanceOf(w.account),
          new Contract(noToken, TOKEN_ABI, w.read).balanceOf(w.account),
        ]);
      }
      setLive({
        question, status: STATUS[Number(status)], closeTime: Number(closeTime), grace: Number(grace), rYes, rNo,
        creator, resolver, yesToken, noToken, lpSettled, balance, required, chainNow: block!.timestamp, myYes, myNo,
      });
      setLoadErr(null);
    } catch (e: any) {
      setLoadErr(`Could not read market ${short(address)} from the chain: ${e.shortMessage ?? e.message}`);
    }
  }, [w.read, w.account, address]);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 5000);
    return () => clearInterval(t);
  }, [load, w.refreshKey]);

  const { data: hist } = useIndexed<{ indexer: { block: number } | null; trades: any[]; redemptions: any[]; holders: any[] }>(
    `/api/markets/${address}`
  );

  if (!isAddress(address)) return <div className="notice err">Not a market address.</div>;
  if (loadErr) return <div className="notice err">{loadErr}</div>;
  if (!live) return <div className="muted">Loading market…</div>;

  const p = probYes(live.rYes, live.rNo);
  const open = live.status === "OPEN";
  const closed = live.chainNow >= live.closeTime;
  const tradingOpen = open && !closed;
  const me = w.account?.toLowerCase();

  return (
    <div className="stack">
      <div>
        <div className="row" style={{ marginBottom: 8 }}>
          <StatusBadge status={open && closed ? "CLOSED" : live.status} />
          <span className="small muted">
            {open ? (closed ? `Closed ${when(live.closeTime)}, awaiting resolution` : `Closes ${when(live.closeTime)} (${relative(live.closeTime, live.chainNow)})`) : `Closed ${when(live.closeTime)}`}
          </span>
          <span className="badge" title="Read live from the chain">live on-chain</span>
        </div>
        <h1>{live.question}</h1>
      </div>

      <TxStatus />

      <div className="two-col">
        <div className="stack">
          <div className="card stack">
            <div className="row between">
              <div>
                <div className="muted small">YES</div>
                <div className="big yes-text num">{pct(p)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="muted small">NO</div>
                <div className="big no-text num">{pct(1 - p)}</div>
              </div>
            </div>
            <ProbBar p={p} />
            <div className="small muted">
              Pool: {shares(live.rYes)} YES / {shares(live.rNo)} NO. A winning share pays 0.01 ETH.
            </div>
          </div>

          <HistoryCard hist={hist} />
        </div>

        <div className="stack">
          {tradingOpen && <TradeCard address={address} live={live} />}
          <SettleCard address={address} live={live} closed={closed} me={me} />
          <div className="card">
            <h2>Your position</h2>
            {w.account ? (
              <dl className="kv">
                <dt>YES shares</dt><dd className="num yes-text">{shares(live.myYes, 4)}</dd>
                <dt>NO shares</dt><dd className="num no-text">{shares(live.myNo, 4)}</dd>
              </dl>
            ) : (
              <div className="muted small">Connect a wallet to trade and see your shares.</div>
            )}
          </div>
          <div className="card">
            <h2>Collateral</h2>
            <dl className="kv small">
              <dt>Contract balance</dt><dd className="num">{eth(live.balance, 6)} ETH</dd>
              <dt>Owed to holders</dt><dd className="num">{eth(live.required, 6)} ETH</dd>
              <dt>Fully backed</dt>
              <dd className={live.balance >= live.required ? "yes-text" : "no-text"}>{live.balance >= live.required ? "Yes" : "NO — investigate"}</dd>
              <dt>Creator (LP)</dt><dd className="mono">{short(live.creator)}</dd>
              <dt>Resolver</dt><dd className="mono">{short(live.resolver)}</dd>
              <dt>Market</dt><dd className="mono">{short(address)}</dd>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

function TradeCard({ address, live }: { address: string; live: Live }) {
  const w = useWallet();
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [isYes, setIsYes] = useState(true);
  const [amount, setAmount] = useState("");
  const [slipBps, setSlipBps] = useState(100);
  const [allowance, setAllowance] = useState<bigint>(0n);

  const token = isYes ? live.yesToken : live.noToken;
  const held = isYes ? live.myYes : live.myNo;

  useEffect(() => {
    if (!w.read || !w.account || mode !== "sell") return;
    new Contract(token, TOKEN_ABI, w.read).allowance(w.account, address).then(setAllowance).catch(() => setAllowance(0n));
  }, [w.read, w.account, token, address, mode, w.refreshKey]);

  let amt = 0n;
  let bad = false;
  try {
    amt = amount ? (mode === "buy" ? parseEther(amount) : parseUnits(amount, 18)) : 0n;
  } catch {
    bad = true;
  }
  const quote = mode === "buy" ? quoteBuy(live.rYes, live.rNo, isYes, amt) : quoteSell(live.rYes, live.rNo, isYes, amt);
  const minOut = quote === null ? 0n : withSlippage(quote, slipBps);
  const avgPrice =
    quote && quote > 0n && amt > 0n
      ? mode === "buy"
        ? Number(amt) / Number(quote) / (Number(UNIT_WEI) / Number(ONE))
        : Number(quote) / Number(amt) / (Number(UNIT_WEI) / Number(ONE))
      : null;

  const problem =
    bad ? "Enter a valid number"
    : amt <= 0n ? null
    : mode === "sell" && amt > held ? `You hold ${shares(held, 4)} ${isYes ? "YES" : "NO"}`
    : quote === null ? "Not enough pool liquidity for this sale"
    : quote === 0n ? "Amount too small"
    : null;
  const needsApproval = mode === "sell" && amt > 0n && allowance < amt;

  async function submit() {
    if (!amt || problem) return;
    const label = `${mode === "buy" ? "Buy" : "Sell"} ${isYes ? "YES" : "NO"}`;
    if (needsApproval) {
      const ok = await w.send(`Approve ${isYes ? "YES" : "NO"}`, (s) => new Contract(token, TOKEN_ABI, s).approve(address, amt));
      if (!ok) return;
      setAllowance(amt);
    }
    const ok = await w.send(label, (s) => {
      const m = new Contract(address, MARKET_ABI, s);
      return mode === "buy" ? m.buy(isYes, minOut, { value: amt }) : m.sell(isYes, amt, minOut);
    });
    if (ok) setAmount("");
  }

  return (
    <div className="card stack">
      <div className="row between">
        <h2 style={{ margin: 0 }}>Trade</h2>
        <div className="seg">
          <button className={mode === "buy" ? "on" : ""} onClick={() => setMode("buy")}>Buy</button>
          <button className={mode === "sell" ? "on" : ""} onClick={() => setMode("sell")}>Sell</button>
        </div>
      </div>
      <div className="seg" style={{ width: "100%" }}>
        <button style={{ flex: 1 }} className={isYes ? "on yes-on" : ""} onClick={() => setIsYes(true)}>YES {pct(probYes(live.rYes, live.rNo))}</button>
        <button style={{ flex: 1 }} className={!isYes ? "on no-on" : ""} onClick={() => setIsYes(false)}>NO {pct(1 - probYes(live.rYes, live.rNo))}</button>
      </div>
      <label>
        {mode === "buy" ? "Spend (ETH)" : "Shares to sell"}
        <input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" />
        {mode === "sell" && held > 0n && (
          <span className="small">
            <button className="ghost small" style={{ padding: "2px 8px" }} onClick={() => setAmount(formatUnits(held, 18))}>Max</button>{" "}
            <span className="muted">{shares(held, 4)} held</span>
          </span>
        )}
      </label>
      <label>
        Slippage tolerance
        <select value={slipBps} onChange={(e) => setSlipBps(Number(e.target.value))}>
          <option value={10}>0.1%</option>
          <option value={50}>0.5%</option>
          <option value={100}>1%</option>
          <option value={300}>3%</option>
        </select>
      </label>
      {amt > 0n && quote !== null && !problem && (
        <dl className="kv small">
          <dt>You receive</dt>
          <dd className="num">{mode === "buy" ? `${shares(quote, 4)} ${isYes ? "YES" : "NO"}` : `${eth(quote, 6)} ETH`}</dd>
          <dt>Minimum after slippage</dt>
          <dd className="num">{mode === "buy" ? `${shares(minOut, 4)} shares` : `${eth(minOut, 6)} ETH`}</dd>
          {avgPrice !== null && (<><dt>Average price</dt><dd className="num">{pct(avgPrice)}</dd></>)}
          {mode === "buy" && (<><dt>Pays if {isYes ? "YES" : "NO"} wins</dt><dd className="num">{eth((quote * UNIT_WEI) / ONE, 6)} ETH</dd></>)}
        </dl>
      )}
      {problem && <div className="notice warn">{problem}</div>}
      <button
        className={isYes ? "yes" : "no"}
        disabled={!w.account || !amt || !!problem || w.tx.kind === "wallet" || w.tx.kind === "pending"}
        onClick={submit}
      >
        {!w.account ? "Connect a wallet" : needsApproval ? `Approve & sell ${isYes ? "YES" : "NO"}` : `${mode === "buy" ? "Buy" : "Sell"} ${isYes ? "YES" : "NO"}`}
      </button>
    </div>
  );
}

function SettleCard({ address, live, closed, me }: { address: string; live: Live; closed: boolean; me?: string }) {
  const w = useWallet();
  const m = (s: any) => new Contract(address, MARKET_ABI, s);
  const isResolver = me === live.resolver.toLowerCase();
  const isCreator = me === live.creator.toLowerCase();
  const busy = w.tx.kind === "wallet" || w.tx.kind === "pending";
  const graceOver = live.chainNow >= live.closeTime + live.grace;

  const parts: React.ReactNode[] = [];

  if (live.status === "OPEN" && closed) {
    if (isResolver) {
      parts.push(
        <div key="resolve" className="stack">
          <div className="small muted">You are the resolver. Resolving is final.</div>
          <div className="row">
            <button className="yes" disabled={busy} onClick={() => w.send("Resolve YES", (s) => m(s).resolve(1))}>Resolve YES</button>
            <button className="no" disabled={busy} onClick={() => w.send("Resolve NO", (s) => m(s).resolve(2))}>Resolve NO</button>
            <button disabled={busy} onClick={() => w.send("Resolve INVALID", (s) => m(s).resolve(3))}>Invalid</button>
          </div>
        </div>
      );
    } else {
      parts.push(
        <div key="wait" className="small muted">
          Trading has closed. Waiting for the resolver ({short(live.resolver)}).
          {graceOver ? " The grace period has passed, so anyone can mark this market INVALID." : ` If they never act, anyone can mark it INVALID ${relative(live.closeTime + live.grace, live.chainNow)}.`}
        </div>
      );
    }
    if (graceOver) {
      parts.push(
        <button key="force" disabled={busy || !w.account} onClick={() => w.send("Force INVALID", (s) => m(s).forceInvalid())}>
          Force INVALID
        </button>
      );
    }
  }

  if (live.status === "RESOLVED_YES" || live.status === "RESOLVED_NO") {
    const yesWon = live.status === "RESOLVED_YES";
    const win = yesWon ? live.myYes : live.myNo;
    parts.push(
      <div key="redeem" className="stack">
        <div className="small">
          {yesWon ? "YES" : "NO"} won. Each winning share redeems for 0.01 ETH.
        </div>
        <button
          className="primary"
          disabled={busy || win === 0n}
          onClick={() => w.send("Redeem", (s) => m(s).redeem(win))}
        >
          {win > 0n ? `Redeem ${shares(win, 4)} shares for ${eth((win * UNIT_WEI) / ONE, 6)} ETH` : "No winning shares to redeem"}
        </button>
      </div>
    );
  }

  if (live.status === "INVALID") {
    const total = live.myYes + live.myNo;
    parts.push(
      <div key="refund" className="stack">
        <div className="small">This market was marked INVALID. Every share, YES or NO, refunds 0.005 ETH.</div>
        <button
          className="primary"
          disabled={busy || total === 0n}
          onClick={() => w.send("Refund", (s) => m(s).refundInvalid(live.myYes, live.myNo))}
        >
          {total > 0n ? `Refund ${shares(total, 4)} shares for ${eth((total * UNIT_WEI) / ONE / 2n, 6)} ETH` : "No shares to refund"}
        </button>
      </div>
    );
  }

  if (live.status !== "OPEN" && isCreator) {
    parts.push(
      <button key="lp" disabled={busy || live.lpSettled} onClick={() => w.send("Settle LP", (s) => m(s).settleLP())}>
        {live.lpSettled ? "LP position settled" : "Claim LP position (creator)"}
      </button>
    );
  }

  if (!parts.length) return null;
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Settlement</h2>
      {parts}
    </div>
  );
}

function HistoryCard({ hist }: { hist: { indexer: { block: number } | null; trades: any[]; redemptions: any[] } | null }) {
  return (
    <div className="card table-wrap">
      <div className="row between" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Recent trades</h2>
        <IndexerBadge block={hist?.indexer?.block} />
      </div>
      {!hist || hist.trades.length === 0 ? (
        <div className="empty">No trades indexed yet.</div>
      ) : (
        <table>
          <thead><tr><th>Trader</th><th>Action</th><th>Shares</th><th>ETH</th><th>Block</th></tr></thead>
          <tbody>
            {hist.trades.map((t) => (
              <tr key={t.transaction_hash + t.side}>
                <td className="mono"><Link href={`/portfolio?holder=${t.trader}`}>{short(t.trader)}</Link></td>
                <td>
                  {t.side === "BUY" ? "Buy" : "Sell"}{" "}
                  <span className={t.is_yes ? "yes-text" : "no-text"}>{t.is_yes ? "YES" : "NO"}</span>
                </td>
                <td className="num">{shares(t.shares)}</td>
                <td className="num">{eth(t.eth_amount)}</td>
                <td className="mono">{t.block_number}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hist && hist.redemptions.length > 0 && (
        <>
          <h2 style={{ marginTop: 18 }}>Redemptions and refunds</h2>
          <table>
            <thead><tr><th>Holder</th><th>Kind</th><th>Shares</th><th>Paid</th></tr></thead>
            <tbody>
              {hist.redemptions.map((r) => (
                <tr key={r.transaction_hash + r.kind}>
                  <td className="mono">{short(r.holder)}</td>
                  <td>{r.kind}</td>
                  <td className="num">{shares(r.shares)}</td>
                  <td className="num">{eth(r.eth_amount)} ETH</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
