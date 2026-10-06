/**
 * Long-running indexer process.
 *
 *   npx hardhat run indexer/src/run.ts --network localhost
 *
 * Reads the factory address + start block from deployments/<network>.json (written
 * by scripts/deploy.ts), or from FACTORY_ADDRESS / START_BLOCK. Kill it at any point
 * (Ctrl-C or SIGKILL) and start it again: it resumes from the stored checkpoint, and
 * raw-event idempotency makes any re-delivered range a no-op.
 */
import { ethers, network } from "hardhat";
import { makePool, migrate } from "./db";
import { Indexer } from "./indexer";
import { readDeployment } from "./deployment";

const POLL_MS = Number(process.env.POLL_MS ?? 500);

async function main() {
  const dep = readDeployment(network.name);
  const factory = process.env.FACTORY_ADDRESS ?? dep?.factory;
  const startBlock = Number(process.env.START_BLOCK ?? dep?.startBlock ?? 0);
  if (!factory) throw new Error(`no factory: run scripts/deploy.ts on ${network.name} or set FACTORY_ADDRESS`);
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  const pool = makePool();
  await migrate(pool);
  const ix = new Indexer(pool, ethers.provider as any, chainId, factory, startBlock);

  let stop = false;
  process.on("SIGINT", () => {
    console.log("stopping after the current range...");
    stop = true;
  });

  const resumed = await ix.lastIndexedBlock();
  console.log(
    `indexer chain=${chainId} factory=${factory} ` +
      (resumed === null ? `starting at block ${startBlock}` : `resuming after block ${resumed}`) +
      ` poll=${POLL_MS}ms`
  );
  await ix.run(POLL_MS, () => stop);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
