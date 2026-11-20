// Token Radar's model, radar-2: one sealed snapshot in, one ranked board out.
//
// The board ranks protocols that record no token, by an implied value that is this
// entry's own claim — never a prediction of whether or when a token is issued, and
// never a price. The value follows only from the snapshot's own figures:
//
//   base     = tvl_usd x 0.18
//   growth   = clamp(change_7d, -80, +150) per cent
//   growth   = 1 + (growth / 100) x 0.65
//   maturity = 0.5 + min(age_days, 1460) / 1460 x 0.7   (age unknown: 270 days)
//   breadth  = 1 + min(chains - 1, 3) x 0.02
//   implied  = max(1, round(base x growth x maturity x breadth))
//
// Why these shapes: TVL is the size of the prize; seven-day growth rewards momentum
// but is clamped hard, because one week of +4,448% (the snapshot's largest move) is
// noise, not value; age with no token is the long wait the launch would pay for, so
// a protocol listed 4 years ago scores up to 1.2 while a 45-day-old one scores 0.52;
// chain breadth is a small bonus, because a launch on more chains reaches more
// wallets. No protocol name is ever special-cased: one function scores every row.
//
// Selection: the snapshot's 40 watchlist slugs are the floor — all of them are in.
// Below the floor, every protocol that passes the house's full no-token definition
// (no token on record, not a bridge / liquid-staking / restaking / CEX product, no
// version marker, no wrapped/staked word, no exchange name) is added, then the
// largest remaining pre-token protocols top the board up to 160 early rows. Rows
// from that second group carry strict_definition: false, so the dashboard can say
// plainly which rows meet the full definition and which only record no token.

