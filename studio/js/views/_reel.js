// Shared helpers for the library, launch and posts views, plus the reel
// detail and editor modal (openReel).

import { supa } from "../supa.js";
import { store, href } from "../store.js";
import { h, clear, toast, modal, fmt, pill, statusKind, field, select, PLATFORM_NAMES } from "../ui.js";

// Reel statuses (same for every workspace). Lever vocabularies come from the
// open workspace (studio.workspaces.levers), which the database enforces.
export const STATUSES = ["idea", "in_production", "ready", "scheduled", "live", "shelved", "retired"];

/** Allowed values of a lever in the open workspace. */
export function leverValues(key) {
  if (key === "status") return STATUSES;
  return store.vocab(key) ?? [];
}

/** Choice levers of the open workspace: [{key, label, kind, store}]. */
export function choiceLevers() {
  return store.leverFields().filter((f) => f.kind === "choice");
}

export const POST_PLATFORMS = ["instagram", "facebook", "youtube", "tiktok"];

export const LABELS = {
  hook_type: { pov: "POV", myth_bust: "myth-bust" },
  format: { myth_bust: "myth-bust", app_demo: "app demo" },
  voice: { tts: "TTS" },
  sound: { sfx: "sound effects", in_app_recitation: "in-app recitation" },
  length_bucket: { under_15s: "under 15 s", "15_30s": "15 to 30 s", "30_45s": "30 to 45 s", "45s_plus": "45 s plus" },
};

export function leverLabel(key, value) {
  if (value == null || value === "") return "–";
  return LABELS[key]?.[value] ?? fmt.label(value);
}

export function leverOptions(key, anyLabel) {
  const opts = leverValues(key).map((v) => [v, leverLabel(key, v)]);
  return anyLabel ? [["", anyLabel], ...opts] : [["", "Not set"], ...opts];
}

export function sortReels(list) {
  const order = { batch3: 0, batch2: 1, playable: 2, batch1: 3 };
  return list.sort((a, b) => (order[a.batch] ?? 9) - (order[b.batch] ?? 9)
    || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
}

export function reelAssets(reelId) {
  return [...store.assets.values()].filter((a) => a.reel_id === reelId)
    .sort((a, b) => (a.kind === b.kind ? (a.variant === "main" ? -1 : b.variant === "main" ? 1 : a.variant.localeCompare(b.variant))
      : a.kind.localeCompare(b.kind)));
}

export function reelVideos(reelId) {
  return reelAssets(reelId).filter((a) => a.kind === "video");
}

export function reelPoster(reel) {
  if (!reel) return null;
  if (reel.poster_url) return reel.poster_url;
  return reelAssets(reel.id).find((a) => a.kind === "poster" && a.url)?.url ?? null;
}

export function reelPosts(reelId) {
  return [...store.posts.values()].filter((p) => p.reel_id === reelId)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

export function reelTitle(reelId) {
  const r = store.reels.get(reelId);
  return r ? `${r.id.toUpperCase()} ${r.title}` : String(reelId ?? "–");
}

export function flagText(f) {
  if (typeof f === "string") return f;
  return f?.message ?? f?.code ?? JSON.stringify(f);
}

export function isBlockingFlag(f) {
  const code = typeof f === "string" ? f : f?.code ?? "";
  return /needs_rerender|stale|blocked/i.test(code);
}

export function fmtBytes(n) {
  if (n == null) return "–";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fileName(asset) {
  const src = asset?.repo_path || asset?.url || "";
  return src.split("/").pop() || `${asset?.reel_id}-${asset?.variant}`;
}

const METRIC_FIELDS = ["views", "reach", "impressions", "likes", "comments", "shares", "saves", "follows",
  "profile_visits", "link_clicks", "three_s_views", "thruplays", "completions", "avg_watch_s", "total_watch_s",
  "skip_rate", "spend_usd", "installs"];
export { METRIC_FIELDS };

/** Latest metrics across sources: for each field the newest non-null value. */
export function mergedLatest(postId) {
  const bySource = Object.values(store.latest(postId)).sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  if (!bySource.length) return null;
  const out = { captured_at: bySource[bySource.length - 1].captured_at, sources: bySource.map((s) => s.source) };
  for (const s of bySource) for (const k of METRIC_FIELDS) if (s[k] != null) out[k] = Number(s[k]);
  return out;
}

export async function copyText(text, what = "Text") {
  try {
    await navigator.clipboard.writeText(text ?? "");
    toast(`${what} copied`, "good");
  } catch {
    toast("Could not copy. Select the text and copy it by hand.", "warn");
  }
}

export async function currentUserId() {
  const { data } = await supa.auth.getSession();
  return data.session?.user?.id ?? null;
}

export function charCounter(len, max, extra) {
  const over = len > max;
  return h("span.hint", { style: over ? { color: "var(--red)", fontWeight: "800" } : null },
    `${len.toLocaleString()} / ${max.toLocaleString()} characters${extra ? `, ${extra}` : ""}`);
}

/** Policy limits object -> list of "key: value" lines (nested objects flattened one level). */
export function limitLines(obj) {
  const out = [];
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (v == null || v === "") continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v)) if (v2 != null) out.push(`${fmt.label(k)} ${fmt.label(k2)}: ${fmtVal(v2)}`);
    } else out.push(`${fmt.label(k)}: ${fmtVal(v)}`);
  }
  return out;
}

