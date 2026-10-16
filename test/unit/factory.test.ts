import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("MarketFactory — input validation", () => {
  async function deploy() {
    const [creator, resolver] = await ethers.getSigners();
    const factory = await (await ethers.getContractFactory("MarketFactory")).deploy();
    await factory.waitForDeployment();
    const closeTime = (await time.latest()) + 3600;
    return { factory, creator, resolver, closeTime };
  }

  it("rejects an empty question", async () => {
    const { factory, resolver, closeTime } = await deploy();
    await expect(
      factory.createMarket("", closeTime, resolver.address, { value: ethers.parseEther("0.1") })
    ).to.be.revertedWith("bad question");
  });

  it("accepts a question at the byte limit and rejects one byte over", async () => {
    const { factory, resolver, closeTime } = await deploy();
    const max = Number(await factory.MAX_QUESTION_BYTES());
    const seed = { value: ethers.parseEther("0.1") };

    await factory.createMarket("q".repeat(max), closeTime, resolver.address, seed);
    expect(await factory.marketCount()).to.equal(1n);

    await expect(
      factory.createMarket("q".repeat(max + 1), closeTime, resolver.address, seed)
    ).to.be.revertedWith("bad question");
  });

  it("counts UTF-8 bytes, not characters", async () => {
    const { factory, resolver, closeTime } = await deploy();
    const max = Number(await factory.MAX_QUESTION_BYTES());
    // "é" is two bytes in UTF-8, so max/2 + 1 of them overflows the limit
    await expect(
      factory.createMarket("é".repeat(max / 2 + 1), closeTime, resolver.address, {
        value: ethers.parseEther("0.1"),
      })
    ).to.be.revertedWith("bad question");
  });

  it("rejects a market with no seed", async () => {
    const { factory, resolver, closeTime } = await deploy();
    await expect(factory.createMarket("Q?", closeTime, resolver.address)).to.be.revertedWith("need seed");
  });
});
