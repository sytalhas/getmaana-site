// What's winning: every lever value against the rest of the posts, on one
// metric, ranked by effect, with its sample and an honest confidence label.

import { h, clear, fmt, select, field, PLATFORM_NAMES } from "../ui.js";
import { store, href } from "../store.js";
import { KPI_BY_KEY, LEVERS, WIN_METRICS, buildRows, leverEffects, MIN_POSTS, MIN_DEN } from "../kpi.js";
import { kpiText, liftText, pText, ensureStyle, valueLabel } from "../charts.js";

const state = { metric: "hook_rate", platform: "", post_type: "" };

const CONF_CLASS = { likely: "conf-likely", suggestive: "conf-suggestive", thin: "muted", unclear: "", untested: "warn" };

// Built per call: the levers depend on the open workspace (kpi.setLeverFields).
const confoundDims = () => [...LEVERS.map((l) => [l.key, l.label]), ["platform", "Platform"], ["post_type", "Post type"]];

/**
 * The strongest other attribute that is over-represented in group A vs the
 * rest: a likely confound, e.g. "all 3 are also look: paper (rest: 1 of 5)".
 */
function confound(rows, leverKey, value) {
  const A = rows.filter((r) => r[leverKey] != null && String(r[leverKey]) === value);
  const B = rows.filter((r) => r[leverKey] != null && String(r[leverKey]) !== value);
  if (!A.length || !B.length) return null;
  let best = null;
  for (const [key, label] of confoundDims()) {
    if (key === leverKey) continue;
    const vals = new Set(A.map((r) => r[key]).filter((v) => v != null));
    for (const v of vals) {
      const a = A.filter((r) => r[key] === v).length, b = B.filter((r) => r[key] === v).length;
      const diff = a / A.length - b / B.length;
      if (diff > 0.3 && (!best || diff > best.diff)) best = { diff, text: `${a} of ${A.length} are also ${label.toLowerCase()}: ${valueLabel(key, v)} (rest: ${b} of ${B.length})` };
    }
  }
  return best?.text ?? null;
}

function confPill(conf) {
  const cls = CONF_CLASS[conf.level] ?? "";
  return h("span.pill" + (cls ? "." + cls : ""), { title: conf.text }, conf.text);
}

function effectsTable(rows, effects, kpi, { showLever = false } = {}) {
  const denLabel = kpi.denLabel ?? "denominator";
  return h("div.table-wrap", h("table.data",
    h("thead", h("tr",
      showLever ? h("th", "Lever") : null,
      h("th", "Value"), h("th.num", kpi.label), h("th.num", "Posts"), h("th.num", `Sample (${denLabel})`),
      h("th.num", "Rest"), h("th.num", "Lift vs rest"), h("th.num", "p"), h("th", "Confidence"))),
    h("tbody", effects.map((e) => {
      const cf = confound(rows, e.lever, e.value);
      return h("tr" + (e.conf.level === "thin" ? ".row-thin" : ""),
        showLever ? h("td", LEVERS.find((l) => l.key === e.lever)?.label ?? e.lever) : null,
        h("td", h("strong", valueLabel(e.lever, e.value)), cf ? h("div.small.muted", `Confound: ${cf}`) : null),
        h("td.num", e.a.value == null ? h("span.nodata", "no data") : kpiText(kpi, e.a.value)),
        h("td.num", String(e.n)),
        h("td.num", e.a.posts ? `${fmt.int(e.a.den)} (${e.a.posts} reporting)` : h("span.nodata", "no data")),
        h("td.num", { title: `${e.b.posts} posts, ${fmt.int(e.b.den)} ${denLabel}` }, e.b.value == null ? h("span.nodata", "no data") : kpiText(kpi, e.b.value)),
        h("td.num", liftText(e.lift)),
        h("td.num", kpi.rate ? pText(e.p) : h("span.nodata", "no test")),
        h("td", confPill(e.conf)));
    }))));
}

