# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/geaven137/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/geaven137/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads DefiLlama's sealed protocol snapshot, ranks every protocol with no token on record by the implied value its token would have, and shows how to farm each one.

The value model (radar-3) is fitted from the snapshot itself: a ridge regression on the snapshot's live protocols predicts log(market cap / TVL) from size, age and category, with the penalty and the terms picked by leave-one-out error — the size curve is fitted, not assumed. Each row's implied value is TVL × fitted multiple × token odds, where token odds come from the share of protocols that already record a token at each age. Every row carries a P25–P75 range from the fit's own leave-one-out residuals and a FARM / MARGINAL / SKIP verdict priced on the downside value. The dashboard also carries the full 758-protocol ledger and recomputes every row in the page to verify the board. No protocol name is special-cased.

## Run it

The grader runs `node main.ts` with the snapshot at `/input/snapshot.json` and collects `/output/` (board.json, the dashboard, screenshots, dossier.json). Locally, from the unpacked kit directory:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node <this repository>/main.ts --input input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
