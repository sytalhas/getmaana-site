// Posts: every post across platforms with its status, latest metrics and
// actions (details, sync now, cancel, reset, the manual and TikTok-inbox
// paths, manual metrics) plus a CSV export.

import { supa, api } from "../supa.js";
import { store, href } from "../store.js";
import {
  h, clear, toast, modal, confirmAction, fmt, pill, statusKind, field, select, empty, downloadFile, PLATFORM_NAMES,
} from "../ui.js";
import { POST_PLATFORMS, reelTitle, mergedLatest, fileName, copyText, METRIC_FIELDS, sortReels } from "./_reel.js";
import { mediaLink } from "../media.js";
import { carouselPanel, carouselSteps, isCarousel, MANUAL_QUALITY, packagePanel, slidesOf } from "./_carousel.js";
import { draftPackages, inPackage, planLaunch, launchLine, launchIds, launchSummary, packageSummary, PLATFORM_LABEL } from "../oneclick.js";
import { tiktokPanel } from "./_tiktok.js";
import { PRIVACY_LABELS, PROCESSING_NOTE } from "../tiktok_ux.js";

const STATUSES = ["draft", "scheduled", "publishing", "awaiting_manual", "inbox_draft", "private_until_audit", "live", "failed", "cancelled"];
const PLATFORMS = [...POST_PLATFORMS, "meta_ads"];
const CANCELLABLE = ["draft", "scheduled", "awaiting_manual", "inbox_draft", "failed"];

