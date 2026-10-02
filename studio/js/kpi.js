// KPI engine. Rule from the handoff: aggregate with the RATIO OF SUMS, never
// the mean of per-post ratios. Every KPI returns {value, num, den, posts} so
// the UI can show the sample behind each number.
//
// Inputs are "rows": one per post, built by postRow() from the latest
// snapshot of each metrics source for that post.

/** Merge the latest snapshot of each source into one row for a post. */
export function postRow(post, latestBySource) {
  const r = {
    post_id: post.id, reel_id: post.reel_id, platform: post.platform, post_type: post.post_type,
    published_at: post.published_at,
    views: null, reach: null, impressions: null, likes: null, comments: null, shares: null, saves: null,
    follows: null, profile_visits: null, link_clicks: null, three_s_views: null, thruplays: null,
    completions: null, avg_watch_s: null, total_watch_s: null, skip_rate: null, spend_usd: null, installs: null,
  };
  // Platform sources first, App Store installs last (they only add installs).
  const sources = Object.values(latestBySource).sort((a, b) =>
    (a.source === "asc_reports") - (b.source === "asc_reports"));
  for (const s of sources) {
    for (const k of Object.keys(r)) {
      if (["post_id", "reel_id", "platform", "post_type", "published_at"].includes(k)) continue;
      if (s[k] == null) continue;
      if (s.source === "asc_reports" && k !== "installs") continue;
      // installs can come from ads (attributed) and ASC (campaign link); take the larger, never add (double count).
      if (k === "installs" && r.installs != null) r.installs = Math.max(r.installs, Number(s[k]));
      else r[k] = Number(s[k]);
    }
  }
  if (r.total_watch_s == null && r.avg_watch_s != null && r.views != null) r.total_watch_s = r.avg_watch_s * r.views;
  return r;
}

function ratio(rows, numFn, denFn) {
  let num = 0, den = 0, posts = 0;
  for (const r of rows) {
    const n = numFn(r), d = denFn(r);
    if (n == null || d == null || !Number.isFinite(n) || !Number.isFinite(d) || d <= 0) continue;
    num += n;
    den += d;
    posts += 1;
  }
  return { value: den > 0 ? num / den : null, num, den, posts };
}

function sum(rows, fn) {
  let total = 0, posts = 0;
  for (const r of rows) {
    const v = fn(r);
    if (v == null || !Number.isFinite(v)) continue;
    total += v;
    posts += 1;
  }
  return { value: posts ? total : null, num: total, den: null, posts };
}

// Hook rate: 3-second views / impressions (ads), or 1 - skip rate (Instagram
// organic, where reels_skip_rate is the share of plays skipped in the first 3 s).
function hookNum(r) {
  if (r.three_s_views != null && r.impressions != null) return r.three_s_views;
  if (r.skip_rate != null && r.views != null) return r.views * (1 - r.skip_rate);
  return null;
}
function hookDen(r) {
  if (r.three_s_views != null && r.impressions != null) return r.impressions;
  if (r.skip_rate != null && r.views != null) return r.views;
  return null;
}

