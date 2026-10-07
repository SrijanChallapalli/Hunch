/**
 * M8 — Event detection -> persistence latency benchmark.
 *
 * Definitions (docs/spec.md §7 "Latency measurement"):
 *   detection   = when the indexer first receives the eligible log (getLogs returns)
 *   persistence = when that event's PostgreSQL transaction COMMIT returns
 *   latency_ms  = persistence - detection, one sample per eligible log
 *
 * A second, independent metric is reported and never mixed with the first:
 *   receipt -> persisted = client sees the tx receipt -> last of its logs committed.
 * It includes poll-interval wait, so it is dominated by POLL_MS.
 *
 * Workload: 8 markets, N traders submitting buys/sells concurrently at a fixed rate
 * while the indexer polls. Both run in this process, so load generation competes
 * with the indexer for the event loop (a conservative setup).
 *
 *   npx hardhat run benchmark/measure-indexer.ts                       # in-process chain
 *   npx hardhat run benchmark/measure-indexer.ts --network localhost   # JSON-RPC node
 *
 * Env: BENCH_TRADES (1500) BENCH_RATE tx/s (25) BENCH_TRADERS (10) POLL_MS (250)
 * Output: benchmark/results/indexer-latency-<network>.{json,md} + raw samples CSV.
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { makePool, migrate, truncateAll } from "../indexer/src/db";
import { Indexer, nowMs } from "../indexer/src/indexer";

const TRADES = Number(process.env.BENCH_TRADES ?? 1500);
const RATE = Number(process.env.BENCH_RATE ?? 25);
const N_TRADERS = Number(process.env.BENCH_TRADERS ?? 10);
const POLL_MS = Number(process.env.POLL_MS ?? 250);
const BLOCK_MS = Number(process.env.BENCH_BLOCK_MS ?? 0); // 0 = automine (one tx per block)
const N_MARKETS = 8;
const SEED = 0x5eed;
const TARGET_P95_MS = 1800;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Nearest-rank percentile over an ascending-sorted array. */
function pct(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    count: s.length,
    min: r(s[0]),
    p50: r(pct(s, 50)),
    p90: r(pct(s, 90)),
    p95: r(pct(s, 95)),
    p99: r(pct(s, 99)),
    max: r(s[s.length - 1]),
    mean: r(mean),
  };
}

