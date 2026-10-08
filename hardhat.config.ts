import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// Sepolia is enabled only when both are set; nothing secret lives in the repo.
const { SEPOLIA_RPC_URL, DEPLOYER_KEY } = process.env;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    ...(SEPOLIA_RPC_URL && DEPLOYER_KEY
      ? { sepolia: { url: SEPOLIA_RPC_URL, accounts: [DEPLOYER_KEY], chainId: 11155111 } }
      : {}),
  },
  mocha: {
    timeout: 120000, // indexer/DB tests do real Postgres round-trips
  },
};

export default config;
