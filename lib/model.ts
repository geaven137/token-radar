// The token radar's model, radar-4: one sealed snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never the ceiling) and adds
// the strongest pre-token protocols below the watchlist floor, by TVL: the early rows the radar
// exists to find. A protocol is pre-token when its record carries no token (no market cap, no
// CoinGecko id, no symbol). Live-token protocols are kept apart and shown with the market's own
// values, never mixed into the ranked board.
//
// Implied value is FITTED from the snapshot's live protocols, not from a fixed multiple:
//
//   log(mcap / tvl) ~ ridge regression on the snapshot's live protocols (market cap known,
//   TVL above zero, exchanges and versioned pools left out: 118 of them). Candidate terms:
//   log TVL (the size curve), log TVL squared, seven-day growth, log age, log chain count,
//   a recent-listing dummy (listed in the last year), and category dummies for categories
//   with at least 8 live protocols. The ridge penalty is picked by leave-one-out error over
//   a grid, each term is kept only when dropping it worsens a held-out error — leave-one-out
//   (median or mean) or walk-forward (median) — by more than half a percent, and the
//   surviving terms are refitted on all 118. The fitted multiple is exp(prediction), clamped
//   to [0.002, 5].
//
//   token odds = the share of the snapshot's protocols that record a token, by age bucket
//   (under 180 days, 180-365, 365-730, 730-1500, over 1500), shrunk toward the global share
//   with a weight of 10 protocols. Unknown age takes the global share. The odds are the
//   peers' own record: young protocols rarely carry a token yet, old ones usually do.
//
//   implied  = max(1, round(tvl_usd * fitted_multiple * token_odds))
//   P25-P75  = implied * exp(quartiles of the final model's leave-one-out residuals)
//
// Farm verdicts price the P25 value, so FARM means worth it even on the downside: the
// airdrop pool is assumed to be 5% of the implied value, split among an estimated farmer
// count (one per $10,000 of TVL, between 1,000 and 100,000 — a rough proxy, stated here),
// minus the plan's fees. FARM when the net is at least $25 and at least $5 an hour,
// MARGINAL when the net is non-negative, otherwise SKIP. No protocol name is ever
// special-cased: the same functions score every row, and the dashboard recomputes each row
// from the same fitted coefficients.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard and changeable in its sandbox. */
export interface ModelConstants {
  lambda_grid: number[];
  category_min_live: number;
  odds_shrinkage: number;
  airdrop_share: number;
  farmers_per_tvl_usd: number;
  farmers_min: number;
  farmers_max: number;
  verdict_net_min: number;
  verdict_hourly_min: number;
  multiple_floor: number;
  multiple_cap: number;
}