async function main() {
  const rnd = lcg(SEED);
  const signers = await ethers.getSigners();
  if (signers.length < 10 + N_TRADERS) throw new Error("not enough funded accounts");
  const traders = signers.slice(10, 10 + N_TRADERS);
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  // ---- setup: factory + 8 markets + approvals (not measured) ----
  const factory = await (await ethers.getContractFactory("MarketFactory")).deploy();
  await factory.waitForDeployment();
  const startBlock = await ethers.provider.getBlockNumber();
  const latest = await ethers.provider.getBlock("latest");
  const closeTime = latest!.timestamp + 30 * 24 * 3600;

  const markets: { m: any; yes: any; no: any }[] = [];
  for (let i = 0; i < N_MARKETS; i++) {
    await (
      await factory.connect(signers[i]).createMarket(`Benchmark market ${i}`, closeTime, signers[(i + 1) % N_MARKETS].address, {
        value: ethers.parseEther("2"),
      })
    ).wait();
    const m = await ethers.getContractAt("PredictionMarket", await factory.markets(i));
    markets.push({
      m,
      yes: await ethers.getContractAt("OutcomeToken", await m.yesToken()),
      no: await ethers.getContractAt("OutcomeToken", await m.noToken()),
    });
  }
  for (const t of traders) {
    for (const k of markets) {
      const mAddr = await k.m.getAddress();
      await (await k.yes.connect(t).approve(mAddr, ethers.MaxUint256)).wait();
      await (await k.no.connect(t).approve(mAddr, ethers.MaxUint256)).wait();
    }
  }

  const pool = makePool();
  await migrate(pool);
  await truncateAll(pool);
  const pgVersion = (await pool.query("SHOW server_version")).rows[0].server_version;

  const ix = new Indexer(pool, ethers.provider as any, chainId, await factory.getAddress(), startBlock + 1);
  let stop = false;
  const running = ix.run(POLL_MS, () => stop);

  // let the indexer catch up on setup before load starts (setup samples are excluded)
  const setupHead = await ethers.provider.getBlockNumber();
  while (((await ix.lastIndexedBlock()) ?? -1) < setupHead) await new Promise((r) => setTimeout(r, 50));

  // optional interval mining: several txs per block, like a real testnet
  if (BLOCK_MS > 0) {
    await ethers.provider.send("evm_setAutomine", [false]);
    await ethers.provider.send("evm_setIntervalMining", [BLOCK_MS]);
  }

  // ---- measured load: per-trader serial chains, dispatched at a fixed global rate ----
  console.log(`load: ${TRADES} trades @ ${RATE}/s, ${N_TRADERS} traders, poll ${POLL_MS}ms on ${network.name}`);
  const receipts = new Map<string, number>(); // txHash -> client receipt time
  const chains: Promise<void>[] = traders.map(() => Promise.resolve());
  let accepted = 0;
  let rejected = 0;
  const loadStart = nowMs();

  for (let i = 0; i < TRADES; i++) {
    const ti = i % N_TRADERS;
    const t = traders[ti];
    const k = markets[Math.floor(rnd() * N_MARKETS)];
    const isYes = rnd() < 0.5;
    const doSell = rnd() < 0.3;
    const amt = 0.002 + rnd() * 0.04;
    const frac = 0.2 + rnd() * 0.6;
    chains[ti] = chains[ti].then(async () => {
      try {
        let tx;
        if (doSell) {
          const bal: bigint = await (isYes ? k.yes : k.no).balanceOf(t.address);
          const sharesIn = (bal * BigInt(Math.floor(frac * 1000))) / 1000n;
          tx = sharesIn > 0n
            ? await k.m.connect(t).sell(isYes, sharesIn, 0n)
            : await k.m.connect(t).buy(isYes, 0n, { value: ethers.parseEther(amt.toFixed(6)) });
        } else {
          tx = await k.m.connect(t).buy(isYes, 0n, { value: ethers.parseEther(amt.toFixed(6)) });
        }
        const rc = await tx.wait();
        receipts.set(rc!.hash, nowMs());
        accepted++;
      } catch {
        rejected++;
      }
    });
    await new Promise((r) => setTimeout(r, 1000 / RATE));
  }
  await Promise.all(chains);
  const loadEnd = nowMs();

  // ---- drain: wait until the indexer has committed the final block ----
  const finalHead = await ethers.provider.getBlockNumber();
  if (BLOCK_MS > 0) {
    await ethers.provider.send("evm_setIntervalMining", [0]);
    await ethers.provider.send("evm_setAutomine", [true]);
  }
  while (((await ix.lastIndexedBlock()) ?? -1) < finalHead) await new Promise((r) => setTimeout(r, 50));
  stop = true;
  await running;

  // ---- collect ----
  const rows = (
    await pool.query(
      `SELECT l.transaction_hash, l.log_index, l.detection_ms, l.persistence_ms, l.latency_ms,
              e.event_name, e.block_number
         FROM latency_samples l
         JOIN chain_events e USING (chain_id, transaction_hash, log_index)
        WHERE l.chain_id=$1 AND e.block_number > $2
        ORDER BY e.block_number, l.log_index`,
      [chainId, setupHead]
    )
  ).rows.map((r) => ({
    tx: r.transaction_hash as string,
    logIndex: Number(r.log_index),
    block: Number(r.block_number),
    event: r.event_name as string,
    detection: Number(r.detection_ms),
    persistence: Number(r.persistence_ms),
    latency: Number(r.latency_ms),
  }));

  const detPersist = stats(rows.map((r) => r.latency));
  const byEvent: Record<string, ReturnType<typeof stats>> = {};
  for (const name of [...new Set(rows.map((r) => r.event))].sort()) {
    byEvent[name] = stats(rows.filter((r) => r.event === name).map((r) => r.latency));
  }
  const lastPersistByTx = new Map<string, number>();
  for (const r of rows) lastPersistByTx.set(r.tx, Math.max(lastPersistByTx.get(r.tx) ?? 0, r.persistence));
  const e2e: number[] = [];
  for (const [tx, rcAt] of receipts) {
    const p = lastPersistByTx.get(tx);
    if (p !== undefined) e2e.push(Math.max(0, p - rcAt)); // receipt can land after an eager poll
  }
  const polls = new Map<number, number>();
  for (const r of rows) polls.set(r.detection, (polls.get(r.detection) ?? 0) + 1);
  const batch = stats([...polls.values()]);

  const cpus = os.cpus();
  const report = {
    generatedAt: new Date().toISOString(),
    definition: {
      detection: "indexer receives the eligible log (provider.getLogs returns)",
      persistence: "PostgreSQL COMMIT for that event's transaction returns",
      latency_ms: "persistence - detection, one sample per eligible log",
      receiptToPersisted_ms: "client receives tx receipt -> last log of that tx committed",
      percentile: "nearest-rank",
    },
    config: { trades: TRADES, rateTxPerSec: RATE, blockMs: BLOCK_MS, traders: N_TRADERS, markets: N_MARKETS, pollMs: POLL_MS, confirmations: Number(process.env.INDEXER_CONFIRMATIONS ?? 0), seed: SEED },
    environment: {
      network: network.name,
      chainId,
      rpc: network.name === "hardhat" ? "in-process Hardhat EVM (automine)" : (network.config as any).url,
      postgres: pgVersion,
      node: process.version,
      os: `${os.type()} ${os.release()} ${os.arch()}`,
      cpu: `${cpus[0]?.model?.trim()} x${cpus.length}`,
      memGB: Math.round(os.totalmem() / 2 ** 30),
    },
    window: {
      loadSeconds: Math.round((loadEnd - loadStart) / 10) / 100,
      blocks: finalHead - setupHead,
      txAccepted: accepted,
      txRejected: rejected,
      eligibleLogs: rows.length,
      polls: polls.size,
    },
    detectionToPersistence_ms: detPersist,
    detectionToPersistenceByEvent_ms: byEvent,
    receiptToPersisted_ms: stats(e2e),
    logsPerPoll: batch,
    target: { p95_ms: TARGET_P95_MS, met: detPersist.p95 <= TARGET_P95_MS },
  };

  const outDir = path.join(__dirname, "results");
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, runName());
  fs.writeFileSync(`${base}.json`, JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(
    `${base}-samples.csv`,
    "block,tx,log_index,event,detection_ms,persistence_ms,latency_ms\n" +
      rows.map((r) => `${r.block},${r.tx},${r.logIndex},${r.event},${r.detection.toFixed(3)},${r.persistence.toFixed(3)},${r.latency.toFixed(3)}`).join("\n") +
      "\n"
  );
  fs.writeFileSync(`${base}.md`, renderMd(report));

  console.log(`detection->persistence p50=${detPersist.p50}ms p95=${detPersist.p95}ms (n=${detPersist.count})`);
  console.log(`receipt->persisted    p50=${report.receiptToPersisted_ms.p50}ms p95=${report.receiptToPersisted_ms.p95}ms`);
  console.log(`target p95 <= ${TARGET_P95_MS}ms: ${report.target.met ? "MET" : "NOT MET"}`);
  console.log(`wrote ${base}.{json,md} + samples csv`);
  await pool.end();
}

