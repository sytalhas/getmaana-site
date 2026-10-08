// Library: every reel with its poster, levers, status and flags. Click a card
// for the detail/editor modal. Editors can re-import the repo folders.

import { api } from "../supa.js";
import { store, href } from "../store.js";
import { h, clear, toast, fmt, pill, statusKind, field, select, empty } from "../ui.js";
import {
  leverLabel, leverOptions, sortReels, reelPoster, reelVideos, reelPosts, flagText, isBlockingFlag, openReel, choiceLevers,
} from "./_reel.js";
import { mediaSrc } from "../media.js";

export function render(root, { params = {} } = {}) {
  // Filters: batch, status, then every choice lever of this workspace.
  const levers = choiceLevers();
  const FILTER_KEYS = ["batch", "status", ...levers.map((f) => f.key)];
  const LABEL = { status: "Status", ...Object.fromEntries(levers.map((f) => [f.key, f.label ?? fmt.label(f.key)])) };
  const brand = store.brand();
  const val = (r, k) => (k === "batch" || k === "status" ? r[k] : store.lever(r, k));
  const state = { q: "", ...Object.fromEntries(FILTER_KEYS.map((k) => [k, params[k] ?? ""])) };

  const countEl = h("p");
  // Sync needs a media library source (studio.workspaces.media_manifest_url).
  const syncBtn = store.canEdit() && store.workspace?.media_manifest_url
    ? h("button.btn.primary", { onclick: syncLibrary }, "Sync library")
    : null;

  async function syncLibrary() {
    syncBtn.disabled = true;
    syncBtn.textContent = "Syncing";
    try {
      const out = await api("import");
      const n = out.notes?.length ?? 0;
      if (n) console.info("Library import notes", out.notes);
      toast(`Library synced: ${out.reels ?? 0} reels, ${out.assets ?? 0} files.${n ? ` ${n} note${n === 1 ? "" : "s"} in the console.` : ""}`, "good");
    } catch (e) {
      // 409: this workspace has no media library source yet (e.g. a new product).
      if (e.status === 409) toast(e.message || `${brand} has no media library source yet.`, "warn");
      else toast(`Sync failed: ${e.message}`, "bad");
    } finally {
      syncBtn.disabled = false;
      syncBtn.textContent = "Sync library";
    }
  }

  // ---- filters (built once, so typing in search is never interrupted) -------
  const search = h("input", {
    type: "search", value: state.q,
    placeholder: store.leverFields().some((f) => f.key === "word_taught") ? "Title, id, word, caption" : "Title, id, caption, notes",
    oninput: () => { state.q = search.value.trim().toLowerCase(); renderGrid(); },
  });
  const selects = {};
  const batchWrap = h("span");
  function batchSelect() {
    const batches = [...new Set([...store.reels.values()].map((r) => r.batch).filter(Boolean))].sort();
    const key = batches.join("|");
    if (batchWrap.dataset.key === key) return;
    batchWrap.dataset.key = key;
    selects.batch = select([["", "All batches"], ...batches.map((b) => [b, fmt.label(b)])], state.batch,
      { onchange: (e) => { state.batch = e.target.value; renderGrid(); } });
    clear(batchWrap, selects.batch);
  }
  batchSelect();
  for (const k of FILTER_KEYS.slice(1)) {
    selects[k] = select(leverOptions(k, "Any"), state[k], { onchange: (e) => { state[k] = e.target.value; renderGrid(); } });
  }
  function resetFilters() {
    for (const k of FILTER_KEYS) { state[k] = ""; if (selects[k]) selects[k].value = ""; }
    state.q = "";
    search.value = "";
    renderGrid();
  }

  const filters = h("div.filters",
    field("Search", search),
    h("label.field", h("span.field-label", "Batch"), batchWrap),
    FILTER_KEYS.slice(1).map((k) => field(LABEL[k], selects[k])),
    h("button.btn.ghost.small", { onclick: resetFilters }, "Clear filters"));

  const grid = h("div");

  clear(root,
    h("div.view-head", h("div", h("h1", "Library"), countEl),
      h("div.row", store.canEdit() ? h("a.btn.primary", { href: href("upload"), title: "Upload a reel, a photo or a carousel you made, write its caption, and launch it from Studio" }, "Add your own") : null,
        syncBtn ? Object.assign(syncBtn, { className: "btn" }) : null)),
    filters,
    grid);

  function matches(r) {
    for (const k of FILTER_KEYS) if (state[k] && String(val(r, k) ?? "") !== state[k]) return false;
    if (state.q) {
      const textLevers = store.leverFields().filter((f) => f.kind === "text").map((f) => store.lever(r, f.key));
      const hay = [r.id, r.title, ...textLevers, r.caption_organic, r.notes, r.batch].join(" ").toLowerCase();
      if (!hay.includes(state.q)) return false;
    }
    return true;
  }

  function card(r) {
    const poster = reelPoster(r);
    const videos = reelVideos(r.id);
    const posts = reelPosts(r.id);
    const live = posts.filter((p) => p.status === "live").length;
    const flags = Array.isArray(r.flags) ? r.flags : [];
    const PREFIX = { hook_type: "hook", voice: "voice", word_taught: "word" };
    const tags = [
      ...store.leverFields().map((f) => {
        const v = store.lever(r, f.key);
        if (v == null || v === "") return null;
        if (f.kind === "bool") return v === true ? (f.label ?? fmt.label(f.key)) : null;
        const text = f.kind === "text" ? v : leverLabel(f.key, v);
        return PREFIX[f.key] ? `${PREFIX[f.key]}: ${text}` : text;
      }),
      r.length_bucket && leverLabel("length_bucket", r.length_bucket),
    ].filter(Boolean);
    const open = () => openReel(r.id);
    return h("article.card.reel-card", {
      tabindex: "0", role: "button", "aria-label": `Open ${r.id} ${r.title}`,
      onclick: open,
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } },
    },
    poster
      ? mediaSrc(h("img.reel-thumb", { alt: "", loading: "lazy" }), poster)
      : h("div.reel-thumb", { style: { display: "grid", placeItems: "center", color: "var(--ink-3)" } }, "No poster"),
    h("div.row.between", h("span.small.muted", `${r.id.toUpperCase()} · ${fmt.label(r.batch)}`), pill(r.status, statusKind(r.status))),
    h("h3", r.title),
    tags.length ? h("div.tags", tags.map((t) => h("span.tag", t))) : null,
    h("div.small.muted", `${videos.length} video${videos.length === 1 ? "" : "s"}`,
      videos.some((v) => v.manual_audio) ? " (one needs Instagram audio)" : "",
      posts.length ? ` · ${posts.length} post${posts.length === 1 ? "" : "s"}, ${live} live` : ""),
    flags.length ? h("div.stack", { style: { gap: "4px" } }, flags.map((f) =>
      h(`div.notice${isBlockingFlag(f) ? ".bad" : ""}`, { style: { padding: "6px 8px", fontSize: "12px" } }, flagText(f)))) : null);
  }

  function renderGrid() {
    batchSelect();
    const all = sortReels([...store.reels.values()]);
    const list = all.filter(matches);
    filters.style.display = all.length ? "" : "none";
    countEl.textContent = all.length
      ? `${list.length} of ${all.length} reels${list.length !== all.length ? " match the filters" : ""}.`
      : "";
    if (!all.length) {
      const hasSource = !!store.workspace?.media_manifest_url;
      clear(grid, h("div.empty",
        h("h3", `No videos yet for ${brand}`),
        h("p", "Videos appear here when they are planned on the content calendar or imported from the media library."),
        h("ul", { style: { textAlign: "left", display: "inline-block", margin: "0 auto" } },
          h("li", "Planned videos arrive from the content calendar sync, each on its planned date."),
          h("li", hasSource
            ? "Press Sync library to import the finished files and their captions."
            : store.isOwner()
              ? `${brand} has no media library source yet, so finished files cannot be imported. Plan videos on the content calendar for now.`
              : `${brand} has no media library source yet. Until the owner adds one, plan videos on the content calendar.`)),
        h("p", h("a", { href: href("calendar") }, "Open the calendar"))));
      return;
    }
    if (!list.length) {
      clear(grid, empty("No reels match these filters.", h("button.btn.ghost.small", { onclick: resetFilters }, "Clear filters")));
      return;
    }
    clear(grid, h("div.grid.cols-4", list.map(card)));
  }

  renderGrid();
  if (params.reel) openReel(params.reel);

  return store.on((table) => {
    if (["reels", "assets", "posts", "*"].includes(table)) renderGrid();
  });
}
