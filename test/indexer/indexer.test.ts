import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { Pool } from "pg";
import { makePool, migrate, truncateAll } from "../../indexer/src/db";
import { Indexer } from "../../indexer/src/indexer";

const CHAIN_ID = 31337;

async function deployAndSeed() {
  const [, alice, bob, resolver] = await ethers.getSigners();
  const Factory = await ethers.getContractFactory("MarketFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  const startBlock = await ethers.provider.getBlockNumber();
  const closeTime = (await time.latest()) + 100000;
  await factory.createMarket("Q", closeTime, resolver.address, { value: ethers.parseEther("1") });
  const market = await ethers.getContractAt("PredictionMarket", await factory.markets(0));
  const yes = await ethers.getContractAt("OutcomeToken", await market.yesToken());
  await market.connect(alice).buy(true, 0n, { value: ethers.parseEther("0.2") });
  await market.connect(bob).buy(false, 0n, { value: ethers.parseEther("0.1") });
  return { factory: await factory.getAddress(), market, yes, alice, bob, resolver, startBlock };
}

function mkIndexer(pool: Pool, factory: string, startBlock: number) {
  return new Indexer(pool, ethers.provider as any, CHAIN_ID, factory, startBlock);
}

async function snapshot(pool: Pool) {
  const q = async (sql: string) => (await pool.query(sql)).rows;
  return {
    markets: await q("SELECT market_address,status FROM markets ORDER BY market_address"),
    trades: await q("SELECT transaction_hash,log_index,side,is_yes,shares FROM trades ORDER BY block_number,log_index"),
    positions: await q("SELECT market_address,token,holder,balance FROM positions WHERE balance<>0 ORDER BY token,holder"),
    redemptions: await q("SELECT transaction_hash,log_index,kind,shares FROM redemptions ORDER BY block_number,log_index"),
    events: (await q("SELECT count(*)::int AS c FROM chain_events"))[0].c,
  };
}

describe("PostgreSQL indexer (M6)", function () {
  this.timeout(120000);
  let pool: Pool;

  before(async () => {
    pool = makePool();
    await migrate(pool);
  });
  beforeEach(async () => {
    await truncateAll(pool);
  });
  after(async () => {
    await pool.end();
  });

  it("materializes markets, trades, and positions from events", async () => {
    const s = await deployAndSeed();
    const ix = mkIndexer(pool, s.factory, s.startBlock);
    await ix.init();
    await ix.sync();

    expect((await pool.query("SELECT * FROM markets")).rowCount).to.equal(1);
    expect((await pool.query("SELECT * FROM trades")).rowCount).to.equal(2);

    const aYes = await pool.query(
      "SELECT balance FROM positions WHERE token='YES' AND holder=$1",
      [s.alice.address.toLowerCase()]
    );
    // indexed position matches the on-chain ERC20 balance exactly
    expect(BigInt(aYes.rows[0].balance)).to.equal(await s.yes.balanceOf(s.alice.address));
  });

  it("is idempotent under duplicate / replayed delivery", async () => {
    const s = await deployAndSeed();
    const ix = mkIndexer(pool, s.factory, s.startBlock);
    await ix.init();
    const head = await ethers.provider.getBlockNumber();

    await ix.syncRange(s.startBlock, head);
    const once = await snapshot(pool);
    await ix.syncRange(s.startBlock, head); // same range again
    await ix.syncRange(s.startBlock, head); // and again
    const thrice = await snapshot(pool);

    expect(thrice).to.deep.equal(once);
  });

  it("recovers to the same derived state after a crash/restart", async () => {
    const s = await deployAndSeed();
    const head = await ethers.provider.getBlockNumber();
    const mid = Math.floor((s.startBlock + head) / 2);

    const ix = mkIndexer(pool, s.factory, s.startBlock);
    await ix.init();
    await ix.syncRange(s.startBlock, mid); // crash after the first half

    const ix2 = mkIndexer(pool, s.factory, s.startBlock); // fresh process resumes
    await ix2.init();
    await ix2.sync(); // from checkpoint -> head
    const chunked = await snapshot(pool);

    await ix2.rebuildDerived(); // a clean, uninterrupted replay
    const replayed = await snapshot(pool);

    expect(replayed).to.deep.equal(chunked);
  });

  it("tracks wallet-to-wallet transfers (portfolio from Transfer events)", async () => {
    const s = await deployAndSeed();
    const ix = mkIndexer(pool, s.factory, s.startBlock);
    await ix.init();
    await ix.sync();

    const half = (await s.yes.balanceOf(s.alice.address)) / 2n;
    await s.yes.connect(s.alice).transfer(s.bob.address, half); // not a market trade
    await ix.sync();

    const a = await pool.query("SELECT balance FROM positions WHERE token='YES' AND holder=$1", [s.alice.address.toLowerCase()]);
    const b = await pool.query("SELECT balance FROM positions WHERE token='YES' AND holder=$1", [s.bob.address.toLowerCase()]);
    expect(BigInt(a.rows[0].balance)).to.equal(await s.yes.balanceOf(s.alice.address));
    expect(BigInt(b.rows[0].balance)).to.equal(await s.yes.balanceOf(s.bob.address));
  });

  it("rebuilds derived state on a reorg (checkpoint hash mismatch)", async () => {
    const s = await deployAndSeed();
    const ix = mkIndexer(pool, s.factory, s.startBlock);
    await ix.init();
    await ix.sync();
    const before = await snapshot(pool);

    // simulate a reorg: the block we trusted now reports a different hash
    await pool.query("UPDATE indexer_checkpoints SET last_confirmed_block_hash='0xdeadbeef'");
    await ix.sync(); // detect mismatch -> rewind + rebuild + re-index

    expect(await snapshot(pool)).to.deep.equal(before);
  });
});
