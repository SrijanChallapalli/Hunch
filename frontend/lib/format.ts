import { formatEther, formatUnits } from "ethers";

export const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

export function eth(wei: bigint | string, dp = 4): string {
  const n = Number(formatEther(BigInt(wei)));
  return n.toLocaleString(undefined, { maximumFractionDigits: dp });
}

export function shares(base: bigint | string, dp = 2): string {
  const n = Number(formatUnits(BigInt(base), 18));
  return n.toLocaleString(undefined, { maximumFractionDigits: dp });
}

export const pct = (p: number) => `${(p * 100).toFixed(1)}%`;

export function when(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function relative(unixSeconds: number, nowSeconds = Date.now() / 1000): string {
  const d = unixSeconds - nowSeconds;
  const abs = Math.abs(d);
  const unit =
    abs < 3600 ? `${Math.round(abs / 60)}m` : abs < 86400 ? `${Math.round(abs / 3600)}h` : `${Math.round(abs / 86400)}d`;
  return d >= 0 ? `in ${unit}` : `${unit} ago`;
}

export const STATUS_LABEL: Record<string, string> = {
  OPEN: "Open",
  CLOSED: "Closed",
  RESOLVED_YES: "Resolved YES",
  RESOLVED_NO: "Resolved NO",
  INVALID: "Invalid",
};

/** Pull a readable reason out of an ethers / wallet error. */
export function errorMessage(e: any): string {
  if (e?.code === "ACTION_REJECTED" || e?.info?.error?.code === 4001) return "Rejected in wallet";
  return (
    e?.reason ||
    e?.revert?.args?.[0] ||
    e?.info?.error?.data?.message ||
    e?.info?.error?.message ||
    e?.shortMessage ||
    e?.message ||
    String(e)
  );
}
