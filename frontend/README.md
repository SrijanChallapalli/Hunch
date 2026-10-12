# Frontend (M7)

A Next.js 14 (App Router) app covering every core flow: explore markets, create one,
buy/sell YES and NO with slippage limits, resolve, redeem, refund an INVALID market,
claim the creator's LP position, and view a portfolio and an activity feed.

## Data sources

| View | Source | Label shown |
|---|---|---|
| Market page: price, pool, your shares, collateral, actions | **chain** (ethers JSON-RPC reads) | `live on-chain` |
| Explore, Portfolio, Activity, market trade history | **indexer** (PostgreSQL via `/api/*` routes) | `Indexed to block N · K blocks behind` |

Indexed views always show how far the indexer lags the chain head, so stale data is
never presented as on-chain state. Explore derives prices from indexed data alone:
the pool's reserves equal the YES/NO balances the market contract holds, which the
indexer already tracks from `Transfer` events.

Trades are quoted client-side with the contract's exact FPMM math
([`lib/fpmm.ts`](lib/fpmm.ts)), and the slippage tolerance becomes `minSharesOut` /
`minProceeds`. Selling checks the token allowance and asks for an approval first if
it is too low. Every transaction goes through one status line: wallet prompt →
pending hash → confirmed block, or the decoded revert reason.

## Wallets

- **Browser wallet** (MetaMask etc.). The app prompts you to switch if the wallet is
  on the wrong chain.
- **Local dev accounts**: on chain 31337 only, a picker lists the Hardhat node's
  unlocked accounts so flows can be tested without an extension. The node signs
  these transactions; no private keys touch the browser.

## Run locally

```bash
npx hardhat node
```

```bash
npm run deploy -- --network localhost
```

```bash
npm run seed -- --network localhost
```

```bash
npm run indexer -- --network localhost
```

```bash
cd frontend && npm install && npm run dev
```

The app reads the factory address from `../deployments/<PM_NETWORK>.json` (default
`localhost`). For Sepolia, deploy with `--network sepolia`, then set `PM_NETWORK=sepolia`
and `NEXT_PUBLIC_RPC_URL` to a Sepolia RPC (see [`.env.example`](.env.example)).
