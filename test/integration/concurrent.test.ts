import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const N = 8;
const ONE = 10n ** 18n;

// M3: prove eight independent markets run concurrently with overlapping active
// windows and no cross-market state bleed.
describe("MarketFactory — eight concurrent markets (M3)", () => {
  it("creates 8 isolated markets, trades, resolves to mixed outcomes, settles", async () => {
    const signers = await ethers.getSigners();
    const alice = signers[10];

    const Factory = await ethers.getContractFactory("MarketFactory");
    const factory = await Factory.deploy();
    await factory.waitForDeployment();

    const now = await time.latest();
    const markets = [] as {
      m: any; creator: any; resolver: any; closeTime: number; yes: any; no: any;
    }[];

    // 8 markets: distinct creators + resolvers, staggered but overlapping windows
    for (let i = 0; i < N; i++) {
      const creator = signers[i];
      const resolver = signers[(i + 1) % N];
      const closeTime = now + 3600 + i * 600; // all active now, different deadlines
      const seed = ethers.parseEther((0.5 + i * 0.1).toFixed(1));
      await factory.connect(creator).createMarket(`Q${i}: event ${i}?`, closeTime, resolver.address, {
        value: seed,
      });
      const addr = await factory.markets(i);
      const m = await ethers.getContractAt("PredictionMarket", addr);
      markets.push({
        m,
        creator,
        resolver,
        closeTime,
        yes: await ethers.getContractAt("OutcomeToken", await m.yesToken()),
        no: await ethers.getContractAt("OutcomeToken", await m.noToken()),
      });
    }

    expect(await factory.marketCount()).to.equal(N);
    // every market + token contract is a distinct address (no shared state)
    const addrs = new Set<string>();
    for (const x of markets) {
      addrs.add(await x.m.getAddress());
      addrs.add(await x.yes.getAddress());
      addrs.add(await x.no.getAddress());
    }
    expect(addrs.size).to.equal(N * 3);

    const priceBefore = await Promise.all(markets.map((x) => x.m.priceYes()));

    // trade ONLY on even markets; leave odd markets untouched to prove isolation
    for (let i = 0; i < N; i += 2) {
      await markets[i].m.connect(alice).buy(true, 0n, { value: ethers.parseEther("0.05") });
    }

    // snapshot an untraded reference reserve to check it never moves
    const m4ReserveYes = await markets[4].m.rYes();
    const m4ReserveNo = await markets[4].m.rNo();

    // invariant holds on all 8; traded markets moved, untouched markets did not
    for (let i = 0; i < N; i++) {
      expect(await markets[i].m.invariantHolds()).to.equal(true);
      const p = await markets[i].m.priceYes();
      if (i % 2 === 0) expect(p).to.not.equal(priceBefore[i]);
      else expect(p).to.equal(priceBefore[i]);
    }

    // past the latest deadline, resolve to a mix: YES, NO, and one INVALID
    await time.increaseTo(markets[N - 1].closeTime + 1);
    const outcomeOf = (i: number) => (i === 2 ? 3 : i % 2 === 0 ? 1 : 2);
    for (let i = 0; i < N; i++) {
      await markets[i].m.connect(markets[i].resolver).resolve(outcomeOf(i));
    }
    // resolving each market set only its own status — no bleed
    for (let i = 0; i < N; i++) {
      expect(await markets[i].m.status()).to.equal(outcomeOf(i));
    }

    // alice redeems her winning YES in market 0 (resolved YES)
    const win = await markets[0].yes.balanceOf(alice.address);
    expect(win).to.be.gt(0);
    await markets[0].m.connect(alice).redeem(win);
    expect(await markets[0].yes.balanceOf(alice.address)).to.equal(0);

    // alice refunds in market 2 (resolved INVALID) at UNIT/2 per token
    const inv = await markets[2].yes.balanceOf(alice.address);
    expect(inv).to.be.gt(0);
    const before = await ethers.provider.getBalance(alice.address);
    const tx = await markets[2].m.connect(alice).refundInvalid(inv, 0n);
    const rc = await tx.wait();
    const after = await ethers.provider.getBalance(alice.address);
    expect(after - before + BigInt(rc!.gasUsed) * BigInt(rc!.gasPrice)).to.equal((inv * 10n ** 16n) / ONE / 2n);

    // settling/redeeming in markets 0 and 2 did not touch market 4's reserves
    expect(await markets[4].m.rYes()).to.equal(m4ReserveYes);
    expect(await markets[4].m.rNo()).to.equal(m4ReserveNo);

    // every market remains solvent after settlement
    for (let i = 0; i < N; i++) {
      expect(await markets[i].m.invariantHolds()).to.equal(true);
    }
  });
});
