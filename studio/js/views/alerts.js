// Alerts: unresolved in-app alerts (failed launches, expiring tokens, posts
// beating or missing targets) and the recent job queue, failures first.

import { supa } from "../supa.js";
import { store, href } from "../store.js";
import { h, clear, toast, fmt, pill, statusKind, empty, PLATFORM_NAMES } from "../ui.js";
import { reelTitle, currentUserId } from "./_reel.js";

const SEV = { error: "bad", warn: "", good: "good", info: "info" };
const SEV_RANK = { error: 0, warn: 1, info: 2, good: 3 };

export function render(root) {
  const canEdit = store.canEdit();
  const S = { severity: "" };
  const alertsBox = h("div");
  const jobsBox = h("div");
  const resolveAllBtn = canEdit ? h("button.btn.ghost.small", { onclick: resolveAll }, "Resolve all shown") : null;
  const sevButtons = h("div.row");

  clear(root,
    h("div.view-head", h("div", h("h1", "Alerts"),
      h("p", "Failed launches, expiring tokens, and posts beating or missing targets. Resolved alerts disappear for everyone."))),
    h("div.row.between", { style: { marginBottom: "12px" } }, sevButtons, resolveAllBtn),
    alertsBox,
    h("section.section",
      h("h2", "Recent jobs"),
      h("p.muted.small", "The launch and sync queue for the last 14 days. Failed jobs first."),
      jobsBox));

  function list() {
    return [...store.alerts.values()]
      .filter((a) => !a.resolved_at && (!S.severity || a.severity === S.severity))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  async function resolve(ids) {
    const uid = await currentUserId();
    const { error } = await supa.from("alerts").update({ resolved_at: new Date().toISOString(), resolved_by: uid }).in("id", ids);
    if (error) return toast(`Could not resolve: ${error.message}`, "bad");
    for (const id of ids) store.alerts.delete(id);
    store.emit("alerts");
    toast(ids.length === 1 ? "Resolved" : `${ids.length} alerts resolved`, "good");
  }

  function resolveAll() {
    const ids = list().map((a) => a.id);
    if (ids.length) resolve(ids);
  }

  function renderSev() {
    const all = [...store.alerts.values()].filter((a) => !a.resolved_at);
    const counts = {};
    for (const a of all) counts[a.severity] = (counts[a.severity] ?? 0) + 1;
    const opts = [["", `All (${all.length})`], ...["error", "warn", "info", "good"].filter((s) => counts[s]).map((s) =>
      [s, `${{ error: "Errors", warn: "Warnings", info: "Info", good: "Good news" }[s]} (${counts[s]})`])];
    clear(sevButtons, opts.map(([v, t]) => h(`button.btn.small${S.severity === v ? ".primary" : ".ghost"}`,
      { onclick: () => { S.severity = v; renderAlerts(); } }, t)));
  }

  function renderAlerts() {
    renderSev();
    const items = list();
    if (resolveAllBtn) resolveAllBtn.style.display = items.length > 1 ? "" : "none";
    if (!items.length) return clear(alertsBox, empty(S.severity ? "Nothing at this level." : "All clear. Nothing needs attention."));
    clear(alertsBox, h("div.stack", items.map((a) => {
      const post = a.post_id ? store.posts.get(a.post_id) : null;
      const conn = a.connection_id ? store.connections.get(a.connection_id) : null;
      return h(`div.notice${SEV[a.severity] ? "." + SEV[a.severity] : ""}`, { style: { display: "flex", gap: "12px", alignItems: "flex-start", flexWrap: "wrap" } },
        h("div", { style: { flex: "1 1 260px", minWidth: "0" } },
          h("div", { style: { fontWeight: "700" } }, a.message),
          h("div.small", { style: { opacity: ".85", marginTop: "2px" } },
            `${fmt.label(a.kind)} · ${fmt.ago(a.created_at)}`,
            post ? h("span", " · ", h("a", { href: href(`posts?post=${encodeURIComponent(post.id)}`) },
              `${reelTitle(post.reel_id)} on ${PLATFORM_NAMES[post.platform]}`)) : null,
            a.post_id && !post ? " · post no longer listed" : null,
            conn || a.connection_id ? h("span", " · ", h("a", { href: href("connections") },
              conn ? `${PLATFORM_NAMES[conn.platform]} connection` : "Connections")) : null)),
        canEdit ? h("button.btn.small", { onclick: () => resolve([a.id]) }, "Resolve") : null);
    })));
  }

  function renderJobs() {
    const jobs = [...store.jobs.values()].sort((a, b) =>
      (a.status === "failed" ? 0 : 1) - (b.status === "failed" ? 0 : 1)
      || String(b.updated_at ?? b.created_at).localeCompare(String(a.updated_at ?? a.created_at)));
    if (!jobs.length) return clear(jobsBox, empty("No jobs in the last 14 days."));
    const shown = jobs.slice(0, 100);
    clear(jobsBox, h("div.table-wrap", { style: { maxHeight: "480px" } }, h("table.data",
      h("thead", h("tr", ["Job", "Platform", "Post", "Status", "Attempts", "Run at", "Updated", "Error"].map((t) => h("th", t)))),
      h("tbody", shown.map((j) => {
        const post = j.post_id ? store.posts.get(j.post_id) : null;
        return h("tr",
          h("td", fmt.label(j.kind)),
          h("td", PLATFORM_NAMES[j.platform] ?? j.platform ?? "–"),
          h("td", post ? h("a", { href: href(`posts?post=${encodeURIComponent(post.id)}`) }, post.reel_id.toUpperCase()) : "–"),
          h("td", pill(j.status, statusKind(j.status === "pending" ? "scheduled" : j.status))),
          h("td.num", `${j.attempts} / ${j.max_attempts}`),
          h("td", { style: { whiteSpace: "nowrap" } }, fmt.dateTime(j.run_at)),
          h("td", { style: { whiteSpace: "nowrap" } }, fmt.ago(j.updated_at ?? j.created_at)),
          h("td.small", { style: { color: "var(--red)", minWidth: "200px" } }, j.last_error ?? ""));
      })))),
    jobs.length > shown.length ? h("p.hint", `Showing 100 of ${jobs.length}.`) : null);
  }

  renderAlerts();
  renderJobs();
  return store.on((t) => {
    if (["alerts", "posts", "connections", "*"].includes(t)) renderAlerts();
    if (["jobs", "posts", "*"].includes(t)) renderJobs();
  });
}
