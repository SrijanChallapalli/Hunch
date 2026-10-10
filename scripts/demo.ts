/**
 * M9 — End-to-end demo (docs/demo-checklist.md), fully scripted.
 *
 *   npx hardhat node                                         # terminal 1
 *   npx hardhat run scripts/demo.ts --network localhost      # terminal 2
 *
 * 1. Deploy the factory and seed 8 markets (different creators, overlapping windows).
 * 2. Start the indexer as a separate OS process (npm run indexer).
 * 3. Trade buys and sells on both outcomes in all 8 markets.
 * 4. Hard-kill the indexer mid-stream, keep trading (plus a wallet-to-wallet transfer),
 *    then restart it and prove that indexed holdings equal on-chain ERC20 balances.
 * 5. Re-deliver the whole block range (duplicate delivery) and show nothing changes.
 * 6. Close, resolve to a YES / NO / INVALID mix, redeem a winner, attempt a double
 *    redemption (reverts), take an INVALID refund at UNIT/2 per token, settle the LP.
 * 7. Check the collateral invariant on all 8 markets after every phase.
 *
 * Writes the transcript to docs/demo-run.md.
 */
import { ethers, network } from "hardhat";
import { spawn, spawnSync, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";
import { makePool, migrate, truncateAll } from "../indexer/src/db";
import { Indexer } from "../indexer/src/indexer";
import { deployFactory } from "./deploy";
import { seedEightMarkets } from "./seed-eight-markets";

const UNIT_WEI = 10n ** 16n;
const ONE = 10n ** 18n;
const ROOT = path.join(__dirname, "..");
const log: string[] = [];

function say(line = "") {
  console.log(line);
  log.push(line);
}
const eth = (wei: bigint) => ethers.formatEther(wei);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function startIndexer(): ChildProcess {
  const child = spawn("npx", ["hardhat", "run", "indexer/src/run.ts", "--network", network.name], {
    cwd: ROOT,
    env: { ...process.env, POLL_MS: "200" },
    shell: process.platform === "win32",
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (d) => process.stdout.write(`    [indexer] ${d}`));
  child.stderr!.on("data", (d) => process.stdout.write(`    [indexer:err] ${d}`));
  return child;
}

/** SIGKILL-equivalent: no graceful shutdown, no final checkpoint write. */
function hardKill(child: ChildProcess) {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  else process.kill(-child.pid!, "SIGKILL");
}

async function checkpoint(pool: Pool, chainId: number): Promise<number> {
  const r = await pool.query("SELECT last_confirmed_block FROM indexer_checkpoints WHERE chain_id=$1", [chainId]);
  return r.rowCount ? Number(r.rows[0].last_confirmed_block) : -1;
}

async function waitIndexed(pool: Pool, chainId: number, timeoutMs = 120000) {
  const head = await ethers.provider.getBlockNumber();
  const t0 = Date.now();
  while ((await checkpoint(pool, chainId)) < head) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`indexer did not reach block ${head}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return head;
}

async function main() {
  if (network.name === "hardhat") {
    throw new Error("run against a node so the indexer can be a separate process: --network localhost");
  }
  const signers = await ethers.getSigners();
  const traders = signers.slice(10, 16);
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  const pool = makePool();
  await migrate(pool);
  await truncateAll(pool);

  say(`# Demo run (M9)`);
  say();
  say(`_Generated ${new Date().toISOString()} on \`${network.name}\` (chainId ${chainId}), PostgreSQL indexer as a separate process._`);
  say();

  // ---- 1. deploy + seed ----
  say(`## 1. Deploy and seed eight markets`);
  say();
  const { address: factoryAddr } = await deployFactory();
  say(`- MarketFactory \`${factoryAddr}\``);
  const seeded = await seedEightMarkets(factoryAddr, 3600);
  const mk = [];
  for (const s of seeded) {
    const m = await ethers.getContractAt("PredictionMarket", s.address);
    const yes = await ethers.getContractAt("OutcomeToken", await m.yesToken());
    const no = await ethers.getContractAt("OutcomeToken", await m.noToken());
    mk.push({ ...s, m, yes, no });
    say(`- #${s.id} \`${s.address}\` creator \`${short(s.creator.address)}\` closes ${new Date(s.closeTime * 1000).toISOString()}: ${s.question}`);
  }
  say();

  const invariants = async (phase: string) => {
    const ok = await Promise.all(mk.map((k) => k.m.invariantHolds()));
    const bad = ok.filter((x) => !x).length;
    say(`- invariant \`balance >= requiredCollateral\` after ${phase}: **${8 - bad}/8 hold**`);
    if (bad) throw new Error("collateral invariant violated");
  };
  await invariants("seeding");
  say();

  // ---- 2. start indexer ----
  say(`## 2. Start the indexer process`);
  say();
  let ix = startIndexer();
  await waitIndexed(pool, chainId);
  say(`- indexer pid ${ix.pid} caught up to block ${await checkpoint(pool, chainId)}`);
  say();

  // ---- 3. trading across all eight ----
  let trades = 0;
  const tradeRound = async (round: number) => {
    for (const [i, k] of mk.entries()) {
      const a = traders[(i + round) % traders.length];
      const b = traders[(i + round + 1) % traders.length];
      await (await k.m.connect(a).buy(true, 0n, { value: ethers.parseEther((0.02 + 0.012 * i).toFixed(3)) })).wait();
      await (await k.m.connect(b).buy(false, 0n, { value: ethers.parseEther((0.09 - 0.01 * i).toFixed(3)) })).wait();
      const bal = await k.yes.balanceOf(a.address);
      await (await k.yes.connect(a).approve(k.address, bal)).wait();
      await (await k.m.connect(a).sell(true, bal / 3n, 0n)).wait();
      trades += 3;
    }
  };
  say(`## 3. Trade on all eight markets`);
  say();
  await tradeRound(0);
  await tradeRound(1);
  say(`- ${trades} trades (YES buys, NO buys, YES sells) across 8 markets`);
  for (const k of mk) say(`  - #${k.id} P(YES) = ${(Number(await k.m.priceYes()) / 1e16).toFixed(2)}%`);
  await invariants("trading");
  say();

  // ---- 4. crash the indexer mid-stream ----
  say(`## 4. Kill the indexer, keep trading, restart`);
  say();
  const before = await checkpoint(pool, chainId);
  hardKill(ix);
  say(`- hard-killed indexer pid ${ix.pid} (no graceful shutdown) at checkpoint block ${before}`);
  await tradeRound(2);
  const xferFrom = traders[0];
  const xferAmt = (await mk[0].yes.balanceOf(xferFrom.address)) / 2n;
  await (await mk[0].yes.connect(xferFrom).transfer(traders[5].address, xferAmt)).wait();
  const headWhileDown = await ethers.provider.getBlockNumber();
  say(`- while it was down: 24 more trades + a wallet-to-wallet YES transfer; chain head now block ${headWhileDown}`);
  ix = startIndexer();
  await waitIndexed(pool, chainId);
  say(`- restarted as pid ${ix.pid}; resumed from block ${before + 1} and caught up to ${await checkpoint(pool, chainId)}`);

  const verifyPositions = async (label: string) => {
    const holders = [...traders.map((t) => t.address), ...mk.map((k) => k.address)];
    let checked = 0;
    let mismatched = 0;
    for (const k of mk) {
      for (const [side, tok] of [["YES", k.yes], ["NO", k.no]] as const) {
        for (const h of holders) {
          const onChain: bigint = await tok.balanceOf(h);
          const r = await pool.query(
            "SELECT balance FROM positions WHERE chain_id=$1 AND market_address=$2 AND token=$3 AND holder=$4",
            [chainId, k.address.toLowerCase(), side, h.toLowerCase()]
          );
          const indexed = r.rowCount ? BigInt(r.rows[0].balance) : 0n;
          checked++;
          if (indexed !== onChain) mismatched++;
        }
      }
    }
    const tradeRows = Number((await pool.query("SELECT count(*) FROM trades WHERE chain_id=$1", [chainId])).rows[0].count);
    say(`- ${label}: ${checked} (market, token, holder) balances compared, **${mismatched} mismatches**; trades indexed ${tradeRows}`);
    if (mismatched) throw new Error("indexed positions diverge from chain");
    return tradeRows;
  };
  const rowsAfterRestart = await verifyPositions("after restart");
  say(`- trades sent ${trades}, trades indexed **${rowsAfterRestart}** (no gaps, no duplicates)`);
  if (rowsAfterRestart !== trades) throw new Error("trade count mismatch");
  await invariants("restart");
  say();

  // ---- 5. duplicate delivery ----
  say(`## 5. Re-deliver every block (duplicate delivery)`);
  say();
  const counts = async () =>
    (await pool.query(
      "SELECT (SELECT count(*) FROM chain_events) e, (SELECT count(*) FROM trades) t, (SELECT coalesce(sum(balance),0) FROM positions) p"
    )).rows[0];
  const c0 = await counts();
  const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments", `${network.name}.json`), "utf8"));
  const replay = new Indexer(pool, ethers.provider as any, chainId, factoryAddr, dep.startBlock);
  await replay.init();
  await replay.syncRange(dep.startBlock, await checkpoint(pool, chainId));
  const c1 = await counts();
  say(`- before: ${c0.e} raw events, ${c0.t} trades · after replaying blocks ${dep.startBlock}..head: ${c1.e} raw events, ${c1.t} trades`);
  say(`- duplicate delivery changed **${c0.e === c1.e && c0.t === c1.t && c0.p === c1.p ? "nothing" : "STATE (bug)"}**`);
  if (c0.e !== c1.e || c0.t !== c1.t || c0.p !== c1.p) throw new Error("replay was not idempotent");
  say();

  // ---- 6. settlement ----
  say(`## 6. Close, resolve, redeem, refund`);
  say();
  const lastClose = Math.max(...mk.map((k) => k.closeTime));
  await ethers.provider.send("evm_setNextBlockTimestamp", [lastClose + 1]);
  await ethers.provider.send("evm_mine", []);
  try {
    await mk[0].m.connect(traders[0]).buy(true, 0n, { value: ethers.parseEther("0.01") });
    say(`- trade after close: accepted (BUG)`);
  } catch {
    say(`- trade after close on #${mk[0].id}: **reverted** ("closed")`);
  }
  const outcomes = [1, 2, 3, 1, 2, 1, 2, 1]; // YES, NO, INVALID, ...
  const label = ["", "YES", "NO", "INVALID"];
  for (const [i, k] of mk.entries()) await (await k.m.connect(k.resolver).resolve(outcomes[i])).wait();
  say(`- resolved: ${mk.map((k, i) => `#${k.id} ${label[outcomes[i]]}`).join(", ")}`);

  // winner redemption on market 0 (YES)
  let w = traders[0];
  for (const t of traders) if ((await mk[0].yes.balanceOf(t.address)) > 0n) { w = t; break; }
  const shares: bigint = await mk[0].yes.balanceOf(w.address);
  const b0 = await ethers.provider.getBalance(w.address);
  const rc = await (await mk[0].m.connect(w).redeem(shares)).wait();
  const gas = rc!.gasUsed * rc!.gasPrice;
  const paid = (await ethers.provider.getBalance(w.address)) - b0 + gas;
  const expect = (shares * UNIT_WEI) / ONE;
  say(`- \`${short(w.address)}\` redeemed ${ethers.formatUnits(shares, 18)} YES on #${mk[0].id} for ${eth(paid)} ETH (expected ${eth(expect)}): **${paid === expect ? "exact" : "MISMATCH"}**`);
  try {
    await (await mk[0].m.connect(w).redeem(shares)).wait();
    say(`- double redemption: accepted (BUG)`);
  } catch {
    say(`- second redemption of the same ${ethers.formatUnits(shares, 18)} shares: **reverted** (tokens already burned)`);
  }

  // invalid refund on market 2
  let r = traders[0];
  let y = 0n, n = 0n;
  for (const t of traders) {
    y = await mk[2].yes.balanceOf(t.address);
    n = await mk[2].no.balanceOf(t.address);
    if (y + n > 0n) { r = t; break; }
  }
  const rb0 = await ethers.provider.getBalance(r.address);
  const rrc = await (await mk[2].m.connect(r).refundInvalid(y, n)).wait();
  const refunded = (await ethers.provider.getBalance(r.address)) - rb0 + rrc!.gasUsed * rrc!.gasPrice;
  const refundExpect = ((y + n) * UNIT_WEI) / ONE / 2n;
  say(`- INVALID #${mk[2].id}: \`${short(r.address)}\` refunded ${ethers.formatUnits(y, 18)} YES + ${ethers.formatUnits(n, 18)} NO for ${eth(refunded)} ETH (UNIT/2 per token = ${eth(refundExpect)}): **${refunded === refundExpect ? "exact" : "MISMATCH"}**`);
  try {
    await (await mk[2].m.connect(r).refundInvalid(y, n)).wait();
    say(`- double refund: accepted (BUG)`);
  } catch {
    say(`- second refund: **reverted**`);
  }

  await (await mk[0].m.connect(mk[0].creator).settleLP()).wait();
  say(`- creator settled the LP position on #${mk[0].id}`);
  await invariants("settlement");
  say();

  // ---- 7. indexer view of settlement ----
  say(`## 7. Indexed view after settlement`);
  say();
  await waitIndexed(pool, chainId);
  const st = await pool.query("SELECT market_address, status FROM markets WHERE chain_id=$1 ORDER BY created_block", [chainId]);
  say(`- market statuses in PostgreSQL: ${st.rows.map((x, i) => `#${mk[i].id} ${x.status}`).join(", ")}`);
  const red = await pool.query("SELECT kind, holder, shares, eth_amount FROM redemptions WHERE chain_id=$1 ORDER BY block_number", [chainId]);
  for (const x of red.rows) say(`- ${x.kind} by \`${short(x.holder)}\`: ${ethers.formatUnits(x.shares, 18)} shares → ${eth(BigInt(x.eth_amount))} ETH`);
  await verifyPositions("final");
  say();

  hardKill(ix);
  await pool.end();
  say(`All steps passed.`);

  const out = path.join(ROOT, "docs", "demo-run.md");
  fs.writeFileSync(out, log.join("\n") + "\n");
  console.log(`\nwrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
