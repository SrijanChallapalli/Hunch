import * as fs from "fs";
import * as path from "path";

/** Addresses written by scripts/deploy.ts and read by the indexer, seed script, and frontend. */
export interface Deployment {
  network: string;
  chainId: number;
  factory: string;
  startBlock: number;
  deployedAt: string;
}

export const DEPLOYMENTS_DIR = path.join(__dirname, "..", "..", "deployments");

export function deploymentPath(networkName: string): string {
  return path.join(DEPLOYMENTS_DIR, `${networkName}.json`);
}

export function readDeployment(networkName: string): Deployment | null {
  const p = deploymentPath(networkName);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
}

export function writeDeployment(d: Deployment): string {
  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  const p = deploymentPath(d.network);
  fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
  return p;
}
