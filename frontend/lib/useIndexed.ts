"use client";

import { useEffect, useState } from "react";
import { useWallet } from "./wallet";

/**
 * Fetch an indexer API route and re-poll it, so views catch up with the indexer
 * after a transaction without a manual reload.
 */
export function useIndexed<T>(url: string | null, pollMs = 3000) {
  const { refreshKey } = useWallet();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(url, { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        if (!r.ok) setError(j.error ?? `HTTP ${r.status}`);
        else {
          setError(null);
          setData(j);
        }
      } catch (e: any) {
        if (alive) setError(e.message);
      }
    };
    load();
    const t = setInterval(load, pollMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [url, pollMs, refreshKey]);

  return { data, error };
}