export const KPIS = [
  { key: "hook_rate", label: "Hook rate", fmt: "pct", target: "hook_rate", rate: true, denLabel: "impressions or views",
    help: "3-second views ÷ impressions (ads), or 1 − skip rate (Instagram). Ratio of sums.",
    calc: (rows) => ratio(rows, hookNum, hookDen) },
  { key: "hold_rate", label: "Hold rate", fmt: "pct", target: "hold_rate", rate: true, denLabel: "3s views",
    help: "ThruPlays ÷ 3-second views (Meta Ads; ThruPlay = 15 s or complete).",
    calc: (rows) => ratio(rows, (r) => r.thruplays, (r) => (r.thruplays != null ? r.three_s_views : null)) },
  { key: "completion_rate", label: "Completion", fmt: "pct", rate: true, denLabel: "views",
    help: "Completed views ÷ views, where the platform reports completions.",
    calc: (rows) => ratio(rows, (r) => r.completions, (r) => (r.completions != null ? r.views : null)) },
  { key: "avg_watch_s", label: "Avg watch", fmt: "sec", denLabel: "views",
    help: "Total watch time ÷ views.",
    calc: (rows) => ratio(rows, (r) => r.total_watch_s, (r) => (r.total_watch_s != null ? r.views : null)) },
  { key: "share_rate", label: "Share rate", fmt: "pct", rate: true, denLabel: "views",
    help: "Shares ÷ views. Instagram ranks reels on reshares.",
    calc: (rows) => ratio(rows, (r) => r.shares, (r) => (r.shares != null ? r.views : null)) },
  { key: "save_rate", label: "Save rate", fmt: "pct", rate: true, denLabel: "views",
    help: "Saves ÷ views.",
    calc: (rows) => ratio(rows, (r) => r.saves, (r) => (r.saves != null ? r.views : null)) },
  { key: "follows", label: "Follows", fmt: "int", help: "Follows attributed to the post, where reported.",
    calc: (rows) => sum(rows, (r) => r.follows) },
  { key: "link_clicks", label: "Link clicks", fmt: "int", help: "Link clicks (ads, bio links where reported).",
    calc: (rows) => sum(rows, (r) => r.link_clicks) },
  { key: "installs_per_1k", label: "Installs / 1k views", fmt: "num2", rate: true, denLabel: "views",
    help: "1000 × installs ÷ views. Installs from App Store campaign links (ct) and Meta Ads.",
    calc: (rows) => {
      const x = ratio(rows, (r) => r.installs, (r) => (r.installs != null ? r.views : null));
      return { ...x, value: x.value == null ? null : x.value * 1000 };
    } },
  { key: "cpi", label: "CPI", fmt: "usd", target: "cpi", lowerIsBetter: true, denLabel: "installs",
    help: "Spend ÷ installs (paid only).",
    calc: (rows) => ratio(rows, (r) => r.spend_usd, (r) => (r.spend_usd != null ? r.installs : null)) },
  { key: "views", label: "Views", fmt: "int", help: "Total views.", calc: (rows) => sum(rows, (r) => r.views) },
  { key: "spend", label: "Spend", fmt: "usd", help: "Total ad spend.", calc: (rows) => sum(rows, (r) => r.spend_usd) },
];

export function computeAll(rows) {
  return Object.fromEntries(KPIS.map((k) => [k.key, k.calc(rows)]));
}

/** Group rows by a key function and compute every KPI per group. */
export function breakdown(rows, keyFn) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyFn(r) ?? "(none)";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.entries()].map(([key, rs]) => ({ key, n: rs.length, kpis: computeAll(rs) }));
}

