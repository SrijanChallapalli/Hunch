# 7,500-Operation Simulation Report

_Generated 2026-10-14T23:10:15.223Z · seed 0xbadc0de · hardhat (in-process)_

| Metric | Value |
|---|---|
| Markets / traders | 8 / 10 |
| Operations attempted | **7500** |
| Accepted | 6228 |
| Rejected (expected) | 1272 |
| Unexpected errors | 0 |
| Solvency checks | 6236 |
| **Solvency failures** | **0** |
| Elapsed | 9.8s (762 ops/s) |

## Accepted operations by type
- buyYes: 1132
- buyNo: 1020
- sellYes: 1009
- sellNo: 1019
- mint: 1023
- merge: 1025

## Rejected-order coverage
- zeroValue: 262
- noAllowance: 277
- slippage: 254
- wrongState: 479
- closed: 0

## Settlement edge cases
- partial redemptions: 6
- double-claims blocked: 6
- invalid-market refunds: 2
- LP settlements: 8
- closed-trade reverts: 8
- failed-ETH-receiver blocked: 1