export const MODEL: ModelConstants = {
  lambda_grid: [0.1, 0.5, 1, 2, 5, 10, 20, 50],
  category_min_live: 8,
  odds_shrinkage: 10,
  airdrop_share: 0.05,
  farmers_per_tvl_usd: 1 / 10000,
  farmers_min: 1000,
  farmers_max: 100000,
  verdict_net_min: 25,
  verdict_hourly_min: 5,
  multiple_floor: 0.002,
  multiple_cap: 5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-4';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A farm verdict: FARM when the downside net clears both bars, MARGINAL when it clears zero. */
export type Verdict = 'FARM' | 'MARGINAL' | 'SKIP';

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  if_launches_value_usd: number;
  implied_value_p25_usd: number;
  implied_value_p75_usd: number;
  token_odds: number;
  verdict: Verdict;
  farm_net_usd: number;
  farm_usd_per_hour: number;
  model: {
    fitted_multiple: number;
    token_odds: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row, farm plan included so the page and board.json agree exactly. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  if_launches_value_usd: number;
  implied_value_p25_usd: number;
  implied_value_p75_usd: number;
  token_odds: number;
  fitted_multiple: number;
  verdict: Verdict;
  farm_net_usd: number;
  farm_usd_per_hour: number;
  farm_fees_usd: number;
  farm_hours: number;
  farm_farmers: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One candidate term's held-out test: the leave-one-out error with it and without it. */
export interface TermResult {
  term: string;
  loo_with_median: number;
  loo_without_median: number;
  loo_with_mean: number;
  loo_without_mean: number;
  wf_with_median: number;
  wf_without_median: number;
  kept: boolean;
}

/** The fitted regression, with its held-out evidence, for the dashboard's model panel. */
export interface FitSummary {
  training_n: number;
  terms: string[];
  lambda: number;
  coefficients: { term: string; value: number }[];
  loo_median: number;
  loo_mean: number;
  loo_flat_median: number;
  wf_median: number;
  wf_mean: number;
  wf_flat_median: number;
  wf_train_n: number;
  wf_test_n: number;
  range_honesty: number;
  q25_log: number;
  q75_log: number;
  term_table: TermResult[];
}

/** One token-odds age bucket: the peers' record, shrunk toward the global share. */
export interface OddsBucket {
  label: string;
  n: number;
  with_token: number;
  rate: number;
  odds: number;
}

/** The token-odds model, with its Brier scores. */
export interface OddsSummary {
  global: number;
  buckets: OddsBucket[];
  brier: number;
  brier_loo: number;
  brier_base: number;
}

/** One protocol's place in the accounting: exactly one group covers all 758. */
export interface LedgerEntry {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  group: 'ranked' | 'has-token' | 'not-ranked';
  reason: string | null;
}

/** Everything the dashboard needs to recompute a row from the fitted model. */
export interface Recompute {
  terms: string[];
  coefficients: number[];
  mean_log_tvl: number;
  mean_log_age: number;
  mean_log_chains: number;
  median_age_days: number;
  categories: string[];
  odds_buckets: { lo: number; hi: number; odds: number }[];
  odds_global: number;
  q25_log: number;
  q75_log: number;
}

/** Everything the dashboard needs: the board, the live set, the fit, the odds, the ledger. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  fit: FitSummary;
  odds: OddsSummary;
  recompute: Recompute;
  verdicts: { farm: number; marginal: number; skip: number };
  ledger_counts: { ranked: number; has_token: number; not_ranked: number };
  watchlist: string[];
  rows: RadarRow[];
  live: LiveRow[];
  ledger: LedgerEntry[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Clamp `v` into [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records a token at all (market cap, CoinGecko id or symbol). */
export function hasToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return !hasToken(p);
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const round2 = (n: number): number => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- regression

/** A candidate term of the regression. */
type Term = 'logTvl' | 'logTvl2' | 'growth' | 'logAge' | 'cats' | 'recent' | 'logChains';
const ALL_TERMS: Term[] = ['logTvl', 'logTvl2', 'growth', 'logAge', 'cats', 'recent', 'logChains'];
/** The order terms are tested for dropping: the weakest candidates first. */
const TEST_ORDER: Term[] = ['logTvl2', 'growth', 'logChains', 'recent', 'cats', 'logAge', 'logTvl'];

/** The feature statistics the design matrix is centred on, fitted from the training set. */
interface FeatureStats {
  meanLogTvl: number;
  meanLogAge: number;
  meanLogChains: number;
  medianAge: number;
  categories: string[];
}

/** Solve A x = b by Gaussian elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i] as number]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c] as number) > Math.abs(M[piv]![c] as number)) piv = r;
    const tmp = M[c] as number[];
    M[c] = M[piv] as number[];
    M[piv] = tmp;
    const d = M[c]![c] as number;
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = (M[r]![c] as number) / d;
      for (let k = c; k <= n; k++) M[r]![k] = (M[r]![k] as number) - f * (M[c]![k] as number);
    }
  }
  return M.map((row, i) => ((row[i] as number) !== 0 ? (row[n] as number) / (row[i] as number) : 0));
}

/** One design row: intercept, then the terms in ALL_TERMS order, dummies last. */
function designRow(p: SnapshotProtocol, asOf: string, stats: FeatureStats, terms: Term[]): number[] {
  const row: number[] = [1];
  const lt = Math.log(p.tvl_usd) - stats.meanLogTvl;
  const age = ageDays(asOf, p.listed_at);
  if (terms.includes('logTvl')) row.push(lt);
  if (terms.includes('logTvl2')) row.push(lt * lt);
  if (terms.includes('growth')) row.push(clamp(finite(p.change_7d, 0), -50, 100) / 100);
  if (terms.includes('logAge')) row.push(Math.log((age ?? stats.medianAge) + 1) - stats.meanLogAge);
  if (terms.includes('logChains')) row.push(Math.log(p.chains.length) - stats.meanLogChains);
  if (terms.includes('recent')) row.push((age ?? stats.medianAge) < 365 ? 1 : 0);
  if (terms.includes('cats')) {
    const cat = p.category ?? 'Other';
    for (const c of stats.categories) row.push(cat === c ? 1 : 0);
  }
  return row;
}

/** The column labels of a design, in order: intercept, then the terms, dummies last. */
function designLabels(terms: Term[], stats: FeatureStats): string[] {
  const labels: string[] = ['intercept'];
  if (terms.includes('logTvl')) labels.push('logTvl');
  if (terms.includes('logTvl2')) labels.push('logTvl^2');
  if (terms.includes('growth')) labels.push('growth');
  if (terms.includes('logAge')) labels.push('logAge');
  if (terms.includes('logChains')) labels.push('logChains');
  if (terms.includes('recent')) labels.push('recent');
  if (terms.includes('cats')) for (const c of stats.categories) labels.push(`cat:${c}`);
  return labels;
}

/** Ridge fit: (X'X + λD)β = X'y, the intercept unpenalised. */
function ridgeFit(X: number[][], y: number[], lambda: number): number[] {
  const p = X[0]!.length;
  const XtX: number[][] = Array.from({ length: p }, () => Array(p).fill(0));
  const Xty: number[] = Array(p).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < p; a++) {
      Xty[a] = (Xty[a] as number) + (X[i]![a] as number) * (y[i] as number);
      for (let b = 0; b < p; b++) XtX[a]![b] = (XtX[a]![b] as number) + (X[i]![a] as number) * (X[i]![b] as number);
    }
  }
  for (let a = 1; a < p; a++) XtX[a]![a] = (XtX[a]![a] as number) + lambda;
  return solveLinear(XtX, Xty);
}

