// DEV ONLY. An in-memory stand-in for js/supa.js so the real app.js, store.js
// and views run without a deployed database. dev/mock.html swaps it in with
// an import map. Writes emit Realtime-style events, so the live store path is
// exercised too. Media comes from the maana repo when the dev server is
// started from the folder that holds both repos (see mock.html).
//
// Query parameters:
//   role=owner|editor|viewer   the signed-in person's role (in every workspace they belong to)
//   member=all|maana|mawadda   which workspaces they belong to (default all)
//   mawadda=empty              a brand-new Mawadda workspace (no reels, posts, connections, settings)
//   media=private              library URLs look like private GitHub release URLs; POST /media-links
//                              "signs" them back to the local files (otherwise it echoes each URL)

const qs = new URLSearchParams(location.search);
const ROLE = qs.get("role") ?? "owner";
const MEMBER = qs.get("member") ?? "all";
const MAWADDA_EMPTY = qs.get("mawadda") === "empty";
const EMAIL = MEMBER === "mawadda"
  ? "yhammad77@outlook.com"
  : { owner: "sytalhas@gmail.com", editor: "editor@getmaana.com", viewer: "viewer@getmaana.com" }[ROLE];
const UID = "00000000-0000-4000-8000-00000000000" + ({ owner: 1, editor: 2, viewer: 3 }[ROLE] ?? 9);
const LOCAL_MEDIA = new URL("../../maana/marketing/", document.baseURI).href;
const PRIVATE_MEDIA = qs.get("media") === "private";
// TikTok: tiktok=direct (TIKTOK_DIRECT_POST on, before the audit) | audited (after it); ttphoto=verified (photo link
// verified, so the generator's TikTok draft is an inbox draft, or ttmethod=api for a direct photo post).
const TT = qs.get("tiktok") ?? "";
const TT_PHOTO = qs.get("ttphoto") === "verified";
const TT_METHOD = qs.get("ttmethod");
const RELEASE_MEDIA = "https://github.com/sytalhas/maana-media/releases/download/library/";
const MEDIA = PRIVATE_MEDIA ? RELEASE_MEDIA : LOCAL_MEDIA;

const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const H = 3600e3;
const D = 24 * H;
let seq = 1;
const uuid = () => `${(seq++).toString(16).padStart(8, "0")}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`;

// ---------------------------------------------------------------------------
// Sample data (real reel ids, titles and files from maana/marketing)
// ---------------------------------------------------------------------------

const R = (id, title, batch, folder, x) => ({
  id, title, batch, folder, status: "ready", hook_type: null, format: null, look: null, voice: null, length_s: null,
  word_taught: null, arabic_frame0: null, lead: null, sound: null, caption_organic: null, caption_paid: null,
  headline_paid: null, captions: {}, script: null, notes: null, flags: [], poster_url: `${MEDIA}${folder}/${folder.split("/").pop()}.jpg`,
  imported_at: iso(now - 2 * H), created_at: iso(now - 20 * D), updated_at: iso(now - 2 * H), ...x,
});

const reels = [
  R("r1", "Known by sound", "batch1", "reels/r1-known-by-sound", {
    status: "live", hook_type: "statement", format: "teach_one_word", look: "paper", voice: "none", length_s: 18.0,
    word_taught: "iyyāka", arabic_frame0: true, lead: "aha_first", sound: "in_app_recitation",
    caption_organic: "Iyyāka naʿbudu wa iyyāka nastaʿīn.\nYou've known it by sound your whole life. Here it is word by word:\n\nإِيَّاكَ — You alone\nنَعۡبُدُ — we worship",
    notes: "Recitation: al-Minshawi, 1:5 only. In-point 22.8s, trim-out 28.4s. Never let 1:6 play.",
  }),
  R("r2", "Said and meant", "batch1", "reels/r2-said-meant", {
    status: "live", hook_type: "pattern", format: "before_after", look: "paper", voice: "none", length_s: 17.2,
    arabic_frame0: true, lead: "aha_first", sound: "in_app_recitation",
    caption_organic: "Al-ʿAṣr. Three ayat, fourteen words, and one of the shortest surahs you'll ever recite.\n\nWhat is said, on the left. What it means, on the right.",
  }),
  R("r3", "Seven seconds of silence", "batch1", "reels/r3-silence", {
    hook_type: "statement", format: "teach_one_word", look: "paper", voice: "none", length_s: 16.3, word_taught: "rabb",
    arabic_frame0: true, lead: "aha_first", sound: "silence",
    caption_organic: "No sound on this one. On purpose.\n\nرَبِّ: rabb, Lord. From al-ḥamdu lillāhi rabbi l-ʿālamīn (1:2).",
  }),
  R("r4", "Recitation first", "batch1", "reels/r4-recitation-first", {
    hook_type: "statement", format: "story", look: "footage", voice: "none", length_s: 20.5, lead: "aha_first", sound: "in_app_recitation",
    caption_organic: "Ash-Sharḥ 94:5 to 6. Ease, promised twice.", poster_url: null,
  }),
  R("r5", "Understood card", "batch1", "reels/r5-understood-card", {
    hook_type: "number", format: "count_along", look: "paper", voice: "none", length_s: 15.1, arabic_frame0: true,
    lead: "product_first", sound: "in_app_recitation",
    caption_organic: "Al-Fātiḥah: 21 of 29 words understood.\n\nYou recite it in every rakʿah. Each green word is one you know.\n\nFree, link in bio.",
  }),
  R("r6", "Twenty years", "batch1", "reels/r6-twenty-years", {
    hook_type: "statement", format: "story", look: "footage", voice: "none", length_s: 19.8, lead: "aha_first", sound: "sfx",
    caption_organic: "Story inspired by learners (dramatized).",
    flags: [{ code: "dramatized", message: "Dramatized testimonial: keep the on-screen label and the caption label." }],
  }),
  R("r7", "One root, three words", "batch1", "reels/r7-one-root", {
    hook_type: "pattern", format: "teach_one_word", look: "paper", voice: "none", length_s: 16.3, word_taught: "raḥmah",
    arabic_frame0: true, lead: "aha_first", sound: "in_app_recitation",
    caption_organic: "ar-Raḥmān. ar-Raḥīm. Raḥmah.\nThree words you've heard all your life, and one root under all of them: ر ح م, mercy.",
  }),
  R("r8", "Which do you know", "batch1", "reels/r8-which-do-you-know", {
    hook_type: "question", format: "puzzle", look: "paper", voice: "none", length_s: 17.0, arabic_frame0: true,
    lead: "aha_first", sound: "in_app_recitation", caption_organic: "Which of these do you already know? Count them.",
  }),
  ...[["b01", "The number", "b01-the-number", "number", "product_first"], ["b02", "One word, 1,618 times", "b02-qala", "number", "product_first"],
    ["b03", "Tap test", "b03-tap-test", "question", "product_first"], ["b04", "Free. No subscription needed.", "b04-free", "statement", "product_first"],
    ["b05", "Before / after", "b05-before-after", "pattern", "product_first"], ["b06", "A whole surah", "b06-whole-surah", "number", "product_first"],
    ["b07", "Founder cut", "b07-founder", "statement", "product_first"], ["b08", "POV", "b08-pov", "pov", "product_first"]]
    .map(([id, title, f, hook, lead]) => R(id, title, "batch2", `batch2/${f}`, {
      status: "shelved", hook_type: hook, lead, look: id === "b07" ? "night" : id === "b08" ? "footage" : "paper",
      format: id === "b07" ? "founder" : id === "b05" ? "before_after" : "teach_one_word", voice: "tts", sound: "sfx",
      length_s: 16 + (id.charCodeAt(2) % 6), caption_organic: `${title}. Free on the App Store. No subscription needed.`,
      caption_paid: "Maana is a free app that teaches the most frequent words of the Qur'an.", headline_paid: "About 900 words. 80% of the Qur'an.",
      flags: [{ code: "shelved_by_founder", message: "Founder review: too fast, no aha. Kept for reference." }],
    })),
  R("p01", "Al-Fatihah tap test (playable)", "playable", "batch2/p01-playable", { status: "ready", format: "playable", poster_url: null }),
  ...[["c1", "Except once", "c1-except-once"], ["c2", "With", "c2-with"], ["c3", "Count it", "c3-count-it"], ["c4", "Nearest", "c4-nearest"]]
    .map(([id, title, f], i) => R(id, title, "batch3", `batch3/${f}`, {
      status: i === 0 ? "ready" : "in_production", format: "teach_one_word", look: "footage", voice: "tts", sound: "voice", lead: "aha_first",
      hook_type: ["myth_bust", "question", "number", "statement"][i], length_s: 24 + i * 3,
      caption_organic: i === 0 ? "One word, and the one time it breaks the rule. Free on the App Store." : null,
      poster_url: i === 0 ? `${MEDIA}batch3/${f}/${f}.jpg` : null,
      flags: i === 0 ? [] : [{ code: "needs_rerender", message: "Render not landed yet (batch 3 in production)." }],
    })),
];