function fmtVal(v) {
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}

export function hashtagCount(text) {
  return ((text ?? "").match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
}

// ---------------------------------------------------------------------------
// Reel modal
// ---------------------------------------------------------------------------

/** Opens the reel detail/editor. Returns the modal handle. */
export function openReel(reelId) {
  const reel0 = store.reels.get(reelId);
  if (!reel0) {
    toast(`Reel ${reelId} is not in the library`, "bad");
    return null;
  }
  const canEdit = store.canEdit();
  const loadedAt = reel0.updated_at;
  let dirty = false;

  const videosBox = h("div.grid.cols-3");
  const filesBox = h("div");
  const postsBox = h("div");
  const staleBox = h("div");
  const flagsBox = h("div.stack");

  // ---- form ---------------------------------------------------------------
  const inputs = {};
  const mark = () => { dirty = true; };
  const text = (key, attrs = {}) => (inputs[key] = h("input", { value: reel0[key] ?? "", disabled: !canEdit, oninput: mark, ...attrs }));
  // One input per lever field of this workspace (column or reels.levers jsonb).
  const leverFields = store.leverFields();
  const leverInput = (f) => {
    const cur = store.lever(reel0, f.key);
    if (f.kind === "bool") {
      return (inputs[f.key] = select([["", "Not set"], ["true", "Yes"], ["false", "No"]],
        cur == null ? "" : String(cur), { disabled: !canEdit, onchange: mark }));
    }
    if (f.kind === "text") {
      return (inputs[f.key] = h("input", { value: cur ?? "", disabled: !canEdit, oninput: mark,
        placeholder: f.key === "word_taught" ? "e.g. qāla" : "" }));
    }
    return (inputs[f.key] = select(leverOptions(f.key), cur ?? "", { disabled: !canEdit, onchange: mark }));
  };
  const leverValue = (f) => {
    const v = inputs[f.key].value;
    if (f.kind === "bool") return v === "" ? null : v === "true";
    if (f.kind === "text") return v.trim() || null;
    return v || null;
  };
  const area = (key, value, attrs = {}) => {
    const el = h("textarea", { disabled: !canEdit, ...attrs }, value ?? "");
    return el;
  };

  inputs.title = h("input", { value: reel0.title ?? "", disabled: !canEdit, oninput: mark });
  inputs.status = select(STATUSES.map((v) => [v, fmt.label(v)]), reel0.status, { disabled: !canEdit, onchange: mark });

  const captionCount = (el, max) => {
    const c = h("span");
    const upd = () => clear(c, charCounter(el.value.length, max));
    el.addEventListener("input", () => { mark(); upd(); });
    upd();
    return c;
  };
  inputs.caption_organic = area("caption_organic", reel0.caption_organic, { rows: 5 });
  inputs.caption_paid = area("caption_paid", reel0.caption_paid, { rows: 4 });
  inputs.headline_paid = h("input", { value: reel0.headline_paid ?? "", disabled: !canEdit });
  inputs.notes = area("notes", reel0.notes, { rows: 3 });
  inputs.notes.addEventListener("input", mark);
  const overrides = {};
  for (const p of POST_PLATFORMS) {
    overrides[p] = area(`cap_${p}`, reel0.captions?.[p] ?? "", { rows: 3, placeholder: "Empty: uses the organic caption" });
  }

  const form = h("div.stack",
    h("h3", "Levers"),
    h("div.grid.cols-3",
      field("Title", inputs.title),
      field("Status", inputs.status),
      leverFields.map((f) => field(f.label ?? fmt.label(f.key), leverInput(f))),
      field("Length (seconds)", text("length_s", { type: "number", step: "0.1", min: "0" }),
        `Bucket: ${leverLabel("length_bucket", reel0.length_bucket)}`),
      field("Batch", h("input", { value: reel0.batch ?? "", disabled: true }), reel0.folder ? `marketing/${reel0.folder}` : null)),
    h("h3", "Captions"),
    field("Organic caption", inputs.caption_organic, captionCount(inputs.caption_organic, 2200)),
    field("Paid primary text", inputs.caption_paid, captionCount(inputs.caption_paid, 2200)),
    field("Paid headline", inputs.headline_paid, captionCount(inputs.headline_paid, 40)),
    h("details",
      h("summary", { style: { cursor: "pointer", fontWeight: "700" } }, "Per-platform caption overrides"),
      h("div.stack", { style: { marginTop: "10px" } },
        POST_PLATFORMS.map((p) => field(PLATFORM_NAMES[p], overrides[p], captionCount(overrides[p], p === "youtube" ? 5000 : 2200))))),
    field("Notes", inputs.notes));

  async function save() {
    const num = inputs.length_s.value.trim();
    const captions = { ...(store.reels.get(reelId)?.captions ?? {}) };
    for (const p of POST_PLATFORMS) {
      const v = overrides[p].value;
      if (v.trim()) captions[p] = v; else delete captions[p];
    }
    const patch = {
      title: inputs.title.value.trim() || reel0.title,
      status: inputs.status.value,
      length_s: num === "" ? null : Number(num),
      caption_organic: inputs.caption_organic.value || null,
      caption_paid: inputs.caption_paid.value || null,
      headline_paid: inputs.headline_paid.value || null,
      captions,
      notes: inputs.notes.value || null,
    };
    const jsonLevers = { ...(store.reels.get(reelId)?.levers ?? {}) };
    let touchedJson = false;
    for (const f of leverFields) {
      const v = leverValue(f);
      if (f.store === "levers") {
        touchedJson = true;
        if (v == null) delete jsonLevers[f.key]; else jsonLevers[f.key] = v;
      } else patch[f.key] = v;
    }
    if (touchedJson) patch.levers = jsonLevers;
    saveBtn.disabled = true;
    const { error } = await supa.from("reels").update(patch).eq("workspace_id", store.wsId).eq("id", reelId);
    saveBtn.disabled = false;
    if (error) return toast(`Could not save: ${error.message}`, "bad");
    dirty = false;
    toast(`Saved ${reelId.toUpperCase()}`, "good");
    m.close();
  }

  const saveBtn = h("button.btn.primary", { onclick: save }, "Save changes");
  const launchBtn = h("button.btn.coral", {
    onclick: () => { m.close(); location.hash = href(`launch?reel=${encodeURIComponent(reelId)}`); },
  }, "Launch this reel");

  // ---- live parts -----------------------------------------------------------
  function renderLive() {
    const reel = store.reels.get(reelId);
    if (!reel) {
      clear(staleBox, h("div.notice.bad", "This reel was removed from the library."));
      return;
    }
    clear(staleBox, reel.updated_at !== loadedAt
      ? h("div.notice.info", "A teammate changed this reel since you opened it. ",
        dirty ? "Saving now will overwrite their changes." : "Close and reopen to see them.")
      : null);

    const flags = Array.isArray(reel.flags) ? reel.flags : [];
    clear(flagsBox, flags.map((f) => h(`div.notice${isBlockingFlag(f) ? ".bad" : ""}`, flagText(f))));

    const assets = reelAssets(reelId);
    const videos = assets.filter((a) => a.kind === "video");
    // Only rebuild the players when the set of videos changes, so playback is not interrupted.
    const vkey = videos.map((v) => v.id + v.url).join("|");
    if (videosBox.dataset.key !== vkey) {
      videosBox.dataset.key = vkey;
      const poster = reelPoster(reel);
      clear(videosBox, videos.length ? videos.map((v) => h("figure", { style: { margin: 0 } },
        v.url
          ? h("video.reel-thumb", { src: v.url, controls: true, playsinline: true, preload: "metadata", poster: poster ?? null })
          : h("div.reel-thumb.empty", { style: { display: "grid", placeItems: "center" } }, "No media URL yet"),
        h("figcaption.small.muted", { style: { marginTop: "4px" } },
          h("strong", v.variant), ` · ${fmt.sec(num(v.duration_s))}`,
          v.manual_audio && store.recitation() ? h("span", " · ", pill("recitation added in Instagram", "warn"))
            : v.manual_audio ? h("span", " · ", pill("sound added in Instagram", "warn")) : null)))
        : empty0("No video files yet. Sync the library once the render lands."));
    }

    clear(filesBox, assets.length ? h("div.table-wrap", h("table.data",
      h("thead", h("tr", ["File", "Kind", "Variant", "Size", "Duration", "Frame", "Audio", "Manual audio"].map((t) => h("th", t)))),
      h("tbody", assets.map((a) => h("tr",
        h("td", a.url ? h("a", { href: a.url, target: "_blank", rel: "noopener" }, fileName(a)) : fileName(a)),
        h("td", a.kind), h("td", a.variant),
        h("td.num", fmtBytes(a.bytes)),
        h("td.num", a.duration_s != null ? fmt.sec(num(a.duration_s)) : "–"),
        h("td", a.width ? `${a.width}×${a.height}` : "–"),
        h("td", a.audio ? fmt.label(a.audio) : "–"),
        h("td", a.manual_audio ? pill("yes: add in Instagram", "warn") : "no")))))) : empty0("No files."));

    const posts = reelPosts(reelId);
    clear(postsBox, posts.length ? h("div.table-wrap", h("table.data",
      h("thead", h("tr", ["Platform", "Type", "Status", "When", "Views", "Likes", "Shares", "Saves", ""].map((t, i) =>
        h(i >= 4 && i <= 7 ? "th.num" : "th", t)))),
      h("tbody", posts.map((p) => {
        const mt = mergedLatest(p.id);
        return h("tr",
          h("td", PLATFORM_NAMES[p.platform] ?? p.platform),
          h("td", fmt.label(p.post_type)),
          h("td", pill(p.status, statusKind(p.status))),
          h("td", fmt.dateTime(p.published_at ?? p.scheduled_at ?? p.created_at)),
          h("td.num", fmt.int(mt?.views)), h("td.num", fmt.int(mt?.likes)),
          h("td.num", fmt.int(mt?.shares)), h("td.num", fmt.int(mt?.saves)),
          h("td", p.platform_url ? h("a", { href: p.platform_url, target: "_blank", rel: "noopener" }, "Open") : ""));
      })))) : empty0("Not posted anywhere yet."));
  }

  const reel = reel0;
  const content = [
    staleBox,
    h("div.row",
      pill(reel.status, statusKind(reel.status)),
      h("span.muted", `${reel.id.toUpperCase()} · ${fmt.label(reel.batch)}`),
      reel.imported_at ? h("span.muted.small", `imported ${fmt.ago(reel.imported_at)}`) : null),
    flagsBox,
    videosBox,
    h("h3", "Files"), filesBox,
    form,
    h("div.row.end",
      canEdit ? launchBtn : null,
      canEdit ? saveBtn : h("span.muted.small", "Viewers can read but not edit.")),
    h("h3", "Posts of this reel"), postsBox,
  ];
  const m = modal(`${reel.id.toUpperCase()} ${reel.title}`, content, { wide: true, onClose: () => off() });
  const off = store.on((table) => {
    if (["reels", "assets", "posts", "metrics_snapshots", "*"].includes(table)) renderLive();
  });
  renderLive();
  return m;
}

function num(x) {
  return x == null ? null : Number(x);
}

function empty0(msg) {
  return h("div.empty", { style: { padding: "16px" } }, msg);
}