/**
 * Leave-one-out errors by the PRESS shortcut: e_i / (1 - h_ii), exact for a linear fit at a fixed
 * penalty. The hat diagonal comes from the inverse of X'X + λD, solved column by column.
 */
function looErrors(X: number[][], y: number[], lambda: number): number[] {
  const p = X[0]!.length;
  const XtX: number[][] = Array.from({ length: p }, () => Array(p).fill(0));
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) XtX[a]![b] = (XtX[a]![b] as number) + (X[i]![a] as number) * (X[i]![b] as number);
  }
  for (let a = 1; a < p; a++) XtX[a]![a] = (XtX[a]![a] as number) + lambda;
  const invCols: number[][] = [];
  for (let j = 0; j < p; j++) {
    const e = Array(p).fill(0);
    e[j] = 1;
    invCols.push(solveLinear(XtX.map((r) => [...r]), e));
  }
  const beta = ridgeFit(X, y, lambda);
  const errs: number[] = [];
  for (let i = 0; i < X.length; i++) {
    let h = 0;
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) h += (X[i]![a] as number) * (invCols[b]![a] as number) * (X[i]![b] as number);
    const pred = (X[i] as number[]).reduce((s, v, k) => s + v * (beta[k] as number), 0);
    errs.push(((y[i] as number) - pred) / (1 - Math.min(h, 0.999)));
  }
  return errs;
}

const medianAbs = (errs: number[]): number => {
  const a = errs.map(Math.abs).sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)] as number;
};
const meanAbs = (errs: number[]): number => errs.reduce((s, v) => s + Math.abs(v), 0) / errs.length;

/** The live protocols the regression trains on: market cap known, TVL above zero, no CEX, no versioned pool. */
function trainingSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && (p.mcap_usd as number) > 0 && p.tvl_usd > 0 && p.category !== 'CEX' && !VERSIONED.test(p.name))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** The fitted regression and every held-out number the dashboard reports. */
export interface Fit {
  summary: FitSummary;
  coefficients: number[];
  stats: FeatureStats;
  terms: Term[];
  lambda: number;
}

