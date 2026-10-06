import { Pool, PoolClient } from "pg";
import { performance } from "perf_hooks";
import { factoryIface, marketIface, tokenIface, STATUS_NAME } from "./abi";
import { CONFIRMATIONS, REORG_DEPTH, ZERO } from "./config";

// Minimal provider surface we depend on (satisfied by ethers v6 providers).
export interface LogLike {
  address: string;
  topics: ReadonlyArray<string>;
  data: string;
  blockNumber: number;
  blockHash: string;
  transactionHash: string;
  index: number;
}
export interface ProviderLike {
  getBlockNumber(): Promise<number>;
  getLogs(filter: { fromBlock: number; toBlock: number }): Promise<LogLike[]>;
  getBlock(n: number): Promise<{ hash: string | null } | null>;
}

// High-resolution wall clock (epoch ms) so samples are comparable across processes.
export const nowMs = () => performance.timeOrigin + performance.now();

const jsonBig = (o: unknown) =>
  JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v));

type TokenRef = { market: string; side: "YES" | "NO" };

/**
 * Event indexer: polls logs, writes raw events idempotently, and materializes
 * markets/trades/redemptions/positions. Derived tables are a pure function of
 * chain_events, so a crash or reorg is recovered by replaying them.
 */
export class Indexer {
  private marketAddrs = new Set<string>();
  private tokenMap = new Map<string, TokenRef>();

  constructor(
    private pool: Pool,
    private provider: ProviderLike,
    private chainId: number,
    private factory: string,
    private startBlock: number
  ) {
    this.factory = factory.toLowerCase();
  }

  /** (Re)load the market/token address maps from the DB. */
  async init(): Promise<void> {
    this.marketAddrs.clear();
    this.tokenMap.clear();
    const r = await this.pool.query(
      "SELECT market_address, yes_token, no_token FROM markets WHERE chain_id=$1",
      [this.chainId]
    );
    for (const row of r.rows) this.register(row.market_address, row.yes_token, row.no_token);
  }

  private register(market: string, yes: string, no: string) {
    this.marketAddrs.add(market.toLowerCase());
    this.tokenMap.set(yes.toLowerCase(), { market: market.toLowerCase(), side: "YES" });
    this.tokenMap.set(no.toLowerCase(), { market: market.toLowerCase(), side: "NO" });
  }

  private async checkpoint(): Promise<{ block: number; hash: string } | null> {
    const r = await this.pool.query(
      "SELECT last_confirmed_block, last_confirmed_block_hash FROM indexer_checkpoints WHERE chain_id=$1",
      [this.chainId]
    );
    return r.rowCount
      ? { block: Number(r.rows[0].last_confirmed_block), hash: r.rows[0].last_confirmed_block_hash }
      : null;
  }

