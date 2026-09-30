// Hand-written SVG charts and shared insight formatting. No chart library.

import { h, fmt } from "./ui.js";

const NS = "http://www.w3.org/2000/svg";

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

/** Format one KPI value by its KPIS fmt. null -> "No data". */
export function kpiText(kpi, value) {
  if (value == null || !Number.isFinite(value)) return "No data";
  switch (kpi.fmt) {
    case "pct": return fmt.pct(value);
    case "usd": return fmt.usd(value);
    case "sec": return fmt.sec(value);
    case "num2": return value.toFixed(2);
    default: return fmt.int(value);
  }
}

/** "n posts, den views" for a ratio; "n posts reporting" for a sum. */
export function sampleText(kpi, res) {
  if (!res || !res.posts) return "no posts report this yet";
  const posts = `${res.posts} post${res.posts === 1 ? "" : "s"}`;
  if (res.den == null) return `${posts} reporting`;
  return `${posts}, ${fmt.int(res.den)} ${kpi.denLabel ?? ""}`.trim();
}

/** Display label for a lever or dimension value. */
export function valueLabel(key, v) {
  if (v == null || v === "(none)") return "Not set";
  if (key === "length_bucket") {
    const m = { under_15s: "Under 15s", "15_30s": "15-30s", "30_45s": "30-45s", "45s_plus": "45s plus" };
    if (m[v]) return m[v];
  }
  return fmt.label(v);
}

export function liftText(lift) {
  if (lift == null || !Number.isFinite(lift)) return "No data";
  const pct = lift * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`;
}

export function pText(p) {
  if (p == null || !Number.isFinite(p)) return "n/a";
  return p < 0.001 ? "< 0.001" : p.toFixed(3);
}

export const PLATFORM_COLORS = {
  instagram: { bg: "#FBE3D6", ink: "#A5502D" },
  facebook: { bg: "#E3E9F5", ink: "#27477F" },
  youtube: { bg: "#F8DEDA", ink: "#9B2C22" },
  tiktok: { bg: "#E2E4EA", ink: "#0E1F3D" },
  meta_ads: { bg: "#FBEBD3", ink: "#8A5A12" },
};

/**
 * Area sparkline for [{day, views, posts}]. Hover titles give each day's
 * value and how many posts it came from.
 */
export function sparkline(series, { height = 64, label = "Views per day" } = {}) {
  const W = 600, H = height, pad = 3;
  const max = Math.max(1, ...series.map((d) => d.views));
  const n = series.length;
  const x = (i) => (n <= 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (n - 1));
  const y = (v) => H - pad - (v / max) * (H - 2 * pad);
  const pts = series.map((d, i) => `${x(i).toFixed(1)},${y(d.views).toFixed(1)}`);
  const svg = s("svg", { class: "spark", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", role: "img", "aria-label": label, style: `height:${H}px` });
  if (!n) return svg;
  svg.append(
    s("path", { d: `M${x(0)},${H - pad} L${pts.join(" L")} L${x(n - 1)},${H - pad} Z`, fill: "#DDEFE4" }),
    s("polyline", { points: pts.join(" "), fill: "none", stroke: "#286F4D", "stroke-width": 2, "vector-effect": "non-scaling-stroke", "stroke-linejoin": "round" }),
  );
  const bw = (W - 2 * pad) / Math.max(1, n - 1);
  series.forEach((d, i) => {
    svg.append(s("rect", { x: Math.max(0, x(i) - bw / 2), y: 0, width: bw, height: H, fill: "transparent" },
      s("title", {}, `${d.day}: ${fmt.int(d.views)} views from ${d.posts} post${d.posts === 1 ? "" : "s"}`)));
  });
  return svg;
}

/** Progress bar using .bar-track / .bar-fill. */
export function progressBar(frac, cls = "") {
  const pct = Math.max(0, Math.min(1, frac || 0)) * 100;
  return h("div.bar-track", { role: "progressbar", "aria-valuenow": Math.round(pct), "aria-valuemin": 0, "aria-valuemax": 100 },
    h("div.bar-fill" + (cls ? "." + cls : ""), { style: { width: `${pct}%` } }));
}

/** Small styles the insight views need beyond studio.css (injected once). */
export function ensureStyle() {
  if (document.getElementById("insights-style")) return;
  const css = `
.kpi-grid { grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); }
@media (max-width: 420px) { .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; } .kpi .kpi-value { font-size: 22px; } }
.kpi .kpi-target { font-size: 12px; font-weight: 700; margin-top: 2px; }
.kpi.good .kpi-target { color: var(--green); } .kpi.bad .kpi-target { color: var(--coral-ink); }
.kpi .kpi-value.nodata { color: var(--ink-3); font-size: 20px; }
td .nodata, .nodata { color: var(--ink-3); font-size: 12px; }
table.data td.num { white-space: nowrap; }
.grid.fit-2 { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
@media (max-width: 420px) { .grid.fit-2 { grid-template-columns: minmax(0, 1fr); } }
.seg { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.activity { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.activity li { display: flex; gap: 10px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 13px; min-width: 0; }
.activity li:last-child { border-bottom: 0; }
.activity .when { color: var(--ink-3); width: 70px; flex: none; font-size: 12px; }
.activity .what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spark-axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--ink-3); }
.conf-likely { background: var(--mint); color: var(--green); }
.conf-suggestive { background: var(--blue-bg); color: var(--blue); }
.row-thin td { color: var(--ink-3); }
.cal-wrap .cal { grid-template-columns: repeat(7, minmax(0, 1fr)) 64px; }
.cal-week { display: flex; align-items: center; justify-content: center; }
.cal-item { border-left: 3px solid transparent; font-size: 11px; }
.cal-item .pill { font-size: 10px; padding: 0 5px; margin-left: 4px; }
.cal-list { display: none; }
@media (max-width: 700px) { .cal-wrap { display: none; } .cal-list { display: flex; flex-direction: column; gap: 12px; } }
.cal-list .day { display: flex; gap: 10px; align-items: flex-start; padding: 6px 0; border-top: 1px solid var(--line); }
.cal-list .day-label { width: 64px; flex: none; font-size: 12px; font-weight: 800; color: var(--ink-2); }
.cal-list .day-items { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.legend { display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; color: var(--ink-2); }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 4px; vertical-align: -1px; }
.variant-row { display: grid; grid-template-columns: 1fr 2fr auto; gap: 8px; align-items: end; }
@media (max-width: 600px) { .variant-row { grid-template-columns: 1fr; } }
.kv { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; font-size: 14px; }
.kv dt { color: var(--ink-3); font-weight: 700; } .kv dd { margin: 0; }
`;
  document.head.append(h("style#insights-style", css));
}
