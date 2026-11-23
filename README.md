# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/geaven137/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/geaven137/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads DefiLlama's sealed protocol snapshot, ranks every protocol with no token on record by the implied value its token would have, and shows how to farm each one.

The value model is calibrated from the snapshot itself: each protocol's implied value is its TVL times its sector's median market-cap-to-TVL ratio (computed from the snapshot's live protocols), adjusted by 7-day growth and by how long it has run with no token. No protocol name is special-cased.

## Run it

The grader runs `node main.ts` with the snapshot at `/input/snapshot.json` and collects `/output/` (board.json, the dashboard, screenshots, dossier.json). Locally, from the unpacked kit directory:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node <this repository>/main.ts --input input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