  private async setCheckpoint(block: number, hash: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO indexer_checkpoints(chain_id,last_confirmed_block,last_confirmed_block_hash,updated_at)
       VALUES($1,$2,$3,NOW())
       ON CONFLICT (chain_id) DO UPDATE SET last_confirmed_block=$2, last_confirmed_block_hash=$3, updated_at=NOW()`,
      [this.chainId, block, hash]
    );
  }

  /** Index everything up to (head - CONFIRMATIONS), handling reorgs first. */
  async sync(): Promise<void> {
    const head = await this.provider.getBlockNumber();
    const safeHead = head - CONFIRMATIONS;

    const cp = await this.checkpoint();
    let from = this.startBlock;
    if (cp) {
      // reorg check: did the block we last trusted change hash?
      const canonical = await this.provider.getBlock(cp.block);
      if (canonical && canonical.hash && canonical.hash !== cp.hash) {
        await this.handleReorg(cp.block);
        const cp2 = await this.checkpoint();
        from = (cp2 ? cp2.block : this.startBlock - 1) + 1;
      } else {
        from = cp.block + 1;
      }
    }
    if (safeHead < from) return;
    await this.syncRange(from, safeHead);
  }

  /** Index a closed block range [from,to]. Safe to call repeatedly (idempotent). */
  async syncRange(from: number, to: number): Promise<number> {
    const logs = await this.provider.getLogs({ fromBlock: from, toBlock: to });
    // Detection = the moment the indexer first receives the eligible log from the RPC.
    const detectAt = nowMs();
    logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);

    // Pass A: factory logs first so market/token addresses are known before
    // their own (same-block, earlier-logIndex) mint Transfers are processed.
    for (const log of logs) {
      if (log.address.toLowerCase() === this.factory) await this.processLog(log, detectAt);
    }
    // Pass B: everything else.
    for (const log of logs) {
      if (log.address.toLowerCase() !== this.factory) await this.processLog(log, detectAt);
    }

    const toHash = (await this.provider.getBlock(to))?.hash ?? "";
    await this.setCheckpoint(to, toHash);
    return logs.length;
  }

  /**
   * Long-running poll loop: sync, sleep `pollMs`, repeat until `shouldStop()`.
   * Crash-safe by construction: a restarted process resumes from the checkpoint.
   */
  async run(pollMs: number, shouldStop: () => boolean = () => false): Promise<void> {
    await this.init();
    while (!shouldStop()) {
      await this.sync();
      if (shouldStop()) break;
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  /** Last block durably processed, or null before the first range. */
  async lastIndexedBlock(): Promise<number | null> {
    return (await this.checkpoint())?.block ?? null;
  }

  private async processLog(log: LogLike, detectAt: number): Promise<void> {
    const addr = log.address.toLowerCase();
    const decoded = this.decode(log, addr);
    if (!decoded) return; // not one of ours

    const client = await this.pool.connect();
    let inserted = false;
    let persistAt = 0;
    try {
      await client.query("BEGIN");
      const ins = await client.query(
        `INSERT INTO chain_events
           (chain_id,transaction_hash,log_index,block_number,block_hash,address,market_address,event_name,payload,observed_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW())
         ON CONFLICT DO NOTHING`,
        [this.chainId, log.transactionHash, log.index, log.blockNumber, log.blockHash,
         addr, decoded.market, decoded.name, decoded.payload]
      );
      inserted = ins.rowCount === 1;
      if (inserted) await this.applyDerived(client, log, decoded);
      await client.query("COMMIT");
      // Persistence = this event's DB transaction commit has returned.
      persistAt = nowMs();
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    if (inserted) {
      await this.pool.query(
        `INSERT INTO latency_samples(chain_id,transaction_hash,log_index,detection_ms,persistence_ms,latency_ms)
         VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [this.chainId, log.transactionHash, log.index, detectAt, persistAt, persistAt - detectAt]
      );
    }
  }

  private decode(log: LogLike, addr: string):
    | { name: string; market: string | null; payload: string; args: any }
    | null {
    try {
      if (addr === this.factory) {
        const p = factoryIface.parseLog(log as any);
        if (!p) return null;
        return { name: p.name, market: p.args.market.toLowerCase(), payload: jsonBig(argsObj(p)), args: p.args };
      }
      if (this.marketAddrs.has(addr)) {
        const p = marketIface.parseLog(log as any);
        if (!p) return null;
        return { name: p.name, market: addr, payload: jsonBig(argsObj(p)), args: p.args };
      }
      if (this.tokenMap.has(addr)) {
        const p = tokenIface.parseLog(log as any);
        if (!p) return null;
        return { name: p.name, market: this.tokenMap.get(addr)!.market, payload: jsonBig(argsObj(p)), args: p.args };
      }
    } catch {
      return null;
    }
    return null;
  }

  private async applyDerived(
    client: PoolClient,
    log: LogLike,
    d: { name: string; market: string | null; args: any }
  ): Promise<void> {
    const a = d.args;
    switch (d.name) {
      case "MarketCreated": {
        const market = a.market.toLowerCase();
        this.register(a.market, a.yesToken, a.noToken);
        await client.query(
          `INSERT INTO markets(chain_id,market_address,creator_address,yes_token,no_token,question,close_time,resolver_address,status,created_block)
           VALUES($1,$2,$3,$4,$5,$6,to_timestamp($7),$8,'OPEN',$9)
           ON CONFLICT (chain_id,market_address) DO NOTHING`,
          [this.chainId, market, a.creator.toLowerCase(), a.yesToken.toLowerCase(),
           a.noToken.toLowerCase(), a.question, Number(a.closeTime), a.resolver.toLowerCase(), log.blockNumber]
        );
        break;
      }
      case "Resolved": {
        await client.query(
          "UPDATE markets SET status=$3 WHERE chain_id=$1 AND market_address=$2",
          [this.chainId, d.market, STATUS_NAME[Number(a.status)] ?? "OPEN"]
        );
        break;
      }
      case "Bought":
      case "Sold": {
        const isBuy = d.name === "Bought";
        await client.query(
          `INSERT INTO trades(chain_id,transaction_hash,log_index,market_address,trader,side,is_yes,eth_amount,shares,block_number)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
          [this.chainId, log.transactionHash, log.index, d.market, a.who.toLowerCase(),
           isBuy ? "BUY" : "SELL", a.isYes, (isBuy ? a.ethIn : a.ethOut).toString(),
           (isBuy ? a.sharesOut : a.sharesIn).toString(), log.blockNumber]
        );
        break;
      }
      case "Redeemed":
      case "Refunded": {
        const isRedeem = d.name === "Redeemed";
        const shares = isRedeem ? a.shares : a.yesShares + a.noShares;
        await client.query(
          `INSERT INTO redemptions(chain_id,transaction_hash,log_index,market_address,holder,kind,shares,eth_amount,block_number)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
          [this.chainId, log.transactionHash, log.index, d.market, a.who.toLowerCase(),
           isRedeem ? "REDEEM" : "REFUND", shares.toString(), a.ethOut.toString(), log.blockNumber]
        );
        break;
      }
      case "Transfer": {
        const ref = this.tokenMap.get(log.address.toLowerCase())!;
        const from = a.from.toLowerCase();
        const to = a.to.toLowerCase();
        const value: bigint = a.value;
        if (from !== ZERO) await this.bumpPosition(client, ref.market, ref.side, from, -value);
        if (to !== ZERO) await this.bumpPosition(client, ref.market, ref.side, to, value);
        break;
      }
    }
  }

  private async bumpPosition(
    client: PoolClient,
    market: string,
    side: string,
    holder: string,
    delta: bigint
  ): Promise<void> {
    await client.query(
      `INSERT INTO positions(chain_id,market_address,token,holder,balance)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (chain_id,market_address,token,holder)
       DO UPDATE SET balance = positions.balance + EXCLUDED.balance`,
      [this.chainId, market, side, holder, delta.toString()]
    );
  }

  private async handleReorg(checkpointBlock: number): Promise<void> {
    const rewind = Math.max(this.startBlock - 1, checkpointBlock - REORG_DEPTH);
    // drop orphaned raw events + markets, then rebuild derived from what remains
    await this.pool.query(
      "DELETE FROM chain_events WHERE chain_id=$1 AND block_number > $2",
      [this.chainId, rewind]
    );
    await this.pool.query(
      "DELETE FROM markets WHERE chain_id=$1 AND created_block > $2",
      [this.chainId, rewind]
    );
    await this.rebuildDerived();
    const hash = rewind >= this.startBlock ? (await this.provider.getBlock(rewind))?.hash ?? "" : "";
    await this.setCheckpoint(rewind, hash);
  }

  /** Recompute every derived table by replaying chain_events in order. */
  async rebuildDerived(): Promise<void> {
    await this.pool.query("TRUNCATE positions, trades, redemptions");
    await this.pool.query("UPDATE markets SET status='OPEN' WHERE chain_id=$1", [this.chainId]);
    // reload address maps so same-tx mint Transfers resolve before MarketCreated replays
    await this.init();
    const r = await this.pool.query(
      "SELECT * FROM chain_events WHERE chain_id=$1 ORDER BY block_number, log_index",
      [this.chainId]
    );
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const row of r.rows) {
        const args = reviveArgs(row.event_name, row.payload);
        await this.applyDerived(client, { ...fakeLog(row), address: row.address } as LogLike, {
          name: row.event_name,
          market: row.market_address,
          args,
        });
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
}

