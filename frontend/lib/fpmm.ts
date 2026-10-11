// Client-side mirror of PredictionMarket's pricing math (bigint, same rounding),
// used for quotes and slippage limits. The contract stays the authority.

export const ONE = 10n ** 18n; // token base units per whole share
export const UNIT_WEI = 10n ** 16n; // wei paid per winning whole share (0.01 ETH)

function sqrtCeil(n: bigint): bigint {
  if (n < 0n) throw new Error("sqrt of negative");
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x * x === n ? x : x + 1n;
}

/** Shares received for `ethIn` wei (exact-input buy). */
export function quoteBuy(rYes: bigint, rNo: bigint, isYes: boolean, ethIn: bigint): bigint {
  const m = (ethIn * ONE) / UNIT_WEI;
  if (m === 0n) return 0n;
  const k = rYes * rNo;
  if (isYes) {
    const newRNo = rNo + m;
    return rYes + m - k / newRNo;
  }
  const newRYes = rYes + m;
  return rNo + m - k / newRYes;
}

/** Wei received for selling `sharesIn` (exact-input sell); null if the pool can't fill it. */
export function quoteSell(rYes: bigint, rNo: bigint, isYes: boolean, sharesIn: bigint): bigint | null {
  if (sharesIn === 0n) return 0n;
  const [rSell, rOther] = isYes ? [rYes, rNo] : [rNo, rYes];
  const B = rSell + rOther + sharesIn;
  const s = sqrtCeil(B * B - 4n * sharesIn * rOther);
  const R = (B - s) / 2n;
  if (R >= rOther) return null;
  return (R * UNIT_WEI) / ONE;
}

/** Apply a slippage tolerance in basis points to a quoted minimum. */
export function withSlippage(amount: bigint, bps: number): bigint {
  return (amount * BigInt(10_000 - bps)) / 10_000n;
}

/** Implied probability of YES in [0, 1]. */
export function probYes(rYes: bigint, rNo: bigint): number {
  const total = rYes + rNo;
  return total === 0n ? 0.5 : Number((rNo * 1_000_000n) / total) / 1_000_000;
}
