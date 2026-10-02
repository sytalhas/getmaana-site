// Dashboard: live KPIs with their samples, targets, breakdowns, views over
// time, recent activity and CSV exports. Everything is the ratio of sums.

import { h, clear, fmt, toast, pill, statusKind, select, empty, downloadFile, field, PLATFORM_NAMES } from "../ui.js";
import { store, href } from "../store.js";
import { api } from "../supa.js";
import { KPIS, breakdown, buildRows, inRange, dailyViews, DIMENSIONS, LEVERS } from "../kpi.js";
import { toCSV } from "../csv.js";
import { welcomeCard } from "./_welcome.js";
import { sparkline, kpiText, sampleText, ensureStyle, valueLabel } from "../charts.js";

// Kept across navigation so the team's filter choice sticks for the session.
const state = { range: "30", platform: "", post_type: "", batch: "", dim: "platform" };

const RANGES = [["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["all", "All time"]];
const TABLE_KPIS = ["views", "hook_rate", "hold_rate", "completion_rate", "avg_watch_s", "share_rate", "save_rate",
  "follows", "link_clicks", "installs_per_1k", "cpi", "spend"];
const METRIC_FIELDS = ["views", "reach", "impressions", "likes", "comments", "shares", "saves", "follows", "profile_visits",
  "link_clicks", "three_s_views", "thruplays", "completions", "avg_watch_s", "total_watch_s", "skip_rate", "spend_usd", "installs"];

function days() { return state.range === "all" ? null : Number(state.range); }

function matchesNonDate(p) {
  if (state.platform && p.platform !== state.platform) return false;
  if (state.post_type && p.post_type !== state.post_type) return false;
  if (state.batch && store.reels.get(p.reel_id)?.batch !== state.batch) return false;
  return true;
}

function filteredPosts() {
  const d = days();
  return [...store.posts.values()].filter((p) => matchesNonDate(p) && (d == null || inRange(p.published_at, d)));
}

function groupLabel(dim, key) {
  if (dim === "platform" && PLATFORM_NAMES[key]) return PLATFORM_NAMES[key];
  return valueLabel(dim, key);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---------------------------------------------------------------------------

function kpiTile(k, res, targets) {
  const t = k.target ? targets?.[k.target] : null;
  let cls = "", targetLine = null;
  if (k.target) {
    const sign = k.lowerIsBetter ? "≤" : "≥";
    if (t == null) targetLine = h("div.kpi-target.muted", "No target set");
    else {
      const tText = kpiText(k, t);
      if (res.value == null) targetLine = h("div.kpi-target.muted", `Target ${sign} ${tText}`);
      else {
        const good = k.lowerIsBetter ? res.value <= t : res.value >= t;
        cls = good ? ".good" : ".bad";
        targetLine = h("div.kpi-target", `${good ? "Meets" : "Misses"} target ${sign} ${tText}`);
      }
    }
  }
  return h("div.kpi" + cls, { title: k.help },
    h("div.kpi-label", k.label),
    h("div.kpi-value" + (res.value == null ? ".nodata" : ""), kpiText(k, res.value)),
    h("div.kpi-sub", sampleText(k, res)),
    targetLine);
}

function breakdownTable(rows) {
  const dim = DIMENSIONS.find((d) => d.key === state.dim) ?? DIMENSIONS[0];
  const groups = breakdown(rows, (r) => r[dim.key]);
  if (dim.key === "week") groups.sort((a, b) => String(b.key).localeCompare(String(a.key)));
  else groups.sort((a, b) => (b.kpis.views.value ?? 0) - (a.kpis.views.value ?? 0));
  const cols = TABLE_KPIS.map((key) => KPIS.find((k) => k.key === key));
  if (!groups.length) return empty("No posts with metrics match these filters.");
  return h("div.table-wrap", h("table.data",
    h("thead", h("tr", h("th", dim.label), h("th.num", "Posts"), cols.map((k) => h("th.num", { title: k.help }, k.label)))),
    h("tbody", groups.map((g) => h("tr",
      h("td", groupLabel(dim.key, g.key)),
      h("td.num", String(g.n)),
      cols.map((k) => {
        const res = g.kpis[k.key];
        return h("td.num", { title: sampleText(k, res) },
          res.value == null ? h("span.nodata", "no data") : kpiText(k, res.value),
          res.value != null && res.posts < g.n ? h("div.small.muted", `${res.posts} of ${g.n}`) : null);
      }))))));
}

function viewsChart(rows) {
  const today = new Date().toISOString().slice(0, 10);
  const d = days();
  let from;
  if (d != null) from = new Date(Date.now() - (d - 1) * 864e5).toISOString().slice(0, 10);
  else {
    let min = null;
    for (const r of rows) for (const s of store.metrics.get(r.post_id) ?? []) {
      const day = String(s.captured_at).slice(0, 10);
      if (!min || day < min) min = day;
    }
    from = min ?? today;
  }
  // Views keep accruing after a post's publish window, so the chart counts
  // every post (matching the other filters) that gained views in the window.
  const ids = [...store.posts.values()].filter(matchesNonDate).map((p) => p.id);
  const series = dailyViews(store.metrics, ids, from, today);
  const total = series.reduce((a, x) => a + x.views, 0);
  const contributing = new Set();
  for (const id of ids) {
    for (const s of store.metrics.get(id) ?? []) {
      if (String(s.captured_at).slice(0, 10) >= from && s.views != null && s.source !== "asc_reports") { contributing.add(id); break; }
    }
  }
  const peak = series.reduce((m, x) => (x.views > (m?.views ?? -1) ? x : m), null);
  return h("div.card",
    h("div.row.between", h("h3", "Views per day"),
      h("span.small.muted", total ? `${fmt.int(total)} views from ${plural(contributing.size, "post")}, ${series.length} days (UTC)` : "")),
    total ? [
      sparkline(series, { height: 72 }),
      h("div.spark-axis", h("span", fmt.date(from + "T12:00:00Z")),
        h("span", peak ? `Peak ${fmt.int(peak.views)} on ${fmt.date(peak.day + "T12:00:00Z")}` : ""),
        h("span", "Today")),
      h("p.hint", "Daily change in each post's cumulative views (last snapshot of each day). Views first measured on a day count on that day, so a post's first sync can show as a spike."),
    ] : h("p.nodata", "No data: no view snapshots in this range."));
}

function activity() {
  const items = [];
  for (const j of store.jobs.values()) {
    const post = j.post_id ? store.posts.get(j.post_id) : null;
    items.push({ at: j.updated_at ?? j.created_at, status: j.status,
      text: `${fmt.label(j.kind)} ${PLATFORM_NAMES[j.platform] ?? j.platform ?? ""}${post ? `, ${post.reel_id}` : ""}${j.status === "failed" && j.last_error ? `: ${j.last_error}` : ""}` });
  }
  for (const p of store.posts.values()) {
    items.push({ at: p.updated_at ?? p.created_at, status: p.status, href: href("posts"),
      text: `Post ${p.reel_id} on ${PLATFORM_NAMES[p.platform] ?? p.platform} (${p.post_type})${p.status === "failed" && p.error ? `: ${p.error}` : ""}` });
  }
  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const top = items.slice(0, 10);
  return h("div.card",
    h("div.row.between", h("h3", "Recent activity"), h("span.small.muted", "Updates live")),
    top.length ? h("ul.activity", top.map((it) => h("li",
      h("span.when", fmt.ago(it.at)), pill(it.status, statusKind(it.status)),
      h("span.what", { title: it.text }, it.href ? h("a", { href: it.href }, it.text) : it.text))))
      : h("p.nodata", "No launches or syncs yet."));
}

// ---------------------------------------------------------------------------

function exportPosts(posts) {
  const cols = ["post_id", "reel_id", "reel_title", "batch", "platform", "post_type", "method", "status", "scheduled_at", "published_at",
    "platform_url", "experiment_id", "variant_label", ...LEVERS.map((l) => l.key),
    "last_synced_at", "sources", ...METRIC_FIELDS];
  const rows = buildRows(posts, store.reels, (id) => store.latest(id), { includeEmpty: true });
  const byId = new Map(rows.map((r) => [r.post_id, r]));
  const out = posts.map((p) => ({
    ...byId.get(p.id), method: p.method, scheduled_at: p.scheduled_at, platform_url: p.platform_url,
    last_synced_at: p.last_synced_at, sources: Object.keys(store.latest(p.id)).join(" "),
  }));
  downloadFile(`${store.wsId}-posts-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(cols, out));
  toast(`Exported ${plural(out.length, "post")}`, "good");
}

function exportSnapshots() {
  const cols = ["id", "post_id", "captured_at", "source", ...METRIC_FIELDS];
  const all = [];
  for (const list of store.metrics.values()) all.push(...list);
  all.sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at)));
  downloadFile(`${store.wsId}-metric-snapshots-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(cols, all));
  toast(`Exported ${plural(all.length, "snapshot")}`, "good");
}

// ---------------------------------------------------------------------------

export function render(root) {
  ensureStyle();
  // Filters are per session, but a batch or lever of another workspace means nothing here.
  if (state.ws !== store.wsId) {
    state.ws = store.wsId;
    state.batch = "";
    if (!DIMENSIONS.some((d) => d.key === state.dim)) state.dim = "platform";
  }
  const syncBtn = store.canEdit() ? h("button.btn.primary", {
    title: "Queue an insights sync for every live post now",
    onclick: async () => {
      syncBtn.disabled = true;
      try {
        const out = await api("sync", {});
        toast(`Queued a sync for ${plural(out.queued ?? 0, "live post")}`, "good");
      } catch (e) {
        toast(`Sync failed: ${e.message}`, "bad");
      } finally {
        syncBtn.disabled = false;
      }
    } }, "Sync all now") : null;

  const head = h("div.view-head",
    h("div", h("h1", "Dashboard"),
      h("p", "Live insights across every platform. Rates are ratio of sums, and each number shows its sample.")),
    h("div.row",
      h("button.btn.ghost", { onclick: () => exportPosts(filteredPosts()), title: "Posts matching the current filters, with their latest metrics" }, "Posts CSV"),
      h("button.btn.ghost", { onclick: exportSnapshots, title: "Every metrics snapshot captured so far" }, "Snapshots CSV"),
      syncBtn));

  const onFilter = (key) => (e) => { state[key] = e.target.value; draw(); };
  const platformOpts = [["", "All platforms"], ...Object.keys(PLATFORM_NAMES).filter((k) => k !== "asc").map((k) => [k, PLATFORM_NAMES[k]])];
  const batchField = h("span");
  const filters = h("div.filters",
    field("Published", select(RANGES, state.range, { onchange: onFilter("range") })),
    field("Platform", select(platformOpts, state.platform, { onchange: onFilter("platform") })),
    field("Post type", select([["", "All types"], "organic", "trial", "paid"], state.post_type, { onchange: onFilter("post_type") })),
    batchField);

  let batchKey = null;
  function refreshBatches() {
    const batches = [...new Set([...store.reels.values()].map((r) => r.batch).filter(Boolean))].sort();
    const key = batches.join("|");
    if (key === batchKey) return; // keep the open select untouched
    batchKey = key;
    clear(batchField, field("Batch", select([["", "All batches"], ...batches], state.batch, { onchange: onFilter("batch") })));
  }

  const body = h("div");
  clear(root, head, filters, body);

  function draw() {
    refreshBatches();
    const posts = filteredPosts();
    const rows = buildRows(posts, store.reels, (id) => store.latest(id));
    const published = posts.filter((p) => p.published_at).length;
    const targets = store.setting("targets") ?? {};
    const all = Object.fromEntries(KPIS.map((k) => [k.key, k.calc(rows)]));
    const unsynced = published - rows.length;
    clear(body,
      welcomeCard(),
      h("p.small.muted", `${plural(rows.length, "post")} with metrics` +
        (unsynced > 0 ? `, ${plural(unsynced, "published post")} not synced yet` : "") +
        (days() != null ? `, published in the last ${days()} days` : ", all time") + "."),
      h("div.grid.kpi-grid", KPIS.map((k) => kpiTile(k, all[k.key], targets))),
      h("div.grid.fit-2.section", viewsChart(rows), activity()),
      h("section.section",
        h("h2", "Breakdown"),
        h("div.seg", DIMENSIONS.map((d) => h("button.btn.small" + (d.key === state.dim ? ".primary" : ".ghost"),
          { onclick: () => { state.dim = d.key; draw(); }, "aria-pressed": String(d.key === state.dim) }, d.label))),
        breakdownTable(rows),
        h("p.hint", "Each cell is the ratio of sums over the group's posts that report that metric (hover for its sample). \"k of n\" shows when only some posts report it.")));
  }

  draw();
  return store.on(() => draw());
}