export function render(root) {
  ensureStyle();
  const onFilter = (key) => (e) => { state[key] = e.target.value; draw(); };
  const platformOpts = [["", "All platforms"], ...Object.keys(PLATFORM_NAMES).filter((k) => k !== "asc").map((k) => [k, PLATFORM_NAMES[k]])];
  const metricOpts = WIN_METRICS.map((k) => [k, KPI_BY_KEY[k].label]);

  const head = h("div.view-head", h("div", h("h1", "What's winning"),
    h("p", "Each lever value compared with every other post, ranked by effect. Observational, so read it as a lead for an experiment.")));
  const filters = h("div.filters",
    field("Metric", select(metricOpts, state.metric, { onchange: onFilter("metric") })),
    field("Platform", select(platformOpts, state.platform, { onchange: onFilter("platform") })),
    field("Post type", select([["", "All types"], "organic", "trial", "paid"], state.post_type, { onchange: onFilter("post_type") })));
  const caveat = h("div.notice",
    h("strong", "Read with care. "),
    "These are observational comparisons, not experiments: posts differ in more than one lever at once (and in timing, platform and audience), so a lever can look strong because of another one. ",
    "The p-value treats every view as independent, which overstates confidence when views cluster by post. ",
    `Rules: "Too little data" under ${MIN_POSTS} posts or ${MIN_DEN.toLocaleString("en-US")} in the denominator on either side; "Suggestive" at p < 0.1; "Likely real" at p < 0.05 with 5+ posts per side. `,
    "Confirm anything that matters in ", h("a", { href: href("experiments") }, "Experiments"), ".");
  const body = h("div");
  clear(root, head, filters, caveat, body);

  function draw() {
    const kpi = KPI_BY_KEY[state.metric];
    const posts = [...store.posts.values()].filter((p) =>
      (!state.platform || p.platform === state.platform) && (!state.post_type || p.post_type === state.post_type));
    const rows = buildRows(posts, store.reels, (id) => store.latest(id));
    const reporting = kpi.calc(rows);
    if (!reporting.posts) {
      clear(body, h("div.empty.section", h("p", `No data: no posts report ${kpi.label.toLowerCase()} for these filters yet.`)));
      return;
    }
    const byLever = LEVERS.map((l) => ({ lever: l, effects: leverEffects(rows, l.key, state.metric) }));
    const best = (x) => Math.max(-Infinity, ...x.effects.filter((e) => e.conf.level !== "thin" && e.effect != null).map((e) => Math.abs(e.effect)));
    byLever.sort((a, b) => best(b) - best(a));
    const leaders = byLever.flatMap((x) => x.effects).filter((e) => e.conf.level !== "thin" && e.effect != null)
      .sort((a, b) => b.effect - a.effect).slice(0, 8);

    clear(body,
      h("p.small.muted.section", `Across ${rows.length} posts with metrics; ${reporting.posts} report ${kpi.label.toLowerCase()} ` +
        `(${fmt.int(reporting.den)} ${kpi.denLabel}, overall ${kpiText(kpi, reporting.value)}).` +
        (kpi.lowerIsBetter ? " Lower is better, so a negative lift ranks first." : "")),
      h("section.section", h("h2", "Biggest effects with enough data"),
        leaders.length ? effectsTable(rows, leaders, kpi, { showLever: true })
          : h("div.empty", h("p", "Nothing has enough data yet. Every lever value needs at least " +
            `${MIN_POSTS} posts and ${MIN_DEN.toLocaleString("en-US")} ${kpi.denLabel} on both sides.`))),
      byLever.map(({ lever, effects }) => h("section.section",
        h("h2", lever.label),
        effects.length ? effectsTable(rows, effects, kpi)
          : h("p.nodata", "No data: no posts with this lever set."))));
  }

  draw();
  return store.on(() => draw());
}