const assets = [];
const A = (reel_id, variant, file, x = {}) => assets.push({
  id: uuid(), reel_id, kind: "video", variant, url: `${MEDIA}${store0(reel_id).folder}/${file}`, repo_path: `marketing/${store0(reel_id).folder}/${file}`,
  bytes: 2_000_000, sha256: null, duration_s: store0(reel_id).length_s, width: 1080, height: 1920, audio: "sfx", manual_audio: false,
  created_at: iso(now - 20 * D), ...x,
});
function store0(id) { return reels.find((r) => r.id === id); }
const SIZES = { r1: [2027038, 1542579], r2: [2018823, 1511081], r5: [1633610, 1844707], r6: [28853768, 27968516], r7: [1443948, 1567395], r8: [2162498, 1851570] };
for (const r of reels.filter((x) => x.batch === "batch1")) {
  const base = r.folder.split("/").pop();
  if (r.id === "r4") {
    A("r4", "paid", `${base}-paid.mp4`, { bytes: 2254170, duration_s: 19.7, audio: "sfx" });
  } else A(r.id, "main", `${base}.mp4`, { bytes: SIZES[r.id]?.[0] ?? 1232806, audio: r.id === "r3" ? "none" : "sfx" });
  if (r.id !== "r3") A(r.id, "igaudio", `${base}-igaudio.mp4`, { bytes: SIZES[r.id]?.[1] ?? 1742657, audio: "none", manual_audio: true, duration_s: r.id === "r4" ? 20.5 : r.length_s });
}
for (const r of reels.filter((x) => x.batch === "batch2")) {
  const base = r.folder.split("/").pop();
  A(r.id, "main", `${base}.mp4`, { bytes: 3_500_000 + (r.id.charCodeAt(2) * 91_000), audio: "mixed" });
}
A("c1", "main", "c1-except-once.mp4", { bytes: 5_120_000, audio: "voice" });
assets.push({ id: uuid(), reel_id: "p01", kind: "playable", variant: "main", url: null, repo_path: "marketing/batch2/p01-playable/web/index.html", bytes: 412_000, duration_s: null, width: null, height: null, audio: null, manual_audio: false, created_at: iso(now - 9 * D) });

