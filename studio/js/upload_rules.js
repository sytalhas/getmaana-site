// Studio uploads (owner 2026-10-08, content-creator LRN-52): a member adds their own reel, photo or carousel in
// Studio and writes the caption by hand. No AI captioning and no AI brand reviewers on this path; the owner chose a
// reminder instead of a blocker. Studio's own pre-flight still runs on every draft (long dashes, the brand's banned
// phrases, the sound rules, platform limits).
// Pure (no DOM, no network): views/upload.js draws the page, test/upload.test.mjs tests these rules.

/** What the uploader checks themselves, per brand (from content-creator brands/<id>/voice.md, facts.md and the source
 *  rules). Shown as a reminder on the upload page, in each draft's Details and in Check and launch all. */
export const REMINDERS = {
  mawadda: [
    "App facts: only what the app really does today. Nothing about features that are not live, no \"ad-free\", \"no tracking\" or \"exclusive content\", and no numbers or statistics.",
    "Qur'an and hadith: word for word from quran.com or sunnah.com, with the exact reference. Never from memory and never reworded. A hadith needs the grade sunnah.com shows.",
    "No rulings or fatwas (\"you must\", \"it is haram\"). Point to a scholar instead.",
    "Never assume which spouse is the husband or the wife, and remember engaged is not married.",
    "Modest pictures and words throughout.",
    "Sound: voices only. No music, instruments or drums.",
  ],
  maana: [
    "Arabic: every word, meaning, root and ayah reference exactly right (check it against the app's deck).",
    "No rulings or fatwas, and no hadith without its grading.",
    "Never \"Premium\", \"free plan\", \"trial\" or \"Free to start\", and no time promises (\"fluent in 30 days\").",
    "Write \"peace be upon him\" in full, never the symbol.",
    "Sound: no music. A voice or natural sounds only.",
  ],
};
const GENERIC = [
  "Facts about the app: only what it really does today.",
  "Religious text: word for word from a verified source, with its reference, never from memory.",
  "No rulings, nothing immodest, and the brand's sound rules.",
];
export const REMINDER_INTRO = "The brand reviewers do not read posts uploaded here. Before you launch, check these yourself:";
export const STUDIO_STILL_CHECKS = "Studio still checks long dashes, the brand's banned phrases, the sound rules and each platform's limits.";

export function reminders(ws) {
  return REMINDERS[ws] ?? GENERIC;
}

export const MAX_FILE_BYTES = 95 * 1024 * 1024;
export const MAX_SLIDES = 10;
export const SIZES = { "4x5": [1080, 1350], "1x1": [1080, 1080], "9x16": [1080, 1920] };
export const IMAGE_PLATFORMS = ["instagram", "facebook", "tiktok"];
export const VIDEO_PLATFORMS = ["instagram", "facebook", "tiktok", "youtube"];
export const SOUND_KINDS = [["none", "No sound"], ["voice", "Voice only (talking, no music)"], ["sfx", "Natural sounds only"],
  ["nasheed_vocal_only", "A nasheed with voices only"]];
export const SOUND_LICENCES = [["own", "We recorded or made it"], ["aswati", "From the Aswati library (licensed files)"]];

/** One video, or 1 to 10 images: what the picked files are, or why they cannot be used. */
export function classify(files) {
  const list = [...files];
  if (!list.length) return { error: "Choose one video, or 1 to 10 images." };
  const isVid = (f) => /^video\//.test(f.type) || /\.(mp4|mov|m4v)$/i.test(f.name);
  const isImg = (f) => /^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name);
  const vids = list.filter(isVid);
  if (vids.length && list.length > 1) return { error: "A post is one video, or images. Not both." };
  if (vids.length) {
    const v = vids[0];
    if (!/\.mp4$/i.test(v.name) && v.type !== "video/mp4") return { error: "Export the video as MP4 first (in CapCut or Photos: Export, MP4)." };
    if (v.size > MAX_FILE_BYTES) return { error: `This video is ${Math.round(v.size / 1024 / 1024)} MB. Studio takes up to 95 MB per file: export it smaller, or send it from content-creator's Own content.` };
    return { kind: "video", files: [v] };
  }
  if (list.some((f) => !isImg(f))) return { error: "Only JPEG, PNG or WebP images, or one MP4 video." };
  if (list.length > MAX_SLIDES) return { error: `A carousel takes at most ${MAX_SLIDES} images (Instagram's limit).` };
  const sorted = list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { kind: sorted.length === 1 ? "photo" : "carousel", files: sorted };
}

