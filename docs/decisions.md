# M1 — Financial Model & Design Decisions

> **Status:** Decided (pre-coding). This document is the source of truth for the
> accounting model. Contracts, tests, and the collateral invariant must match it.
> Change the model *here first*, then propagate to code and tests.
>
> **Network:** Ethereum testnet (Sepolia). **Collateral:** testnet ETH.

---

## 0. Model in one sentence

Each market is **collateral-backed by complete sets**: `1 UNIT` of ETH always mints
exactly `1 YES + 1 NO`, and `1 YES + 1 NO` can always be merged back into `1 UNIT`.
Price discovery is a small **constant-product AMM (FPMM)** seeded by the market
creator (the sole LP). Because the AMM only ever shuffles tokens that are *already*
1:1 backed, it can never make the market insolvent. The whole solvency story reduces
to one line (§5).

This is the Gnosis conditional-tokens / Polymarket lineage, simplified to a single LP
per market so there is no general LP join/leave accounting in the MVP.

---

## 1. Denominations, units, decimals

| Quantity | Value | Notes |
|---|---|---|
| `UNIT` (payout per winning whole share) | `0.01 ether` = `1e16` wei | One full winning share redeems for 0.01 ETH |
| Outcome token decimals | `18` | Standard ERC20 |
| 1 **whole share** | `1e18` token base units | Human-facing quantity |
| Collateral to mint `n` whole sets | `n × UNIT` wei | `n` expressed in whole shares |

**Whole shares vs base units — do not conflate.** A balance of `s` whole shares is
`s × 1e18` base units and pays `s × UNIT` wei if it wins. All user-facing amounts are
whole shares; on-chain math is in base units. Internal conversions use the
`UNIT / 1e18` ratio.

**Rounding rule (safety-critical):** always round so the contract keeps *more*
collateral, never less. Round **costs up**, round **payouts/proceeds down**. A trade
or redemption may leave dust in the contract; it must never create a payout the
contract cannot cover. Boundary rounding is fuzz-tested (see threat-model §Rounding).

---

## 2. Issuance & redemption of collateral (the backing layer)

These are the **only** operations that move net ETH in/out before resolution:

- **`mintSet(n)`** — send `n × UNIT` wei → receive `n` YES **and** `n` NO.
- **`mergeSet(n)`** — burn `n` YES **and** `n` NO → receive `n × UNIT` wei.

Consequences enforced by construction:

- YES and NO are minted and burned **only in matched pairs** (via mint/merge) or burned
  singly at resolution (§4). Therefore, in any `OPEN`/`CLOSED` state:

  ```text
  totalSupply(YES) == totalSupply(NO) == setsOutstanding
  ```

- `setsOutstanding = Σ mintSet − Σ mergeSet`.
- Mint/burn authority on `OutcomeToken` is restricted to the owning `PredictionMarket`.

Buys and sells (§3) are built *on top of* mint/merge + an AMM swap; they change *who*
holds the tokens, not the backing ratio.

---

## 3. Pricing — single-LP FPMM

The market contract holds a constant-product pool of reserves `(R_YES, R_NO)` in token
base units, with `k = R_YES · R_NO`. Normalized instantaneous prices:

```text
priceYES = R_NO / (R_YES + R_NO)      priceNO = R_YES / (R_YES + R_NO)
priceYES + priceNO = 1
```

### Seeding (creation)

The creator deposits `D` ETH. The contract mints `m0 = D / UNIT` sets and seeds the pool
**50/50**: `R_YES = R_NO = m0` ⇒ starting implied probability = 50%. The creator is
recorded as the **sole LP** owning 100% of the pool. (General LP join/leave is a non-goal
for the MVP — see spec §2.)

### Buy (ETH → outcome shares)

To buy YES with net ETH `E` (after any fee), let `m = E / UNIT`:

```text
yesOut = m + R_YES − k / (R_NO + m)
pool after:  R_NO' = R_NO + m,   R_YES' = k / (R_NO + m)   (k preserved)
```

Derivation: minting `m` sets gives the contract `m` YES and `m` NO. All `m` NO go into
the pool (`R_NO → R_NO + m`); to preserve `k` the pool releases `R_YES − R_YES'` YES. The
trader receives the `m` freshly minted YES **plus** the released pool YES. Net effect:
`setsOutstanding += m`, `balance += m × UNIT`, invariant (§5) preserved. NO is symmetric.