export function fitModel(snapshot: Snapshot, model: ModelConstants = MODEL): Fit {
  const train = trainingSet(snapshot);
  if (train.length < 20) throw new SnapshotError(`only ${train.length} live protocols to fit on`);
  const y = train.map((p) => Math.log((p.mcap_usd as number) / p.tvl_usd));
  const logTvls = train.map((p) => Math.log(p.tvl_usd));
  const meanLogTvl = logTvls.reduce((a, b) => a + b, 0) / logTvls.length;
  const ages = train.map((p) => ageDays(snapshot.as_of, p.listed_at));
  const knownAges = ages.filter((a): a is number => a !== null).sort((a, b) => a - b);
  const medianAge = knownAges[Math.floor(knownAges.length / 2)] as number;
  const logAges = ages.map((a) => Math.log((a ?? medianAge) + 1));
  const meanLogAge = logAges.reduce((a, b) => a + b, 0) / logAges.length;
  const logChains = train.map((p) => Math.log(p.chains.length));
  const meanLogChains = logChains.reduce((a, b) => a + b, 0) / logChains.length;
  const catCount = new Map<string, number>();
  for (const p of train) {
    const c = p.category ?? 'Other';
    catCount.set(c, (catCount.get(c) ?? 0) + 1);
  }
  const categories = [...catCount.entries()]
    .filter(([, n]) => n >= model.category_min_live)
    .map(([c]) => c)
    .sort();
  const stats: FeatureStats = { meanLogTvl, meanLogAge, meanLogChains, medianAge, categories };
  const X = (terms: Term[]): number[][] => train.map((p) => designRow(p, snapshot.as_of, stats, terms));

  // The walk-forward split, up front: the oldest 70% by listing date train, the newest 30% test.
  const byAge = train
    .map((p, i) => ({ i, age: ageDays(snapshot.as_of, p.listed_at) }))
    .sort((a, b) => (b.age ?? -1) - (a.age ?? -1) || (train[a.i]!.slug < train[b.i]!.slug ? -1 : 1));
  const nTrain = Math.floor((byAge.length * 7) / 10);
  const trIdx = byAge.slice(0, nTrain).map((x) => x.i);
  const teIdx = byAge.slice(nTrain).map((x) => x.i);

  // The ridge penalty, picked by leave-one-out median error over the grid on the full model.
  let lambda = model.lambda_grid[0] as number;
  let best = Infinity;
  for (const l of model.lambda_grid) {
    const e = medianAbs(looErrors(X(ALL_TERMS), y, l));
    if (e < best) {
      best = e;
      lambda = l;
    }
  }

  // Sequential term selection: drop a term unless dropping it worsens a held-out error —
  // leave-one-out (median or mean) or walk-forward (median) — by more than half a percent.
  // Each test is recorded for the evidence table. The walk-forward leg matters: a term that
  // only helps across cohorts (a recent listing prices differently from an old one) looks
  // useless to leave-one-out, which mixes the cohorts.
  let terms: Term[] = [...ALL_TERMS];
  const termTable: TermResult[] = [];
  const wfErr = (ts: Term[]): number[] => {
    const b = ridgeFit(
      trIdx.map((i) => designRow(train[i] as SnapshotProtocol, snapshot.as_of, stats, ts)),
      trIdx.map((i) => y[i] as number),
      lambda,
    );
    return teIdx.map((i) => {
      const pred = designRow(train[i] as SnapshotProtocol, snapshot.as_of, stats, ts).reduce((s, v, k) => s + v * (b[k] as number), 0);
      return (y[i] as number) - pred;
    });
  };
  for (const t of TEST_ORDER) {
    const without = terms.filter((x) => x !== t);
    const eWith = looErrors(X(terms), y, lambda);
    const eWithout = looErrors(X(without), y, lambda);
    const wWith = wfErr(terms);
    const wWithout = wfErr(without);
    const kept = medianAbs(eWithout) > medianAbs(eWith) * 1.005 || meanAbs(eWithout) > meanAbs(eWith) * 1.005 || medianAbs(wWithout) > medianAbs(wWith) * 1.005;
    termTable.push({
      term: t,
      loo_with_median: round4(medianAbs(eWith)),
      loo_without_median: round4(medianAbs(eWithout)),
      loo_with_mean: round4(meanAbs(eWith)),
      loo_without_mean: round4(meanAbs(eWithout)),
      wf_with_median: round4(medianAbs(wWith)),
      wf_without_median: round4(medianAbs(wWithout)),
      kept,
    });
    if (!kept) terms = without;
  }

  const coefficients = ridgeFit(X(terms), y, lambda);
  const labels = designLabels(terms, stats);
  const eLoo = looErrors(X(terms), y, lambda);
  const sorted = [...eLoo].sort((a, b) => a - b);
  const q25 = sorted[Math.floor(sorted.length * 0.25)] as number;
  const q75 = sorted[Math.floor(sorted.length * 0.75)] as number;
  let inside = 0;
  for (let i = 0; i < train.length; i++) {
    const pred = (y[i] as number) - (eLoo[i] as number);
    if ((y[i] as number) >= pred + q25 && (y[i] as number) <= pred + q75) inside++;
  }
  const flatLoo = medianAbs(looErrors(X([]), y, lambda));

  // Walk-forward: fit on the oldest 70% by listing date, test on the newest 30%.
  const betaWf = ridgeFit(
    trIdx.map((i) => designRow(train[i] as SnapshotProtocol, snapshot.as_of, stats, terms)),
    trIdx.map((i) => y[i] as number),
    lambda,
  );
  const wfErrs = teIdx.map((i) => {
    const pred = designRow(train[i] as SnapshotProtocol, snapshot.as_of, stats, terms).reduce((s, v, k) => s + v * (betaWf[k] as number), 0);
    return (y[i] as number) - pred;
  });
  const trainY = trIdx.map((i) => y[i] as number).sort((a, b) => a - b);
  const flatPred = trainY[Math.floor(trainY.length / 2)] as number;
  const wfFlat = medianAbs(teIdx.map((i) => (y[i] as number) - flatPred));

  const summary: FitSummary = {
    training_n: train.length,
    terms: [...terms],
    lambda,
    coefficients: labels.map((term, i) => ({ term, value: round4(coefficients[i] as number) })),
    loo_median: round4(medianAbs(eLoo)),
    loo_mean: round4(meanAbs(eLoo)),
    loo_flat_median: round4(flatLoo),
    wf_median: round4(medianAbs(wfErrs)),
    wf_mean: round4(meanAbs(wfErrs)),
    wf_flat_median: round4(wfFlat),
    wf_train_n: trIdx.length,
    wf_test_n: teIdx.length,
    range_honesty: round4(inside / train.length),
    q25_log: round4(q25),
    q75_log: round4(q75),
    term_table: termTable,
  };
  return { summary, coefficients, stats, terms, lambda };
}