/** Which sizes the images go out at, from their shape (the same rule as content-creator own.py image_sets):
 *  {feed, tall}: Instagram and Facebook get `feed`, TikTok gets `tall`. */
export function chooseSets(ratios) {
  const rs = [...ratios].sort((a, b) => a - b);
  const r = rs[Math.floor(rs.length / 2)];
  if (r < 0.7) return { feed: "4x5", tall: "9x16" };   // 9:16 slides: native on TikTok, framed to 4:5 for the feeds
  if (r < 0.9) return { feed: "4x5", tall: "4x5" };
  return { feed: "1x1", tall: "1x1" };                // square, or wide framed to a square
}

/** Where an image of w x h sits inside the target (scaled to fit, centred; never cropped). */
export function fitRect(w, h, tw, th) {
  const s = Math.min(tw / w, th / h);
  const dw = Math.max(1, Math.round(w * s)), dh = Math.max(1, Math.round(h * s));
  return { x: Math.floor((tw - dw) / 2), y: Math.floor((th - dh) / 2), w: dw, h: dh, padded: Math.abs(dw - tw) > 4 || Math.abs(dh - th) > 4 };
}

export function cleanTags(text) {
  const out = [];
  for (let t of String(text ?? "").split(/[\s,]+/)) {
    t = t.replace(/^#*/, "");
    if (!t) continue;
    const tag = `#${t}`;
    if (!out.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out.slice(0, 30);
}

/** The caption a platform gets: its own text, or the main one, with the hashtags it does not already contain. */
export function captionFor(form, pl) {
  const text = (form.per?.[pl]?.trim() || form.caption || "").trim();
  const tags = cleanTags(form.hashtags).filter((t) => !text.toLowerCase().includes(t.toLowerCase()));
  return text + (tags.length ? `\n\n${tags.join(" ")}` : "");
}

/** The sound a video carries, as studio-draft/1 records it (delivery "file": it is in the video). */
export function soundChoice(sound) {
  const kind = sound?.kind ?? null;
  if (!kind || kind === "none") return { id: "none", label: "No sound", kind: "none", licence: "none", delivery: "none", contains_instruments: false };
  const label = SOUND_KINDS.find(([k]) => k === kind)?.[1] ?? kind;
  const licence = SOUND_LICENCES.some(([k]) => k === sound.licence) ? sound.licence : "own";
  const out = { id: `upload-${kind}`, label, kind, licence, delivery: "file",
    contains_instruments: kind === "voice" || kind === "sfx" || sound.listened ? false : null };
  if (kind === "nasheed_vocal_only" && sound.listened) out.listened = { no_instruments: true, at: new Date().toISOString() };
  return out;
}

/** What blocks "Create drafts" before anything is uploaded (Studio's pre-flight would refuse these anyway). */
export function problems(form, kind, allowedSounds = []) {
  const out = [];
  const plats = form.platforms ?? [];
  if (!plats.length) out.push("Tick at least one platform.");
  if (!form.title?.trim()) out.push("Give it a title.");
  for (const pl of plats) {
    const c = captionFor(form, pl);
    if (!c.trim()) out.push(`Write a caption${form.per?.[pl] !== undefined ? ` for ${NAMES[pl]}` : ""}.`);
    if (c.length > 2200) out.push(`The ${NAMES[pl]} caption is ${c.length} characters (2,200 at most).`);
  }
  const all = [form.title, form.caption, form.hashtags, form.youtubeTitle, ...Object.values(form.per ?? {}), ...(form.alts ?? [])].join(" ");
  if (/[—–]/.test(all)) out.push("Take out the long dashes (— or –): use a full stop, comma or colon.");
  if (kind === "video" && plats.includes("youtube")) {
    const t = (form.youtubeTitle || form.title || "").trim();
    if (!t) out.push("YouTube needs a title.");
    if (t.length > 100) out.push(`The YouTube title is ${t.length} characters (100 at most).`);
    if (/[<>]/.test(t + captionFor(form, "youtube"))) out.push("YouTube does not allow < or > in the title or caption.");
  }
  if (kind === "video") {
    const k = form.sound?.kind;
    if (!k) out.push("Say what sound is in the video.");
    else if (k !== "none" && !allowedSounds.includes(k)) out.push("That sound is not allowed for this brand.");
    else if (k === "nasheed_vocal_only" && !form.sound.listened) out.push("Listen to the whole nasheed, then tick that it has voices only.");
  }
  if (cleanTags(form.hashtags).length > 30) out.push("30 hashtags at most.");
  return out;
}

export const NAMES = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube Shorts" };

export function newUploadId(title, rand = Math.random) {
  const slug = String(title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "post";
  const hex = Array.from({ length: 6 }, () => Math.floor(rand() * 16).toString(16)).join("");
  return `u-${slug}-${hex}`;
}

/**
 * The studio-draft/1 package for studio-api /drafts. `files` is what /upload returned:
 *   carousel/photo: { sets: { "4x5": [{n, url, width, height, bytes, sha256}], ... } }
 *   video: { video: {url, width, height, duration_s, bytes, sha256}, poster: {url} }
 */
export function buildPackage({ ws, uploadId, kind, form, files, setKeys }) {
  const plats = form.platforms;
  const pkg = {
    schema: "studio-draft/1", brand: ws, workspace: ws, package_id: uploadId, format: kind === "video" ? "video" : "carousel",
    title: form.title.trim().slice(0, 200), created_at: new Date().toISOString(),
    source: { tool: "studio upload" },
    metadata: { source: "manual", written_by: "a person", checked: false },
    gate_report: null, credits: [], ayahs: [], skipped: kind === "video" ? [] : [{ platform: "youtube", why: "YouTube has no API for image posts." }],
    nothing_posted: "Drafts only. A person launches them in Studio.",
  };
  if (kind === "video") {
    pkg.video = { ...files.video, mime: "video/mp4", sound: soundChoice(form.sound) };
    if (files.poster) pkg.poster = { url: files.poster.url };
    pkg.posts = plats.map((pl) => ({
      platform: pl, method: pl === "tiktok" ? "inbox_draft" : "api", caption: captionFor(form, pl),
      title: pl === "youtube" ? (form.youtubeTitle || form.title).trim() : null, first_comment: null,
      cover_ms: pl === "instagram" || pl === "tiktok" ? 1000 : null,
    }));
    return pkg;
  }
  pkg.sets = Object.fromEntries(Object.entries(files.sets).map(([key, items]) => [key, {
    width: SIZES[key][0], height: SIZES[key][1], mime: "image/jpeg",
    items: items.map((it, i) => ({ ...it, n: i + 1, mime: "image/jpeg", alt: (form.alts?.[i] ?? "").slice(0, 1000) })),
  }]));
  pkg.posts = plats.map((pl) => ({
    platform: pl, set: pl === "tiktok" ? setKeys.tall : setKeys.feed, method: pl === "tiktok" ? "inbox_draft" : "api",
    caption: captionFor(form, pl), first_comment: null,
    audio: { choice: { id: "none", label: "No added sound", kind: "none", licence: "none", delivery: "none", contains_instruments: false } },
  }));
  return pkg;
}

/** True for a reel uploaded in Studio (not checked by the brand reviewers). */
export function isUnchecked(reel) {
  return !!reel?.package && reel.package.checked === false;
}
