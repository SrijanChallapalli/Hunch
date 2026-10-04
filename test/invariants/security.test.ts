import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;

// Deterministic PRNG so the property run is reproducible.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

async function newMarket(resolver: string, seed = ethers.parseEther("2"), closeIn = 100000) {
  const Factory = await ethers.getContractFactory("MarketFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  const closeTime = (await time.latest()) + closeIn;
  await factory.createMarket("Q?", closeTime, resolver, { value: seed });
  const market = await ethers.getContractAt("PredictionMarket", await factory.markets(0));
  const yes = await ethers.getContractAt("OutcomeToken", await market.yesToken());
  const no = await ethers.getContractAt("OutcomeToken", await market.noToken());
  return { market, yes, no, closeTime };
}

describe("Security & invariants (M4)", () => {
  it("blocks a reentrancy attack on payout (and a benign merge still works)", async () => {
    const [, resolver] = await ethers.getSigners();
    const { market } = await newMarket(resolver.address);

    const Attacker = await ethers.getContractFactory("ReentrancyAttacker");
    const attacker = await Attacker.deploy(await market.getAddress());
    await attacker.mint({ value: ethers.parseEther("0.1") });
    const shares = ethers.parseEther("1"); // 0.1 ETH / 0.01 unit = 10 shares; merge 1

    await attacker.setAttack(true);
    await expect(attacker.doMerge(shares)).to.be.reverted; // guard trips

    await attacker.setAttack(false);
    await expect(attacker.doMerge(shares)).to.not.be.reverted; // control
    expect(await market.invariantHolds()).to.equal(true);
  });

  it("reverts a redeem whose payout recipient rejects ETH, atomically", async () => {
    const [, resolver, alice] = await ethers.getSigners();
    const { market, yes, closeTime } = await newMarket(resolver.address);

    await market.connect(alice).buy(true, 0n, { value: ethers.parseEther("0.5") });
    const Reject = await ethers.getContractFactory("RejectETH");
    const reject = await Reject.deploy(await market.getAddress());

    const bal = await yes.balanceOf(alice.address);
    await yes.connect(alice).transfer(await reject.getAddress(), bal);

    await time.increaseTo(closeTime);
    await market.connect(resolver).resolve(1); // YES

    await expect(reject.doRedeem(bal)).to.be.reverted; // payout fails -> whole tx reverts
    expect(await yes.balanceOf(await reject.getAddress())).to.equal(bal); // tokens intact
    expect(await market.invariantHolds()).to.equal(true);
  });

  it("rejects all the adversarial / illegal-state operations", async () => {
    const [creator, resolver, alice] = await ethers.getSigners();
    const { market, yes, closeTime } = await newMarket(resolver.address);

    await expect(market.connect(alice).buy(true, 0n, { value: 0 })).to.be.revertedWith("zero");
    await expect(market.connect(alice).mergeSet(0)).to.be.revertedWith("zero");
    await expect(market.connect(resolver).resolve(1)).to.be.revertedWith("not closed");
    await expect(market.connect(alice).redeem(1)).to.be.revertedWith("not resolved");
    await expect(market.connect(alice).refundInvalid(1, 0)).to.be.revertedWith("not invalid");
    await expect(market.forceInvalid()).to.be.revertedWith("grace");

    // sell without allowance must fail
    await market.connect(alice).buy(true, 0n, { value: ethers.parseEther("0.2") });
    const bal = await yes.balanceOf(alice.address);
    await expect(market.connect(alice).sell(true, bal, 0n)).to.be.reverted; // no approval

    await time.increaseTo(closeTime);
    await expect(market.connect(alice).buy(true, 0n, { value: 1 })).to.be.revertedWith("closed");
    await expect(market.connect(alice).resolve(1)).to.be.revertedWith("not resolver");
    await expect(market.connect(resolver).resolve(9)).to.be.revertedWith("bad outcome");
    await market.connect(resolver).resolve(2); // NO
    await expect(market.connect(resolver).resolve(1)).to.be.revertedWith("resolved");
    // redeeming the losing (YES) side has nothing to burn
    await expect(market.connect(alice).redeem(bal)).to.be.reverted;
    expect(await market.invariantHolds()).to.equal(true);
  });

  it("holds the solvency invariant across 150 random seeded operations", async () => {
    const signers = await ethers.getSigners();
    const resolver = signers[1];
    const traders = signers.slice(10, 15);
    const { market, yes, no } = await newMarket(resolver.address, ethers.parseEther("3"));

    const rnd = lcg(0xC0FFEE);
    const marketAddr = await market.getAddress();
    const wei = () => ethers.parseEther((0.001 + rnd() * 0.05).toFixed(4));

    let ok = 0;
    let rejected = 0;
    for (let i = 0; i < 150; i++) {
      const u = traders[Math.floor(rnd() * traders.length)];
      const action = Math.floor(rnd() * 6);
      try {
        if (action === 0) {
          await market.connect(u).buy(true, 0n, { value: wei() });
        } else if (action === 1) {
          await market.connect(u).buy(false, 0n, { value: wei() });
        } else if (action === 2) {
          await market.connect(u).mintSet({ value: wei() });
        } else if (action === 3) {
          const bal = await yes.balanceOf(u.address);
          if (bal === 0n) { rejected++; continue; }
          const amt = bal / 2n > 0n ? bal / 2n : bal;
          await yes.connect(u).approve(marketAddr, amt);
          await market.connect(u).sell(true, amt, 0n);
        } else if (action === 4) {
          const bal = await no.balanceOf(u.address);
          if (bal === 0n) { rejected++; continue; }
          const amt = bal / 2n > 0n ? bal / 2n : bal;
          await no.connect(u).approve(marketAddr, amt);
          await market.connect(u).sell(false, amt, 0n);
        } else {
          const y = await yes.balanceOf(u.address);
          const n = await no.balanceOf(u.address);
          const m = y < n ? y : n;
          if (m === 0n) { rejected++; continue; }
          await market.connect(u).mergeSet(m / 2n > 0n ? m / 2n : m);
        }
        ok++;
        // the key property: the contract is solvent after every accepted op
        expect(await market.invariantHolds()).to.equal(true);
      } catch {
        rejected++;
      }
    }

    expect(ok).to.be.greaterThan(50);
    expect(await market.invariantHolds()).to.equal(true);
    // sanity: YES and NO supplies stayed equal (sets always matched)
    expect(await yes.totalSupply()).to.equal(await no.totalSupply());
  });
});