// ---------------------------------------------------------------- token odds

/** The age buckets the token odds are read from, in days. */
const ODDS_BUCKETS: { lo: number; hi: number; label: string }[] = [
  { lo: 0, hi: 180, label: 'under 6 months' },
  { lo: 180, hi: 365, label: '6–12 months' },
  { lo: 365, hi: 730, label: '1–2 years' },
  { lo: 730, hi: 1500, label: '2–4 years' },
  { lo: 1500, hi: Number.POSITIVE_INFINITY, label: 'over 4 years' },
];

/** The token-odds model: per-bucket shares, shrunk toward the global share. */
export interface OddsModel {
  summary: OddsSummary;
  buckets: { lo: number; hi: number; odds: number }[];
  global: number;
}

export function oddsModel(snapshot: Snapshot, model: ModelConstants = MODEL): OddsModel {
  const global = snapshot.protocols.filter(hasToken).length / snapshot.protocols.length;
  const buckets: OddsBucket[] = ODDS_BUCKETS.map((b) => {
    const ps = snapshot.protocols.filter((p) => {
      const a = ageDays(snapshot.as_of, p.listed_at);
      return a !== null && a >= b.lo && a < b.hi;
    });
    const k = ps.filter(hasToken).length;
    const rate = ps.length > 0 ? k / ps.length : global;
    const odds = (k + model.odds_shrinkage * global) / (ps.length + model.odds_shrinkage);
    return { label: b.label, n: ps.length, with_token: k, rate: round4(rate), odds: round4(odds) };
  });
  const oddsOf = (p: SnapshotProtocol, exclude: SnapshotProtocol | null): number => {
    const a = ageDays(snapshot.as_of, p.listed_at);
    if (a === null) return global;
    for (let i = 0; i < ODDS_BUCKETS.length; i++) {
      const b = ODDS_BUCKETS[i] as { lo: number; hi: number; label: string };
      if (a >= b.lo && a < b.hi) {
        let n = (buckets[i] as OddsBucket).n;
        let k = (buckets[i] as OddsBucket).with_token;
        if (exclude !== null) {
          n -= 1;
          if (hasToken(exclude)) k -= 1;
        }
        return (k + model.odds_shrinkage * global) / (n + model.odds_shrinkage);
      }
    }
    return global;
  };
  let brier = 0;
  let brierLoo = 0;
  let brierBase = 0;
  for (const p of snapshot.protocols) {
    const t = hasToken(p) ? 1 : 0;
    brier += (oddsOf(p, null) - t) ** 2;
    brierLoo += (oddsOf(p, p) - t) ** 2;
    brierBase += (global - t) ** 2;
  }
  const n = snapshot.protocols.length;
  return {
    summary: {
      global: round4(global),
      buckets,
      brier: round4(brier / n),
      brier_loo: round4(brierLoo / n),
      brier_base: round4(brierBase / n),
    },
    // The open-ended bucket's cap is finite: Infinity serialises to null in JSON, which would
    // break the dashboard's bucket lookup, and no protocol is a million days old.
    buckets: ODDS_BUCKETS.map((b, i) => ({ lo: b.lo, hi: Number.isFinite(b.hi) ? b.hi : 999999, odds: (buckets[i] as OddsBucket).odds })),
    global,
  };
}

