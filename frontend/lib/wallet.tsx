"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BrowserProvider, JsonRpcProvider, JsonRpcSigner, Signer, TransactionResponse } from "ethers";
import { errorMessage } from "./format";

export interface Config {
  network: string;
  chainId: number;
  factory: string | null;
  rpcUrl: string;
}

export type TxState =
  | { kind: "idle" }
  | { kind: "wallet"; label: string }
  | { kind: "pending"; label: string; hash: string }
  | { kind: "mined"; label: string; hash: string; block: number }
  | { kind: "failed"; label: string; error: string };

interface WalletCtx {
  config: Config | null;
  read: JsonRpcProvider | null;
  signer: Signer | null;
  account: string | null;
  walletChainId: number | null;
  source: "injected" | "dev" | null;
  devAccounts: string[];
  wrongNetwork: boolean;
  connectInjected(): Promise<void>;
  selectDevAccount(index: number): Promise<void>;
  disconnect(): void;
  switchNetwork(): Promise<void>;
  tx: TxState;
  send(label: string, fn: (s: Signer) => Promise<TransactionResponse>): Promise<boolean>;
  refreshKey: number;
}

const Ctx = createContext<WalletCtx | null>(null);

declare global {
  interface Window {
    ethereum?: any;
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [source, setSource] = useState<"injected" | "dev" | null>(null);
  const [devAccounts, setDevAccounts] = useState<string[]>([]);
  const [tx, setTx] = useState<TxState>({ kind: "idle" });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  const read = useMemo(
    () => (config ? new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true }) : null),
    [config]
  );

  // Local dev chain only: the node's unlocked accounts can sign without a wallet extension.
  useEffect(() => {
    if (!read || config?.chainId !== 31337) return;
    read
      .send("eth_accounts", [])
      .then((a: string[]) => setDevAccounts(a.slice(0, 20)))
      .catch(() => setDevAccounts([]));
  }, [read, config]);

  const connectInjected = useCallback(async () => {
    if (!window.ethereum) throw new Error("No browser wallet found. Install MetaMask, or use a dev account on a local chain.");
    const bp = new BrowserProvider(window.ethereum);
    await bp.send("eth_requestAccounts", []);
    const s = await bp.getSigner();
    setSigner(s);
    setAccount(await s.getAddress());
    setWalletChainId(Number((await bp.getNetwork()).chainId));
    setSource("injected");
  }, []);

  useEffect(() => {
    const eth = window.ethereum;
    if (!eth?.on || source !== "injected") return;
    const onAccounts = () => connectInjected().catch(() => undefined);
    const onChain = (id: string) => {
      setWalletChainId(parseInt(id, 16));
      connectInjected().catch(() => undefined);
    };
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [source, connectInjected]);

  const selectDevAccount = useCallback(
    async (index: number) => {
      if (!read || !config) return;
      const s = new JsonRpcSigner(read, devAccounts[index]);
      setSigner(s);
      setAccount(devAccounts[index]);
      setWalletChainId(config.chainId);
      setSource("dev");
    },
    [read, config, devAccounts]
  );

  const disconnect = useCallback(() => {
    setSigner(null);
    setAccount(null);
    setWalletChainId(null);
    setSource(null);
  }, []);

  const switchNetwork = useCallback(async () => {
    if (!window.ethereum || !config) return;
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x" + config.chainId.toString(16) }],
    });
  }, [config]);

  const wrongNetwork = !!config && walletChainId !== null && walletChainId !== config.chainId;

  const send = useCallback(
    async (label: string, fn: (s: Signer) => Promise<TransactionResponse>) => {
      if (!signer) {
        setTx({ kind: "failed", label, error: "Connect a wallet first" });
        return false;
      }
      if (wrongNetwork) {
        setTx({ kind: "failed", label, error: `Switch your wallet to chain ${config?.chainId}` });
        return false;
      }
      try {
        setTx({ kind: "wallet", label });
        const resp = await fn(signer);
        setTx({ kind: "pending", label, hash: resp.hash });
        const rc = await resp.wait();
        if (!rc || rc.status !== 1) throw new Error("Transaction reverted");
        setTx({ kind: "mined", label, hash: resp.hash, block: rc.blockNumber });
        setRefreshKey((k) => k + 1);
        return true;
      } catch (e) {
        setTx({ kind: "failed", label, error: errorMessage(e) });
        setRefreshKey((k) => k + 1);
        return false;
      }
    },
    [signer, wrongNetwork, config]
  );

  const value: WalletCtx = {
    config,
    read,
    signer,
    account,
    walletChainId,
    source,
    devAccounts,
    wrongNetwork,
    connectInjected,
    selectDevAccount,
    disconnect,
    switchNetwork,
    tx,
    send,
    refreshKey,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWallet outside WalletProvider");
  return c;
}
