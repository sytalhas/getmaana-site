// Launch: pick a reel and a cut, tick platforms, adapt each post, run the
// pre-flight check, then confirm. Check creates draft posts and runs
// POST /preflight on each; Launch calls studio.confirm_posts (after a
// one-click confirmation that lists exactly what goes where).

import { supa, api } from "../supa.js";
import { store } from "../store.js";
import { h, clear, toast, confirmAction, fmt, pill, statusKind, field, select, empty, PLATFORM_NAMES } from "../ui.js";
import {
  POST_PLATFORMS, sortReels, reelVideos, reelPoster, reelTitle, fileName, flagText, isBlockingFlag,
  charCounter, hashtagCount, limitLines, copyText,
} from "./_reel.js";

const LIMITS = {
  instagram: { caption: 2200, hashtags: 30 },
  facebook: { caption: 2200 },
  youtube: { title: 100, caption: 5000 },
  tiktok: { caption: 2200 },
};

const COVER_HINT = {
  instagram: "Sent as the reel's cover frame.",
  facebook: "Stored with the post. Facebook may pick its own frame.",
  youtube: "YouTube picks the Shorts frame itself. Kept for reference.",
  tiktok: "Used for direct posts. For inbox drafts, pick the cover in the TikTok app.",
};

const LINK_PLACE = {
  instagram: "Instagram bio link (links in Instagram captions are not clickable).",
  facebook: "Facebook post description.",
  youtube: "YouTube description.",
  tiktok: "TikTok bio link (links in TikTok captions are not clickable).",
};