/** One protocol of the sealed snapshot: exactly its ten fields. */
export interface Protocol {
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

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** The radar-2 constants. The dashboard shows them and its sandbox can change them. */
export interface Model {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_step: number;
  breadth_max_extra: number;
}

export const MODEL: Model = {
  base_multiple: 0.18,
  growth_weight: 0.65,
  growth_floor: -80,
  growth_cap: 150,
  maturity_floor: 0.5,
  maturity_range: 0.7,
  maturity_days: 1460,
  unknown_age_days: 270,
  breadth_step: 0.02,
  breadth_max_extra: 3,
};

/** The model's version label, shown by the dashboard. */
export const MODEL_VERSION = 'radar-2';

/** How many early (below-floor) rows the board carries on top of the watchlist. */
export const EARLY_TARGET = 160;

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_COUNT = 24;

/** One farm step: the action, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

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
  strict_definition: boolean;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One board row, compact, for the dashboard's data.js. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  strict_definition: boolean;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
}

/** A protocol whose token already trades: the market's value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: Model;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  extended_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot cannot be scored. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, at least 0; null when the date is missing or bad. */
export function daysListed(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The score of one protocol: implied value and every multiplier that made it. */
export function scoreProtocol(
  p: Protocol,
  asOf: string,
  model: Model = MODEL,
): { value: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = daysListed(asOf, p.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, num(p.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageUsed = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageUsed, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_extra);
  const breadthMult = 1 + extraChains * model.breadth_step;
  const value = Math.max(1, Math.round(p.tvl_usd * model.base_multiple * growthMult * maturityMult * breadthMult));
  return { value, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** A name ending in a version marker is a pool of another protocol, not a protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that mark a wrapped, staked or bridged product of a traded token. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a protocol name must not start with. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether the snapshot records no token for the protocol at all. */
export function recordsNoToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether the protocol passes the house's full no-token definition (see ANALYSIS.md). */
export function passesStrictDefinition(p: Protocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** Whether the protocol may be ranked below the floor: pre-token, not an exchange, not a versioned pool. */
export function isEarlyCandidate(p: Protocol): boolean {
  return recordsNoToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The board's rows, ranked 1..N by implied value, ties broken by slug so the order is stable. */
export function buildBoard(snapshot: Snapshot, model: Model = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const picked = new Map<string, Protocol>();
  const strictFlags = new Map<string, boolean>();

  // The watchlist is the floor: every slug in it, in snapshot order.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) {
      picked.set(slug, p);
      strictFlags.set(slug, passesStrictDefinition(p));
    }
  }
  // Early radar, first pass: every below-floor protocol that passes the full
  // definition, largest TVL first. Second pass: the largest remaining candidates
  // top the early rows up to EARLY_TARGET; they are flagged, not hidden.
  const below = snapshot.protocols.filter((p) => !picked.has(p.slug) && p.tvl_usd < snapshot.floor_usd);
  const byTvl = (a: Protocol, b: Protocol): number => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  const strictEarly = below.filter(passesStrictDefinition).sort(byTvl);
  for (const p of strictEarly) {
    picked.set(p.slug, p);
    strictFlags.set(p.slug, true);
  }
  const earlySoFar = picked.size - snapshot.watchlist.length;
  const extended = below.filter((p) => !picked.has(p.slug) && isEarlyCandidate(p)).sort(byTvl).slice(0, Math.max(0, EARLY_TARGET - earlySoFar));
  for (const p of extended) {
    picked.set(p.slug, p);
    strictFlags.set(p.slug, false);
  }

  const scored = [...picked.values()].map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.s.value - a.s.value || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((row, i) => ({
    rank: i + 1,
    slug: row.p.slug,
    name: row.p.name,
    category: row.p.category,
    chains: row.p.chains,
    tvl_usd: row.p.tvl_usd,
    change_7d: row.p.change_7d,
    mcap_usd: row.p.mcap_usd,
    listed_at: row.p.listed_at,
    gecko_id: row.p.gecko_id,
    symbol: row.p.symbol,
    token_status: 'pre-token' as const,
    age_days: row.s.age,
    strict_definition: strictFlags.get(row.p.slug) ?? false,
    implied_value_usd: row.s.value,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: row.s.growthPct,
      growth_multiplier: round4(row.s.growthMult),
      maturity_multiplier: round4(row.s.maturityMult),
      breadth_multiplier: round4(row.s.breadthMult),
      age_days: row.s.age,
    },
    farm_steps: farmPlan(row.p, row.s.age).map(renderStep),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** One step as a single string: the action, then its cost and time. */
export function renderStep(step: FarmStep): string {
  let s = `${step.text} (Cost: ${step.cost}; time: ${step.time}.)`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} (Keep the position and check the protocol's own page.)`;
  return s;
}

/** The first chain the protocol names, or a neutral phrase. */
function firstChain(p: Protocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: Protocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: the younger it is, the longer the window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 30;
}

/** The one action that fits the protocol's category, in words a farmer can follow. */
function actionFor(p: Protocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC on ${name} (${chain}) and leave the loan open`;
  if (c.includes('dex') || c.includes('liquidity')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and hold the LP position`;
  if (c.includes('bridge')) return `Move $${capital} of USDC to ${chain} through ${name}, then put the bridged funds to work in its app`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's native staking asset through ${name} and keep the receipt token`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Post $${capital} of USDC as margin on ${name} and open a single small hedged position`;
  if (c.includes('yield') || c.includes('farm')) return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and leave it compounding`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Allocate $${capital} to a ${name} vault on ${chain} and keep the vault shares`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and take one position in an open market`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. Every
 * step is derived from the protocol's own record (category, chains, TVL, age) — no
 * name is ever special-cased, and no step claims data the snapshot does not carry.
 */
export function farmPlan(p: Protocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    { text: 'Open a fresh wallet for this farm only and store its seed phrase offline, never in a screenshot or a chat', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, time: '15 minutes to set up' },
    { text: 'Do a second, different qualifying action — a swap, a borrow, a vote or a deposit — so the wallet shows more than one interaction', cost: 'about $2 of gas', time: '10 minutes' },
    { text: 'Repeat one qualifying action every week while the position is open', cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Keep the position open for at least ${hold} days so it is counted in more than one snapshot`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: "Check the protocol's own points or rewards page before withdrawing, and claim only from a link the protocol itself publishes", cost: 'free to check; never pay to claim', time: '10 minutes' },
    { text: 'Record the wallet, the dates and every transaction in a farm log, then plan the exit: withdraw in two steps and leave a little gas behind', cost: 'nothing but the log', time: '5 minutes' },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_COUNT)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

/** One board row in the dashboard's compact form. */
function toRadarRow(row: BoardRow, onWatchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: onWatchlist,
    strict_definition: row.strict_definition,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: Model = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const extended = board.filter((r) => !snapshot.watchlist.includes(r.slug) && !r.strict_definition).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    extended_size: extended,
    live_size: live.length,
    rows: board.map((r) => toRadarRow(r, snapshot.watchlist.includes(r.slug))),
    live,
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
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, steps. */
export function boardProblem(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const n = s.trim().length;
      if (n < 20 || n > 600) return `${r.slug} has a farm step of ${n} characters`;
    }
  }
  return null;
}

/** The dashboard's dataset as one script: window.RADAR, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