export function render(root, { params = {} } = {}) {
  const state = { platform: params.platform ?? "", status: params.status ?? "", type: params.type ?? "", reel: params.reel ?? "" };
  const canEdit = store.canEdit();

  const fPlatform = select([["", "All platforms"], ...PLATFORMS.map((p) => [p, PLATFORM_NAMES[p]])], state.platform,
    { onchange: (e) => { state.platform = e.target.value; renderTable(); } });
  const fStatus = select([["", "Any status"], ...STATUSES.map((s) => [s, fmt.label(s)])], state.status,
    { onchange: (e) => { state.status = e.target.value; renderTable(); } });
  const fType = select([["", "Any type"], ["organic", "Organic"], ["trial", "Trial"], ["paid", "Paid"]], state.type,
    { onchange: (e) => { state.type = e.target.value; renderTable(); } });
  const reelWrap = h("span");
  function fillReelFilter() {
    const ids = new Set([...store.posts.values()].map((p) => p.reel_id));
    const reels = sortReels([...store.reels.values()].filter((r) => ids.has(r.id)));
    const key = reels.map((r) => r.id).join("|");
    if (reelWrap.dataset.key === key) return;
    reelWrap.dataset.key = key;
    clear(reelWrap, select([["", "All reels"], ...reels.map((r) => [r.id, `${r.id.toUpperCase()} ${r.title}`])], state.reel,
      { onchange: (e) => { state.reel = e.target.value; renderTable(); } }));
  }
  fillReelFilter();

  const countEl = h("p");
  const tableBox = h("div");
  const packagesBox = h("div");

  clear(root,
    h("div.view-head",
      h("div", h("h1", "Posts"), countEl),
      h("div.row",
        canEdit ? h("button.btn.ghost", { onclick: syncAll }, "Sync all live posts") : null,
        h("button.btn", { onclick: exportCsv }, "Export CSV"))),
    h("div.filters",
      field("Platform", fPlatform), field("Status", fStatus), field("Type", fType),
      h("label.field", h("span.field-label", "Reel"), reelWrap)),
    packagesBox,
    tableBox);

  // Packages sent from content-creator (post generator carousels, own carousels, photos and reels): one "Check and
  // launch all" per package.
  function renderPackages() {
    const pk = draftPackages([...store.posts.values()], store.reels);
    if (!pk.size || !canEdit) return clear(packagesBox);
    clear(packagesBox, h("section.card.stack.packages", { style: { marginBottom: "16px" } },
      h("h3", { style: { margin: "0" } }, `Ready to launch (${pk.size})`),
      h("p.small.muted", { style: { margin: "0" } }, "Each post's drafts launch together: Studio runs pre-flight on every draft, shows you one list of what publishes where, and launches only after you confirm. Drafts with a sound you add by hand stay manual."),
      [...pk.entries()].map(([reelId, drafts]) => h("div.row.between.package-row", { style: { gap: "10px", borderTop: "1px solid var(--line)", paddingTop: "10px" } },
        h("div", { style: { minWidth: "0", flex: "1 1 260px" } },
          h("strong", reelTitle(reelId)),
          h("div.small.muted", drafts.map((p) => `${PLATFORM_LABEL[p.platform]} (${p.method === "manual" ? "manual" : p.method === "inbox_draft" ? "TikTok inbox" : "API"})`).join(" · "))),
        h("button.btn.coral", { onclick: (e) => launchPackage(reelId, e.currentTarget), title: packageSummary(drafts) }, "Check and launch all")))));
  }

  function filtered() {
    return [...store.posts.values()]
      .filter((p) => (!state.platform || p.platform === state.platform)
        && (!state.status || p.status === state.status)
        && (!state.type || p.post_type === state.type)
        && (!state.reel || p.reel_id === state.reel))
      .sort((a, b) => String(b.published_at ?? b.scheduled_at ?? b.created_at)
        .localeCompare(String(a.published_at ?? a.scheduled_at ?? a.created_at)));
  }

  function renderTable() {
    fillReelFilter();
    const all = store.posts.size;
    const list = filtered();
    countEl.textContent = all ? `${list.length} of ${all} posts. Metrics sync hourly for a week, then daily.` : "";
    if (!all) {
      clear(tableBox, empty(`No posts yet for ${store.brand()}. Posts appear here once a reel is launched or scheduled, with live insights after publishing.`,
        canEdit ? h("div.row", { style: { justifyContent: "center" } },
          h("a.btn.primary", { href: href("launch") }, "Launch a reel"),
          !store.connections.size ? h("a.btn.ghost", { href: href("connections") }, "Connect accounts first") : null) : null));
      return;
    }
    if (!list.length) return clear(tableBox, empty("No posts match these filters."));
    const heads = ["Reel", "Platform", "Type", "Method", "Status", "When", "Views", "Likes", "Shares", "Saves", "Avg watch", "Synced", ""];
    clear(tableBox, h("div.table-wrap", h("table.data",
      h("thead", h("tr", heads.map((t, i) => h(i >= 6 && i <= 10 ? "th.num" : "th", t)))),
      h("tbody", list.map(row)))));
  }

  function row(p) {
    const m = mergedLatest(p.id);
    const needsYou = (p.method === "manual" && p.status === "awaiting_manual") || (p.method === "inbox_draft" && p.status === "inbox_draft");
    const when = p.published_at
      ? h("span", { title: "Published" }, fmt.dateTime(p.published_at))
      : p.scheduled_at ? h("span", { title: "Scheduled" }, fmt.dateTime(p.scheduled_at), h("div.small.muted", "scheduled"))
        : h("span.muted", fmt.dateTime(p.created_at));
    return h("tr",
      h("td", { style: { minWidth: "120px" } }, h("a", { href: href(`library?reel=${encodeURIComponent(p.reel_id)}`) }, p.reel_id.toUpperCase()),
        h("div.small.muted", store.reels.get(p.reel_id)?.title ?? ""),
        isCarousel(p) ? h("span.pill.small", `carousel · ${slidesOf(p).length} slides`) : null),
      h("td", PLATFORM_NAMES[p.platform] ?? p.platform),
      h("td", fmt.label(p.post_type)),
      h("td", fmt.label(p.method)),
      h("td", { style: { minWidth: "130px" } }, pill(p.status, statusKind(p.status)),
        p.error ? h("div.small", { style: { color: "var(--red)", maxWidth: "220px", marginTop: "4px" }, title: p.error }, truncate(p.error, 80)) : null),
      h("td", { style: { whiteSpace: "nowrap" } }, when),
      h("td.num", fmt.int(m?.views)),
      h("td.num", fmt.int(m?.likes)),
      h("td.num", fmt.int(m?.shares)),
      h("td.num", fmt.int(m?.saves)),
      h("td.num", fmt.sec(m?.avg_watch_s)),
      h("td.small", { style: { whiteSpace: "nowrap" } }, p.last_synced_at ? fmt.ago(p.last_synced_at) : "–"),
      h("td", { style: { minWidth: "170px" } }, h("div.row", { style: { gap: "6px" } },
        needsYou && canEdit ? h("button.btn.small.coral", { onclick: () => openManual(p.id) },
          p.platform === "tiktok" ? "Finish in TikTok" : "Checklist") : null,
        h("button.btn.small", { onclick: () => openDetail(p.id) }, "Details"),
        canEdit && p.platform_media_id && ["live", "private_until_audit"].includes(p.status)
          ? h("button.btn.small.ghost", { onclick: (e) => syncNow(p.id, e.currentTarget) }, "Sync now") : null,
        canEdit && p.status === "failed"
          ? h("button.btn.small.ghost", { onclick: () => resetDraft(p) }, "Reset to draft") : null,
        canEdit && CANCELLABLE.includes(p.status)
          ? h("button.btn.small.danger", { onclick: () => cancelPost(p) }, "Cancel") : null)));
  }

  async function syncNow(id, btn) {
    if (btn) btn.disabled = true;
    try {
      const out = await api("sync", { post_id: id });
      toast(out.queued ? "Sync queued. New numbers appear here when it finishes." : "Nothing to sync", "good");
    } catch (e) {
      toast(`Sync failed: ${e.message}`, "bad");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function syncAll() {
    try {
      const out = await api("sync", {});
      toast(`${out.queued ?? 0} posts queued for sync`, "good");
    } catch (e) {
      toast(`Sync failed: ${e.message}`, "bad");
    }
  }

  async function cancelPost(p) {
    const ok = await confirmAction("Cancel this post?", [
      `${reelTitle(p.reel_id)} on ${PLATFORM_NAMES[p.platform]} (${fmt.label(p.status)}).`,
      p.status === "scheduled" ? "Its publish job is cancelled, so nothing goes out." : "It stays in the list as cancelled.",
      p.platform_media_id ? "Anything already on the platform stays there: delete it in the platform's app if needed." : null,
    ].filter(Boolean), "Cancel post");
    if (!ok) return;
    const { error } = await supa.from("posts").update({ status: "cancelled" }).eq("id", p.id);
    toast(error ? `Could not cancel: ${error.message}` : "Post cancelled", error ? "bad" : "good");
  }

  async function resetDraft(p) {
    const { error } = await supa.from("posts").update({ status: "draft", error: null }).eq("id", p.id);
    toast(error ? `Could not reset: ${error.message}` : "Back to draft. Open Details to check and confirm it again.", error ? "bad" : "good");
  }

  function exportCsv() {
    const list = filtered();
    const cols = ["id", "reel_id", "reel_title", "platform", "post_type", "method", "status", "scheduled_at", "published_at",
      "platform_url", "campaign_ct", "experiment_id", "variant_label", "last_synced_at", "metrics_captured_at", ...METRIC_FIELDS, "error"];
    const lines = [cols.join(",")];
    for (const p of list) {
      const m = mergedLatest(p.id) ?? {};
      const rec = { ...p, reel_title: store.reels.get(p.reel_id)?.title ?? "", metrics_captured_at: m.captured_at ?? "" };
      for (const k of METRIC_FIELDS) rec[k] = m[k] ?? "";
      lines.push(cols.map((c) => csvCell(rec[c])).join(","));
    }
    downloadFile(`${store.wsId}-posts-${new Date().toISOString().slice(0, 10)}.csv`, lines.join("\n") + "\n");
    toast(`Exported ${list.length} posts`, "good");
  }

  renderTable();
  renderPackages();
  if (params.post && store.posts.has(params.post)) openDetail(params.post);

  return store.on((table) => {
    if (["posts", "reels", "metrics_snapshots", "*"].includes(table)) renderTable();
    if (["posts", "reels", "*"].includes(table)) renderPackages();
  });
}

// ---------------------------------------------------------------------------
// One-click launch for a carousel package (rules in ../oneclick.js)
// ---------------------------------------------------------------------------

function connLabel(p) {
  const list = [...store.connections.values()].filter((c) => c.platform === p.platform);
  const c = list.find((x) => x.id === p.connection_id) ?? list.find((x) => x.status !== "disconnected") ?? null;
  return c ? (c.account_name ?? c.account_id) : null;
}

export async function launchPackage(reelId, btn) {
  const drafts = [...store.posts.values()].filter((p) => p.reel_id === reelId && inPackage(p, store.reels) && p.status === "draft");
  if (!drafts.length) return toast("This post has no drafts left to launch.", "warn");
  if (btn) { btn.disabled = true; btn.textContent = "Checking"; }
  const results = {};
  try {
    // Pre-flight on every draft that could launch by API (manual ones are checked when launched from Details).
    await Promise.all(drafts.filter((p) => p.method !== "manual").map((p) => api("preflight", { post_id: p.id })
      .then((r) => { results[p.id] = r; })
      .catch((e) => { results[p.id] = { ok: false, errors: [`Pre-flight could not run: ${e.message}`] }; })));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Check and launch all"; }
  }
  const plan = planLaunch(drafts, results);
  const when = (p) => (p.scheduled_at && new Date(p.scheduled_at) > new Date() ? fmt.dateTime(p.scheduled_at) : null);
  // Plain summary first, one line per platform; the full lines (slides, sound, caption, account) behind Details.
  const MARK = { launch: "✓", manual: "•", own: "•", blocked: "✗" };
  const lines = [
    h("p.small.muted", `${reelTitle(reelId)} · ${isCarousel(drafts[0]) ? `${slidesOf(drafts[0]).length} slide${slidesOf(drafts[0]).length === 1 ? "" : "s"}` : "video"}`),
    h("ul.launch-summary", launchSummary(plan, { when }).map((r) => h(`li.${r.kind}`, h("span.mark", MARK[r.kind]), r.text))),
    plan.launch.length ? "Nothing else changes. You can cancel a scheduled post in Posts until it goes out." : "Nothing can go out from here right now.",
    h("details.small",
      h("summary", "Details"),
      h("ul.launch-details",
        ...plan.launch.map(({ post }) => h("li", launchLine(post, { slides: slidesOf(post).length, when: when(post), account: connLabel(post) }))),
        ...plan.manual.map(({ post, why }) => h("li", `${PLATFORM_LABEL[post.platform]} ${why}`)),
        ...plan.ownScreen.map(({ post, why }) => h("li", `${PLATFORM_LABEL[post.platform]}: ${why}`)),
        ...plan.blocked.map(({ post, why }) => h("li", `${PLATFORM_LABEL[post.platform]}: blocked by pre-flight: ${why}`)))),
  ];
  if (!plan.launch.length) {
    await confirmAction(`Launch ${reelTitle(reelId)}?`, lines, "OK");
    return;
  }
  const ok = await confirmAction(`Launch ${plan.launch.length} post${plan.launch.length === 1 ? "" : "s"} of ${isCarousel(drafts[0]) ? "this carousel" : "this video"}?`, lines,
    `Launch ${plan.launch.length}`);
  if (!ok) return;
  const ids = launchIds(plan);
  const { error } = await supa.rpc("confirm_posts", { p_ids: ids });
  if (error) return toast(`Launch failed, nothing was launched: ${error.message}`, "bad");
  toast(`Launched ${ids.length} post${ids.length === 1 ? "" : "s"}.${plan.manual.length ? ` ${plan.manual.length} manual draft${plan.manual.length === 1 ? "" : "s"} still wait${plan.manual.length === 1 ? "s" : ""} for you.` : ""}${plan.launch.some(({ post }) => post.platform === "tiktok") ? ` ${PROCESSING_NOTE}` : ""}`, "good");
}

// ---------------------------------------------------------------------------
// Detail modal
// ---------------------------------------------------------------------------

function openDetail(id) {
  const canEdit = store.canEdit();
  const top = h("div");
  const cache = {};   // the TikTok screen survives live re-renders (keeps the person's choices; one creator_info read)
  const timeline = h("div");
  const history = h("div");

  function renderLive() {
    const p = store.posts.get(id);
    if (!p) return clear(top, h("div.notice.bad", "This post was deleted."));
    const a = p.asset_id ? store.assets.get(p.asset_id) : null;
    const pf = p.preflight;
    clear(top,
      h("div.row", pill(p.status, statusKind(p.status)), h("span.muted", `${PLATFORM_NAMES[p.platform]} · ${fmt.label(p.post_type)} · ${fmt.label(p.method)}`)),
      p.error ? h("div.notice.bad", p.error) : null,
      p.platform === "tiktok" && ["scheduled", "publishing"].includes(p.status) ? h("div.notice.info", PROCESSING_NOTE) : null,
      p.status === "private_until_audit"
        ? h("div.notice", "YouTube keeps uploads from unaudited API projects private until Google's audit passes. The owner can apply from Connections.") : null,
      h("div.grid.cols-3",
        kv("Reel", h("a", { href: href(`library?reel=${encodeURIComponent(p.reel_id)}`) }, reelTitle(p.reel_id))),
        kv("File", isCarousel(p) ? `${slidesOf(p).length} slides, ${a?.width ?? "?"}x${a?.height ?? "?"} JPEG` : a ? fileName(a) : "–"),
        kv("Scheduled", fmt.dateTime(p.scheduled_at)),
        kv("Published", fmt.dateTime(p.published_at)),
        kv("Confirmed", p.confirmed_at ? fmt.dateTime(p.confirmed_at) : "not yet"),
        kv("Campaign id", p.campaign_ct ?? "reserved at Check"),
        kv("On the platform", p.platform_url
          ? h("a", { href: p.platform_url, target: "_blank", rel: "noopener", style: { wordBreak: "break-all" } }, "Open post")
          : "–"),
        kv("Last synced", p.last_synced_at ? fmt.ago(p.last_synced_at) : "never"),
        kv("Next sync", fmt.dateTime(p.next_sync_at))),
      p.caption ? h("details", h("summary", { style: { cursor: "pointer", fontWeight: "700" } }, "Caption"),
        h("pre", p.caption), h("button.btn.small.ghost", { onclick: () => copyText(p.caption, "Caption") }, "Copy caption")) : null,
      isCarousel(p) ? carouselPanel(p) : inPackage(p, store.reels) ? packagePanel(p) : null,
      h("h3", "Pre-flight"),
      pf ? h("div.stack", { style: { gap: "4px" } },
        h("div.row", pf.ok ? pill("passed", "good") : pill("blocked", "bad"), h("span.small.muted", `checked ${fmt.ago(pf.checked_at)}`)),
        pf.errors?.length ? h("ul.preflight-list.errors", pf.errors.map((e) => h("li", e))) : null,
        pf.warnings?.length ? h("ul.preflight-list.warnings", pf.warnings.map((w) => h("li", w))) : null)
        : h("p.muted", "Not checked yet."),
      canEdit && p.status === "draft" ? draftActions(p, cache) : null,
      canEdit && p.status === "draft" && inPackage(p, store.reels) && [...store.posts.values()].filter((x) => x.reel_id === p.reel_id && inPackage(x, store.reels) && x.status === "draft").length > 1
        ? h("div.row.end", h("span.small.muted", `Or launch every draft of this ${isCarousel(p) ? "carousel" : "video"} together:`),
          h("button.btn.ghost", { onclick: (e) => launchPackage(p.reel_id, e.currentTarget) }, "Check and launch all")) : null);

    const jobs = [...store.jobs.values()].filter((j) => j.post_id === id);
    const events = [
      { at: p.created_at, what: "Draft created" },
      p.confirmed_at ? { at: p.confirmed_at, what: "Confirmed by a teammate" } : null,
      p.published_at ? { at: p.published_at, what: "Published" } : null,
      ...jobs.map((j) => ({
        at: j.updated_at ?? j.created_at,
        what: `${fmt.label(j.kind)} job ${fmt.label(j.status)} (attempt ${j.attempts} of ${j.max_attempts}${j.status === "pending" ? `, runs ${fmt.dateTime(j.run_at)}` : ""})`,
        kind: j.status === "failed" ? "bad" : j.status === "done" ? "good" : "",
        err: j.last_error,
      })),
    ].filter(Boolean).sort((x, y) => String(x.at).localeCompare(String(y.at)));
    clear(timeline, h("ul.checklist", events.map((e) => h("li",
      h("span.small.muted", { style: { minWidth: "110px" } }, fmt.dateTime(e.at)),
      h("div", e.kind ? h(`span.pill.${e.kind}`, e.what) : e.what, e.err ? h("div.small", { style: { color: "var(--red)" } }, e.err) : null)))));

    const snaps = [...(store.metrics.get(id) ?? [])].reverse().slice(0, 50);
    clear(history, snaps.length ? h("div.table-wrap", { style: { maxHeight: "320px" } }, h("table.data",
      h("thead", h("tr", ["Captured", "Source", "Views", "Reach", "Likes", "Comments", "Shares", "Saves", "Avg watch", "Installs"]
        .map((t, i) => h(i >= 2 ? "th.num" : "th", t)))),
      h("tbody", snaps.map((s) => h("tr",
        h("td", fmt.dateTime(s.captured_at)), h("td", fmt.label(s.source)),
        h("td.num", fmt.int(num(s.views))), h("td.num", fmt.int(num(s.reach))), h("td.num", fmt.int(num(s.likes))),
        h("td.num", fmt.int(num(s.comments))), h("td.num", fmt.int(num(s.shares))), h("td.num", fmt.int(num(s.saves))),
        h("td.num", fmt.sec(num(s.avg_watch_s))), h("td.num", fmt.int(num(s.installs))))))))
      : h("p.muted", "No metrics yet."));
  }

  const p0 = store.posts.get(id);
  const m = modal(`${p0 ? reelTitle(p0.reel_id) : "Post"} on ${PLATFORM_NAMES[p0?.platform] ?? "?"}`, [
    top,
    h("h3", "Timeline"), timeline,
    h("h3", "Metrics history"), history,
    canEdit ? manualMetricsForm(id) : null,
  ], { wide: true, onClose: () => off() });
  const off = store.on((t) => { if (["posts", "jobs", "metrics_snapshots", "assets", "reels", "*"].includes(t)) renderLive(); });
  renderLive();
  return m;
}

// A TikTok draft: inbox or direct post (direct needs TIKTOK_DIRECT_POST; carousels also need the verified photo link).
function tiktokMethod(p) {
  if (p.platform !== "tiktok" || p.method === "manual") return null;
  const conn = [...store.connections.values()].find((c) => c.platform === "tiktok" && c.status !== "disconnected");
  if (!conn?.info?.direct_post && p.method !== "api") return null;
  const sel = select([["inbox_draft", "Send to the TikTok inbox as a draft"], ["api", "Direct post (you choose privacy and settings)"]], p.method, {
    onchange: async (e) => {
      const { error } = await supa.from("posts").update({ method: e.target.value }).eq("id", p.id).eq("status", "draft");
      toast(error ? `Could not change: ${error.message}` : "Method changed. Pre-flight runs again at Launch.", error ? "bad" : "good");
    },
  });
  return field("TikTok method", sel);
}

// A TikTok direct post: TikTok's own screen (creator, privacy, interactions, disclosure, declaration), then one
// confirmation. The choices are saved to options.tiktok, which clears pre-flight, so pre-flight runs again first.
function tiktokDirectActions(p, cache) {
  const a = p.asset_id ? store.assets.get(p.asset_id) : null;
  if (!cache.tt || cache.ttFor !== p.id) {
    cache.ttFor = p.id;
    cache.tt = tiktokPanel({
      kind: isCarousel(p) ? "photo" : "video", connectionId: p.connection_id ?? null, durationS: a?.duration_s ?? null,
      photos: isCarousel(p) ? slidesOf(p).map((i) => i.url) : [], videoUrl: isCarousel(p) ? null : a?.url ?? null,
      saved: p.options?.tiktok ?? null, caption: p.caption ?? "", onChange: () => { cache.btn && (cache.btn.disabled = cache.tt.problems().length > 0); },
    });
  }
  const tt = cache.tt;
  const btn = h("button.btn.coral", {
    disabled: tt.problems().length > 0,
    onclick: async () => {
      const probs = tt.problems();
      if (probs.length) return toast(probs[0], "warn");
      btn.disabled = true;
      try {
        const cur = store.posts.get(p.id) ?? p;
        const value = tt.value();
        const text = tt.caption() ?? cur.caption;
        if (JSON.stringify(cur.options?.tiktok ?? null) !== JSON.stringify(value) || text !== cur.caption) {
          const { error } = await supa.from("posts").update({ caption: text, options: { ...(cur.options ?? {}), tiktok: value } }).eq("id", p.id).eq("status", "draft");
          if (error) return toast(`Could not save the TikTok settings: ${error.message}`, "bad");
        }
        const r = await api("preflight", { post_id: p.id });
        if (!r.ok) return toast(`Pre-flight blocked this post: ${r.errors?.[0] ?? ""}`, "warn");
        const c = tt.creator();
        const yes = await confirmAction(`Post to TikTok as ${c?.creator_nickname ?? "this account"}?`, [
          isCarousel(p) ? `Photo post: ${reelTitle(p.reel_id)}, ${slidesOf(p).length} photos.` : `Video: ${reelTitle(p.reel_id)}.`,
          `Who can see it: ${PRIVACY_LABELS[value.privacy_level] ?? value.privacy_level}. Comments ${value.allow_comment ? "on" : "off"}${isCarousel(p) ? "" : `, Duet ${value.allow_duet ? "on" : "off"}, Stitch ${value.allow_stitch ? "on" : "off"}`}.`,
          value.disclose ? `Disclosed as ${[value.brand_organic && "Your brand", value.branded_content && "Branded content"].filter(Boolean).join(" and ")}.` : "No commercial content disclosure.",
          value.title ? `Title: ${value.title}` : null,
          `Caption ${(text ?? "").length} characters.`,
          value.declaration,
          "Nothing is sent to TikTok until you press Post.",
        ].filter(Boolean), "Post");
        if (!yes) return;
        const { error } = await supa.rpc("confirm_posts", { p_ids: [p.id] });
        toast(error ? `Launch failed: ${error.message}` : `Confirmed and queued. ${PROCESSING_NOTE}`, error ? "bad" : "good");
      } catch (e) {
        toast(`Could not launch: ${e.message}`, "bad");
      } finally {
        btn.disabled = false;
      }
    },
  }, "Post to TikTok");
  cache.btn = btn;
  return h("div.stack", h("h3", "TikTok post settings"), tt.el, h("div.row.end", btn));
}

// A draft (new, or a failed post reset to draft) can be checked and confirmed here.
function draftActions(p, cache = {}) {
  const method = tiktokMethod(p);
  if (p.platform === "tiktok" && p.method === "api") return h("div.stack", method, tiktokDirectActions(p, cache));
  const checkBtn = h("button.btn", {
    onclick: async () => {
      checkBtn.disabled = true;
      try {
        const r = await api("preflight", { post_id: p.id });
        toast(r.ok ? "Pre-flight passed" : "Pre-flight blocked this post", r.ok ? "good" : "warn");
      } catch (e) {
        toast(`Pre-flight could not run: ${e.message}`, "bad");
      } finally {
        checkBtn.disabled = false;
      }
    },
  }, "Run pre-flight");
  const ok = !!p.preflight?.ok;
  const confirmBtn = h("button.btn.coral", {
    disabled: !ok,
    title: ok ? null : "Run pre-flight first",
    onclick: async () => {
      const a = p.asset_id ? store.assets.get(p.asset_id) : null;
      const yes = await confirmAction(`Launch ${p.reel_id.toUpperCase()} on ${PLATFORM_NAMES[p.platform]}?`, [
        isCarousel(p)
          ? `Carousel: ${reelTitle(p.reel_id)}, ${slidesOf(p).length} slides. Sound: ${p.options?.audio?.choice?.label ?? "none"}.`
          : `Reel: ${reelTitle(p.reel_id)}. File: ${a ? fileName(a) : "none"}.`,
        `${PLATFORM_NAMES[p.platform]}: ${fmt.label(p.post_type)}, ${p.method === "manual" ? "posted by hand from the checklist" : p.method === "inbox_draft" ? "sent to the TikTok inbox as a draft" : "published with the API"}, caption ${(p.caption ?? "").length} characters.`,
        p.scheduled_at && new Date(p.scheduled_at) > new Date() ? `When: ${fmt.dateTime(p.scheduled_at)}.` : "When: now.",
      ], "Launch");
      if (!yes) return;
      const { error } = await supa.rpc("confirm_posts", { p_ids: [p.id] });
      toast(error ? `Launch failed: ${error.message}` : "Confirmed and queued", error ? "bad" : "good");
    },
  }, "Launch");
  return h("div.stack", method, h("div.row.end", checkBtn, confirmBtn));
}

function manualMetricsForm(postId) {
  const FIELDS = [["views", "Views"], ["reach", "Reach"], ["likes", "Likes"], ["comments", "Comments"], ["shares", "Shares"],
    ["saves", "Saves"], ["follows", "Follows"], ["link_clicks", "Link clicks"], ["avg_watch_s", "Avg watch (s)"], ["installs", "Installs"]];
  const inputs = Object.fromEntries(FIELDS.map(([k]) => [k, h("input", { type: "number", min: "0", step: k === "avg_watch_s" ? "0.1" : "1", inputmode: "decimal" })]));
  const when = h("input", { type: "datetime-local" });
  const btn = h("button.btn.primary", { type: "submit" }, "Add snapshot");
  const form = h("form.stack", {
    onsubmit: async (e) => {
      e.preventDefault();
      const row = { workspace_id: store.wsId, post_id: postId, source: "manual" };
      let any = false;
      for (const [k] of FIELDS) {
        const v = inputs[k].value.trim();
        if (v !== "") { row[k] = Number(v); any = true; }
      }
      if (!any) return toast("Enter at least one number", "warn");
      if (when.value) row.captured_at = new Date(when.value).toISOString();
      btn.disabled = true;
      const { error } = await supa.from("metrics_snapshots").insert(row);
      btn.disabled = false;
      if (error) return toast(`Could not save: ${error.message}`, "bad");
      for (const [k] of FIELDS) inputs[k].value = "";
      toast("Manual snapshot added", "good");
    },
  },
  h("p.hint", "For platforms or posts without API insights. Copy the numbers from the platform's insights screen. Each entry is a new snapshot, so the history stays intact."),
  h("div.grid.cols-4", FIELDS.map(([k, l]) => field(l, inputs[k]))),
  h("div.row", field("Captured at (blank: now)", when), h("div", { style: { marginLeft: "auto" } }, btn)));
  return h("details.card", { style: { padding: "12px 16px" } },
    h("summary", { style: { cursor: "pointer", fontWeight: "800" } }, "Add metrics by hand"),
    h("div", { style: { marginTop: "10px" } }, form));
}

// ---------------------------------------------------------------------------
// Manual path: Instagram cuts whose sound is added in the app (Maana's
// recitation cuts), TikTok inbox drafts
// ---------------------------------------------------------------------------

function openManual(id) {
  const p = store.posts.get(id);
  if (!p) return;
  const tiktok = p.platform === "tiktok";
  const facebook = p.platform === "facebook";
  const reel = store.reels.get(p.reel_id);
  const asset = p.asset_id ? store.assets.get(p.asset_id) : null;
  const saved = { ...(p.manual_checklist ?? {}) };

  const copyCaption = h("button.btn.small.ghost", { onclick: () => copyText(p.caption, "Caption") }, "Copy caption");
  const posting = reel?.folder ? `marketing/${reel.folder}/POSTING.md` : "the reel's POSTING.md";
  const steps = isCarousel(p) ? carouselSteps(p, copyCaption) : tiktok
    ? [
      ["quality", MANUAL_QUALITY.tiktok],
      ["inbox", "Open the TikTok app and tap the inbox notification: the video is waiting as a draft."],
      ["caption", h("span", "Paste the caption. ", copyCaption)],
      ["cover", "Pick the cover frame and check the sound: no music."],
      ["post", "Tap Post."],
      ["bio", "Make sure the bio link carries this post's campaign link once the app is live."],
    ]
    : [
      ["quality", MANUAL_QUALITY.instagram],
      ["download", h("span", "Download the silent cut: ",
        asset?.url ? mediaLink(h("a", { download: fileName(asset), target: "_blank", rel: "noopener" }, fileName(asset)), asset.url) : "no media URL yet",
        ". Save it to the phone that posts to the Instagram account.")],
      ["create", "In Instagram, tap +, then Reel, and pick that file."],
      ["sound", store.recitation()
        ? h("span", "Add the recitation from Instagram's sound library exactly as noted in ", h("code", posting),
          " (search terms, in-point, trim). Never use a file with recitation baked in.",
          reel?.notes ? h("div.small.muted", { style: { marginTop: "4px", whiteSpace: "pre-wrap" } }, reel.notes) : null)
        : h("span", "Add the sound in Instagram as the reel's notes say.",
          reel?.notes ? h("div.small.muted", { style: { marginTop: "4px", whiteSpace: "pre-wrap" } }, reel.notes) : null)],
      ["caption", h("span", "Paste the caption, then the first comment if there is one. ", copyCaption,
        p.first_comment ? h("button.btn.small.ghost", { style: { marginLeft: "6px" }, onclick: () => copyText(p.first_comment, "First comment") }, "Copy first comment") : null)],
      ["post", "Post it. Organic only: never boost this reel."],
    ];

  const boxes = steps.map(([key, text], i) => {
    const cb = h("input", { type: "checkbox", checked: !!saved[key], onchange: () => saveStep(key, cb.checked), "aria-label": `Step ${i + 1} done` });
    return h("li", cb, h("div", h("strong", `${i + 1}. `), text));
  });

  async function saveStep(key, val) {
    saved[key] = val;
    const { error } = await supa.from("posts").update({ manual_checklist: { ...saved, updated_at: new Date().toISOString() } }).eq("id", id);
    if (error) toast(`Could not save the checklist: ${error.message}`, "bad");
  }

  const ttHandle = String(store.copy("handles", {})?.tiktok ?? "@account").replace(/^@?/, "@");
  const url = h("input", { type: "url", placeholder: tiktok ? `https://www.tiktok.com/${ttHandle}/video/...` : facebook ? "https://www.facebook.com/.../posts/..." : "https://www.instagram.com/reel/..." });
  const attach = h("button.btn.primary", { type: "submit" }, "Attach and start syncing");
  const pattern = tiktok ? /^https:\/\/(www\.|vm\.)?tiktok\.com\//i : facebook ? /^https:\/\/(www\.|m\.|web\.)?facebook\.com\//i : /^https:\/\/(www\.)?instagram\.com\/(reel|reels|p)\//i;
  const n = steps.length + 1;
  const form = h("form.stack", {
    onsubmit: async (e) => {
      e.preventDefault();
      const v = url.value.trim();
      if (!pattern.test(v)) return toast(tiktok ? "Paste the TikTok video link" : facebook ? "Paste the Facebook post link (Share > Copy link)" : "Paste the Instagram permalink (instagram.com/p/... or /reel/...)", "warn");
      attach.disabled = true;
      try {
        await api(tiktok ? "action/tiktok/attach_video" : facebook ? "action/facebook/attach_manual" : "action/instagram/attach_manual", { post_id: id, url: v });
        await saveStep("link", true);
        toast("Attached. Insights will sync automatically.", "good");
        m.close();
      } catch (err) {
        toast(`Could not attach: ${err.message}`, "bad");
      } finally {
        attach.disabled = false;
      }
    },
  },
  field(tiktok ? `${n}. Paste the TikTok link here` : facebook ? `${n}. Paste the Facebook post link here` : `${n}. Paste the Instagram permalink here`, url,
    "Studio finds the post by this link, marks it live and pulls its insights like any other post."),
  h("div.row.end", attach));

  const m = modal(`${tiktok ? "Finish in TikTok" : "Post by hand"}: ${reelTitle(p.reel_id)}`, [
    isCarousel(p)
      ? h("p", tiktok
        ? (p.method === "manual"
          ? "Post these 9:16 slides in the TikTok app (Studio's photo link is not verified by TikTok yet). Tick each step as you go, then paste the link back."
          : "These slides were sent to TikTok as a photo draft. Add the sound in TikTok (its API cannot) and post it there.")
        : `This carousel goes up by hand because you chose a sound, which only the ${facebook ? "Facebook" : "Instagram"} app can add. Tick each step as you go, then paste the link back.`)
      : tiktok
      ? h("p", "This video was sent to TikTok as a draft. It is not public until someone posts it in the app.")
      : store.recitation()
        ? h("p", "This cut is silent on purpose. The recitation is added in the Instagram app from its sound library, so no file we make contains recitation.")
        : h("p", "This post goes up by hand in the Instagram app. Tick each step as you go, then paste the link back."),
    h("ul.checklist", boxes),
    form,
  ]);
  return m;
}

// ---------------------------------------------------------------------------

function kv(label, value) {
  return h("div", h("div.field-label", label), h("div", value));
}

function truncate(s, n) {
  s = String(s);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function num(x) {
  return x == null ? null : Number(x);
}

function csvCell(v) {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
