// Add your own (owner 2026-10-08, content-creator LRN-52): a member uploads a reel, one photo or a carousel they made,
// writes the caption by hand, and Studio makes one draft per platform. From there it is a normal reel: Launch,
// schedule, levers, experiments and the numbers. No AI captioning and no AI brand reviewers on this path: a reminder
// of what to check sits next to the button (it never blocks). Studio's own pre-flight still runs on every draft.
// Images are sized here like content-creator does (JPEG at each platform's size, framed in the edge colour, never
// cropped); a video goes as it is (MP4, up to 95 MB). Files go to the brand's own GitHub release through studio-api.

import { api, uploadFile } from "../supa.js";
import { store, href } from "../store.js";
import { h, clear, toast, field, empty } from "../ui.js";
import {
  classify, chooseSets, fitRect, buildPackage, problems, newUploadId, reminders, REMINDER_INTRO, STUDIO_STILL_CHECKS,
  SIZES, IMAGE_PLATFORMS, VIDEO_PLATFORMS, SOUND_KINDS, SOUND_LICENCES, NAMES,
} from "../upload_rules.js";

export function render(root) {
  const ws = store.wsId;
  const brand = store.brand();
  if (!store.canEdit()) return void clear(root, empty("Only editors and owners can add posts."));
  if (!store.workspace?.media_release) {
    return void clear(root, h("div.view-head", h("div", h("h1", "Add your own"))),
      h("div.notice", `${brand} has nowhere to store media yet, so nothing can be uploaded. The owner sets up its media release first.`));
  }
  const allowedSounds = store.workspace?.preflight?.audio_policy?.allowed ?? ["none"];
  const S = { kind: null, files: [], bitmaps: [], urls: [], video: null, sets: null, busy: false };
  const form = { title: "", platforms: [], caption: "", hashtags: "", per: {}, youtubeTitle: "", alts: [], sound: { kind: null, licence: "own", listened: false } };

  // ---- step 1: the files ---------------------------------------------------------------------------------------
  const input = h("input", { type: "file", multiple: true, accept: "image/jpeg,image/png,image/webp,video/mp4", class: "visually-hidden",
    onchange: () => pick(input.files) });
  const drop = h("label.upload-drop", input,
    h("b", "Choose files, or drop them here"),
    h("span.small.muted", "One video (MP4, up to 95 MB), or 1 to 10 images in order: one photo or a carousel."),
    h("span.small.muted", "Each file must upload within about 2 minutes, so on a slow connection keep reels smaller (Studio tells you if one is too big)."));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); pick(e.dataTransfer.files); });
  const preview = h("div.stack");
  const filesCard = h("section.card.stack", h("h3", "1. The post"), drop, preview);

  // ---- step 2: where and what it says ------------------------------------------------------------------------
  const details = h("div.stack");
  const detailsCard = h("section.card.stack", { hidden: true }, h("h3", "2. Caption and where it goes"), details);

  // ---- the reminder (never blocks) ---------------------------------------------------------------------------
  const reminderCard = h("aside.card.stack.upload-reminder", { "aria-label": "What to check yourself" },
    h("h3", "Before you launch"),
    h("p.small", REMINDER_INTRO),
    h("ul.small", reminders(ws).map((r) => h("li", r))),
    h("p.small.muted", STUDIO_STILL_CHECKS));

  // ---- create ----------------------------------------------------------------------------------------------
  const errBox = h("div");
  const progress = h("div.upload-progress", { hidden: true }, h("div.bar-track", h("div.bar-fill")), h("p.small.muted"));
  const go = h("button.btn.primary", { onclick: create, disabled: true }, "Create drafts");
  const foot = h("section.card.stack", { hidden: true }, errBox, progress,
    h("div.row.between", h("span.small.muted", "Nothing is posted: the drafts wait in Posts until you launch them."), go));
  const done = h("div");

  clear(root,
    h("div.view-head", h("div", h("h1", "Add your own"),
      h("p", `A reel, one photo or a carousel you made for ${brand}. You write the caption; Studio publishes it and tracks the numbers like any other post.`)),
      h("a.btn.ghost", { href: href("library") }, "Back to Library")),
    done,
    h("div.upload-grid", h("div.stack", filesCard, detailsCard, foot), reminderCard));

  const leave = (e) => { if (S.busy) { e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", leave);

  async function pick(list) {
    if (S.busy) return;
    const c = classify(list);
    S.urls.forEach((u) => URL.revokeObjectURL(u));
    Object.assign(S, { kind: null, files: [], bitmaps: [], urls: [], video: null, sets: null });
    if (c.error) {
      clear(preview, h("div.notice.bad", c.error));
      detailsCard.hidden = foot.hidden = true;
      return;
    }
    S.kind = c.kind;
    S.files = c.files;
    S.urls = S.files.map((f) => URL.createObjectURL(f));
    if (!form.title) form.title = S.files[0].name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 120);
    form.platforms = [...(S.kind === "video" ? VIDEO_PLATFORMS : IMAGE_PLATFORMS)];
    form.alts = S.files.map((_, i) => form.alts[i] ?? "");
    try {
      if (S.kind === "video") S.video = await videoInfo(S.urls[0]);
      else {
        S.bitmaps = await Promise.all(S.files.map((f) => createImageBitmap(f)));
        S.sets = chooseSets(S.bitmaps.map((b) => b.width / b.height));
      }
    } catch (e) {
      clear(preview, h("div.notice.bad", `That file could not be read: ${e.message}`));
      return;
    }
    drawPreview();
    drawDetails();
    detailsCard.hidden = foot.hidden = false;
    go.disabled = false;
  }

  function drawPreview() {
    if (S.kind === "video") {
      const v = S.video;
      const tall = Math.abs(v.width / v.height - 9 / 16) < 0.01;
      clear(preview,
        h("video.upload-video", { src: S.urls[0], controls: true, playsInline: true, preload: "metadata" }),
        h("p.small.muted", `${v.width}x${v.height}, ${v.duration.toFixed(1)} s, ${(S.files[0].size / 1024 / 1024).toFixed(1)} MB.`,
          tall ? "" : " Not 9:16: the apps show it with bands. Export it at 1080x1920 for the best result."),
        v.duration < 3 ? h("div.notice", "Instagram and Facebook need at least 3 seconds.") : null);
      return;
    }
    const sizes = [...new Set([S.sets.feed, S.sets.tall])];
    const padded = S.bitmaps.some((b) => sizes.some((k) => fitRect(b.width, b.height, ...SIZES[k]).padded));
    clear(preview,
      h("div.slide-strip", S.urls.map((u, i) => h("figure.slide", h("img", { src: u, alt: `Image ${i + 1}` }), h("figcaption.small.muted", String(i + 1))))),
      h("p.small.muted", `${S.kind === "photo" ? "One photo" : `${S.files.length} slides, in this order`}. Instagram and Facebook get ${SIZES[S.sets.feed].join("x")}`,
        S.sets.tall !== S.sets.feed ? `, TikTok ${SIZES[S.sets.tall].join("x")}` : ", TikTok the same",
        padded ? ". Where the shape differs the image is framed in its edge colour; nothing is cropped." : "."));
  }

  function drawDetails() {
    const plats = S.kind === "video" ? VIDEO_PLATFORMS : IMAGE_PLATFORMS;
    const title = h("input", { type: "text", maxLength: 120, value: form.title, oninput: (e) => { form.title = e.target.value; } });
    const checks = h("div.row.upload-plats", plats.map((p) => h("label.check",
      h("input", { type: "checkbox", checked: form.platforms.includes(p),
        onchange: (e) => { form.platforms = plats.filter((x) => (x === p ? e.target.checked : form.platforms.includes(x))); drawYt(); } }),
      ` ${NAMES[p]}`)));
    const caption = h("textarea", { rows: 7, value: form.caption, placeholder: "The first line is what most people read. Make it speak to them.",
      oninput: (e) => { form.caption = e.target.value; count(); } });
    const counter = h("span.hint");
    const count = () => { counter.textContent = `${form.caption.length} characters (2,200 at most). No long dashes.`; };
    count();
    const tags = h("input", { type: "text", value: form.hashtags, placeholder: "#muslimcouples #marriage", oninput: (e) => { form.hashtags = e.target.value; } });
    const per = h("details.upload-more", h("summary", "A different caption for one platform (optional)"),
      plats.map((p) => field(NAMES[p], h("textarea", { rows: 3, value: form.per[p] ?? "", placeholder: "Leave empty to use the main caption",
        oninput: (e) => { if (e.target.value.trim()) form.per[p] = e.target.value; else delete form.per[p]; } }))));
    const ytBox = h("div");
    const drawYt = () => clear(ytBox, S.kind === "video" && form.platforms.includes("youtube")
      ? field("YouTube title", h("input", { type: "text", maxLength: 100, value: form.youtubeTitle, placeholder: form.title,
          oninput: (e) => { form.youtubeTitle = e.target.value; } }), "Up to 100 characters (about 70 reads best). Empty: the title above.")
      : null);
    drawYt();
    const alts = S.kind === "video" ? null : h("details.upload-more", h("summary", "Alt text: what a screen reader says for each image (optional)"),
      S.files.map((_, i) => field(`Image ${i + 1}`, h("textarea", { rows: 2, maxLength: 1000, value: form.alts[i],
        oninput: (e) => { form.alts[i] = e.target.value; } }))));
    clear(details,
      field("Title", title, "Shown in Studio's Library and Posts."),
      h("div.field", h("span.field-label", "Where it goes"), checks,
        S.kind === "video" ? null : h("span.hint", "YouTube is left out: it cannot take photo posts.")),
      field("Caption", caption, counter),
      field("Hashtags", tags, "Separate them with spaces."),
      ytBox, per, alts,
      S.kind === "video" ? soundBlock() : null);
  }

  function soundBlock() {
    const kinds = SOUND_KINDS.filter(([k]) => allowedSounds.includes(k));
    const extra = h("div.stack");
    const drawExtra = () => clear(extra, form.sound.kind === "nasheed_vocal_only" ? [
      field("Where it is from", h("select", { onchange: (e) => { form.sound.licence = e.target.value; } },
        SOUND_LICENCES.map(([v, t]) => h("option", { value: v, selected: form.sound.licence === v }, t)))),
      h("label.check", h("input", { type: "checkbox", checked: form.sound.listened, onchange: (e) => { form.sound.listened = e.target.checked; } }),
        " I listened to all of it: voices only, no instruments or drums"),
    ] : null);
    drawExtra();
    return h("div.field", h("span.field-label", "Sound in the video"),
      h("div.stack.upload-sound", kinds.map(([k, label]) => h("label.check",
        h("input", { type: "radio", name: "upl-sound", value: k, checked: form.sound.kind === k,
          onchange: () => { form.sound.kind = k; drawExtra(); } }), ` ${label}`))),
      extra,
      h("span.hint", `Studio checks it against ${brand}'s sound rules.${allowedSounds.includes("recitation") ? " A recitation cannot be added here: it goes through the library import." : ""}`));
  }

  // ---- create the drafts -----------------------------------------------------------------------------------
  async function create() {
    const errs = problems(form, S.kind, allowedSounds);
    if (errs.length) {
      clear(errBox, h("div.notice.bad", h("b", "Before Studio can make the drafts:"), h("ul", errs.map((e) => h("li", e)))));
      errBox.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    clear(errBox);
    S.busy = true;
    go.disabled = true;
    go.textContent = "Working";
    detailsCard.querySelectorAll("input, textarea, select").forEach((x) => { x.disabled = true; });
    input.disabled = true;
    progress.hidden = false;
    const bar = progress.querySelector(".bar-fill");
    const say = (t, f) => { progress.querySelector("p").textContent = t; if (f != null) bar.style.width = `${Math.round(f * 100)}%`; };
    const uploadId = newUploadId(form.title);
    try {
      const jobs = [];   // [slot, blob]
      say("Preparing the files", 0);
      if (S.kind === "video") {
        jobs.push(["video", S.files[0]]);
        const poster = await posterOf(S.urls[0], S.video).catch(() => null);
        if (poster) jobs.push(["poster", poster]);
      } else {
        for (const key of [...new Set([S.sets.feed, S.sets.tall])].filter((k) => form.platforms.some((p) => (p === "tiktok" ? S.sets.tall : S.sets.feed) === k))) {
          for (const [i, b] of S.bitmaps.entries()) jobs.push([`${key}-${String(i + 1).padStart(2, "0")}`, await sized(S.files[i], b, key)]);
        }
      }
      const total = jobs.reduce((n, [, b]) => n + b.size, 0);
      let sent = 0;
      const files = S.kind === "video" ? {} : { sets: {} };
      for (const [i, [slot, blob]] of jobs.entries()) {
        say(`Uploading ${jobs.length > 1 ? `${i + 1} of ${jobs.length}` : "the file"} to ${brand}'s media store`);
        const r = await uploadFile({ upload: uploadId, slot }, blob, (f) => { bar.style.width = `${Math.round(((sent + f * blob.size) / total) * 95)}%`; });
        sent += blob.size;
        if (slot === "video") files.video = { url: r.url, width: S.video.width, height: S.video.height, duration_s: Number(S.video.duration.toFixed(2)), bytes: r.bytes, sha256: r.sha256 };
        else if (slot === "poster") files.poster = { url: r.url };
        else {
          const key = slot.split("-")[0];
          (files.sets[key] ??= []).push({ url: r.url, width: SIZES[key][0], height: SIZES[key][1], bytes: r.bytes, sha256: r.sha256 });
        }
      }
      say("Creating the drafts", 0.97);
      const pkg = buildPackage({ ws, uploadId, kind: S.kind, form, files, setKeys: S.sets });
      const out = await api("drafts", { package: pkg });
      say("Done", 1);
      S.busy = false;
      finished(out);
    } catch (e) {
      S.busy = false;
      go.disabled = false;
      go.textContent = "Try again";
      input.disabled = false;
      detailsCard.querySelectorAll("input, textarea, select").forEach((x) => { x.disabled = false; });
      progress.hidden = true;
      clear(errBox, h("div.notice.bad", h("b", "Not created: "), e.message));
    }
  }

  function finished(out) {
    const blocked = (out.posts ?? []).filter((p) => p.preflight && !p.preflight.ok);
    window.removeEventListener("beforeunload", leave);
    clear(done, h("section.card.stack.upload-done",
      h("h2", `${out.posts?.length ?? 0} draft${out.posts?.length === 1 ? " is" : "s are"} ready in Posts`),
      h("p", "Open Posts and press Check and launch all under Ready to launch. A reel can also be launched from Launch (a trial reel, a schedule)."),
      blocked.length ? h("div.notice", h("b", "Pre-flight found something to fix: "),
        h("ul", blocked.map((p) => h("li", `${NAMES[p.platform] ?? p.platform}: ${p.preflight.errors[0]}`)))) : null,
      h("div.notice.info", h("b", "Before you launch: "), "the brand reviewers did not read this post. Go through the reminders once more."),
      h("div.row", h("a.btn.primary", { href: href("posts") }, "Open Posts"),
        h("a.btn.ghost", { href: href("library") }, "Library"),
        h("button.btn.ghost", { onclick: () => render(root) }, "Add another"))));
    root.querySelector(".upload-grid").hidden = true;
    toast("Drafts created", "good");
  }

  return () => { window.removeEventListener("beforeunload", leave); S.urls.forEach((u) => URL.revokeObjectURL(u)); };
}

// ---- media helpers (browser only) ------------------------------------------------------------------------------

function videoInfo(url) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => resolve({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
    v.onerror = () => reject(new Error("this browser cannot read the video (is it H.264 MP4?)"));
    v.src = url;
  });
}

