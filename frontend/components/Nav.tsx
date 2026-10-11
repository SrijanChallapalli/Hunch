"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useWallet } from "@/lib/wallet";
import { errorMessage, short } from "@/lib/format";

const LINKS = [
  { href: "/", label: "Explore" },
  { href: "/create", label: "Create" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/activity", label: "Activity" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="nav">
      <div className="container">
        <Link href="/" className="brand">Prediction Market</Link>
        <nav className="nav-links">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={path === l.href ? "active" : ""}>
              {l.label}
            </Link>
          ))}
        </nav>
        <WalletButton />
      </div>
    </header>
  );
}

function WalletButton() {
  const w = useWallet();
  const [err, setErr] = useState<string | null>(null);

  if (w.account) {
    return (
      <div className="row">
        {w.wrongNetwork && (
          <button className="primary" onClick={() => w.switchNetwork().catch((e) => setErr(errorMessage(e)))}>
            Switch to chain {w.config?.chainId}
          </button>
        )}
        <span className="badge" title={w.account}>
          {w.source === "dev" ? "dev " : ""}
          {short(w.account)}
        </span>
        <button className="ghost small" onClick={w.disconnect}>Disconnect</button>
      </div>
    );
  }
  return (
    <div className="row">
      <button
        className="primary"
        onClick={() => {
          setErr(null);
          w.connectInjected().catch((e) => setErr(errorMessage(e)));
        }}
      >
        Connect wallet
      </button>
      {w.devAccounts.length > 0 && (
        <select
          aria-label="Use a local dev account"
          defaultValue=""
          onChange={(e) => e.target.value !== "" && w.selectDevAccount(Number(e.target.value))}
          style={{ width: "auto" }}
        >
          <option value="" disabled>Local dev account…</option>
          {w.devAccounts.map((a, i) => (
            <option key={a} value={i}>#{i} {short(a)}</option>
          ))}
        </select>
      )}
      {err && <span className="small no-text">{err}</span>}
    </div>
  );
}
