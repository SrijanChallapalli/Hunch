import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { quoteBuy, quoteSell } from "../../frontend/lib/fpmm";

// frontend/lib/fpmm.ts re-implements the pool math in bigint for instant quotes.
// Any drift from the contract would mean wrong slippage limits in the UI, so
// check the mirror against the on-chain views across a seeded random walk.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("Frontend FPMM mirror == contract quotes", () => {
  it("agrees on buy and sell quotes as reserves move", async () => {
    const [, resolver, trader] = await ethers.getSigners();
    const factory = await (await ethers.getContractFactory("MarketFactory")).deploy();
    await factory.waitForDeployment();
    await factory.createMarket("Q?", (await time.latest()) + 3600, resolver.address, {
      value: ethers.parseEther("0.8"),
    });
    const market = await ethers.getContractAt("PredictionMarket", await factory.markets(0));
    const rand = lcg(42);

    for (let i = 0; i < 40; i++) {
      const [rYes, rNo] = [await market.rYes(), await market.rNo()];
      const isYes = rand() < 0.5;
      const ethIn = BigInt(Math.floor(rand() * 2e17)) + 1n;
      const sharesIn = BigInt(Math.floor(rand() * 5e18)) + 1n;

      expect(quoteBuy(rYes, rNo, isYes, ethIn)).to.equal(await market.quoteBuy(isYes, ethIn));
      const local = quoteSell(rYes, rNo, isYes, sharesIn);
      if (local === null) {
        await expect(market.quoteSell(isYes, sharesIn)).to.be.revertedWith("insufficient liquidity");
      } else {
        expect(local).to.equal(await market.quoteSell(isYes, sharesIn));
      }

      await market.connect(trader).buy(isYes, 0n, { value: ethIn }); // move the pool
    }
  });
});
