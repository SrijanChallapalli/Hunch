"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Contract, Interface, isAddress, parseEther } from "ethers";
import { useWallet } from "@/lib/wallet";
import { FACTORY_ABI } from "@/lib/abi";
import { TxStatus } from "@/components/Status";

const iface = new Interface(FACTORY_ABI);

function defaultClose(): string {
  const d = new Date(Date.now() + 7 * 86400_000);
  d.setMinutes(0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function Create() {
  const w = useWallet();
  const [question, setQuestion] = useState("");
  const [close, setClose] = useState(defaultClose);
  const [resolver, setResolver] = useState("");
  const [seed, setSeed] = useState("0.5");
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    if (w.account && !resolver) setResolver(w.account);
  }, [w.account, resolver]);

  const closeTs = Math.floor(new Date(close).getTime() / 1000);
  let seedWei = 0n;
  try {
    seedWei = parseEther(seed || "0");
  } catch {
    seedWei = -1n;
  }
  const problems = [
    !question.trim() && "Enter a question",
    !(closeTs > Date.now() / 1000 + 60) && "Close time must be in the future",
    !isAddress(resolver) && "Resolver must be a valid address",
    !(seedWei > 0n) && "Seed liquidity must be more than 0 ETH",
    !w.config?.factory && "No factory deployment found: run scripts/deploy.ts",
  ].filter(Boolean) as string[];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (problems.length || !w.config?.factory) return;
    setCreated(null);
    let hash = "";
    const ok = await w.send("Create market", async (s) => {
      const f = new Contract(w.config!.factory!, FACTORY_ABI, s);
      const tx = await f.createMarket(question.trim(), closeTs, resolver, { value: seedWei });
      hash = tx.hash;
      return tx;
    });
    if (ok && w.read) {
      const rc = await w.read.getTransactionReceipt(hash);
      for (const l of rc?.logs ?? []) {
        const p = (() => { try { return iface.parseLog(l); } catch { return null; } })();
        if (p?.name === "MarketCreated") setCreated(p.args.market);
      }
    }
  }

  return (
    <div className="two-col">
      <form className="card stack" onSubmit={submit}>
        <div>
          <h1>Create a market</h1>
          <p className="sub" style={{ margin: 0 }}>
            Your seed becomes the pool&apos;s initial liquidity at 50/50. You are the market&apos;s only LP
            and can claim the pool&apos;s remaining value after it resolves.
          </p>
        </div>
        <label>
          Question
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Will … happen by …?" maxLength={200} />
        </label>
        <label>
          Trading closes
          <input type="datetime-local" value={close} onChange={(e) => setClose(e.target.value)} />
        </label>
        <label>
          Resolver
          <input value={resolver} onChange={(e) => setResolver(e.target.value.trim())} placeholder="0x…" className="mono" />
          <span className="small muted">
            Only this address can resolve YES, NO, or INVALID after close. If it never acts,
            anyone can force INVALID 7 days after close.
          </span>
        </label>
        <label>
          Seed liquidity (ETH)
          <input type="number" min="0" step="0.01" value={seed} onChange={(e) => setSeed(e.target.value)} />
        </label>
        {problems.length > 0 && question && <div className="notice warn">{problems[0]}</div>}
        <button className="primary" type="submit" disabled={problems.length > 0 || !w.account}>
          {w.account ? "Create market" : "Connect a wallet to create"}
        </button>
        <TxStatus />
        {created && (
          <div className="notice ok">
            Market created. <Link href={`/market/${created}`}>Open it →</Link>
          </div>
        )}
      </form>

      <div className="card small">
        <h2>How it works</h2>
        <ul className="muted" style={{ paddingLeft: 18, margin: 0, display: "grid", gap: 8 }}>
          <li>Each share is backed by collateral: 0.01 ETH mints 1 YES + 1 NO.</li>
          <li>Traders buy and sell against a constant-product pool, so prices move with demand.</li>
          <li>After close, each winning share redeems for 0.01 ETH. A losing share pays nothing.</li>
          <li>An INVALID market refunds 0.005 ETH per share on either side.</li>
        </ul>
      </div>
    </div>
  );
}
