import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

// The on-chain quote views must agree with what buy/sell actually pay, so UIs and
// bots can derive slippage limits without re-implementing the pool math.
describe("PredictionMarket — quoteBuy / quoteSell", () => {
  async function setup() {
    const [, resolver, alice] = await ethers.getSigners();
    const factory = await (await ethers.getContractFactory("MarketFactory")).deploy();
    await factory.waitForDeployment();
    const closeTime = (await time.latest()) + 3600;
    await factory.createMarket("Q?", closeTime, resolver.address, { value: ethers.parseEther("1") });
    const market = await ethers.getContractAt("PredictionMarket", await factory.markets(0));
    const yes = await ethers.getContractAt("OutcomeToken", await market.yesToken());
    const no = await ethers.getContractAt("OutcomeToken", await market.noToken());
    return { market, yes, no, alice };
  }

  it("quoteBuy equals the shares actually received", async () => {
    const { market, yes, no, alice } = await setup();
    for (const [isYes, amt] of [[true, "0.13"], [false, "0.4"], [true, "0.007"]] as const) {
      const ethIn = ethers.parseEther(amt);
      const quoted = await market.quoteBuy(isYes, ethIn);
      const token = isYes ? yes : no;
      const before = await token.balanceOf(alice.address);
      await market.connect(alice).buy(isYes, quoted, { value: ethIn }); // quote as exact min
      expect((await token.balanceOf(alice.address)) - before).to.equal(quoted);
    }
  });

  it("quoteSell equals the ETH actually paid", async () => {
    const { market, yes, alice } = await setup();
    await market.connect(alice).buy(true, 0n, { value: ethers.parseEther("0.3") });
    const held = await yes.balanceOf(alice.address);
    await yes.connect(alice).approve(await market.getAddress(), held);

    const sellAmt = held / 3n;
    const quoted = await market.quoteSell(true, sellAmt);
    const before = await ethers.provider.getBalance(alice.address);
    const rc = await (await market.connect(alice).sell(true, sellAmt, quoted)).wait();
    const after = await ethers.provider.getBalance(alice.address);
    expect(after - before + rc!.gasUsed * rc!.gasPrice).to.equal(quoted);
  });

  it("returns zero for zero input", async () => {
    const { market } = await setup();
    expect(await market.quoteBuy(true, 0n)).to.equal(0n);
    expect(await market.quoteSell(false, 0n)).to.equal(0n);
  });
});
