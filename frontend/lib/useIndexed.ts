"use client";

import { useEffect, useState } from "react";
import { useWallet } from "./wallet";

/**
 * Fetch an indexer API route and re-poll it, so views catch up with the indexer
 * after a transaction without a manual reload. Background tabs stop polling.
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
    // Skip polls while the tab is hidden, and catch up as soon as it is shown again.
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, pollMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, pollMs, refreshKey]);

  return { data, error };
}