Implemented as an **exact-ETH-in swap**: the caller sends ETH (`msg.value`) and sets
`minSharesOut`; the trade reverts if `sharesOut < minSharesOut` (slippage bound) or if
`block.timestamp >= closeTime` (deadline). The AMM swap's rounding favors the trader a
hair (the LP bears it) but never the contract; solvency is unaffected because total
supply is set by the mint, not the swap. NO is symmetric.

### Sell (outcome shares → ETH)

The reverse: the trader returns `b` YES; the contract swaps against the pool to assemble
complete sets (YES+NO), merges them for ETH, and pays the proceeds. Enforce
`proceeds ≥ minProceeds`, deadline, and a `transferFrom` allowance/balance check before
pulling the trader's tokens.

### Why the AMM can't break solvency

Every token the pool holds or releases was minted as part of a complete set and is counted
in `setsOutstanding`. A swap changes `R_YES`/`R_NO` but not `totalSupply(YES) −
totalSupply(NO)` (which stays 0) nor the `balance == setsOutstanding × UNIT` equality. The
pool redistributes backed tokens; it never issues unbacked ones.

---

## 4. Closing, resolution, redemption, refunds

State machine (per spec §5):

```text
OPEN --(block.timestamp >= closeTime)--> CLOSED
CLOSED --(resolver: YES)--> RESOLVED_YES
CLOSED --(resolver: NO )--> RESOLVED_NO
CLOSED --(resolver: INVALID, or timeout)--> INVALID
Only OPEN can trade. Only RESOLVED_* can redeem winners. Only INVALID can refund.
No transition back to OPEN after resolution.
```

### Resolver + timeout

Each market stores a trusted `resolver` set at creation. After `closeTime` the resolver
calls `resolve(YES | NO | INVALID)` exactly once; finalization is immutable. **Timeout:**
if the resolver has not acted by `closeTime + RESOLVE_GRACE` (default **7 days**), *anyone*
may call `forceInvalid()` to move the market to `INVALID`. This answers "what if the
resolver never responds" (spec Q7) and funds the refund path. The timeout mitigates
resolver *absence*, not a resolver reporting a *false* outcome — that is an accepted trust
assumption (threat-model §Resolver).

### Redemption (RESOLVED_YES / RESOLVED_NO)

Winning token burns 1:1 for `UNIT`; losing token is worthless.

```text
redeem:  burn s winning shares -> pay s × UNIT wei   (atomic: burn then pay)
```

**Single-use by construction:** the claim *is* the burn, so the same share cannot be
redeemed twice. The pool's winning tokens are redeemed by the creator (sole LP) the same
way — this is the "LP settlement" and it is already inside the invariant, needing no extra
funding.

Total winner liability:
`totalSupply(winner) × UNIT` and since `totalSupply(winner) ≤ setsOutstanding = balance /
UNIT`, it is fully covered. The losing side's ETH backing stays in the contract and covers
the winners — that is exactly where winners' payout comes from.

### INVALID refund policy (chosen)

On `INVALID`, **each** outcome token — YES *and* NO — redeems for `UNIT / 2`:

```text
refundInvalid:  burn q tokens (of either side) -> pay q × (UNIT / 2) wei
```

Rationale: a complete set is worth exactly `1 UNIT = 1 YES + 1 NO`, so splitting the
backing evenly gives `UNIT/2` per token. A holder of a full set still recovers `UNIT`
(same as `mergeSet`); a holder of only one side recovers the pro-rata collateral backing
that token. This is **collateral-backed and provably solvent**, not a promise to refund the
original *trade price* (spec §3.6 forbids that unless the accounting supports it — ours
does not, so we do not promise it). Total refund liability:

```text
(totalSupply(YES) + totalSupply(NO)) × UNIT/2
  = (setsOutstanding + setsOutstanding) × UNIT/2
  = setsOutstanding × UNIT = balance.           ✓ exactly solvent
```

---

## 5. The solvency invariant

**One line, checked in every reachable state before resolution:**

```text
address(this).balance  >=  setsOutstanding × UNIT    // "==" up to rounding dust
          (equivalently)  totalSupply(YES) == totalSupply(NO)
```

