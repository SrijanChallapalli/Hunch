/**
 * Create eight independent markets with different creators and overlapping close
 * windows on the deployed factory, then place a few opening trades on each.
 *
 *   npx hardhat run scripts/seed-eight-markets.ts --network localhost
 *
 * Env: SEED_CLOSE_HOURS (base close offset, default 24). Market i closes at
 * now + base + i hours, so all eight are open at the same time.
 */
import { ethers, network } from "hardhat";
import { readDeployment } from "../indexer/src/deployment";

export const QUESTIONS = [
  "Will ETH close above $4,000 on Dec 31?",
  "Will the Fed cut rates at the next FOMC meeting?",
  "Will a team score 30+ goals in the league this season?",
  "Will Sepolia average under 13s block time this week?",
  "Will the city record snowfall before December 1?",
  "Will the open-source release ship before the deadline?",
  "Will the box-office opener gross over $100M?",
  "Will the bill pass the Senate this session?",
];

export async function seedEightMarkets(factoryAddress: string, closeBaseSeconds: number) {
  const signers = await ethers.getSigners();
  const factory = await ethers.getContractAt("MarketFactory", factoryAddress);
  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
  const firstId = Number(await factory.marketCount());

  const markets = [];
  for (let i = 0; i < 8; i++) {
    // different creator per market; resolver is a separate account
    const creator = signers[i % signers.length];
    const resolver = signers[8 % signers.length];
    const closeTime = now + closeBaseSeconds + i * 3600;
    await (
      await factory.connect(creator).createMarket(QUESTIONS[i], closeTime, resolver.address, {
        value: ethers.parseEther("1"),
      })
    ).wait();
    const addr = await factory.markets(firstId + i);
    markets.push({ id: firstId + i, address: addr, creator, resolver, closeTime, question: QUESTIONS[i] });
    console.log(`market #${firstId + i} ${addr} creator=${creator.address.slice(0, 8)} closes ${new Date(closeTime * 1000).toISOString()}`);
  }
  return markets;
}

async function main() {
  const dep = readDeployment(network.name);
  if (!dep) throw new Error(`no deployment for ${network.name}: run scripts/deploy.ts first`);
  const base = Number(process.env.SEED_CLOSE_HOURS ?? 24) * 3600;
  const markets = await seedEightMarkets(dep.factory, base);

  // opening trades on both outcomes in every market
  const signers = await ethers.getSigners();
  const traders = signers.slice(10, Math.min(14, signers.length));
  if (!traders.length) return;
  for (const [i, mk] of markets.entries()) {
    const m = await ethers.getContractAt("PredictionMarket", mk.address);
    const t = traders[i % traders.length];
    await (await m.connect(t).buy(true, 0n, { value: ethers.parseEther("0.05") })).wait();
    await (await m.connect(traders[(i + 1) % traders.length]).buy(false, 0n, { value: ethers.parseEther("0.03") })).wait();
    console.log(`  seeded trades on #${mk.id}: P(YES)=${Number(await m.priceYes()) / 1e16}%`);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
