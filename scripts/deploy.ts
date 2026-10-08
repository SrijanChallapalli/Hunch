/**
 * Deploy MarketFactory and record it in deployments/<network>.json, which the
 * indexer, seed script, and frontend all read.
 *
 *   npx hardhat run scripts/deploy.ts --network localhost
 *   npx hardhat run scripts/deploy.ts --network sepolia     # needs SEPOLIA_RPC_URL + DEPLOYER_KEY
 */
import { ethers, network } from "hardhat";
import { writeDeployment } from "../indexer/src/deployment";

export async function deployFactory() {
  const [deployer] = await ethers.getSigners();
  const factory = await (await ethers.getContractFactory("MarketFactory")).deploy();
  const rc = await factory.deploymentTransaction()!.wait();
  const address = await factory.getAddress();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const file = writeDeployment({
    network: network.name,
    chainId,
    factory: address,
    startBlock: rc!.blockNumber,
    deployedAt: new Date().toISOString(),
  });
  console.log(`MarketFactory ${address} (block ${rc!.blockNumber}) by ${deployer.address} -> ${file}`);
  return { factory, address, startBlock: rc!.blockNumber, chainId };
}

if (require.main === module) {
  deployFactory().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
