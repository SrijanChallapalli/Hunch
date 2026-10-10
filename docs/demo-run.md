# Demo run (M9)

_Generated 2026-10-14T23:43:25.296Z on `localhost` (chainId 31337), PostgreSQL indexer as a separate process._

## 1. Deploy and seed eight markets

- MarketFactory `0x5FbDB2315678afecb367f032d93F642f64180aa3`
- #0 `0xa16E02E87b7454126E5E10d957A927A7F5B5d2be` creator `0xf39F…2266` closes 2026-10-15T00:43:25.000Z: Will ETH close above $4,000 on Dec 31?
- #1 `0xB7A5bd0345EF1Cc5E66bf61BdeC17D2461fBd968` creator `0x7099…79C8` closes 2026-10-15T01:43:25.000Z: Will the Fed cut rates at the next FOMC meeting?
- #2 `0xeEBe00Ac0756308ac4AaBfD76c05c4F3088B8883` creator `0x3C44…93BC` closes 2026-10-15T02:43:25.000Z: Will a team score 30+ goals in the league this season?
- #3 `0x10C6E9530F1C1AF873a391030a1D9E8ed0630D26` creator `0x90F7…b906` closes 2026-10-15T03:43:25.000Z: Will Sepolia average under 13s block time this week?
- #4 `0x603E1BD79259EbcbAaeD0c83eeC09cA0B89a5bcC` creator `0x15d3…6A65` closes 2026-10-15T04:43:25.000Z: Will the city record snowfall before December 1?
- #5 `0x86337dDaF2661A069D0DcB5D160585acC2d15E9a` creator `0x9965…A4dc` closes 2026-10-15T05:43:25.000Z: Will the open-source release ship before the deadline?
- #6 `0x9CfA6D15c80Eb753C815079F2b32ddEFd562C3e4` creator `0x976E…0aa9` closes 2026-10-15T06:43:25.000Z: Will the box-office opener gross over $100M?
- #7 `0x427f7c59ED72bCf26DfFc634FEF3034e00922DD8` creator `0x14dC…9955` closes 2026-10-15T07:43:25.000Z: Will the bill pass the Senate this session?

- invariant `balance >= requiredCollateral` after seeding: **8/8 hold**

## 2. Start the indexer process

- indexer pid 51312 caught up to block 9

## 3. Trade on all eight markets

- 48 trades (YES buys, NO buys, YES sells) across 8 markets
  - #0 P(YES) = 42.94%
  - #1 P(YES) = 44.46%
  - #2 P(YES) = 46.02%
  - #3 P(YES) = 47.61%
  - #4 P(YES) = 49.22%
  - #5 P(YES) = 50.86%
  - #6 P(YES) = 52.53%
  - #7 P(YES) = 54.22%
- invariant `balance >= requiredCollateral` after trading: **8/8 hold**

## 4. Kill the indexer, keep trading, restart

- hard-killed indexer pid 51312 (no graceful shutdown) at checkpoint block 9
- while it was down: 24 more trades + a wallet-to-wallet YES transfer; chain head now block 106
- restarted as pid 25504; resumed from block 10 and caught up to 106
- after restart: 224 (market, token, holder) balances compared, **0 mismatches**; trades indexed 72
- trades sent 72, trades indexed **72** (no gaps, no duplicates)
- invariant `balance >= requiredCollateral` after restart: **8/8 hold**

## 5. Re-deliver every block (duplicate delivery)

- before: 313 raw events, 72 trades · after replaying blocks 1..head: 313 raw events, 72 trades
- duplicate delivery changed **nothing**

## 6. Close, resolve, redeem, refund

- trade after close on #0: **reverted** ("closed")
- resolved: #0 YES, #1 NO, #2 INVALID, #3 YES, #4 NO, #5 YES, #6 NO, #7 YES
- `0xBcd4…4096` redeemed 1.320261437908496733 YES on #0 for 0.013202614379084967 ETH (expected 0.013202614379084967): **exact**
- second redemption of the same 1.320261437908496733 shares: **reverted** (tokens already burned)
- INVALID #2: `0xFABB…694a` refunded 5.743039591315453385 YES + 0.0 NO for 0.028715197956577266 ETH (UNIT/2 per token = 0.028715197956577266): **exact**
- second refund: **reverted**
- creator settled the LP position on #0
- invariant `balance >= requiredCollateral` after settlement: **8/8 hold**

## 7. Indexed view after settlement

- market statuses in PostgreSQL: #0 RESOLVED_YES, #1 RESOLVED_NO, #2 INVALID, #3 RESOLVED_YES, #4 RESOLVED_NO, #5 RESOLVED_YES, #6 RESOLVED_NO, #7 RESOLVED_YES
- REDEEM by `0xbcd4…4096`: 1.320261437908496733 shares → 0.013202614379084967 ETH
- REFUND by `0xfabb…694a`: 5.743039591315453385 shares → 0.028715197956577266 ETH
- final: 224 (market, token, holder) balances compared, **0 mismatches**; trades indexed 72

All steps passed.
