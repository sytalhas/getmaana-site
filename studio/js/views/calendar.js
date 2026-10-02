// Calendar: every post by its scheduled or published time, coloured by
// platform, with the organic cadence per week checked against settings.
// Planned videos (reels.planned_for, pushed from the repo's content calendar by
// marketing/pipeline/studio_calendar_sync.py) show on their planned day until
// the reel has a post.

import { h, clear, fmt, pill, statusKind, modal, PLATFORM_NAMES } from "../ui.js";
import { store } from "../store.js";
import { cadenceStatus } from "../kpi.js";
import { PLATFORM_COLORS, ensureStyle } from "../charts.js";

const state = { month: null }; // "YYYY-MM", local time
const SHORT = { instagram: "IG", facebook: "FB", youtube: "YT", tiktok: "TT", meta_ads: "Ads" };
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SKIP = new Set(["cancelled", "failed"]);

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function mondayOf(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  return t;
}
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** A post's calendar time: published if it went out, else scheduled. */
function whenOf(p) { return p.published_at ?? p.scheduled_at ?? null; }

function openDetail(p) {
  const reel = store.reels.get(p.reel_id);
  const exp = p.experiment_id ? store.experiments.get(p.experiment_id) : null;
  const m = modal(`${p.reel_id}${reel?.title ? `: ${reel.title}` : ""}`, [
    h("div.row", pill(PLATFORM_NAMES[p.platform] ?? p.platform, "info"), pill(p.post_type), pill(p.status, statusKind(p.status)),
      p.method !== "api" ? pill(p.method === "manual" ? "manual post" : p.method) : null),
    h("dl.kv",
      h("dt", "Scheduled"), h("dd", p.scheduled_at ? fmt.dateTime(p.scheduled_at) : "Not scheduled"),
      h("dt", "Published"), h("dd", p.published_at ? fmt.dateTime(p.published_at) : "Not yet"),
      exp ? [h("dt", "Experiment"), h("dd", h("a", { href: `#/experiments/${exp.id}`, onclick: () => m.close() }, exp.name), p.variant_label ? ` (variant ${p.variant_label})` : "")] : null,
      p.error ? [h("dt", "Error"), h("dd", { style: { color: "var(--red)" } }, p.error)] : null,
      p.caption ? [h("dt", "Caption"), h("dd", p.caption.length > 220 ? p.caption.slice(0, 220) + "..." : p.caption)] : null),
    h("div.row.end",
      p.platform_url ? h("a.btn.ghost", { href: p.platform_url, target: "_blank", rel: "noopener" }, "Open on platform") : null,
      h("a.btn.primary", { href: `#/posts?post=${encodeURIComponent(p.id)}`, onclick: () => m.close() }, "Open in Posts")),
  ]);
}

function item(p) {
  const c = PLATFORM_COLORS[p.platform] ?? { bg: "var(--paper-2)", ink: "var(--navy)" };
  const t = new Date(whenOf(p));
  const label = `${p.reel_id} ${SHORT[p.platform] ?? p.platform}`;
  return h("div.cal-item", {
    role: "button", tabindex: 0,
    title: `${label}, ${p.post_type}, ${fmt.label(p.status)}, ${fmt.dateTime(whenOf(p))}`,
    style: { background: c.bg, color: c.ink, borderLeftColor: c.ink, opacity: SKIP.has(p.status) ? ".55" : "1" },
    onclick: () => openDetail(p),
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(p); } },
  }, `${t.getHours()}:${pad(t.getMinutes())} ${label}`, pill(p.status, statusKind(p.status)));
}

const STAGE_KIND = { agreed: "muted", writing: "info", filming: "info", drafted: "info", recorded: "info", spliced: "good", blocked: "bad" };

function planned(r) {
  const label = `${r.id.toUpperCase()} ${r.word_taught ?? ""}`.trim();
  const stage = r.pipeline_status ?? r.status;
  const go = () => { location.hash = `#/library?reel=${encodeURIComponent(r.id)}`; };
  return h("div.cal-item.planned", {
    role: "button", tabindex: 0,
    title: `Planned: ${r.title}. Stage: ${fmt.label(stage)}. No post yet.`,
    onclick: go,
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } },
  }, `Plan ${label}`, pill(stage, STAGE_KIND[stage] ?? "muted"));
}

function weekBadge(count, cadence, weekStartDate, today) {
  const st = cadenceStatus(count, cadence);
  const min = cadence?.organic_per_week_min, max = cadence?.organic_per_week_max;
  const target = min != null && max != null ? `${min} to ${max}` : min != null ? `${min}+` : max != null ? `up to ${max}` : null;
  const future = weekStartDate > today;
  const kind = st === "ok" ? "good" : future ? "info" : "warn";
  const text = st === "below" ? (future ? "plan more" : "below") : st === "above" ? "above" : "on pace";
  return h("span.pill." + kind, { title: `${count} organic post${count === 1 ? "" : "s"} this week${target ? `; cadence ${target} per week` : ""}` },
    `${count}${target ? `/${target.replace(" to ", "-")}` : ""} ${text}`);
}

