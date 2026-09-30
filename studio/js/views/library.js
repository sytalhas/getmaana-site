// Library: every reel with its poster, levers, status and flags. Click a card
// for the detail/editor modal. Editors can re-import the repo folders.

import { api } from "../supa.js";
import { store } from "../store.js";
import { h, clear, toast, fmt, pill, statusKind, field, select, empty } from "../ui.js";
import {
  leverLabel, leverOptions, sortReels, reelPoster, reelVideos, reelPosts, flagText, isBlockingFlag, openReel,
} from "./_reel.js";

const FILTER_KEYS = ["batch", "status", "format", "hook_type", "look", "voice", "sound", "lead"];
const LABEL = { status: "Status", format: "Format", hook_type: "Hook", look: "Look", voice: "Voice", sound: "Sound", lead: "Lead" };

export function render(root, { params = {} } = {}) {
  const state = { q: "", ...Object.fromEntries(FILTER_KEYS.map((k) => [k, params[k] ?? ""])) };

  const countEl = h("p");
  const syncBtn = store.canEdit()
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
      toast(`Sync failed: ${e.message}`, "bad");
    } finally {
      syncBtn.disabled = false;
      syncBtn.textContent = "Sync library";
    }
  }

  // ---- filters (built once, so typing in search is never interrupted) -------
  const search = h("input", {
    type: "search", placeholder: "Title, id, word, caption", value: state.q,
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
    h("div.view-head", h("div", h("h1", "Library"), countEl), syncBtn),
    filters,
    grid);

  function matches(r) {
    for (const k of FILTER_KEYS) if (state[k] && (r[k] ?? "") !== state[k]) return false;
    if (state.q) {
      const hay = [r.id, r.title, r.word_taught, r.caption_organic, r.notes, r.batch].join(" ").toLowerCase();
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
    const tags = [
      r.format && leverLabel("format", r.format),
      r.hook_type && `hook: ${leverLabel("hook_type", r.hook_type)}`,
      r.look && leverLabel("look", r.look),
      r.voice && `voice: ${leverLabel("voice", r.voice)}`,
      r.sound && leverLabel("sound", r.sound),
      r.lead && leverLabel("lead", r.lead),
      r.length_bucket && leverLabel("length_bucket", r.length_bucket),
      r.word_taught && `word: ${r.word_taught}`,
      r.arabic_frame0 === true ? "Arabic at frame 0" : null,
    ].filter(Boolean);
    const open = () => openReel(r.id);
    return h("article.card.reel-card", {
      tabindex: "0", role: "button", "aria-label": `Open ${r.id} ${r.title}`,
      onclick: open,
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } },
    },
    poster
      ? h("img.reel-thumb", { src: poster, alt: "", loading: "lazy" })
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
    countEl.textContent = all.length
      ? `${list.length} of ${all.length} reels${list.length !== all.length ? " match the filters" : ""}.`
      : "";
    if (!all.length) {
      clear(grid, empty("The library is empty.", store.canEdit()
        ? h("p", "Press Sync library to import batch 1, batch 2, P01 and batch 3 from the repo.") : null));
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