const conns = [
  { id: uuid(), platform: "instagram", account_id: "17841400000000001", account_name: "@maana.app", status: "connected", scopes: ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_insights"], token_expires_at: iso(now + 41 * D), limits: { publishing: { used_24h: 2, cap_24h: 100 } }, info: {}, last_checked_at: iso(now - 3 * H), last_error: null, created_at: iso(now - 19 * D), updated_at: iso(now - 3 * H) },
  { id: uuid(), platform: "facebook", account_id: "10000000001", account_name: "Maana (Page)", status: "expiring", scopes: ["pages_manage_posts", "read_insights"], token_expires_at: iso(now + 4 * D), limits: {}, info: {}, last_checked_at: iso(now - 3 * H), last_error: null, created_at: iso(now - 19 * D), updated_at: iso(now - 3 * H) },
  { id: uuid(), platform: "youtube", account_id: "UCxxxx", account_name: "Maana", status: "connected", scopes: ["youtube.upload", "yt-analytics.readonly"], token_expires_at: null, limits: { audit: "not_audited", quota_units_day: 10000 }, info: {}, last_checked_at: iso(now - 20 * H), last_error: null, created_at: iso(now - 10 * D), updated_at: iso(now - 20 * H) },
  { id: uuid(), platform: "tiktok", account_id: "tt-001", account_name: "@maana.app", status: "error", scopes: ["video.upload", "video.list"], token_expires_at: iso(now - 1 * D), limits: { direct_post_audited: false }, info: {}, last_checked_at: iso(now - 26 * H), last_error: "access_token_invalid: The access token is invalid or not found in the request.", created_at: iso(now - 8 * D), updated_at: iso(now - 26 * H) },
];
if (TT) Object.assign(conns[3], { status: "connected", last_error: null, token_expires_at: iso(now + 300 * D), scopes: ["user.info.basic", "video.upload", "video.list", "video.publish"],
  limits: { direct_post_audited: TT === "audited" }, info: { display_name: "Maana", direct_post: true, audited: TT === "audited" } });

const vid = (reel, variant) => assets.find((a) => a.reel_id === reel && a.variant === variant)?.id ?? null;
const P = (x) => ({
  id: uuid(), asset_id: null, connection_id: null, method: "api", status: "live", scheduled_at: null, published_at: null, caption: "",
  first_comment: null, cover_ms: 0, options: {}, preflight: { ok: true, errors: [], warnings: ["The app is not live yet, so App Store campaign links cannot be generated. The campaign id is reserved for this post."], checked_at: iso(now - 5 * D) },
  campaign_ct: null, experiment_id: null, variant_label: null, platform_media_id: null, platform_url: null, manual_checklist: {},
  confirmed_by: UID, confirmed_at: iso(now - 5 * D), error: null, last_synced_at: null, next_sync_at: null,
  created_at: iso(now - 5 * D), created_by: UID, updated_at: iso(now - 1 * H), ...x,
});
const posts = [
  P({ reel_id: "r1", asset_id: vid("r1", "igaudio"), platform: "instagram", post_type: "organic", method: "manual", published_at: iso(now - 5 * D), platform_media_id: "1790000001", platform_url: "https://www.instagram.com/reel/C0mockR1/", campaign_ct: "r1-igo-260925-a1b", caption: reels[0].caption_organic, last_synced_at: iso(now - 40 * 60e3), manual_checklist: { download: true, create: true, sound: true, caption: true, post: true, link: true } }),
  P({ reel_id: "r2", asset_id: vid("r2", "igaudio"), platform: "instagram", post_type: "organic", method: "manual", published_at: iso(now - 3 * D), platform_media_id: "1790000002", platform_url: "https://www.instagram.com/reel/C0mockR2/", campaign_ct: "r2-igo-260927-c3d", caption: reels[1].caption_organic, last_synced_at: iso(now - 50 * 60e3) }),
  P({ reel_id: "r2", asset_id: vid("r2", "main"), platform: "facebook", post_type: "organic", published_at: iso(now - 3 * D), platform_media_id: "fb_2", platform_url: "https://www.facebook.com/reel/1000002", campaign_ct: "r2-fbo-260927-e5f", caption: reels[1].caption_organic, last_synced_at: iso(now - 2 * H) }),
  P({ reel_id: "r5", asset_id: vid("r5", "igaudio"), platform: "instagram", post_type: "organic", method: "manual", status: "awaiting_manual", campaign_ct: "r5-igo-260930-g7h", caption: reels[4].caption_organic, first_comment: "Which word did you know first?", confirmed_at: iso(now - 2 * H), manual_checklist: { download: true, create: true } }),
  P({ reel_id: "r3", asset_id: vid("r3", "main"), platform: "tiktok", post_type: "organic", method: "inbox_draft", status: "inbox_draft", campaign_ct: "r3-tto-260929-j9k", caption: reels[2].caption_organic, platform_media_id: "v_inbox_1" }),
  P({ reel_id: "r3", asset_id: vid("r3", "main"), platform: "youtube", post_type: "organic", status: "private_until_audit", published_at: iso(now - 1 * D), platform_media_id: "yt_abc", platform_url: "https://youtube.com/shorts/mockabc", campaign_ct: "r3-yto-260929-m1n", caption: reels[2].caption_organic, options: { title: "Seven seconds of silence", privacy: "public" }, last_synced_at: iso(now - 1 * H) }),
  P({ reel_id: "r7", asset_id: vid("r7", "main"), platform: "facebook", post_type: "organic", status: "failed", scheduled_at: iso(now - 6 * H), campaign_ct: "r7-fbo-260930-p2q", caption: reels[6].caption_organic, error: "(#200) The user hasn't authorized the application to perform this action (pages_manage_posts)." }),
  P({ reel_id: "r8", asset_id: vid("r8", "main"), platform: "instagram", post_type: "trial", status: "scheduled", scheduled_at: iso(now + 20 * H), campaign_ct: "r8-igt-261001-r3s", caption: reels[7].caption_organic, options: { trial_params: { graduation_strategy: "SS_PERFORMANCE" } }, confirmed_at: iso(now - 30 * 60e3) }),
];

// A carousel sent from the content-creator post generator ("Send to Studio"): the real package from
// dev/fixtures/draft_package.json (built by studio_send.py from a Maana run), as studio-api /drafts stores it.
// Slides load from the generator's local output: ?gen=<folder with 4x5/ and 9x16/> (default: the g2s-cc worktree).
const GEN_LOCAL = new URL(qs.get("gen") ?? "../../g2s-cc/out/generator/maana/20261006-164305-carousel-fd96/variants/v1/studio/", document.baseURI).href;
const GEN_PKG = await fetch(new URL("./fixtures/draft_package.json", import.meta.url)).then((r) => r.json()).catch(() => null);
if (GEN_PKG) {
  const pk = GEN_PKG;
  reels.push({ ...R(pk.package_id, pk.title, "generator", "", { folder: null, status: "ready", caption_organic: pk.posts[0].caption, poster_url: pk.sets["4x5"].items[0].url }),
    notes: `Sent from the content-creator post generator (${pk.source.run} ${pk.source.variant}).`,
    package: { schema: pk.schema, source: pk.source, gate_report: pk.gate_report, credits: pk.credits, skipped: pk.skipped, ayahs: pk.ayahs } });
  const setIds = {};
  for (const [variant, st] of Object.entries(pk.sets)) {
    setIds[variant] = uuid();
    assets.push({ id: setIds[variant], reel_id: pk.package_id, kind: "image_set", variant, url: st.items[0].url, repo_path: null, bytes: null,
      sha256: null, duration_s: null, width: st.width, height: st.height, audio: null, manual_audio: false, items: st.items, created_at: iso(now - 1 * H) });
  }
  for (const gp of pk.posts) {
    // As studio-api /drafts plans it: TikTok is manual until the photo link is verified.
    const method = gp.platform === "tiktok" ? (TT_PHOTO ? (TT_METHOD === "api" ? "api" : "inbox_draft") : "manual") : gp.method;
    posts.push(P({ reel_id: pk.package_id, asset_id: setIds[gp.set], platform: gp.platform, post_type: "organic", method, status: "draft",
      format: "carousel", caption: gp.caption, confirmed_by: null, confirmed_at: null, created_at: iso(now - 50 * 60e3),
      options: { set: gp.set, source: "generator", audio: gp.platform === "tiktok" && method === "api" ? { ...gp.audio, choice: { id: "none", label: "No added sound", kind: "none" }, manual_step: null } : gp.audio, alt_text: pk.sets[gp.set].items.map((i) => i.alt), ...(gp.platform === "tiktok" ? { auto_add_music: false } : {}) },
      preflight: { ok: true, errors: [], warnings: gp.platform === "tiktok"
        ? ["The app is not live yet, so App Store campaign links cannot be generated. The campaign id is reserved for this post."]
        : ["The app is not live yet, so App Store campaign links cannot be generated. The campaign id is reserved for this post."], checked_at: iso(now - 50 * 60e3) } }));
  }
}

const metrics = [];
const M = (post, hoursAgo, x) => metrics.push({ id: metrics.length + 1, post_id: post.id, captured_at: iso(now - hoursAgo * H), raw: {}, ...x });
for (let i = 0; i < 6; i++) {
  const f = (i + 1) / 6;
  M(posts[0], 100 - i * 18, { source: "instagram_insights", views: Math.round(4210 * f), reach: Math.round(3300 * f), likes: Math.round(312 * f), comments: Math.round(21 * f), shares: Math.round(88 * f), saves: Math.round(140 * f), avg_watch_s: 7.9, skip_rate: 0.58 });
  M(posts[1], 60 - i * 10, { source: "instagram_insights", views: Math.round(1890 * f), reach: Math.round(1500 * f), likes: Math.round(120 * f), comments: Math.round(9 * f), shares: Math.round(31 * f), saves: Math.round(66 * f), avg_watch_s: 6.4, skip_rate: 0.63 });
}
M(posts[2], 2, { source: "facebook_video_insights", views: 640, reach: 590, likes: 22, comments: 1, shares: 4, avg_watch_s: 4.1 });
M(posts[5], 1, { source: "youtube_analytics", views: 0, likes: 0 });
M(posts[0], 20, { source: "manual", follows: 14, link_clicks: 9 });

const jobs = [
  { id: 1, kind: "publish", platform: "facebook", post_id: posts[6].id, status: "failed", attempts: 3, max_attempts: 3, run_at: iso(now - 6 * H), last_error: posts[6].error, created_at: iso(now - 7 * H), updated_at: iso(now - 5.5 * H), payload: {} },
  { id: 2, kind: "sync", platform: "instagram", post_id: posts[0].id, status: "done", attempts: 1, max_attempts: 3, run_at: iso(now - 40 * 60e3), last_error: null, created_at: iso(now - 41 * 60e3), updated_at: iso(now - 40 * 60e3), payload: {} },
  { id: 3, kind: "publish", platform: "instagram", post_id: posts[7].id, status: "pending", attempts: 0, max_attempts: 3, run_at: posts[7].scheduled_at, last_error: null, created_at: iso(now - 30 * 60e3), updated_at: iso(now - 30 * 60e3), payload: {} },
  { id: 4, kind: "health", platform: "tiktok", post_id: null, connection_id: conns[3].id, status: "failed", attempts: 2, max_attempts: 2, run_at: iso(now - 26 * H), last_error: conns[3].last_error, created_at: iso(now - 27 * H), updated_at: iso(now - 26 * H), payload: {} },
  { id: 5, kind: "publish", platform: "youtube", post_id: posts[5].id, status: "done", attempts: 1, max_attempts: 3, run_at: iso(now - 1 * D), last_error: null, created_at: iso(now - 1 * D), updated_at: iso(now - 1 * D + 90e3), payload: {} },
];

const alerts = [
  { id: 1, kind: "launch_failed", severity: "error", message: "R7 on Facebook failed after 3 attempts: (#200) missing pages_manage_posts.", post_id: posts[6].id, connection_id: null, created_at: iso(now - 5.5 * H), resolved_at: null },
  { id: 2, kind: "token_expiring", severity: "warn", message: "The Facebook Page token expires in 4 days. Reconnect in Connections.", post_id: null, connection_id: conns[1].id, created_at: iso(now - 3 * H), resolved_at: null },
  { id: 3, kind: "beat_target", severity: "good", message: "R1 on Instagram: hook rate 42% beats the 30% target (4,210 views).", post_id: posts[0].id, connection_id: null, created_at: iso(now - 20 * H), resolved_at: null },
  { id: 4, kind: "sync_failed", severity: "error", message: "TikTok health check failed: access token invalid.", post_id: null, connection_id: conns[3].id, created_at: iso(now - 26 * H), resolved_at: null },
];

const settings = [
  { key: "targets", value: { hook_rate: 0.3, hold_rate: 0.4, cpi: null, d7_retention: null }, note: "hook and hold from strategy/STRATEGY.md; CPI and D7 are for the owner to set (app is free)", updated_at: iso(now - 10 * D) },
  { key: "ads_spend_cap", value: { total_usd: 100, daily_usd: null }, note: "Hard cap enforced server-side before any ad object is created or activated", updated_at: iso(now - 10 * D) },
  { key: "cadence", value: { organic_per_week_min: 3, organic_per_week_max: 4 }, note: "strategy/STRATEGY.md, Measurement", updated_at: iso(now - 10 * D) },
  { key: "app_store", value: { app_id: "6817107338", provider_token: null, live: false }, note: "provider_token (pt) only exists after the first campaign link is created in App Store Connect, which needs a live app", updated_at: iso(now - 10 * D) },
];

const members = [
  { email: "sytalhas@gmail.com", user_id: "00000000-0000-4000-8000-000000000001", role: "owner", name: "Owner", created_at: iso(now - 20 * D) },
  { email: "editor@getmaana.com", user_id: "00000000-0000-4000-8000-000000000002", role: "editor", name: "Editor", created_at: iso(now - 12 * D) },
  { email: "viewer@getmaana.com", user_id: null, role: "viewer", name: null, created_at: iso(now - 2 * D) },
];

const audit_log = [
  { id: 3, at: iso(now - 30 * 60e3), actor: UID, actor_email: "editor@getmaana.com", action: "update", entity: "posts", entity_id: posts[7].id, detail: { status: ["draft", "scheduled"], confirmed_at: [null, iso(now - 30 * 60e3)] } },
  { id: 2, at: iso(now - 2 * H), actor: UID, actor_email: "sytalhas@gmail.com", action: "update", entity: "reels", entity_id: "b03", detail: { status: ["ready", "shelved"] } },
  { id: 1, at: iso(now - 10 * D), actor: null, actor_email: null, action: "insert", entity: "settings", entity_id: "targets", detail: { new: {} } },
];

const campaign_links = posts.filter((p) => p.campaign_ct).map((p) => ({ ct: p.campaign_ct, post_id: p.id, url: null, created_at: p.created_at }));

// ---------------------------------------------------------------------------
// Workspaces (same values as supabase/migrations/20261003120000_studio_workspaces.sql)
// ---------------------------------------------------------------------------

const workspaces = [
  {
    id: "maana", name: "Maana", short_name: "Maana", tagline: "Qur'anic vocabulary", site_url: "https://getmaana.com/",
    ios_app_id: "6817107338", android_id: "co.qordova.maana", bundle_id: "co.qordova.maana", sort: 1,
    palette: { "--paper": "#F8F3EA", "--paper-2": "#F1EADD", "--card": "#FFFDF8", "--navy": "#0E1F3D", "--ink-2": "#44506A",
      "--ink-3": "#6B7488", "--coral": "#E08864", "--coral-soft": "#F3A37E", "--coral-ink": "#A5502D", "--green": "#286F4D",
      "--mint": "#DDEFE4", "--line": "#E4DACA", "--side": "#0E1F3D", "--side-ink": "#F8F3EA", "--side-mute": "#D8DDE8", "--brand": "#286F4D" },
    logo_url: "../apple-touch-icon.png",
    fonts: { display: "Fraunces", body: "Nunito", css: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Nunito:wght@400;600;700;800&display=swap" },
    copy: { studio_name: "Maana Studio", brand: "Maana", domain: "getmaana.com", privacy_url: "https://getmaana.com/privacy/",
      terms_url: "https://getmaana.com/terms/", support_email: "developer@getmaana.com", company: "Qordova Inc.",
      app_store_url: "https://apps.apple.com/app/id6817107338", play_store_url: null, media_repo: "sytalhas/maana-media",
      content_kind: "short educational videos", default_video_title: "Maana", app_live: false,
      handles: { instagram: "@maana.app", tiktok: "@maana.app", youtube: "Maana", facebook: "Maana" } },
    preflight: { recitation_rules: true, religion_rule: true, time_promise: true, silent_warning: true, banned: [], warn: [],
      audio_policy: { allowed: ["none", "voice", "sfx", "recitation"], vocal_only: true } },
    levers: {
      vocab: {
        hook_type: ["question", "number", "statement", "pov", "pattern", "myth_bust"],
        format: ["teach_one_word", "story", "puzzle", "count_along", "before_after", "founder", "playable"],
        look: ["paper", "night", "footage", "chalkboard"], voice: ["none", "tts", "human"],
        lead: ["product_first", "aha_first"], sound: ["silence", "sfx", "in_app_recitation", "voice"],
      },
      fields: [
        { key: "hook_type", label: "Hook type", kind: "choice", store: "column" }, { key: "format", label: "Format", kind: "choice", store: "column" },
        { key: "look", label: "Look", kind: "choice", store: "column" }, { key: "voice", label: "Voice", kind: "choice", store: "column" },
        { key: "lead", label: "Lead", kind: "choice", store: "column" }, { key: "sound", label: "Sound", kind: "choice", store: "column" },
        { key: "word_taught", label: "Word taught", kind: "text", store: "column" },
        { key: "arabic_frame0", label: "Arabic on screen at frame 0", kind: "bool", store: "column" },
      ],
      import_keys: ["hook_type", "format", "look", "voice", "word_taught", "arabic_frame0", "lead", "sound"],
    },
    media_manifest_url: "https://github.com/sytalhas/maana-media/releases/download/library/manifest.json",
  },
  {
    id: "mawadda", name: "Mawadda", short_name: "Mawadda", tagline: "Muslim couples", site_url: "https://mawadda.app/",
    ios_app_id: "6756983545", android_id: "com.mawadda.android", bundle_id: "com.mawadda.mawadda", sort: 2,
    palette: { "--paper": "#F4EEE1", "--paper-2": "#EBE2D0", "--card": "#FFFBF3", "--navy": "#2C211B", "--ink-2": "#5A4A40",
      "--ink-3": "#7D6D62", "--coral": "#B08A3E", "--coral-soft": "#D9BE84", "--coral-ink": "#7A5C1F", "--green": "#2F6B4A",
      "--mint": "#E1EEE4", "--line": "#E2D6C0", "--side": "#7B011E", "--side-ink": "#F4EEE1", "--side-mute": "#EBD9D3", "--brand": "#7B011E" },
    logo_url: "img/mawadda-mark.png",
    fonts: { display: "Fraunces", body: "Plus Jakarta Sans", css: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" },
    copy: { studio_name: "Mawadda Studio", brand: "Mawadda", domain: "mawadda.app", privacy_url: "https://mawadda.app/privacy",
      terms_url: "https://mawadda.app/terms", support_email: "info@mawadda.app", company: "Mawadda",
      app_store_url: "https://apps.apple.com/app/id6756983545", play_store_url: "https://play.google.com/store/apps/details?id=com.mawadda.android",
      media_repo: null, content_kind: "short videos for Muslim couples", default_video_title: "Mawadda", app_live: true,
      handles: { instagram: "@mawadda.app", tiktok: "@mawadda.app", youtube: "Mawadda", facebook: "Mawadda" }, handles_are_samples: true },
    preflight: { recitation_rules: false, religion_rule: true, time_promise: true, silent_warning: true, banned: [], warn: [],
      audio_policy: { allowed: ["none", "voice", "sfx", "nasheed_vocal_only", "recitation"], vocal_only: true } },
    levers: {
      vocab: {
        hook_type: ["question", "number", "statement", "pov", "pattern", "myth_bust"],
        format: ["conversation_starter", "tip", "story", "quiz", "myth_bust", "app_demo", "founder", "testimonial"],
        look: ["warm", "illustrated", "footage", "studio"], voice: ["none", "tts", "human"],
        lead: ["product_first", "aha_first"], sound: ["silence", "sfx", "voice", "ambient"],
        topic: ["communication", "conflict", "gratitude", "family", "faith", "fun", "finances", "future"],
        audience: ["engaged", "newlywed", "married", "all"],
      },
      fields: [
        { key: "hook_type", label: "Hook", kind: "choice", store: "column" }, { key: "format", label: "Format", kind: "choice", store: "column" },
        { key: "topic", label: "Topic", kind: "choice", store: "levers" }, { key: "audience", label: "Audience", kind: "choice", store: "levers" },
        { key: "look", label: "Look", kind: "choice", store: "column" }, { key: "voice", label: "Voice", kind: "choice", store: "column" },
        { key: "lead", label: "Lead", kind: "choice", store: "column" }, { key: "sound", label: "Sound", kind: "choice", store: "column" },
      ],
      import_keys: ["hook_type", "format", "look", "voice", "lead", "sound", "topic", "audience"],
    },
    media_manifest_url: null,
  },
];

// Everything above is Maana's (the live data today).
for (const list of [reels, assets, posts, conns, metrics, jobs, alerts, settings, members, audit_log, campaign_links]) {
  for (const r of list) r.workspace_id = "maana";
}
for (const r of reels) r.levers = {};

// ---------------------------------------------------------------------------
// Mawadda sample data (skipped with ?mawadda=empty: a brand-new workspace)
// ---------------------------------------------------------------------------

const MW = "mawadda";
if (!MAWADDA_EMPTY) {
  const MR = (id, title, x) => ({
    ...R(id, title, "planned", `mawadda/${id}`, { ...x, folder: null, poster_url: null }), workspace_id: MW, levers: x.levers ?? {},
  });
  const mwReels = [
    MR("m01", "Tonight's question", { status: "live", hook_type: "question", format: "conversation_starter", look: "warm", voice: "human",
      lead: "aha_first", sound: "voice", length_s: 21, levers: { topic: "communication", audience: "married" },
      caption_organic: "One question for the two of you tonight. Answer it before you look at each other's answer." }),
    MR("m02", "Three words before sleep", { status: "live", hook_type: "number", format: "tip", look: "illustrated", voice: "tts",
      lead: "aha_first", sound: "ambient", length_s: 17.5, levers: { topic: "gratitude", audience: "all" },
      caption_organic: "Three words, every night, for a week. Tell us what changed." }),
    MR("m03", "The sealed answer", { status: "ready", hook_type: "pov", format: "app_demo", look: "studio", voice: "human",
      lead: "product_first", sound: "voice", length_s: 24, levers: { topic: "fun", audience: "newlywed" },
      caption_organic: "Your answer stays sealed until your spouse answers too." }),
    MR("m04", "Money talk without a fight", { status: "idea", planned_for: new Date(now + 3 * D).toISOString().slice(0, 10), pipeline_status: "writing",
      hook_type: "myth_bust", format: "story", levers: { topic: "finances", audience: "engaged" } }),
    MR("m05", "Before the wedding: five questions", { status: "idea", planned_for: new Date(now + 6 * D).toISOString().slice(0, 10), pipeline_status: "agreed",
      levers: { topic: "future", audience: "engaged" } }),
  ];
  reels.push(...mwReels);
  const mwAsset = (reel_id, x = {}) => {
    const a = { id: uuid(), workspace_id: MW, reel_id, kind: "video", variant: "main", url: null, repo_path: null, bytes: 3_100_000,
      sha256: null, duration_s: reels.find((r) => r.workspace_id === MW && r.id === reel_id).length_s, width: 1080, height: 1920,
      audio: "voice", manual_audio: false, created_at: iso(now - 9 * D), ...x };
    assets.push(a);
    return a.id;
  };
  const a1 = mwAsset("m01"), a2 = mwAsset("m02"), a3 = mwAsset("m03");
  const mwConn = { id: uuid(), workspace_id: MW, platform: "instagram", account_id: "17841400000000099", account_name: "@mawadda.app",
    status: "connected", scopes: ["instagram_business_basic", "instagram_business_content_publish"], token_expires_at: iso(now + 52 * D),
    limits: {}, info: { token_kind: "ig_login" }, last_checked_at: iso(now - 2 * H), last_error: null, created_at: iso(now - 9 * D), updated_at: iso(now - 2 * H) };
  conns.push(mwConn);
  const mp1 = P({ workspace_id: MW, reel_id: "m01", asset_id: a1, platform: "instagram", post_type: "organic", connection_id: mwConn.id,
    published_at: iso(now - 4 * D), platform_media_id: "mw_1", platform_url: "https://www.instagram.com/reel/C0mockM1/",
    campaign_ct: "m01-igo-260928-x1y", caption: mwReels[0].caption_organic, last_synced_at: iso(now - 30 * 60e3) });
  const mp2 = P({ workspace_id: MW, reel_id: "m02", asset_id: a2, platform: "instagram", post_type: "organic", connection_id: mwConn.id,
    published_at: iso(now - 2 * D), platform_media_id: "mw_2", platform_url: "https://www.instagram.com/reel/C0mockM2/",
    campaign_ct: "m02-igo-260930-z2w", caption: mwReels[1].caption_organic, last_synced_at: iso(now - 40 * 60e3) });
  const mp3 = P({ workspace_id: MW, reel_id: "m03", asset_id: a3, platform: "instagram", post_type: "organic", connection_id: mwConn.id,
    status: "scheduled", scheduled_at: iso(now + 26 * H), campaign_ct: "m03-igo-261003-q4r", caption: mwReels[2].caption_organic });
  posts.push(mp1, mp2, mp3);
  for (let i = 0; i < 5; i++) {
    const f = (i + 1) / 5;
    metrics.push({ id: metrics.length + 1, workspace_id: MW, post_id: mp1.id, captured_at: iso(now - (90 - i * 18) * H), raw: {}, source: "instagram_insights",
      views: Math.round(6120 * f), reach: Math.round(5200 * f), likes: Math.round(540 * f), comments: Math.round(64 * f), shares: Math.round(210 * f), saves: Math.round(330 * f), avg_watch_s: 9.4, skip_rate: 0.49 });
    metrics.push({ id: metrics.length + 1, workspace_id: MW, post_id: mp2.id, captured_at: iso(now - (44 - i * 8) * H), raw: {}, source: "instagram_insights",
      views: Math.round(2380 * f), reach: Math.round(2010 * f), likes: Math.round(190 * f), comments: Math.round(12 * f), shares: Math.round(45 * f), saves: Math.round(98 * f), avg_watch_s: 7.1, skip_rate: 0.6 });
  }
  campaign_links.push(...[mp1, mp2, mp3].map((p) => ({ workspace_id: MW, ct: p.campaign_ct, post_id: p.id, url: null, created_at: p.created_at })));
  jobs.push({ id: 50, workspace_id: MW, kind: "publish", platform: "instagram", post_id: mp3.id, status: "pending", attempts: 0, max_attempts: 3, run_at: mp3.scheduled_at, last_error: null, created_at: iso(now - 1 * H), updated_at: iso(now - 1 * H), payload: {} });
  alerts.push({ id: 50, workspace_id: MW, kind: "beat_target", severity: "good", message: "M01 on Instagram: hook rate 51% beats the 30% target (6,120 views).", post_id: mp1.id, connection_id: null, created_at: iso(now - 10 * H), resolved_at: null });
  settings.push(...settings.filter((x) => x.workspace_id === "maana").map((x) => ({ ...structuredClone(x), workspace_id: MW,
    note: "Starting values; adjust in Settings",
    value: x.key === "app_store" ? { app_id: "6756983545", provider_token: null, live: true } : structuredClone(x.value) })));
  audit_log.push({ id: 50, workspace_id: MW, at: iso(now - 5 * H), actor: UID, actor_email: "sytalhas@gmail.com", action: "insert", entity: "reels", entity_id: "m05", detail: { new: {} } });
}

// Memberships of the signed-in person (?member=), plus the rest of each team.
const myWorkspaces = MEMBER === "all" ? ["maana", "mawadda"] : [MEMBER];
if (MEMBER === "mawadda") {
  members.length = 0;
}
members.push({ workspace_id: MW, email: "sytalhas@gmail.com", user_id: "00000000-0000-4000-8000-000000000001", role: "owner", name: "Owner", created_at: iso(now - 1 * D) });
if (MEMBER === "mawadda") {
  members.push({ workspace_id: MW, email: EMAIL, user_id: UID, role: ROLE, name: "Yazan", created_at: iso(now - 1 * D) });
} else if (ROLE !== "owner") {
  members.push({ workspace_id: MW, email: EMAIL, user_id: UID, role: ROLE, name: null, created_at: iso(now - 1 * D) });
}

export const DB = {
  workspaces, reels, assets, posts, connections: conns, metrics_snapshots: metrics, jobs, alerts, settings, members, audit_log,
  campaign_links, experiments: [],
};
// Natural keys (unique per workspace) for the duplicate check on insert.
const KEY = { settings: "key", members: "email", campaign_links: "ct" };
window.mockDB = DB;

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

const channels = [];
// Realtime filters: only "col=eq.value", which is what the store uses.
function passes(filter, row) {
  if (!filter) return true;
  const m = /^([a-z_]+)=eq\.(.*)$/.exec(filter);
  return !m || String(row?.[m[1]]) === m[2];
}
function emit(table, eventType, row, old) {
  for (const ch of channels) {
    for (const [t, fn, filter] of ch.handlers) {
      if (t === table && passes(filter, row ?? old)) setTimeout(() => fn({ eventType, new: row ?? {}, old: old ?? {} }), 30);
    }
  }
}

class Query {
  constructor(table) { this.t = table; this.op = "select"; this.f = []; this.lim = null; this.ord = null; this.one = false; this.ret = false; }
  select() { if (this.op !== "select") this.ret = true; return this; }
  insert(v) { this.op = "insert"; this.v = v; return this; }
  update(v) { this.op = "update"; this.v = v; return this; }
  delete() { this.op = "delete"; return this; }
  eq(k, v) { this.f.push((r) => r[k] === v); return this; }
  in(k, vs) { this.f.push((r) => vs.includes(r[k])); return this; }
  is(k, v) { this.f.push((r) => (r[k] ?? null) === v); return this; }
  gte(k, v) { this.f.push((r) => String(r[k]) >= String(v)); return this; }
  not(k, _op, v) { this.f.push((r) => (r[k] ?? null) !== v); return this; }
  order(k, o = {}) { this.ord = [k, o.ascending !== false]; return this; }
  limit(n) { this.lim = n; return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  single() { this.one = true; return this; }
  maybeSingle() { this.one = true; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
  run() {
    const rows = DB[this.t];
    if (!rows) return { data: null, error: { message: `no table ${this.t}` } };
    // Stand-in for RLS: only rows of workspaces the person belongs to.
    const visible = (r) => myWorkspaces.includes(this.t === "workspaces" ? r.id : r.workspace_id ?? "maana");
    const match = (r) => visible(r) && this.f.every((fn) => fn(r));
    if (this.op === "select") {
      let out = rows.filter(match);
      if (this.ord) { const [k, asc] = this.ord; out = [...out].sort((a, b) => (asc ? 1 : -1) * String(a[k] ?? "").localeCompare(String(b[k] ?? ""), undefined, { numeric: true })); }
      if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
      if (this.lim) out = out.slice(0, this.lim);
      out = structuredClone(out);
      return { data: this.one ? out[0] ?? null : out, error: null };
    }
    if (this.op === "insert") {
      const list = (Array.isArray(this.v) ? this.v : [this.v]).map((v) => {
        const k = KEY[this.t] ?? "id";
        v = { workspace_id: "maana", ...v };
        if (!myWorkspaces.includes(v.workspace_id)) throw new Error("new row violates row-level security policy");
        if (k !== "id" && rows.some((r) => r[k] === v[k] && r.workspace_id === v.workspace_id)) throw new Error("duplicate key");
        const row = { ...(k === "id" ? { id: this.t === "metrics_snapshots" ? rows.length + 1 : uuid() } : {}), created_at: iso(Date.now()), updated_at: iso(Date.now()), ...v };
        if (this.t === "metrics_snapshots") row.captured_at ??= iso(Date.now());
        if (this.t === "posts") Object.assign(row, { preflight: null, confirmed_by: null, confirmed_at: null, status: "draft", manual_checklist: {}, campaign_ct: null, created_by: UID });
        rows.push(row);
        emit(this.t, "INSERT", structuredClone(row));
        return row;
      });
      const data = structuredClone(list);
      return { data: this.ret ? (this.one ? data[0] : data) : null, error: null };
    }
    if (this.op === "update") {
      const hit = rows.filter(match);
      for (const r of hit) {
        const old = structuredClone(r);
        Object.assign(r, this.v, { updated_at: iso(Date.now()) });
        if (this.t === "posts" && old.status === "draft" && ["caption", "first_comment", "asset_id", "scheduled_at", "options"].some((k) => JSON.stringify(old[k]) !== JSON.stringify(r[k]))) r.preflight = null;
        emit(this.t, "UPDATE", structuredClone(r), old);
      }
      return { data: this.ret ? structuredClone(hit) : null, error: null };
    }
    if (this.op === "delete") {
      for (const r of rows.filter(match)) {
        rows.splice(rows.indexOf(r), 1);
        emit(this.t, "DELETE", null, structuredClone(r));
      }
      return { data: null, error: null };
    }
  }
}

// ---------------------------------------------------------------------------
// Mock preflight (a small subset of _shared/preflight.ts, for the harness only)
// ---------------------------------------------------------------------------

function wsRowOf(id) { return workspaces.find((w) => w.id === (id ?? "maana")); }
function mockPreflight(p) {
  const errors = [];
  const warnings = [];
  const reel = reels.find((r) => r.id === p.reel_id && r.workspace_id === p.workspace_id);
  const asset = assets.find((a) => a.id === p.asset_id);
  const cap = p.caption ?? "";
  if (!cap.trim()) errors.push("Caption is empty.");
  if (/—/.test(cap + (p.first_comment ?? "") + (p.options?.title ?? ""))) errors.push("Copy contains an em dash. Use : , . or parentheses.");
  if (p.workspace_id === "maana" && /\bpremium\b|\bfree plan\b|\btrial\b/i.test(cap)) errors.push('Copy contains a banned phrase ("Premium", "free plan" or "trial").');
  if (reel && ["shelved", "retired"].includes(reel.status)) errors.push(`Reel ${reel.id} is ${reel.status}. Change its status before launching.`);
  if (asset?.manual_audio && p.platform !== "instagram") errors.push("The recitation (igaudio) cut is Instagram-only.");
  if (asset?.manual_audio && p.platform === "instagram" && p.method !== "manual") errors.push("The recitation (igaudio) cut must use the manual-post checklist, not the API.");
  if (p.platform === "youtube" && !(p.options?.title ?? "").trim()) errors.push("YouTube needs a title.");
  if (p.platform === "instagram" && /https?:\/\//.test(cap)) warnings.push("Links in Instagram captions are not clickable. Use the bio link.");
  if (p.format !== "carousel" && asset?.audio === "none" && !asset.manual_audio) warnings.push("Silent video: Instagram demotes muted reels (BATCH2_RESEARCH.md §5).");
  const choice = p.options?.audio?.choice;   // the brand audio policy (a subset of _shared/audio.ts)
  if (choice) {
    const allowed = wsRowOf(p.workspace_id)?.preflight?.audio_policy?.allowed ?? ["none"];
    if (!allowed.includes(choice.kind)) errors.push(`Audio: ${choice.label}: ${choice.kind} is not allowed by this brand's audio policy (allowed: ${allowed.join(", ")})`);
    if (choice.kind !== "none" && choice.contains_instruments !== false) errors.push(`Audio: ${choice.label}: not confirmed instrument-free`);
    if (choice.kind === "recitation" && !choice.recitation?.fit_review?.pass) errors.push("Audio: recitation needs a passing fit review from the islamic-correctness gate");
    if (choice.kind !== "none" && p.platform === "instagram" && p.method !== "manual") errors.push("Audio: the Instagram API cannot add a sound to a carousel. Use the manual checklist (post it in the app) or choose no added sound.");
    if (choice.kind !== "none" && p.platform === "facebook" && p.method !== "manual") errors.push("Audio: the Facebook API cannot add a sound to a photo post. Use the manual checklist (post it in the Facebook app) or choose no added sound.");
  }
  if (p.platform === "tiktok" && p.format === "carousel" && p.method !== "manual" && !TT_PHOTO) errors.push("TikTok pulls photos only from a verified URL prefix, which is not set up yet. Use the manual checklist.");
  if (p.platform === "tiktok" && p.method === "api" && TT === "audited" && !(p.options?.tiktok?.privacy_level && p.options?.tiktok?.declaration)) errors.push("TikTok direct post: choose who can see it (TikTok allows no default privacy).");
  if (p.workspace_id === "maana") warnings.push("The app is not live yet, so App Store campaign links cannot be generated. The campaign id is reserved for this post.");
  return { ok: errors.length === 0, errors, warnings, checked_at: iso(Date.now()) };
}

function patchPost(id, patch) {
  const r = posts.find((p) => p.id === id);
  if (!r) return;
  const old = structuredClone(r);
  Object.assign(r, patch, { updated_at: iso(Date.now()) });
  emit("posts", "UPDATE", structuredClone(r), old);
}

const mockConfig = { GOOGLE_CLIENT_ID: "studio", GOOGLE_CLIENT_SECRET: "secret" };
const SHORT = { instagram: "ig", facebook: "fb", youtube: "yt", tiktok: "tt" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let apiWorkspace = null;
export function setApiWorkspace(id) { apiWorkspace = id; }
const wsRow = () => workspaces.find((w) => w.id === apiWorkspace) ?? workspaces[0];

export async function api(path, body = {}, method = "POST") {
  await sleep(250);
  body = { ...(body ?? {}), workspace: apiWorkspace };
  console.info("[mock api]", method, path, body);
  const brand = wsRow().name;
  if (path === "config") {
    for (const k of Object.keys(body.values ?? {})) mockConfig[k] = "studio";
    return { ok: true, saved: Object.keys(body.values ?? {}) };
  }
  if (path === "adapters") {
    const out = {
      instagram: { setupNote: "Meta app in development mode. The Instagram professional account must be linked to the Facebook Page and have a role on the app.", limits: { publish_cap_24h: 100, caption_chars: 2200, hashtags: 30 }, oauth: true, connectFromSecrets: false, actions: ["attach_manual"], outwardActions: [] },
      facebook: { setupNote: "Same Meta app as Instagram. Needs pages_manage_posts and read_insights.", limits: { reels_per_24h: 30, duration_s: "3 to 90" }, oauth: true, connectFromSecrets: false, actions: [], outwardActions: [] },
      meta_ads: { setupNote: "Uses a system user token from function secrets.", limits: { spend_cap: "from Settings" }, oauth: false, connectFromSecrets: true, actions: ["create_split_test"], outwardActions: ["create_split_test"] },
      youtube: { setupNote: "Google Cloud project with the YouTube Data API v3 and the Analytics API. Uploads stay private until the API audit passes.", limits: { quota_units_day: 10000, upload_cost_units: 1600 }, oauth: true, connectFromSecrets: false, actions: [], outwardActions: [] },
      tiktok: { setupNote: "TikTok developer app with Content Posting API and Display API. Until audited, videos go to the inbox as drafts.", limits: { uploads_per_24h: 15 }, oauth: true, connectFromSecrets: false, actions: ["attach_video"], outwardActions: [] },
      asc: { setupNote: "App Store Connect API key (owner provides). Analytics Reports API access must be requested once.", limits: {}, oauth: false, connectFromSecrets: true, actions: ["set_provider_token"], outwardActions: [] },
    };
    const guide = (group, fields, minutes, copy) => ({
      group, title: group, minutes, connect: "oauth", copy,
      steps: ["Create the developer app.", "Paste the redirect URI below.", "Copy the keys here and Save.", "Press Connect."],
      fields: fields.map(([name, label, secret, optional]) => ({ name, label, secret, optional, source: mockConfig[name] ?? null })),
    });
    const cb = (p) => ({ label: "Redirect URI", value: `https://vymyqrxvpzlhzpvsuhya.supabase.co/functions/v1/studio-api/oauth/${p}/callback` });
    const meta = guide("meta", [["META_APP_ID", "App ID"], ["META_APP_SECRET", "App secret", true], ["META_BUSINESS_ID", "Business portfolio ID", false, true]], 10, [cb("instagram")]);
    const yt = guide("youtube", [["GOOGLE_CLIENT_ID", "Client ID"], ["GOOGLE_CLIENT_SECRET", "Client secret", true]], 10, [cb("youtube")]);
    const tt = guide("tiktok", [["TIKTOK_CLIENT_KEY", "Client key"], ["TIKTOK_CLIENT_SECRET", "Client secret", true]], 15, [cb("tiktok")]);
    const asc = { ...guide("asc", [["ASC_KEY_ID", "Key ID"], ["ASC_ISSUER_ID", "Issuer ID"], ["ASC_PRIVATE_KEY", "Private key", true]], 5, []), connect: "keys" };
    asc.fields[2].multiline = true;
    for (const g of [meta, yt, tt, asc]) g.ready = g.fields.every((f) => f.optional || f.source);
    out.instagram.setup = meta; out.facebook.setup = meta; out.meta_ads.setup = meta;
    out.youtube.setup = yt; out.tiktok.setup = tt; out.asc.setup = asc;
    const igAlt = { ...guide("meta", [["IG_APP_ID", "Instagram app ID"], ["IG_APP_SECRET", "Instagram app secret", true]], 5, [{ ...cb("instagram"), label: "OAuth redirect URI" }]),
      title: "Instagram only (no Facebook Page needed)",
      steps: [
        "Instagram must be a professional account (Business or Creator).",
        "In the same Meta app, add the product Instagram and open API setup with Instagram login.",
        "Business login settings: paste the redirect URI below into OAuth redirect URIs and Save.",
        `App roles, Roles, Instagram Testers: add the ${brand} Instagram account, then accept the invite on instagram.com (Settings, Apps and websites, Tester invites).`,
        "Copy the Instagram app ID and Instagram app secret into the boxes here and Save.",
        "Press Connect with Instagram.",
      ] };
    igAlt.ready = igAlt.fields.every((f) => f.optional || f.source);
    out.instagram.setupAlt = igAlt;
    return out;
  }
  if (path === "preflight") {
    const post = posts.find((p) => p.id === body.post_id);
    if (!post) throw new Error("post not found");
    const result = mockPreflight(post);
    const ct = post.campaign_ct ?? `${post.reel_id}-${SHORT[post.platform]}${post.post_type[0]}-260930-${Math.random().toString(36).slice(2, 5)}`;
    if (!post.campaign_ct) campaign_links.push({ ct, post_id: post.id, url: null, created_at: iso(Date.now()) });
    patchPost(post.id, { preflight: result, campaign_ct: ct });
    return result;
  }
  if (path === "import") {
    if (!wsRow().media_manifest_url) {
      throw Object.assign(new Error(`${brand} has no media library source yet. Plan videos on the content calendar for now; the owner can add a library source later.`), { status: 409 });
    }
    return { reels: reels.filter((r) => r.workspace_id === apiWorkspace).length, assets: assets.length, notes: ["batch3/c2-with: no render yet"] };
  }
  if (path === "media-links") {
    // The real route returns short-lived signed GitHub URLs; the mock echoes,
    // or maps the fake release URLs back to local files with media=private.
    window.__mockMediaLinks = (window.__mockMediaLinks ?? 0) + 1;
    const gen = (u) => {   // generator slides: <brand>-g-<run>-<variant>-<set>-NN.jpg -> the local studio/<set>/ folder
      const m = /\/([a-z]+-g-[a-z0-9-]+-(4x5|9x16)-\d{2}\.jpg)$/.exec(u);
      return m ? `${GEN_LOCAL}${m[2]}/${m[1]}` : null;
    };
    const links = Object.fromEntries((body.urls ?? []).map((u) => [u, gen(u) ??
      (PRIVATE_MEDIA && u.startsWith(RELEASE_MEDIA) ? `${LOCAL_MEDIA}${u.slice(RELEASE_MEDIA.length)}?sig=mock` : u)]));
    return { links, expires_in_s: 300 };
  }
  if (path === "sync") return { queued: body.post_id ? 1 : posts.filter((p) => p.status === "live" && p.workspace_id === apiWorkspace).length };
  if (path.startsWith("health/")) return { results: conns.filter((c) => c.workspace_id === apiWorkspace && c.platform === path.split("/")[1]).map((c) => ({ id: c.id, status: c.status, last_error: c.last_error })) };
  if (path.startsWith("oauth/")) return { url: `#/w/${apiWorkspace}/connections?ok=Mock%20OAuth%20return:%20connected` };
  if (path.startsWith("connect/")) return { ok: true, message: "Connected from secrets (mock)" };
  if (path === "action/tiktok/creator_info") {
    if (!TT) return { direct_post: false, audited: false, can_post: false, message: "TikTok direct posting is off (TIKTOK_DIRECT_POST). Posts go to the TikTok inbox." };
    const all = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"];
    return { direct_post: true, audited: TT === "audited", can_post: true, creator_nickname: wsRow().name, creator_username: `${wsRow().id}.app`,
      creator_avatar_url: null, privacy_level_options: TT === "audited" ? all : ["SELF_ONLY"], comment_disabled: false, duet_disabled: false,
      stitch_disabled: true, max_video_post_duration_sec: 600 };
  }
  if (path === "action/instagram/attach_manual" || path === "action/tiktok/attach_video" || path === "action/facebook/attach_manual") {
    patchPost(body.post_id, { status: "live", platform_url: body.url, platform_media_id: "attached", published_at: iso(Date.now()) });
    return { ok: true };
  }
  if (path === "action/asc/set_provider_token") {
    const s = settings.find((x) => x.key === "app_store" && x.workspace_id === apiWorkspace);
    const old = structuredClone(s);
    s.value = { ...s.value, provider_token: body.pt };
    emit("settings", "UPDATE", structuredClone(s), old);
    return { ok: true, filled: campaign_links.length };
  }
  return { ok: true };
}

export const supa = {
  from: (t) => new Query(t),
  async rpc(name, args) {
    await sleep(200);
    if (name === "claim_membership") return { data: ROLE, error: null };
    if (name === "claim_memberships") return { data: myWorkspaces.map((w) => ({ workspace_id: w, role: ROLE })), error: null };
    if (name === "seed_workspace_settings") {
      if (ROLE !== "owner") return { data: null, error: { message: "not allowed" } };
      const ws = workspaces.find((w) => w.id === args.p_workspace);
      const defaults = [
        ["targets", { hook_rate: 0.3, hold_rate: 0.4, cpi: null, d7_retention: null }, "Starting targets; adjust in Settings"],
        ["ads_spend_cap", { total_usd: 0, daily_usd: null }, "No ad spend until an owner sets a cap"],
        ["cadence", { organic_per_week_min: 3, organic_per_week_max: 4 }, "Starting cadence"],
        ["app_store", { app_id: ws.ios_app_id, provider_token: null, live: !!ws.copy.app_live }, "provider_token (pt) comes from the first campaign link in App Store Connect"],
      ];
      let n = 0;
      for (const [key, value, note] of defaults) {
        if (settings.some((x) => x.workspace_id === ws.id && x.key === key)) continue;
        const row = { workspace_id: ws.id, key, value, note, updated_at: iso(Date.now()) };
        settings.push(row);
        emit("settings", "INSERT", structuredClone(row));
        n++;
      }
      return { data: n, error: null };
    }
    if (name === "confirm_posts") {
      if (ROLE === "viewer") return { data: null, error: { message: "not allowed" } };
      for (const id of args.p_ids) {
        const p = posts.find((x) => x.id === id);
        if (!p || p.status !== "draft") return { data: null, error: { message: `post ${id} is ${p?.status}, only drafts can be confirmed` } };
        if (!p.preflight?.ok) return { data: null, error: { message: `post ${id} has not passed preflight` } };
      }
      for (const id of args.p_ids) {
        const p = posts.find((x) => x.id === id);
        patchPost(id, { status: p.method === "manual" ? "awaiting_manual" : "scheduled", confirmed_by: UID, confirmed_at: iso(Date.now()) });
        if (p.method !== "manual") {
          const j = { id: jobs.length + 100, workspace_id: p.workspace_id, kind: "publish", platform: p.platform, post_id: id, status: "pending", attempts: 0, max_attempts: 3, run_at: p.scheduled_at ?? iso(Date.now()), last_error: null, created_at: iso(Date.now()), updated_at: iso(Date.now()), payload: {} };
          jobs.push(j);
          emit("jobs", "INSERT", j);
        }
      }
      return { data: [], error: null };
    }
    return { data: null, error: { message: `no rpc ${name}` } };
  },
  channel() {
    const ch = { handlers: [], on(_ev, filter, fn) { this.handlers.push([filter.table, fn, filter.filter]); return this; }, subscribe(cb) { setTimeout(() => cb("SUBSCRIBED"), 50); return this; } };
    channels.push(ch);
    return ch;
  },
  removeChannel(ch) { channels.splice(channels.indexOf(ch), 1); },
  auth: {
    onAuthStateChange(cb) { setTimeout(() => cb("SIGNED_IN", { user: { id: UID, email: EMAIL }, access_token: "mock" }), 0); return { data: { subscription: { unsubscribe() {} } } }; },
    async getSession() { return { data: { session: { user: { id: UID, email: EMAIL }, access_token: "mock" } } }; },
    async signOut() { location.reload(); },
    async signInWithOtp() { return { error: null }; },
  },
};