/** One protocol's token odds from its age bucket; unknown age takes the global share. */
export function tokenOdds(p: SnapshotProtocol, asOf: string, odds: OddsModel): number {
  const a = ageDays(asOf, p.listed_at);
  if (a === null) return odds.global;
  for (const b of odds.buckets) if (a >= b.lo && a < b.hi) return b.odds;
  return odds.global;
}

// ---------------------------------------------------------------- implied value

/** The fitted multiple and the implied value one protocol gets. */
export function impliedValue(
  protocol: SnapshotProtocol,
  snapshot: Snapshot,
  fit: Fit,
  odds: OddsModel,
  model: ModelConstants = MODEL,
): { implied: number; ifLaunches: number; p25: number; p75: number; multiple: number; odds: number; age: number | null } {
  const age = ageDays(snapshot.as_of, protocol.listed_at);
  const row = designRow(protocol, snapshot.as_of, fit.stats, fit.terms);
  const logMultiple = row.reduce((s, v, k) => s + v * (fit.coefficients[k] as number), 0);
  const multiple = clamp(Math.exp(logMultiple), model.multiple_floor, model.multiple_cap);
  const o = tokenOdds(protocol, snapshot.as_of, odds);
  const ifLaunches = Math.max(1, Math.round(protocol.tvl_usd * multiple));
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * o));
  const p25 = Math.max(1, Math.round(implied * Math.exp(fit.summary.q25_log)));
  const p75 = Math.max(1, Math.round(implied * Math.exp(fit.summary.q75_log)));
  return { implied, ifLaunches, p25, p75, multiple: round4(multiple), odds: round4(o), age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; fit: Fit; odds: OddsModel } {
  const fit = fitModel(snapshot, model);
  const odds = oddsModel(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the watchlist floor, by TVL, capped.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot, fit, odds, model);
    const econ = farmEconomics(p, v.p25, v.age, model);
    return { p, ...v, ...econ };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    if_launches_value_usd: s.ifLaunches,
    implied_value_p25_usd: s.p25,
    implied_value_p75_usd: s.p75,
    token_odds: s.odds,
    verdict: s.verdict,
    farm_net_usd: s.net,
    farm_usd_per_hour: s.perHour,
    model: {
      fitted_multiple: s.multiple,
      token_odds: s.odds,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
  return { board, fit, odds };
}

// ---------------------------------------------------------------- farm plans

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Gas tier of a chain: mainnet is dear, rollups and fast chains are cheap. */
function gasFor(chain: string): { setup: string; weekly: string } {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return { setup: 'about $8 of gas', weekly: 'about $3 of gas a week' };
  if (c === 'solana' || c === 'sui' || c === 'aptos' || c === 'near') return { setup: 'under $0.20 of fees', weekly: 'a few cents of fees a week' };
  if (c === 'bitcoin' || c === 'lightning') return { setup: 'about $2 of fees', weekly: 'about $1 of fees a week' };
  return { setup: 'under $1 of gas', weekly: 'under $1 of gas a week' };
}

/** The same gas tier as numbers, for the farm economics. */
function gasUsd(chain: string): { setup: number; weekly: number } {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return { setup: 8, weekly: 3 };
  if (c === 'solana' || c === 'sui' || c === 'aptos' || c === 'near') return { setup: 0.2, weekly: 0.05 };
  if (c === 'bitcoin' || c === 'lightning') return { setup: 2, weekly: 1 };
  return { setup: 1, weekly: 1 };
}

/** The category's core action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and, if it offers borrowing, borrow a small amount against it so both sides of the position are active.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the position in range.`;
  if (c.includes('yield aggregator') || c.includes('yield')) return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and leave the yield compounding.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC through ${name} to ${chain}, then use the bridged funds in the destination app instead of bridging straight back.`;
  if (c.includes('restak') || c.includes('staking') || c.includes('staking pool') || c.includes('liquid staking')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name}, open one small hedged position, and close it after a week.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and take one position in a market that settles within the month.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares in the farming wallet.`;
  if (c.includes('stablecoin') || c.includes('stable')) return `Mint or hold $${capital} of the stable asset ${name} issues on ${chain} and keep it in the farming wallet.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it through at least one payout cycle.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the full term.`;
  if (c.includes('governance')) return `Deposit $${capital} into ${name}'s rewards pool on ${chain} and vote once in its next governance round.`;
  if (c.includes('chain') || c.includes('payments')) return `Move $${capital} onto ${name}'s chain and make one real transaction a week: a swap, a transfer or a contract call.`;
  if (c.includes('farm')) return `Deposit $${capital} into ${name}'s main farm on ${chain} and claim the rewards weekly instead of letting them sit.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and hold through one funding cycle.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The weekly upkeep action for the category. */
function upkeepFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) return 'Make one qualifying action each week: a deposit, a borrow, a repayment or a vote.';
  if (c.includes('dex') || c.includes('yield')) return 'Touch the position once a week: add or remove a little liquidity, or claim and restake the rewards.';
  if (c.includes('bridge')) return 'Bridge a small amount once a week, in a different direction or asset than the week before.';
  if (c.includes('staking') || c.includes('restak')) return 'Check the position weekly and restake any rewards instead of letting them sit unclaimed.';
  if (c.includes('perpetual') || c.includes('derivative')) return 'Open and close one small position each week so the account shows steady activity.';
  if (c.includes('governance')) return 'Vote in every governance round and keep the deposit in place between rounds.';
  return 'Make one qualifying action each week, such as a deposit, a swap or a vote.';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: 'under $3 for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas.setup}`,
      time: '15 minutes to set up',
    },
    {
      text: upkeepFor(p),
      cost: gas.weekly,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** One farm position's economics, priced on the P25 value: fees, hours, expected share, verdict. */
export function farmEconomics(
  p: SnapshotProtocol,
  p25Value: number,
  age: number | null,
  model: ModelConstants = MODEL,
): { fees: number; hours: number; farmers: number; ev: number; net: number; perHour: number; verdict: Verdict } {
  const hold = holdDaysFor(age);
  const weeks = hold / 7;
  const gas = gasUsd(chainOf(p));
  const fees = round2(gas.setup + gas.weekly * weeks);
  const hours = round2(0.75 + 0.17 * weeks);
  const farmers = Math.min(model.farmers_max, Math.max(model.farmers_min, Math.round(p.tvl_usd * model.farmers_per_tvl_usd)));
  const ev = round2((p25Value * model.airdrop_share) / farmers);
  const net = round2(ev - fees);
  const perHour = round2(net / hours);
  const verdict: Verdict = net >= model.verdict_net_min && perHour >= model.verdict_hourly_min ? 'FARM' : net >= 0 ? 'MARGINAL' : 'SKIP';
  return { fees, hours, farmers, ev, net, perHour, verdict };
}

// ---------------------------------------------------------------- ledger

/** Every protocol in exactly one group: ranked, records a token, or pre-token and not ranked. */
export function buildLedger(snapshot: Snapshot, boardSlugs: Set<string>): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  for (const p of snapshot.protocols) {
    if (boardSlugs.has(p.slug)) {
      entries.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, group: 'ranked', reason: null });
    } else if (hasToken(p)) {
      entries.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, group: 'has-token', reason: null });
    } else if (p.category === 'CEX') {
      entries.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, group: 'not-ranked', reason: 'exchange' });
    } else if (VERSIONED.test(p.name)) {
      entries.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, group: 'not-ranked', reason: 'versioned pool of another protocol' });
    } else if (p.tvl_usd >= snapshot.floor_usd) {
      entries.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, group: 'not-ranked', reason: 'above the floor, not named by the watchlist' });
    } else {
      entries.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, group: 'not-ranked', reason: 'below the top-160 TVL cut' });
    }
  }
  entries.sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  return entries;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's form for data.js, farm plan included. */