export function render(root, { params = {} } = {}) {
  const head = h("div.view-head", h("div", h("h1", "Launch"),
    h("p", "Pick a reel, tick platforms, check, then launch. Nothing is sent until you confirm.")));
  if (!store.canEdit()) {
    clear(root, head, empty("Only editors and owners can launch. You can follow every launch in Posts."));
    return null;
  }

  const S = {
    reelId: params.reel && store.reels.has(params.reel) ? params.reel : "",
    assetId: "",
    drafts: {},        // platform -> post id (unconfirmed drafts made by Check)
    results: {},       // platform -> preflight result
    links: {},         // post id -> campaign_links row
    checkedSig: null,  // signature of the form at the last completed check
    checking: false,
    recheck: false,
    launched: false,
    adapters: null,
    adaptersError: null,
  };
  let timer = null;

  // ---- reel and cut --------------------------------------------------------
  const reelSel = h("select", { onchange: () => { S.reelId = reelSel.value; onReel(); } });
  const assetSel = h("select", { onchange: () => { S.assetId = assetSel.value; onAsset(); } });
  const reelInfo = h("div.stack");
  const vid = h("video.reel-thumb", { controls: true, playsinline: true, muted: true, preload: "metadata" });
  const vidWrap = h("div", vid);

  function fillReels() {
    const list = sortReels([...store.reels.values()]);
    const key = list.map((r) => r.id + r.status + r.title).join("|");
    if (reelSel.dataset.key === key) return;
    reelSel.dataset.key = key;
    clear(reelSel, h("option", { value: "" }, "Choose a reel"),
      list.map((r) => h("option", { value: r.id, selected: r.id === S.reelId },
        `${r.id.toUpperCase()} ${r.title}${["shelved", "retired", "idea"].includes(r.status) ? ` (${fmt.label(r.status)})` : ""}`)));
  }

  function reel() { return store.reels.get(S.reelId) ?? null; }
  function asset() { return store.assets.get(S.assetId) ?? null; }

  function onReel() {
    const r = reel();
    const vids = r ? reelVideos(r.id) : [];
    S.assetId = (vids.find((v) => v.variant === "main") ?? vids[0])?.id ?? "";
    clear(assetSel, vids.length
      ? vids.map((v) => h("option", { value: v.id, selected: v.id === S.assetId },
        `${v.variant}${v.duration_s != null ? `, ${Number(v.duration_s).toFixed(1)} s` : ""}${v.manual_audio ? ", silent: recitation added in Instagram" : v.audio ? `, audio: ${fmt.label(v.audio)}` : ""}`))
      : h("option", { value: "" }, r ? "No video files for this reel" : "Choose a reel first"));
    for (const c of cards) prefill(c, r);
    renderReelInfo();
    onAsset();
  }

  function renderReelInfo() {
    const r = reel();
    if (!r) return clear(reelInfo);
    const flags = Array.isArray(r.flags) ? r.flags : [];
    const poster = reelPoster(r);
    clear(reelInfo,
      h("div.row", pill(r.status, statusKind(r.status)), h("span.small.muted", fmt.label(r.batch))),
      ["shelved", "retired"].includes(r.status)
        ? h("div.notice.bad", `This reel is ${r.status}. Pre-flight will block it until its status changes in the Library.`) : null,
      flags.map((f) => h(`div.notice${isBlockingFlag(f) ? ".bad" : ""}`, { style: { fontSize: "13px" } }, flagText(f))),
      !asset()?.url && poster ? h("img.reel-thumb", { src: poster, alt: "" }) : null);
  }

  function onAsset() {
    const a = asset();
    const src = a?.url ?? "";
    if (vid.getAttribute("src") !== src) {
      if (src) vid.src = src; else vid.removeAttribute("src");
      vid.poster = reelPoster(reel()) ?? "";
      vid.load?.();
    }
    show(vidWrap, !!src);
    for (const c of cards) syncCard(c);
    renderReelInfo();
    changed();
    queueCovers();
  }

  // ---- cover frame previews (one shared video element) ---------------------
  const drawQueue = [];
  let drawing = null;
  function queueDraw(c) {
    const i = drawQueue.indexOf(c);
    if (i >= 0) drawQueue.splice(i, 1);
    drawQueue.push(c);
    pump();
  }
  function queueCovers() {
    for (const c of cards) if (c.on.checked) queueDraw(c);
  }
  function pump() {
    if (drawing || !drawQueue.length || !vid.getAttribute("src")) return;
    if (vid.readyState < 2) {
      // Wait until a frame is decodable; drawing at HAVE_METADATA paints nothing.
      vid.addEventListener("loadeddata", pump, { once: true });
      return;
    }
    drawing = drawQueue.shift();
    const t = Math.min(Number(drawing.cover.value) / 1000, Math.max(0, (vid.duration || 0) - 0.05));
    vid.pause();
    if (Math.abs(vid.currentTime - t) < 0.001) onSeeked();
    else vid.currentTime = t;
  }
  function onSeeked() {
    const c = drawing;
    drawing = null;
    if (c) {
      try {
        c.canvas.getContext("2d").drawImage(vid, 0, 0, c.canvas.width, c.canvas.height);
      } catch { /* cross-origin frames still draw; ignore anything else */ }
    }
    pump();
  }
  vid.addEventListener("seeked", onSeeked);
  vid.addEventListener("loadedmetadata", () => {
    const max = Math.round((vid.duration || Number(asset()?.duration_s) || 0) * 1000);
    for (const c of cards) c.cover.max = String(Math.max(0, max));
  });
  vid.addEventListener("error", () => { drawing = null; });

  // ---- platform cards -------------------------------------------------------
  const cards = POST_PLATFORMS.map(makeCard);

  function connFor(p) {
    const list = [...store.connections.values()].filter((c) => c.platform === p);
    return list.find((c) => c.status !== "disconnected") ?? list[0] ?? null;
  }

  function makeCard(p) {
    const c = { p };
    const upd = () => { syncCard(c); changed(); };
    c.on = h("input", { type: "checkbox", onchange: () => { upd(); if (c.on.checked) queueDraw(c); } });
    c.health = h("span");
    c.note = h("div");
    c.result = h("div");
    c.campaign = h("div");
    c.limits = h("div.hint");
    c.type = p === "instagram"
      ? select([["organic", "Organic reel"], ["trial", "Trial reel (shown to non-followers first)"]], "organic", { onchange: upd })
      : null;
    c.method = p === "instagram"
      ? select([["api", "Publish with the API"], ["manual", "Manual checklist (post it in the app)"]], "api", { onchange: upd })
      : p === "tiktok"
        ? select([["inbox_draft", "Send to the TikTok inbox as a draft"], ["api", "Direct post (after the TikTok audit)"]], "inbox_draft", { onchange: upd })
        : null;
    c.caption = h("textarea", { rows: 6, oninput: changed });
    c.capCount = h("div");
    if (p === "youtube") {
      c.title = h("input", { oninput: changed });
      c.titleCount = h("div");
      c.privacy = select([["private", "Private"], ["unlisted", "Unlisted"], ["public", "Public"]], "private", { onchange: changed });
    }
    if (p === "instagram" || p === "facebook") {
      c.firstComment = h("textarea", { rows: 2, oninput: changed, placeholder: "Optional. Posted as the first comment." });
    }
    if (p === "instagram") {
      c.shareFeed = h("input", { type: "checkbox", checked: true, onchange: changed });
      c.shareFeedWrap = h("label.row.small", c.shareFeed, "Also share to the main feed grid");
      c.graduation = select([["MANUAL", "MANUAL: I decide whether to share it with followers"],
        ["SS_PERFORMANCE", "SS_PERFORMANCE: share with followers automatically if it performs well"]], "MANUAL", { onchange: changed });
      c.graduationWrap = field("Trial graduation", c.graduation);
    }
    c.cover = h("input", { type: "range", min: "0", max: "0", step: "100", value: "0" });
    c.coverLabel = h("span.small", "0.0 s");
    c.canvas = h("canvas", { width: 54, height: 96, style: { borderRadius: "6px", background: "var(--paper-2)", flex: "none" } });
    c.cover.addEventListener("input", () => {
      c.coverLabel.textContent = `${(Number(c.cover.value) / 1000).toFixed(1)} s`;
      queueDraw(c);
      changed();
    });

    const captionLabel = p === "youtube" ? "Description" : "Caption";
    c.body = h("div.stack",
      c.note,
      h("div.grid.cols-2", { style: { gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" } },
        c.type ? field("Post type", c.type) : field("Post type", h("input", { value: "Organic", disabled: true })),
        c.method ? field("Method", c.method) : field("Method", h("input", { value: "Publish with the API", disabled: true }))),
      c.title ? field("Title", c.title, c.titleCount) : null,
      c.privacy ? field("Privacy", c.privacy,
        "Until Google's API audit passes, uploads from Studio stay private whatever you choose (shown as private until audit).") : null,
      field(captionLabel, c.caption, c.capCount),
      c.firstComment ? field("First comment", c.firstComment) : null,
      c.shareFeedWrap ?? null,
      c.graduationWrap ?? null,
      h("div.field", h("span.field-label", "Cover frame"),
        h("div.row", { style: { flexWrap: "nowrap" } }, c.canvas,
          h("div.stack", { style: { flex: "1", gap: "4px", minWidth: "0" } }, c.cover, c.coverLabel, h("span.hint", COVER_HINT[p])))),
      c.campaign,
      c.result,
      c.limits);

    c.el = h("section.card.stack",
      h("div.row.between",
        h("label.row", { style: { fontWeight: "800", fontSize: "16px" } }, c.on, PLATFORM_NAMES[p]),
        c.health),
      c.body);
    return c;
  }

  function prefill(c, r) {
    c.caption.value = r ? (r.captions?.[c.p] ?? r.caption_organic ?? "") : "";
    if (c.title) c.title.value = r ? String(r.title ?? "").slice(0, 100) : "";
    if (c.firstComment) c.firstComment.value = "";
    c.cover.value = "0";
    c.coverLabel.textContent = "0.0 s";
    const d = Number(asset()?.duration_s);
    if (d) c.cover.max = String(Math.round(d * 1000));
  }

  function syncCard(c) {
    const a = asset();
    const recitation = !!a?.manual_audio;
    const notes = [];
    if (c.p !== "instagram") {
      c.on.disabled = recitation;
      if (recitation) {
        c.on.checked = false;
        notes.push(h("div.notice", "This cut needs recitation added in the Instagram app, so it can only go to Instagram. Pick the main cut for other platforms."));
      }
    }
    if (c.p === "instagram") {
      if (recitation) {
        c.method.value = "manual";
        c.method.disabled = true;
        notes.push(h("div.notice.info", "Silent recitation cut: this goes down the manual checklist. After you confirm, Posts shows the steps (download, add the recitation from Instagram's sound library as POSTING.md says, paste the caption, post, paste the link back)."));
      } else c.method.disabled = false;
      const trial = c.type.value === "trial";
      show(c.shareFeedWrap, !trial);
      show(c.graduationWrap, trial);
      if (c.method.value === "manual" && !recitation) {
        notes.push(h("div.notice.info", "Manual: after you confirm, Posts shows a checklist and you post it in the Instagram app."));
      }
    }
    if (c.p === "tiktok") {
      const conn = connFor("tiktok");
      const audited = !!(conn?.info?.audited ?? conn?.limits?.direct_post_audited);
      c.method.querySelector('option[value="api"]').disabled = !audited;
      if (!audited && c.method.value === "api") c.method.value = "inbox_draft";
      if (c.method.value === "inbox_draft") {
        notes.push(h("div.hint", "The video lands in the TikTok app's inbox. Someone taps Post there, then pastes the link in Posts."));
      }
    }
    clear(c.note, notes);
    show(c.body, c.on.checked);
    renderHealth(c);
    renderLimits(c);
  }

  function renderHealth(c) {
    const conn = connFor(c.p);
    const manual = c.method?.value === "manual";
    if (manual) return clear(c.health, pill("manual: no connection needed", ""));
    if (!conn) return clear(c.health, h("a.pill.bad", { href: "#/connections", style: { textDecoration: "none" } }, "not connected"));
    const exp = conn.token_expires_at ? `, token until ${fmt.date(conn.token_expires_at)}` : "";
    clear(c.health, h("a", { href: "#/connections", title: `${conn.account_name ?? conn.account_id}${exp}. Checked ${fmt.ago(conn.last_checked_at)}.`, style: { textDecoration: "none" } },
      pill(conn.status, statusKind(conn.status))));
  }

  function renderLimits(c) {
    const conn = connFor(c.p);
    const lines = [
      ...limitLines(S.adapters?.[c.p]?.limits),
      ...limitLines(conn?.limits),
    ];
    const base = c.p === "youtube"
      ? `Title up to ${LIMITS.youtube.title}, description up to ${LIMITS.youtube.caption} characters.`
      : `Caption up to ${LIMITS[c.p].caption.toLocaleString()} characters${c.p === "instagram" ? ", 30 hashtags, 20 mentions" : ""}.`;
    clear(c.limits, h("strong", "Policy limits: "), [base, ...lines].join(" · "),
      S.adaptersError ? h("span", ` (platform limits unavailable: ${S.adaptersError})`) : null);
  }

  function updateCounts(c) {
    const len = c.caption.value.length;
    const max = LIMITS[c.p].caption;
    if (c.p === "instagram") {
      const tags = hashtagCount(c.caption.value);
      clear(c.capCount, charCounter(len, max), " ",
        h("span.hint", { style: tags > 30 ? { color: "var(--red)", fontWeight: "800" } : null }, `${tags} / 30 hashtags`));
    } else clear(c.capCount, charCounter(len, max));
    if (c.title) clear(c.titleCount, charCounter(c.title.value.length, LIMITS.youtube.title));
  }

  // ---- time ----------------------------------------------------------------
  const whenNow = h("input", { type: "radio", name: "launch-when", value: "now", checked: true, onchange: onWhen });
  const whenLater = h("input", { type: "radio", name: "launch-when", value: "later", onchange: onWhen });
  const at = h("input", { type: "datetime-local", oninput: changed, style: { maxWidth: "260px" } });
  const atHint = h("span.hint");
  function onWhen() {
    at.disabled = !whenLater.checked;
    if (whenLater.checked && !at.value) {
      const d = new Date(Date.now() + 60 * 60 * 1000);
      d.setMinutes(0, 0, 0);
      at.value = toLocalInput(d);
    }
    changed();
  }
  at.disabled = true;
  function scheduledAt() {
    if (!whenLater.checked || !at.value) return null;
    const d = new Date(at.value); // datetime-local is local time; stored as UTC
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  // ---- actions ---------------------------------------------------------------
  const checkBtn = h("button.btn", { onclick: () => check() }, "Check");
  const launchBtn = h("button.btn.coral", { onclick: launch, disabled: true }, "Launch");
  const discardBtn = h("button.btn.ghost", { onclick: () => discard(true) }, "Discard drafts");
  const status = h("div");
  const campaignIntro = h("div");

  function collect() {
    const r = reel();
    const a = asset();
    const rows = {};
    for (const c of cards) {
      if (!c.on.checked || c.on.disabled) continue;
      const options = {};
      if (c.p === "instagram") {
        if (c.type.value === "trial") options.trial_params = { graduation_strategy: c.graduation.value };
        else options.share_to_feed = c.shareFeed.checked;
      }
      if (c.p === "youtube") Object.assign(options, { title: c.title.value, privacy: c.privacy.value });
      const conn = connFor(c.p);
      rows[c.p] = {
        reel_id: r?.id ?? null,
        asset_id: a?.id ?? null,
        platform: c.p,
        post_type: c.type ? c.type.value : "organic",
        method: c.method ? c.method.value : "api",
        caption: c.caption.value,
        first_comment: c.firstComment ? (c.firstComment.value.trim() || null) : null,
        cover_ms: Number(c.cover.value) || 0,
        options,
        scheduled_at: scheduledAt(),
        connection_id: conn && conn.status !== "disconnected" ? conn.id : null,
      };
    }
    return rows;
  }
  const sigOf = (rows) => JSON.stringify(rows);

  function problems(rows) {
    const out = [];
    if (!reel()) out.push("Choose a reel.");
    else if (!asset()) out.push("This reel has no video file yet. Sync the library once it renders.");
    if (!Object.keys(rows).length) out.push("Tick at least one platform.");
    if (whenLater.checked) {
      const t = scheduledAt();
      if (!t) out.push("Pick a date and time, or choose Now.");
      else if (new Date(t).getTime() < Date.now() - 60_000) out.push("The scheduled time is in the past.");
    }
    return out;
  }

  function changed() {
    for (const c of cards) updateCounts(c);
    const t = scheduledAt();
    atHint.textContent = t ? `Stored as ${t.replace("T", " ").slice(0, 16)} UTC. Your time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}.` : "";
    renderStatus();
    if (S.checkedSig !== null && sigOf(collect()) !== S.checkedSig) {
      clearTimeout(timer);
      timer = setTimeout(() => check(true), 1500);
    }
  }

  function renderStatus() {
    const rows = collect();
    const sig = sigOf(rows);
    const fresh = S.checkedSig !== null && sig === S.checkedSig;
    const ps = Object.keys(rows);
    const allOk = fresh && ps.length && ps.every((p) => S.results[p]?.ok);
    const probs = problems(rows);
    checkBtn.disabled = S.checking || probs.length > 0;
    launchBtn.disabled = S.checking || !allOk || probs.length > 0;
    show(discardBtn, Object.keys(S.drafts).length > 0);
    checkBtn.textContent = S.checking ? "Checking" : S.checkedSig === null ? "Check" : "Check again";

    let msg;
    if (probs.length) msg = h("div.notice", probs.join(" "));
    else if (S.checking) msg = h("div.notice.info", "Running pre-flight checks");
    else if (S.checkedSig === null) msg = h("div.notice.info", "Press Check to save these as drafts and run the pre-flight checks. Launch unlocks when every platform passes.");
    else if (!fresh) msg = h("div.notice.info", "Changed since the last check. Checking again");
    else if (allOk) msg = h("div.notice.good", `All ${ps.length} platform${ps.length === 1 ? "" : "s"} passed. Launch asks you to confirm first.`);
    else msg = h("div.notice.bad", "Fix the errors marked in red, then the check runs again.");
    clear(status, msg);

    for (const c of cards) renderResult(c, fresh);
    renderCampaign();
  }

  function renderResult(c, fresh) {
    const r = S.results[c.p];
    if (!c.on.checked || !r) return clear(c.result);
    clear(c.result, h("div.stack", { style: { gap: "6px", opacity: fresh ? "1" : ".55" } },
      h("div.row", r.ok ? pill("pre-flight passed", "good") : pill("blocked", "bad"),
        !fresh ? h("span.small.muted", "out of date") : null),
      r.errors?.length ? h("ul.preflight-list.errors", r.errors.map((e) => h("li", e))) : null,
      r.warnings?.length ? h("ul.preflight-list.warnings", r.warnings.map((w) => h("li", w))) : null));
  }

  function renderCampaign() {
    const appLive = !!store.setting("app_store")?.live;
    clear(campaignIntro, h(`div.notice${appLive ? ".info" : ""}`,
      "Each post gets its own App Store campaign id, so installs can be traced to it. ",
      appLive
        ? "The link appears after Check."
        : "The app is not live on the App Store yet, so there is no link: the id is reserved now and the link is filled in once the app is live and the provider token is set in Settings."));
    for (const c of cards) {
      const id = S.drafts[c.p];
      const post = id ? store.posts.get(id) : null;
      const link = id ? S.links[id] : null;
      if (!c.on.checked || !post?.campaign_ct) { clear(c.campaign); continue; }
      const url = link?.url ?? null;
      clear(c.campaign, h("div.stack", { style: { gap: "4px", padding: "10px", background: "var(--paper)", borderRadius: "8px" } },
        h("div.small", h("strong", "Campaign id: "), h("code", post.campaign_ct)),
        h("div.small", h("strong", "Link: "), url
          ? h("span", h("a", { href: url, target: "_blank", rel: "noopener", style: { wordBreak: "break-all" } }, url), " ",
            h("button.btn.small.ghost", { onclick: () => copyText(url, "Link") }, "Copy"))
          : "not available until the app is live on the App Store."),
        h("div.small", h("strong", "Where it goes: "), LINK_PLACE[c.p])));
    }
  }

  async function check(auto = false) {
    clearTimeout(timer);
    if (S.checking) { S.recheck = true; return; }
    const rows = collect();
    if (problems(rows).length) { renderStatus(); return; }
    const sig = sigOf(rows);
    S.checking = true;
    renderStatus();
    try {
      // Drafts for platforms no longer ticked are removed.
      for (const p of Object.keys(S.drafts)) {
        if (rows[p]) continue;
        await supa.from("posts").delete().eq("id", S.drafts[p]).eq("status", "draft");
        delete S.drafts[p];
        delete S.results[p];
      }
      for (const [p, row] of Object.entries(rows)) {
        const id = S.drafts[p];
        const existing = id ? store.posts.get(id) : null;
        if (id && (!existing || existing.status === "draft")) {
          const { data, error } = await supa.from("posts").update(row).eq("id", id).eq("status", "draft").select("id");
          if (error) throw new Error(`${PLATFORM_NAMES[p]}: ${error.message}`);
          if (data?.length) continue;
        }
        const { data, error } = await supa.from("posts").insert({ ...row, status: "draft" }).select("id").single();
        if (error) throw new Error(`${PLATFORM_NAMES[p]}: ${error.message}`);
        S.drafts[p] = data.id;
      }
      const results = await Promise.all(Object.keys(rows).map((p) => api("preflight", { post_id: S.drafts[p] })
        .then((r) => [p, r])
        .catch((e) => [p, { ok: false, errors: [`Pre-flight could not run: ${e.message}`], warnings: [] }])));
      for (const [p, r] of results) S.results[p] = r;
      const ids = Object.values(S.drafts);
      const { data: links } = await supa.from("campaign_links").select("*").in("post_id", ids);
      for (const l of links ?? []) S.links[l.post_id] = l;
      S.checkedSig = sig;
      if (!auto) {
        const bad = results.filter(([, r]) => !r.ok).length;
        toast(bad ? `${bad} platform${bad === 1 ? "" : "s"} blocked by pre-flight` : "Pre-flight passed", bad ? "warn" : "good");
      }
    } catch (e) {
      toast(`Check failed: ${e.message}`, "bad");
    } finally {
      S.checking = false;
      renderStatus();
      if (S.recheck) { S.recheck = false; check(true); } else changed();
    }
  }

  function describe(p, row) {
    const parts = [];
    if (p === "instagram") {
      parts.push(row.post_type === "trial"
        ? `trial reel (graduation ${row.options.trial_params?.graduation_strategy})`
        : `organic reel${row.options.share_to_feed ? ", shared to feed" : ", not shared to feed"}`);
      parts.push(row.method === "manual" ? "posted by hand from the checklist in Posts (nothing is sent automatically)" : "published with the API");
    } else if (p === "tiktok") {
      parts.push(row.method === "inbox_draft" ? "sent to the TikTok inbox as a draft (someone taps Post in the app)" : "direct post");
    } else if (p === "youtube") {
      parts.push(`Short titled "${row.options.title}", ${row.options.privacy}`);
    } else parts.push("reel published with the API");
    parts.push(`caption ${row.caption.length} characters`);
    if (row.first_comment) parts.push("with a first comment");
    parts.push(`cover at ${(row.cover_ms / 1000).toFixed(1)} s`);
    const conn = connFor(p);
    if (row.method !== "manual" && conn) parts.push(`account ${conn.account_name ?? conn.account_id}`);
    return `${PLATFORM_NAMES[p]}: ${parts.join(", ")}.`;
  }

  async function launch() {
    const rows = collect();
    if (sigOf(rows) !== S.checkedSig) return check();
    const ps = Object.keys(rows);
    const a = asset();
    const t = scheduledAt();
    const ok = await confirmAction(`Launch ${reel().id.toUpperCase()} to ${ps.length} platform${ps.length === 1 ? "" : "s"}?`, [
      `Reel: ${reelTitle(S.reelId)}. File: ${fileName(a)}.`,
      ...ps.map((p) => describe(p, rows[p])),
      t ? `When: ${fmt.dateTime(t)} your time (${t.slice(0, 16).replace("T", " ")} UTC).` : "When: now.",
      ps.every((p) => rows[p].method === "manual")
        ? "Nothing is sent automatically: each post gets a checklist in Posts for posting by hand."
        : ps.some((p) => rows[p].method === "manual")
        ? "The API posts publish to the accounts above. Manual posts get a checklist in Posts. You can cancel a scheduled post in Posts until it goes out."
        : "This publishes to the accounts above. You can cancel a scheduled post in Posts until it goes out.",
    ], "Launch");
    if (!ok) return;
    launchBtn.disabled = true;
    const ids = ps.map((p) => S.drafts[p]);
    const { error } = await supa.rpc("confirm_posts", { p_ids: ids });
    if (error) {
      toast(`Launch failed: ${error.message}`, "bad");
      renderStatus();
      return;
    }
    S.launched = true;
    S.drafts = {};
    toast(`Launched ${ps.length} post${ps.length === 1 ? "" : "s"}. Follow them in Posts.`, "good");
    location.hash = "#/posts";
  }

  async function discard(announce) {
    const ids = Object.values(S.drafts);
    S.drafts = {};
    S.results = {};
    S.links = {};
    S.checkedSig = null;
    if (ids.length) {
      const { error } = await supa.from("posts").delete().in("id", ids).eq("status", "draft");
      if (announce) toast(error ? `Could not discard: ${error.message}` : "Drafts discarded", error ? "bad" : "good");
    }
    if (announce) renderStatus();
  }

  // ---- layout -----------------------------------------------------------------
  clear(root,
    head,
    h("div", { style: { display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "flex-start" } },
      h("aside.stack", { style: { flex: "1 1 240px", maxWidth: "340px", minWidth: "0" } },
        h("div.card.stack",
          field("Reel", reelSel),
          field("Video cut", assetSel),
          reelInfo,
          vidWrap)),
      h("div.stack", { style: { flex: "999 1 420px", minWidth: "0" } },
        cards.map((c) => c.el),
        h("section.card.stack",
          h("h3", "When"),
          h("div.checks",
            h("label", whenNow, "Now"),
            h("label", whenLater, "Schedule")),
          at, atHint,
          h("span.hint", "Scheduled posts are published by the server at that time, even with every browser closed. Manual posts go straight to their checklist in Posts.")),
        campaignIntro,
        status,
        h("div.row.end", discardBtn, checkBtn, launchBtn),
        h("p.hint", "Drafts made by Check are removed if you leave without launching."))));

  fillReels();
  onReel();

  api("adapters", null, "GET")
    .then((a) => { S.adapters = a; })
    .catch((e) => { S.adaptersError = e.message; })
    .finally(() => cards.forEach(renderLimits));

  const off = store.on((table) => {
    if (table === "reels" || table === "*") { fillReels(); renderReelInfo(); }
    if (table === "assets" && !asset() && S.reelId) onReel();
    if (["connections", "*"].includes(table)) for (const c of cards) { renderHealth(c); renderLimits(c); }
    if (["posts", "settings", "*"].includes(table)) renderCampaign();
  });

  return () => {
    off();
    clearTimeout(timer);
    vid.removeAttribute("src");
    if (!S.launched) discard(false);
  };
}

function show(el, on) {
  el.style.display = on ? "" : "none";
}

function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