function runName(): string {
  return `indexer-latency-${network.name}${BLOCK_MS > 0 ? `-${BLOCK_MS}ms-blocks` : ""}`;
}

function renderMd(r: any): string {
  const row = (label: string, s: any) =>
    `| ${label} | ${s.count} | ${s.p50} | ${s.p90} | ${s.p95} | ${s.p99} | ${s.max} | ${s.mean} |`;
  const head = "| Metric | n | p50 | p90 | p95 | p99 | max | mean |\n|---|---|---|---|---|---|---|---|";
  return `# Indexer Latency Benchmark (${r.environment.network})

_Generated ${r.generatedAt} · seed 0x${r.config.seed.toString(16)}_

**Result: detection → persistence p95 = ${r.detectionToPersistence_ms.p95} ms** over
${r.detectionToPersistence_ms.count} eligible logs. Target p95 ≤ ${r.target.p95_ms} ms:
**${r.target.met ? "met" : "not met"}**.

## Definition

- **detection**: ${r.definition.detection}
- **persistence**: ${r.definition.persistence}
- **latency**: ${r.definition.latency_ms}; percentiles are ${r.definition.percentile}
- **receipt → persisted** is a separate metric (${r.definition.receiptToPersisted_ms}). It includes
  the poll-interval wait, so it is bounded mostly by \`POLL_MS\`. Don't compare it with the
  first metric.

## Results (ms)

${head}
${row("detection → persistence", r.detectionToPersistence_ms)}
${row("receipt → persisted", r.receiptToPersisted_ms)}

### detection → persistence by event

${head}
${Object.entries(r.detectionToPersistenceByEvent_ms).map(([k, v]) => row(k, v)).join("\n")}

Logs per poll: p50 ${r.logsPerPoll.p50}, p95 ${r.logsPerPoll.p95}, max ${r.logsPerPoll.max}.
A log that arrives late in a large batch waits for the logs ahead of it, and that wait
counts toward its latency.

## Workload

| | |
|---|---|
| Trades submitted | ${r.config.trades} @ ${r.config.rateTxPerSec} tx/s (${r.config.traders} traders, ${r.config.markets} markets) |
| Accepted / rejected | ${r.window.txAccepted} / ${r.window.txRejected} |
| Load window | ${r.window.loadSeconds} s, ${r.window.blocks} blocks, ${r.window.polls} polls |
| Mining | ${r.config.blockMs ? `interval, one block every ${r.config.blockMs} ms` : "automine (one tx per block)"} |
| Indexer | poll ${r.config.pollMs} ms, confirmations ${r.config.confirmations} |

## Environment

| | |
|---|---|
| Chain | ${r.environment.network} (chainId ${r.environment.chainId}), ${r.environment.rpc} |
| PostgreSQL | ${r.environment.postgres} (Docker, localhost) |
| Node | ${r.environment.node} |
| Host | ${r.environment.os}, ${r.environment.cpu}, ${r.environment.memGB} GB |

The raw per-log samples are in \`${runName()}-samples.csv\`.
This run is on a local chain, not Sepolia. A public RPC adds network time to *receipt → persisted*,
but it does not change the detection → persistence window, which starts after \`getLogs\` returns.
`;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