export function render(root) {
  ensureStyle();
  const now = new Date();
  if (!state.month) state.month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

  const title = h("h2", { style: { margin: 0, minWidth: "170px" } });
  const shift = (n) => {
    const [y, m] = state.month.split("-").map(Number);
    const d = new Date(y, m - 1 + n, 1);
    state.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    draw();
  };
  const head = h("div.view-head",
    h("div", h("h1", "Calendar"), h("p", "Posts by scheduled or published time, planned videos from the content calendar, and the organic cadence for each week.")),
    store.canEdit() ? h("a.btn.primary", { href: "#/launch" }, "Schedule a post") : null);
  const nav = h("div.row", { style: { marginBottom: "12px" } },
    h("button.btn.ghost.small", { onclick: () => shift(-1), "aria-label": "Previous month" }, "Prev"),
    title,
    h("button.btn.ghost.small", { onclick: () => shift(1), "aria-label": "Next month" }, "Next"),
    h("button.btn.ghost.small", { onclick: () => { state.month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`; draw(); } }, "Today"));
  const summary = h("div");
  const grid = h("div.cal-wrap");
  const list = h("div.cal-list");
  const legend = h("div.legend.section", Object.entries(PLATFORM_COLORS).map(([k, c]) =>
    h("span", h("i", { style: { background: c.bg, border: `2px solid ${c.ink}` } }), PLATFORM_NAMES[k] ?? k)),
    h("span", h("i", { style: { background: "transparent", border: "2px dashed var(--ink-3)" } }), "Planned (content calendar)"));
  clear(root, head, summary, nav, grid, list, legend);

  function draw() {
    const today = new Date();
    const todayKey = dayKey(today);
    const cadence = store.setting("cadence") ?? {};
    const [y, m] = state.month.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    title.textContent = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });

    const byDay = new Map();
    const organicByWeek = new Map();
    let unscheduled = 0;
    for (const p of store.posts.values()) {
      const w = whenOf(p);
      if (!w) { if (p.status === "draft") unscheduled += 1; continue; }
      const d = new Date(w);
      const k = dayKey(d);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(p);
      if (p.post_type === "organic" && !SKIP.has(p.status)) {
        const wk = dayKey(mondayOf(d));
        organicByWeek.set(wk, (organicByWeek.get(wk) ?? 0) + 1);
      }
    }
    for (const arr of byDay.values()) arr.sort((a, b) => String(whenOf(a)).localeCompare(String(whenOf(b))));

    // Planned videos with no post yet, on their planned day (a plain date, no time zone).
    const posted = new Set([...store.posts.values()].filter((p) => !SKIP.has(p.status)).map((p) => p.reel_id));
    const plannedByDay = new Map();
    let plannedThisWeek = 0;
    for (const r of store.reels.values()) {
      if (!r.planned_for || posted.has(r.id) || ["shelved", "retired"].includes(r.status)) continue;
      const k = String(r.planned_for).slice(0, 10);
      if (!plannedByDay.has(k)) plannedByDay.set(k, []);
      plannedByDay.get(k).push(r);
      const [py, pm, pd] = k.split("-").map(Number);
      if (dayKey(mondayOf(new Date(py, pm - 1, pd))) === dayKey(mondayOf(today))) plannedThisWeek += 1;
    }
    for (const arr of plannedByDay.values()) arr.sort((a, b) => a.id.localeCompare(b.id));

    // This week's cadence, at the top.
    const thisWeek = dayKey(mondayOf(today));
    const n = organicByWeek.get(thisWeek) ?? 0;
    const st = cadenceStatus(n, cadence);
    const min = cadence.organic_per_week_min, max = cadence.organic_per_week_max;
    clear(summary, h("div.notice" + (st === "ok" ? ".good" : st === "above" ? "" : ".info"), { style: { marginBottom: "14px" } },
      `This week: ${n} organic post${n === 1 ? "" : "s"} published or scheduled` +
      (min != null || max != null ? `, cadence ${min ?? 0} to ${max ?? "any"} per week` : ", no cadence set") +
      (st === "below" ? `. ${min - n} more to reach the minimum.` : st === "above" ? ". Above the recommended cadence." : ".") +
      (unscheduled ? ` ${unscheduled} draft${unscheduled === 1 ? " has" : "s have"} no time yet.` : "") +
      (plannedThisWeek ? ` ${plannedThisWeek} planned video${plannedThisWeek === 1 ? "" : "s"} without a post.` : "")));

    // Month grid, Monday first, plus a cadence column.
    const start = mondayOf(first);
    const last = new Date(y, m, 0);
    const end = addDays(mondayOf(last), 6);
    const cells = [...DOW.map((d) => h("div.cal-head", d)), h("div.cal-head", "Organic")];
    const weeks = [];
    for (let wk = start; wk <= end; wk = addDays(wk, 7)) {
      weeks.push(wk);
      for (let i = 0; i < 7; i++) {
        const d = addDays(wk, i);
        const k = dayKey(d);
        const posts = byDay.get(k) ?? [];
        cells.push(h("div.cal-day" + (k === todayKey ? ".today" : "") + (d.getMonth() !== m - 1 ? ".other" : ""),
          h("span.small", { style: { fontWeight: 800, color: "var(--ink-2)" } }, String(d.getDate())),
          posts.map(item), (plannedByDay.get(k) ?? []).map(planned)));
      }
      cells.push(h("div.cal-week", weekBadge(organicByWeek.get(dayKey(wk)) ?? 0, cadence, dayKey(wk), thisWeek)));
    }
    clear(grid, h("div.cal", cells));

    // Week list for phones: only days with posts.
    clear(list, weeks.map((wk) => {
      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = addDays(wk, i);
        const posts = byDay.get(dayKey(d)) ?? [];
        const plans = plannedByDay.get(dayKey(d)) ?? [];
        if (posts.length || plans.length) days.push(h("div.day",
          h("div.day-label", d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })),
          h("div.day-items", posts.map(item), plans.map(planned))));
      }
      return h("div.card",
        h("div.row.between", h("strong", `Week of ${wk.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`),
          weekBadge(organicByWeek.get(dayKey(wk)) ?? 0, cadence, dayKey(wk), thisWeek)),
        days.length ? days : h("p.small.muted", { style: { margin: "6px 0 0" } }, "Nothing scheduled."));
    }));
  }

  draw();
  return store.on(() => draw());
}