The relation is exact equality except for sub-wei rounding dust left behind by
payout divisions (`_weiFor` rounds down), which only ever leaves the contract *over*-
collateralized. The on-chain `invariantHolds()` view asserts the `>=` form.

After resolution the obligation transforms but stays fully funded:

| State | Outstanding liability | Covered by |
|---|---|---|
| RESOLVED_YES | `totalSupply(YES) × UNIT` | `balance` (losing NO's ETH stays in) |
| RESOLVED_NO | `totalSupply(NO) × UNIT` | `balance` |
| INVALID | `(supply(YES)+supply(NO)) × UNIT/2` | `balance` (equals `sets × UNIT`) |

Tests must prove (spec §6):

- Every accepted trade preserves the invariant (unit + invariant/fuzz tests).
- No path lets anyone withdraw collateral needed for an outstanding payout.
- A share cannot pay out more than once (burn-on-claim).
- Redeemed + remaining-claimable never exceeds legitimate collateral.
- Both YES and NO winning paths, and the INVALID path, are each exercised.
- INVALID refunds and the LP's pool settlement cannot spend the same ETH twice.

---

## 6. The eight pre-coding decisions (spec §3) — resolved

| # | Decision | Choice |
|---|---|---|
| 1 | Market mechanics | **Split/merge complete sets + single-LP FPMM.** *Not* the Speedrun average-probability AMM — chosen because solvency reduces to one auditable line (§5) and the AMM structurally cannot create unbacked liability. |
| 2 | Collateral denomination | Testnet **ETH**, used consistently. |
| 3 | Payout & decimals | `UNIT = 0.01 ETH` per winning whole share; tokens `18` decimals; whole-share vs base-unit discipline per §1. |
| 4 | Issuance accounting | Collateral enters/leaves **only** via `mintSet`/`mergeSet`; creator's deposit seeds the pool 50/50 and the creator is the sole LP. |
| 5 | Selling / withdrawals | ETH is released only by `mergeSet`, `sell` (swap→merge), winner `redeem`, or INVALID `refund`; each guarded by the §5 invariant so future payouts stay funded. |
| 6 | Invalid outcome policy | Resolver or timeout can set INVALID; holders redeem each token at `UNIT/2` via an auditable supply-based claim (no original-price refund promise). |
| 7 | Resolution trust | Trusted per-market resolver; immutable after finalization; `RESOLVE_GRACE` timeout → anyone can `forceInvalid`. Resolver honesty is an accepted trust assumption. |
| 8 | Indexer finality | UI balances are **provisional until N confirmations**; reorgs rewind to a common ancestor and replay idempotently (spec §7). Confirmation depth `N` pinned at M6. |

### Also resolved (spec §12 questions)

- **Q1 ERC20 per market:** Yes — two real `OutcomeToken` ERC20s per market (resume says
  "ERC20 outcome shares"). 8 markets ⇒ 16 token contracts + 8 markets + 1 factory.
  Minimal-proxy clones are an optional later optimization, not MVP.
- **Q2 Creator deposit:** It is the pool seed; the creator recovers value only as the LP
  after resolution, within the invariant.
- **Q3 One side fully sold:** FPMM price asymptotes; `R_YES`/`R_NO` never reach 0 exactly,
  quotes stay monotonic and solvent. Reserve-exhaustion is an explicit invariant test.
- **Q6 Transferable tokens:** Yes, standard ERC20 transfer. The indexer therefore derives
  positions from **all `Transfer` events**, not just market buy/sell (spec §7 portfolio
  note).

---

## 7. Open items deferred to later milestones

- Exact integer buy/sell formulas + rounding proofs → **M2** (with unit tests).
- Trading fee? Default **0%** for MVP; if added, fee accrues to the LP and must be folded
  into the §5 invariant before shipping.
- Confirmation depth `N` and reorg replay specifics → **M6**.
- The `1.8s p95` indexer number is a **measurement target**, not an assumption → **M8**.
  Never claimed until the benchmark produces a saved run log.

---

*Next milestone: M2 — implement `OutcomeToken`, `PredictionMarket`, `MarketFactory` and
exercise the full buy/sell/close/resolve/redeem/refund lifecycle on a single market with
Hardhat tests.*