/** A JPEG still from the video (Studio's Library poster). */
function posterOf(url, info) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.onloadeddata = () => { v.currentTime = Math.min(1, info.duration / 2); };
    v.onseeked = () => {
      const w = Math.min(1080, info.width), hgt = Math.round((w * info.height) / info.width);
      const c = Object.assign(document.createElement("canvas"), { width: w, height: hgt });
      c.getContext("2d").drawImage(v, 0, 0, w, hgt);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("no poster"))), "image/jpeg", 0.9);
    };
    v.onerror = () => reject(new Error("no poster"));
    v.src = url;
  });
}

/** The image as a JPEG at the size `key`: the file itself when it already is one, else drawn, framed in its edge
 *  colour, never cropped. */
async function sized(file, bmp, key) {
  const [tw, th] = SIZES[key];
  if (file.type === "image/jpeg" && bmp.width === tw && bmp.height === th) return file;
  const c = Object.assign(document.createElement("canvas"), { width: tw, height: th });
  const g = c.getContext("2d");
  g.fillStyle = edgeColour(bmp);
  g.fillRect(0, 0, tw, th);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  const r = fitRect(bmp.width, bmp.height, tw, th);
  g.drawImage(bmp, r.x, r.y, r.w, r.h);
  return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("could not draw the image"))), "image/jpeg", 0.95));
}

function edgeColour(bmp) {
  const w = 32, hh = Math.max(1, Math.round((32 * bmp.height) / bmp.width));
  const c = Object.assign(document.createElement("canvas"), { width: w, height: hh });
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, w, hh);
  const d = g.getImageData(0, 0, w, hh).data;
  let r = 0, gg = 0, b = 0, n = 0;
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    if (x && y && x < w - 1 && y < hh - 1) continue;
    const i = (y * w + x) * 4;
    r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++;
  }
  return `rgb(${Math.round(r / n)}, ${Math.round(gg / n)}, ${Math.round(b / n)})`;
}