export function radarRow(row: BoardRow, snapshot: Snapshot, model: ModelConstants = MODEL): RadarRow {
  const p = snapshot.protocols.find((x) => x.slug === row.slug) as SnapshotProtocol;
  const econ = farmEconomics(p, row.implied_value_p25_usd, row.age_days, model);
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    if_launches_value_usd: row.if_launches_value_usd,
    implied_value_p25_usd: row.implied_value_p25_usd,
    implied_value_p75_usd: row.implied_value_p75_usd,
    token_odds: row.token_odds,
    fitted_multiple: row.model.fitted_multiple,
    verdict: row.verdict,
    farm_net_usd: row.farm_net_usd,
    farm_usd_per_hour: row.farm_usd_per_hour,
    farm_fees_usd: econ.fees,
    farm_hours: econ.hours,
    farm_farmers: econ.farmers,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, fit, odds } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const ledger = buildLedger(snapshot, new Set(board.map((r) => r.slug)));
  const verdicts = { farm: 0, marginal: 0, skip: 0 };
  for (const r of board) {
    if (r.verdict === 'FARM') verdicts.farm++;
    else if (r.verdict === 'MARGINAL') verdicts.marginal++;
    else verdicts.skip++;
  }
  const ledgerCounts = { ranked: 0, has_token: 0, not_ranked: 0 };
  for (const e of ledger) {
    if (e.group === 'ranked') ledgerCounts.ranked++;
    else if (e.group === 'has-token') ledgerCounts.has_token++;
    else ledgerCounts.not_ranked++;
  }
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    fit: fit.summary,
    odds: odds.summary,
    recompute: {
      terms: [...fit.terms],
      // Six decimals: the dashboard's recompute must land within 0.1% of the board's values.
      coefficients: fit.coefficients.map((c) => round6(c)),
      mean_log_tvl: round6(fit.stats.meanLogTvl),
      mean_log_age: round6(fit.stats.meanLogAge),
      mean_log_chains: round6(fit.stats.meanLogChains),
      median_age_days: fit.stats.medianAge,
      categories: fit.stats.categories,
      odds_buckets: odds.buckets,
      odds_global: round4(odds.global),
      q25_log: fit.summary.q25_log,
      q75_log: fit.summary.q75_log,
    },
    verdicts,
    ledger_counts: ledgerCounts,
    watchlist: snapshot.watchlist,
    rows: board.map((r) => radarRow(r, snapshot, model)),
    live,
    ledger,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not a snapshot protocol`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (!Number.isSafeInteger(r.if_launches_value_usd) || r.if_launches_value_usd <= 0) return `${r.slug} has if-launches value ${r.if_launches_value_usd}`;
    if (!(r.token_odds > 0 && r.token_odds <= 1)) return `${r.slug} has token odds ${r.token_odds}`;
    if (!(r.implied_value_p25_usd <= r.implied_value_usd && r.implied_value_usd <= r.implied_value_p75_usd)) return `${r.slug} has a range that does not bracket its value`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