/** ISO week label, e.g. 2026-W40 */
export function isoWeek(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const w = Math.ceil(((t - y0) / 864e5 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, "0")}`;
}

/**
 * Two-proportion z-test for "what's winning": is group A's rate different
 * from the rest? Returns {z, p, lift}. Used only as a caveat, never as proof.
 */
export function proportionTest(numA, denA, numB, denB) {
  if (!(denA > 0 && denB > 0)) return null;
  const pA = numA / denA, pB = numB / denB;
  const p = (numA + numB) / (denA + denB);
  const se = Math.sqrt(p * (1 - p) * (1 / denA + 1 / denB));
  if (!(se > 0)) return null;
  const z = (pA - pB) / se;
  return { z, p: 2 * (1 - normCdf(Math.abs(z))), lift: pB > 0 ? pA / pB - 1 : null, pA, pB };
}

function normCdf(x) {
  // Abramowitz and Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * x / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t *
    Math.exp(-(x * x) / 2);
  return 0.5 * (1 + y);
}

// ---------------------------------------------------------------------------
// Insights helpers (dashboard, what's winning, experiments, calendar).
// Pure functions: no DOM, no store, so they run under `node --test`.
// ---------------------------------------------------------------------------

export const KPI_BY_KEY = Object.fromEntries(KPIS.map((k) => [k.key, k]));

/** Creative levers as stored on studio.reels (Maana's set; see setLeverFields). */
const DEFAULT_LEVERS = [
  { key: "hook_type", label: "Hook type" },
  { key: "format", label: "Format" },
  { key: "look", label: "Look" },
  { key: "voice", label: "Voice" },
  { key: "length_bucket", label: "Length" },
  { key: "arabic_frame0", label: "Arabic at frame 0" },
  { key: "lead", label: "Lead" },
  { key: "sound", label: "Sound" },
];
const BASE_DIMENSIONS = [
  { key: "platform", label: "Platform" },
  { key: "post_type", label: "Post type" },
  { key: "batch", label: "Batch" },
  { key: "week", label: "Week" },
];

export let LEVERS = DEFAULT_LEVERS;
/** Every dimension the dashboard can break down by. */
export let DIMENSIONS = [...BASE_DIMENSIONS, ...LEVERS];
/** Where each lever lives: "column" (studio.reels column) or "levers" (reels.levers jsonb). */
let LEVER_STORE = {};

/**
 * Switches the levers to a workspace's set (studio.workspaces.levers.fields).
 * Text levers (e.g. "word taught") are not grouped by; the length bucket is
 * always offered. null restores Maana's default set.
 */
export function setLeverFields(fields) {
  if (!Array.isArray(fields) || !fields.length) {
    LEVERS = DEFAULT_LEVERS;
    LEVER_STORE = {};
  } else {
    const list = fields.filter((f) => f.kind !== "text").map((f) => ({ key: f.key, label: f.label ?? f.key }));
    const at = list.findIndex((f) => f.key === "voice");
    list.splice(at >= 0 ? at + 1 : list.length, 0, { key: "length_bucket", label: "Length" });
    LEVERS = list;
    LEVER_STORE = Object.fromEntries(fields.map((f) => [f.key, f.store ?? "column"]));
  }
  DIMENSIONS = [...BASE_DIMENSIONS, ...LEVERS];
}

function reelLever(reel, key) {
  if (LEVER_STORE[key] === "levers") return reel.levers?.[key];
  return reel[key] ?? reel.levers?.[key];
}

/** Metrics offered on "what's winning" and experiments. */
export const WIN_METRICS = ["hook_rate", "share_rate", "save_rate", "completion_rate", "installs_per_1k", "cpi"];

function leverValue(v) {
  if (v === true) return "yes";
  if (v === false) return "no";
  return v ?? null;
}

/**
 * One row per post that has at least one metrics snapshot, with the reel's
 * levers attached. latestFn(postId) -> {source: snapshot}.
 */
export function buildRows(posts, reels, latestFn, { includeEmpty = false } = {}) {
  const out = [];
  for (const p of posts) {
    const latest = latestFn(p.id) ?? {};
    if (!includeEmpty && !Object.keys(latest).length) continue;
    const reel = (reels.get ? reels.get(p.reel_id) : reels[p.reel_id]) ?? {};
    const r = postRow(p, latest);
    r.status = p.status;
    r.experiment_id = p.experiment_id ?? null;
    r.variant_label = p.variant_label ?? null;
    r.batch = reel.batch ?? null;
    r.reel_title = reel.title ?? null;
    r.week = isoWeek(p.published_at);
    for (const l of LEVERS) r[l.key] = leverValue(reelLever(reel, l.key));
    out.push(r);
  }
  return out;
}

/** True when dateStr falls within the last `days` days of `now` (days null = all time). */
export function inRange(dateStr, days, now = Date.now()) {
  if (days == null) return true;
  if (!dateStr) return false;
  const t = new Date(dateStr).getTime();
  return t >= now - days * 864e5 && t <= now + 864e5;
}

/**
 * Daily views from cumulative snapshots. For each post, the cumulative view
 * count at the end of each UTC day is the max over its platform sources
 * (never summed across sources: that would double count). Day deltas are
 * summed across posts. Views first measured on a day are attributed to that
 * day. Returns [{day: "YYYY-MM-DD", views, posts}] for every day in [from, to].
 */
export function dailyViews(snapshotsByPost, postIds, from, to) {
  const totals = new Map();
  const contributors = new Map();
  for (const id of postIds) {
    const snaps = (snapshotsByPost.get ? snapshotsByPost.get(id) : snapshotsByPost[id]) ?? [];
    const cur = {};
    const endOfDay = new Map();
    for (const s of snaps) {
      if (s.source === "asc_reports" || s.views == null) continue;
      cur[s.source] = Math.max(cur[s.source] ?? 0, Number(s.views));
      endOfDay.set(String(s.captured_at).slice(0, 10), Math.max(...Object.values(cur)));
    }
    let prev = 0;
    for (const day of [...endOfDay.keys()].sort()) {
      const cum = endOfDay.get(day);
      const d = Math.max(0, cum - prev);
      prev = Math.max(prev, cum);
      if (d > 0) {
        totals.set(day, (totals.get(day) ?? 0) + d);
        if (!contributors.has(day)) contributors.set(day, new Set());
        contributors.get(day).add(id);
      }
    }
  }
  const out = [];
  if (!from || !to) return out;
  const start = new Date(from + "T00:00:00Z"), end = new Date(to + "T00:00:00Z");
  for (let t = start; t <= end; t = new Date(t.getTime() + 864e5)) {
    const day = t.toISOString().slice(0, 10);
    out.push({ day, views: totals.get(day) ?? 0, posts: contributors.get(day)?.size ?? 0 });
  }
  return out;
}

/** Minimum sample rule for any single claim on "what's winning". */
export const MIN_POSTS = 3;
export const MIN_DEN = 1000;

/**
 * Plain-language confidence for group A vs the rest (B).
 * level: thin | untested | likely | suggestive | unclear
 */
export function confidence(a, b, test, kpi) {
  if (a.posts < MIN_POSTS || b.posts < MIN_POSTS || a.den < MIN_DEN || b.den < MIN_DEN) {
    return { level: "thin", text: `Too little data (needs ${MIN_POSTS}+ posts and ${MIN_DEN.toLocaleString("en-US")}+ ${kpi.denLabel ?? "units"} on each side)` };
  }
  if (!kpi.rate || !test) return { level: "untested", text: "Directional only: no significance test for this metric" };
  if (test.p < 0.05 && a.posts >= 5 && b.posts >= 5) return { level: "likely", text: "Likely real (p < 0.05, 5+ posts per side)" };
  if (test.p < 0.1) return { level: "suggestive", text: "Suggestive (p < 0.1)" };
  return { level: "unclear", text: "No clear difference" };
}

/**
 * For one lever: each value vs the rest of the posts, on one metric, ranked
 * by effect (best first; direction-aware for lower-is-better metrics).
 * Rows where the lever is not set are left out of both sides.
 */
export function leverEffects(rows, leverKey, metricKey) {
  const kpi = KPI_BY_KEY[metricKey];
  const tagged = rows.filter((r) => r[leverKey] != null);
  const values = [...new Set(tagged.map((r) => String(r[leverKey])))];
  const out = values.map((value) => {
    const A = tagged.filter((r) => String(r[leverKey]) === value);
    const B = tagged.filter((r) => String(r[leverKey]) !== value);
    const a = kpi.calc(A), b = kpi.calc(B);
    const lift = a.value != null && b.value != null && b.value > 0 ? a.value / b.value - 1 : null;
    const effect = lift == null ? null : (kpi.lowerIsBetter ? -lift : lift);
    const test = kpi.rate && a.den > 0 && b.den > 0 ? proportionTest(a.num, a.den, b.num, b.den) : null;
    return { lever: leverKey, value, n: A.length, a, b, lift, effect, p: test?.p ?? null, conf: confidence(a, b, test, kpi) };
  });
  out.sort((x, y) => (y.effect ?? -Infinity) - (x.effect ?? -Infinity));
  return out;
}

/** Sample toward an experiment's pre-registered minimum, in its sample_unit. */
export function sampleOf(rows, unit, kpiResult) {
  const s = (f) => rows.reduce((acc, r) => acc + (Number.isFinite(r[f]) ? r[f] : 0), 0);
  switch (unit) {
    case "posts": return rows.length;
    case "views": return s("views");
    case "impressions": return s("impressions");
    case "installs": return s("installs");
    case "reach": return s("reach");
    default: return kpiResult?.den ?? 0;
  }
}

/**
 * Live comparison for an experiment. rows: rows of posts in this experiment.
 * Refuses to name a winner until every variant has reached min_sample.
 */
export function compareVariants(rows, exp) {
  const kpi = KPI_BY_KEY[exp.metric];
  const variants = (exp.variants ?? []).map((v) => {
    const rs = rows.filter((r) => r.variant_label === v.label);
    const k = kpi ? kpi.calc(rs) : { value: null, num: 0, den: 0, posts: 0 };
    const sample = sampleOf(rs, exp.sample_unit, k);
    return { label: v.label, reel_id: v.reel_id, n: rs.length, kpi: k, sample,
      progress: exp.min_sample > 0 ? Math.min(1, sample / exp.min_sample) : 0,
      met: sample >= exp.min_sample };
  });
  const unit = exp.sample_unit ?? "units";
  const res = { variants, test: null, winner: null, ready: false, verdict: "" };
  if (!kpi) { res.verdict = `Unknown metric "${exp.metric}".`; return res; }
  const withData = variants.filter((v) => v.kpi.value != null);
  if (variants.length < 2) { res.verdict = "Add at least two variants."; return res; }
  if (!withData.length) { res.verdict = "No data yet."; return res; }
  const ranked = [...withData].sort((x, y) => kpi.lowerIsBetter ? x.kpi.value - y.kpi.value : y.kpi.value - x.kpi.value);
  const [best, second] = ranked;
  if (best && second && kpi.rate) res.test = proportionTest(best.kpi.num, best.kpi.den, second.kpi.num, second.kpi.den);
  const metCount = variants.filter((v) => v.met).length;
  if (metCount < variants.length) {
    res.verdict = `Not enough data to call a winner: ${metCount} of ${variants.length} variants have reached the pre-registered minimum of ${Number(exp.min_sample).toLocaleString("en-US")} ${unit}.` +
      (second ? ` ${best.label} leads for now, which is not a result.` : "");
    return res;
  }
  res.ready = true;
  if (!second) { res.verdict = "Minimum sample reached, but only one variant has data."; return res; }
  if (!kpi.rate) {
    res.verdict = `Minimum sample reached. ${best.label} leads on ${kpi.label}. No significance test for cost metrics, so judge the size of the gap.`;
    res.winner = null;
    return res;
  }
  const p = res.test?.p;
  if (p != null && p < 0.05) {
    res.winner = best.label;
    res.verdict = `${best.label} beats ${second.label} on ${kpi.label} (p ${p < 0.001 ? "< 0.001" : "= " + p.toFixed(3)}).`;
  } else {
    res.verdict = `Minimum sample reached with no significant difference (p = ${p == null ? "n/a" : p.toFixed(3)}). Treat as a tie or extend the test.`;
  }
  return res;
}

/** Monday (UTC date string) of the week containing dateStr. */
export function weekStart(dateStr) {
  const d = new Date(dateStr);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

/** Cadence status for a count of organic posts in one week. */
export function cadenceStatus(count, cadence) {
  const min = cadence?.organic_per_week_min, max = cadence?.organic_per_week_max;
  if (min != null && count < min) return "below";
  if (max != null && count > max) return "above";
  return "ok";
}

/**
 * Per-variant sample needed to detect a relative lift in a proportion with a
 * two-sided test at alpha 0.05 and 80% power (normal approximation):
 * n = (1.96 + 0.8416)^2 * (p1 q1 + p2 q2) / (p2 - p1)^2.
 */
export function sampleSizeFor(baseline, relLift = 0.2) {
  if (!(baseline > 0 && baseline < 1)) return null;
  const p2 = Math.min(0.999, baseline * (1 + relLift));
  const d = p2 - baseline;
  if (!(d > 0)) return null;
  return Math.ceil((1.959964 + 0.841621) ** 2 * (baseline * (1 - baseline) + p2 * (1 - p2)) / (d * d));
}