function argsObj(parsed: any): Record<string, any> {
  // ethers v6 Result: named fields are exposed via toObject(), not Object.keys().
  try {
    return parsed.args.toObject();
  } catch {
    return { ...parsed.args };
  }
}

function fakeLog(row: any) {
  return {
    transactionHash: row.transaction_hash,
    index: row.log_index,
    blockNumber: Number(row.block_number),
    blockHash: row.block_hash,
    topics: [],
    data: "0x",
  };
}

// Rebuild a typed args object from stored JSONB (strings -> bigint where needed).
function reviveArgs(name: string, payload: any): any {
  const p = payload;
  const big = (v: any) => BigInt(v);
  switch (name) {
    case "MarketCreated":
      return { market: p.market, creator: p.creator, yesToken: p.yesToken, noToken: p.noToken,
               question: p.question, closeTime: big(p.closeTime), resolver: p.resolver };
    case "Resolved":
      return { status: Number(p.status) };
    case "Bought":
      return { who: p.who, isYes: p.isYes, ethIn: big(p.ethIn), sharesOut: big(p.sharesOut) };
    case "Sold":
      return { who: p.who, isYes: p.isYes, sharesIn: big(p.sharesIn), ethOut: big(p.ethOut) };
    case "Redeemed":
      return { who: p.who, shares: big(p.shares), ethOut: big(p.ethOut) };
    case "Refunded":
      return { who: p.who, yesShares: big(p.yesShares), noShares: big(p.noShares), ethOut: big(p.ethOut) };
    case "Transfer":
      return { from: p.from, to: p.to, value: big(p.value) };
    default:
      return p;
  }
}
