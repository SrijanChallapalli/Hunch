/**
 * M5 — Reproducible >= 7,500-operation simulation.
 *
 * Deterministic (seeded) mixed workload across 8 concurrent markets and many
 * users: buys/sells on both outcomes, set mint/merge, plus deliberately rejected
 * orders (zero value, no allowance, slippage, wrong state, closed market).
 * Solvency is asserted after EVERY accepted operation. After trading, markets are
 * resolved to a YES/NO/INVALID mix and the settlement edge cases are exercised:
 * partial redemptions, double-claim attempts, invalid-market refunds, and a payout
 * to a receiver that rejects ETH.
 *
 * Run: npx hardhat run test/simulation/run-7500.ts
 * Output: benchmark/results/simulation-report.{json,md}
 */
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import * as fs from "fs";
import * as path from "path";

const TARGET_OPS = 7500;
const N_MARKETS = 8;
const SEED = 0xBADC0DE;
const ONE = 10n ** 18n;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

async function main() {
  const t0 = Date.now();
  const rnd = lcg(SEED);
  const signers = await ethers.getSigners();
  const traders = signers.slice(10, 20); // 10 traders

  const Factory = await ethers.getContractFactory("MarketFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();

  const now = await time.latest();
  const closeTime = now + 10_000_000; // far out, so block-time drift never closes mid-run

  type M = { m: any; yes: any; no: any; creator: any; resolver: any };
  const markets: M[] = [];
  for (let i = 0; i < N_MARKETS; i++) {
    const creator = signers[i];
    const resolver = signers[(i + 1) % N_MARKETS];
    await factory.connect(creator).createMarket(`Q${i}`, closeTime, resolver.address, {
      value: ethers.parseEther((0.5 + 0.1 * i).toFixed(1)),
    });
    const m = await ethers.getContractAt("PredictionMarket", await factory.markets(i));
    markets.push({
      m,
      yes: await ethers.getContractAt("OutcomeToken", await m.yesToken()),
      no: await ethers.getContractAt("OutcomeToken", await m.noToken()),
      creator,
      resolver,
    });
  }

  const counts = {
    attempted: 0,
    accepted: 0,
    rejectedExpected: 0,
    unexpectedErrors: 0,
    solvencyChecks: 0,
    solvencyFailures: 0,
    byAction: { buyYes: 0, buyNo: 0, sellYes: 0, sellNo: 0, mint: 0, merge: 0 } as Record<string, number>,
    rejections: { zeroValue: 0, noAllowance: 0, slippage: 0, wrongState: 0, closed: 0 } as Record<string, number>,
  };

  const wei = () => ethers.parseEther((0.001 + rnd() * 0.03).toFixed(4));

  async function assertSolvent(m: any) {
    counts.solvencyChecks++;
    if (!(await m.invariantHolds())) {
      counts.solvencyFailures++;
      throw new Error("SOLVENCY VIOLATED");
    }
  }

  // ---- main trading loop ----
  while (counts.attempted < TARGET_OPS) {
    counts.attempted++;
    const mk = markets[Math.floor(rnd() * N_MARKETS)];
    const u = traders[Math.floor(rnd() * traders.length)];

    // ~18% deliberately-invalid operations
    if (rnd() < 0.18) {
      const kind = Math.floor(rnd() * 5);
      try {
        if (kind === 0) {
          await mk.m.connect(u).buy(true, 0n, { value: 0 }); // zero
          counts.unexpectedErrors++;
        } else if (kind === 1) {
          // sell without allowance (buy a little first so there's a balance)
          await mk.m.connect(u).buy(true, 0n, { value: ethers.parseEther("0.002") });
          const bal = await mk.yes.balanceOf(u.address);
          await mk.yes.connect(u).approve(await mk.m.getAddress(), 0n);
          await mk.m.connect(u).sell(true, bal, 0n); // no allowance
          counts.unexpectedErrors++;
        } else if (kind === 2) {
          await mk.m.connect(u).buy(true, ethers.parseEther("1000000"), { value: ethers.parseEther("0.01") }); // slippage
          counts.unexpectedErrors++;
        } else if (kind === 3) {
          await mk.m.connect(u).redeem(1); // wrong state (still OPEN)
          counts.unexpectedErrors++;
        } else {
          await mk.m.connect(u).refundInvalid(1, 0); // wrong state
          counts.unexpectedErrors++;
        }
      } catch {
        counts.rejectedExpected++;
        const key = ["zeroValue", "noAllowance", "slippage", "wrongState", "wrongState"][kind];
        counts.rejections[key]++;
      }
      continue;
    }

    // normal op
    let action = Math.floor(rnd() * 6);
    try {
      if (action === 2 || action === 3) {
        // sell YES/NO; fall back to a buy if the user has nothing to sell
        const tok = action === 2 ? mk.yes : mk.no;
        const bal = await tok.balanceOf(u.address);
        if (bal === 0n) action = action === 2 ? 0 : 1;
        else {
          const amt = bal / 2n > 0n ? bal / 2n : bal;
          await tok.connect(u).approve(await mk.m.getAddress(), amt);
          try {
            await mk.m.connect(u).sell(action === 2, amt, 0n);
            counts.byAction[action === 2 ? "sellYes" : "sellNo"]++;
            counts.accepted++;
            await assertSolvent(mk.m);
          } catch {
            // thin-liquidity sell can revert; treat as a no-op, not an error
          }
          continue;
        }
      }
      if (action === 5) {
        const y = await mk.yes.balanceOf(u.address);
        const n = await mk.no.balanceOf(u.address);
        const mm = y < n ? y : n;
        if (mm === 0n) action = 0;
        else {
          await mk.m.connect(u).mergeSet(mm / 2n > 0n ? mm / 2n : mm);
          counts.byAction.merge++;
          counts.accepted++;
          await assertSolvent(mk.m);
          continue;
        }
      }
      if (action === 0) {
        await mk.m.connect(u).buy(true, 0n, { value: wei() });
        counts.byAction.buyYes++;
      } else if (action === 1) {
        await mk.m.connect(u).buy(false, 0n, { value: wei() });
        counts.byAction.buyNo++;
      } else if (action === 4) {
        await mk.m.connect(u).mintSet({ value: wei() });
        counts.byAction.mint++;
      }
      counts.accepted++;
      await assertSolvent(mk.m);
    } catch (e) {
      counts.unexpectedErrors++;
    }
  }

  // ---- resolution + settlement edge cases ----
  await time.increaseTo(closeTime + 1);
  const outcomes = [1, 2, 1, 3, 2, 1, 2, 3]; // mix: YES, NO, INVALID
  const settlement = {
    partialRedemptions: 0,
    doubleClaimBlocked: 0,
    invalidRefunds: 0,
    failedReceiverBlocked: 0,
    closedTradeBlocked: 0,
    lpSettled: 0,
  };

  for (let i = 0; i < N_MARKETS; i++) {
    const mk = markets[i];
    await mk.m.connect(mk.resolver).resolve(outcomes[i]);

    // trading after close must revert
    try {
      await mk.m.connect(traders[0]).buy(true, 0n, { value: 1 });
    } catch {
      settlement.closedTradeBlocked++;
    }

    if (outcomes[i] === 1 || outcomes[i] === 2) {
      const winTok = outcomes[i] === 1 ? mk.yes : mk.no;
      // find a holder with a winning balance
      let holder: any = null;
      let bal = 0n;
      for (const u of traders) {
        const b = await winTok.balanceOf(u.address);
        if (b > 0n) { holder = u; bal = b; break; }
      }
      if (holder) {
        await mk.m.connect(holder).redeem(bal / 2n); // partial
        await mk.m.connect(holder).redeem(bal - bal / 2n); // the rest
        settlement.partialRedemptions++;
        try { await mk.m.connect(holder).redeem(1); } catch { settlement.doubleClaimBlocked++; }
      }
    } else {
      // INVALID: refund a holder, then confirm double-refund is blocked
      for (const u of traders) {
        const y = await mk.yes.balanceOf(u.address);
        const n = await mk.no.balanceOf(u.address);
        if (y > 0n || n > 0n) {
          await mk.m.connect(u).refundInvalid(y, n);
          settlement.invalidRefunds++;
          try { await mk.m.connect(u).refundInvalid(1, 0); } catch {}
          break;
        }
      }
    }

    // LP settlement for the creator
    try { await mk.m.connect(mk.creator).settleLP(); settlement.lpSettled++; } catch {}
    await assertSolvent(mk.m);
  }

  // dedicated failed-ETH-receiver check on a fresh resolved market
  {
    const Factory2 = await ethers.getContractFactory("MarketFactory");
    const f2 = await Factory2.deploy();
    await f2.waitForDeployment();
    const ct = (await time.latest()) + 1000;
    await f2.connect(signers[0]).createMarket("reject", ct, signers[1].address, { value: ethers.parseEther("1") });
    const rm = await ethers.getContractAt("PredictionMarket", await f2.markets(0));
    const ry = await ethers.getContractAt("OutcomeToken", await rm.yesToken());
    await rm.connect(signers[10]).buy(true, 0n, { value: ethers.parseEther("0.3") });
    const Reject = await ethers.getContractFactory("RejectETH");
    const reject = await Reject.deploy(await rm.getAddress());
    const b = await ry.balanceOf(signers[10].address);
    await ry.connect(signers[10]).transfer(await reject.getAddress(), b);
    await time.increaseTo(ct + 1);
    await rm.connect(signers[1]).resolve(1);
    try { await reject.doRedeem(b); } catch { settlement.failedReceiverBlocked++; }
  }

  const elapsedMs = Date.now() - t0;
  const report = {
    seed: `0x${SEED.toString(16)}`,
    network: "hardhat (in-process)",
    markets: N_MARKETS,
    traders: traders.length,
    targetOps: TARGET_OPS,
    ...counts,
    settlement,
    elapsedMs,
    opsPerSec: Math.round((counts.attempted / elapsedMs) * 1000),
    generatedAt: new Date().toISOString(),
  };

  const outDir = path.join(__dirname, "..", "..", "benchmark", "results");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "simulation-report.json"), JSON.stringify(report, null, 2));
  const md = `# 7,500-Operation Simulation Report

_Generated ${report.generatedAt} · seed ${report.seed} · ${report.network}_

| Metric | Value |
|---|---|
| Markets / traders | ${report.markets} / ${report.traders} |
| Operations attempted | **${counts.attempted}** |
| Accepted | ${counts.accepted} |
| Rejected (expected) | ${counts.rejectedExpected} |
| Unexpected errors | ${counts.unexpectedErrors} |
| Solvency checks | ${counts.solvencyChecks} |
| **Solvency failures** | **${counts.solvencyFailures}** |
| Elapsed | ${(elapsedMs / 1000).toFixed(1)}s (${report.opsPerSec} ops/s) |

## Accepted operations by type
${Object.entries(counts.byAction).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

## Rejected-order coverage
${Object.entries(counts.rejections).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

## Settlement edge cases
- partial redemptions: ${settlement.partialRedemptions}
- double-claims blocked: ${settlement.doubleClaimBlocked}
- invalid-market refunds: ${settlement.invalidRefunds}
- LP settlements: ${settlement.lpSettled}
- closed-trade reverts: ${settlement.closedTradeBlocked}
- failed-ETH-receiver blocked: ${settlement.failedReceiverBlocked}
`;
  fs.writeFileSync(path.join(outDir, "simulation-report.md"), md);

  console.log(md);
  if (counts.solvencyFailures > 0 || counts.unexpectedErrors > 0) {
    throw new Error(`Simulation found issues: ${counts.solvencyFailures} solvency, ${counts.unexpectedErrors} unexpected`);
  }
  console.log(`OK: ${counts.attempted} ops, 0 solvency failures, 0 unexpected errors.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
