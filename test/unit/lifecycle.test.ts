import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { MarketFactory, PredictionMarket, OutcomeToken } from "../../typechain-types";

const ONE = 10n ** 18n; // 1 whole share
const UNIT_WEI = 10n ** 16n; // 0.01 ETH payout per whole winning share

async function createMarket(
  factory: MarketFactory,
  resolver: string,
  seed: bigint,
  closeInSeconds = 3600
): Promise<{ market: PredictionMarket; yes: OutcomeToken; no: OutcomeToken; closeTime: number }> {
  const closeTime = (await time.latest()) + closeInSeconds;
  await factory.createMarket("Will it rain tomorrow?", closeTime, resolver, { value: seed });
  const id = (await factory.marketCount()) - 1n;
  const addr = await factory.markets(id);
  const market = await ethers.getContractAt("PredictionMarket", addr);
  const yes = await ethers.getContractAt("OutcomeToken", await market.yesToken());
  const no = await ethers.getContractAt("OutcomeToken", await market.noToken());
  return { market, yes, no, closeTime };
}

describe("PredictionMarket — single-market lifecycle (M2)", () => {
  async function deploy() {
    const [creator, alice, bob, resolver] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("MarketFactory");
    const factory = await Factory.deploy();
    await factory.waitForDeployment();
    return { factory, creator, alice, bob, resolver };
  }

  it("seeds the pool at 50% and holds the collateral invariant", async () => {
    const { factory, resolver } = await deploy();
    const seed = ethers.parseEther("0.5");
    const { market } = await createMarket(factory, resolver.address, seed);

    expect(await market.priceYes()).to.equal(ONE / 2n);
    expect(await ethers.provider.getBalance(await market.getAddress())).to.equal(seed);
    expect(await market.invariantHolds()).to.equal(true);
  });

  it("buys YES and NO, keeps the invariant, and moves the price", async () => {
    const { factory, alice, bob, resolver } = await deploy();
    const { market, yes, no } = await createMarket(factory, resolver.address, ethers.parseEther("0.5"));

    await market.connect(alice).buy(true, 0, { value: ethers.parseEther("0.1") });
    const aliceYes = await yes.balanceOf(alice.address);
    expect(aliceYes).to.be.gt(0);
    expect(await market.priceYes()).to.be.gt(ONE / 2n); // YES got more expensive
    expect(await market.invariantHolds()).to.equal(true);

    await market.connect(bob).buy(false, 0, { value: ethers.parseEther("0.1") });
    expect(await no.balanceOf(bob.address)).to.be.gt(0);
    expect(await market.invariantHolds()).to.equal(true);
  });

  it("round-trips a sell and stays solvent", async () => {
    const { factory, alice, resolver } = await deploy();
    const { market, yes } = await createMarket(factory, resolver.address, ethers.parseEther("1"));

    await market.connect(alice).buy(true, 0, { value: ethers.parseEther("0.2") });
    const held = await yes.balanceOf(alice.address);

    await yes.connect(alice).approve(await market.getAddress(), held);
    await market.connect(alice).sell(true, held / 2n, 0);

    expect(await yes.balanceOf(alice.address)).to.equal(held - held / 2n);
    expect(await market.invariantHolds()).to.equal(true);
  });

  it("blocks trading after close", async () => {
    const { factory, alice, resolver } = await deploy();
    const { market, closeTime } = await createMarket(factory, resolver.address, ethers.parseEther("0.5"));

    await time.increaseTo(closeTime);
    await expect(
      market.connect(alice).buy(true, 0, { value: ethers.parseEther("0.1") })
    ).to.be.revertedWith("closed");
  });

  it("resolves YES, redeems the winner once, and rejects a second redeem", async () => {
    const { factory, alice, resolver } = await deploy();
    const { market, yes, closeTime } = await createMarket(factory, resolver.address, ethers.parseEther("1"));

    await market.connect(alice).buy(true, 0, { value: ethers.parseEther("0.3") });
    const shares = await yes.balanceOf(alice.address);

    await time.increaseTo(closeTime);
    await market.connect(resolver).resolve(1); // YES

    const before = await ethers.provider.getBalance(alice.address);
    const tx = await market.connect(alice).redeem(shares);
    const rc = await tx.wait();
    const gas = rc!.gasUsed * rc!.gasPrice;
    const after = await ethers.provider.getBalance(alice.address);

    expect(after - before + gas).to.equal((shares * UNIT_WEI) / ONE);
    expect(await yes.balanceOf(alice.address)).to.equal(0);

    // second redeem has nothing left to burn
    await expect(market.connect(alice).redeem(shares)).to.be.reverted;
    expect(await market.invariantHolds()).to.equal(true);
  });

  it("only the resolver can resolve, and only after close", async () => {
    const { factory, alice, resolver } = await deploy();
    const { market, closeTime } = await createMarket(factory, resolver.address, ethers.parseEther("0.5"));

    await expect(market.connect(resolver).resolve(1)).to.be.revertedWith("not closed");
    await time.increaseTo(closeTime);
    await expect(market.connect(alice).resolve(1)).to.be.revertedWith("not resolver");
    await market.connect(resolver).resolve(2); // NO
    await expect(market.connect(resolver).resolve(1)).to.be.revertedWith("resolved");
  });

  it("pays UNIT/2 per token on INVALID and blocks double refund", async () => {
    const { factory, alice, resolver } = await deploy();
    const { market, yes, no, closeTime } = await createMarket(factory, resolver.address, ethers.parseEther("1"));

    // alice buys a complete set directly so she holds both sides
    await market.connect(alice).mintSet({ value: ethers.parseEther("0.1") });
    const y = await yes.balanceOf(alice.address);
    const n = await no.balanceOf(alice.address);

    await time.increaseTo(closeTime);
    await market.connect(resolver).resolve(3); // INVALID

    const before = await ethers.provider.getBalance(alice.address);
    const tx = await market.connect(alice).refundInvalid(y, n);
    const rc = await tx.wait();
    const gas = rc!.gasUsed * rc!.gasPrice;
    const after = await ethers.provider.getBalance(alice.address);

    expect(after - before + gas).to.equal(((y + n) * UNIT_WEI) / ONE / 2n);
    await expect(market.connect(alice).refundInvalid(y, n)).to.be.reverted;
    expect(await market.invariantHolds()).to.equal(true);
  });
});
