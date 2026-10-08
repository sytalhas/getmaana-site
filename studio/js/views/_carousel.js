// Drafts sent from content-creator ("Send to Studio": post generator carousels, and own content: a carousel, one photo
// or a reel video). For a carousel: the slides, the sound (the chosen
// one, why, its licence, the brand policy check, the step to do in the app, the alternatives), the gate report,
// credits and the upload-quality readback. Shown inside a post's Details. Editing the sound changes the draft's
// options, which clears its pre-flight (guard_posts), so it is checked again before anyone can Launch it.
// One-click is the default (owner 2026-10-07): Instagram and Facebook carousels start with No added sound and publish
// by API; a recommended sound is an optional "add it by hand" choice that switches that post to the manual checklist.

import { supa } from "../supa.js";
import { store } from "../store.js";
import { h, toast, pill, fmt, PLATFORM_NAMES } from "../ui.js";
import { mediaSrc, mediaLink } from "../media.js";
import { soundName, soundReason, soundLine, plainText } from "../sound_words.js";
import { isUnchecked, reminders, REMINDER_INTRO } from "../upload_rules.js";

/** A post uploaded in Studio: the brand reviewers did not read it, so the reminder of what to check (never a block). */
export function uncheckedBlock(reel) {
  if (!isUnchecked(reel)) return null;
  return h("details.card.notice.unchecked", { open: true },
    h("summary", { style: { cursor: "pointer", fontWeight: "800" } }, "Uploaded in Studio: check it yourself before you launch"),
    h("p.small", REMINDER_INTRO),
    h("ul.small", reminders(store.wsId).map((r) => h("li", r))));
}

/** Settings a person checks before posting by hand, so the app does not compress the upload (LRN-46). */
export const MANUAL_QUALITY = {
  instagram: "In Instagram: Settings and activity > Media quality > turn on Upload at highest quality, and turn off Use less mobile data (Data saver). Post on Wi-Fi.",
  tiktok: "In TikTok: Settings and privacy > Data Saver off; on the post screen, More options > Allow high-quality uploads on. Post on Wi-Fi.",
  facebook: "In Facebook: Settings > Media > Upload quality: Best quality (or HD), and Data Saver off.",
  youtube: "In YouTube: Settings > Video quality preferences / Uploads: Best quality, on Wi-Fi.",
};

export function isCarousel(p) {
  return p?.format === "carousel";
}

/** The method a carousel draft takes for a sound: Instagram and Facebook publish by API only with no added sound. */
export function methodForSound(p, kind) {
  if (p.platform === "instagram" || p.platform === "facebook") return kind === "none" ? "api" : "manual";
  return p.method;
}

export function slidesOf(p) {
  const a = p?.asset_id ? store.assets.get(p.asset_id) : null;
  return Array.isArray(a?.items) ? a.items : [];
}

function slideStrip(p) {
  const items = slidesOf(p);
  if (!items.length) return h("p.muted", "No slides attached.");
  const alts = p.options?.alt_text ?? [];
  return h("div.slide-strip", items.map((it, i) => {
    const img = h("img", { alt: alts[i] || it.alt || `Slide ${i + 1}`, loading: "lazy", width: 108, height: Math.round(108 * it.height / it.width) });
    mediaSrc(img, it.url);
    return h("figure.slide",
      img,
      h("figcaption.small.muted", `${i + 1} · ${it.width}x${it.height}`),
      h("div.small", mediaLink(h("a", { download: it.name ?? `slide-${i + 1}.jpg`, target: "_blank", rel: "noopener" }, "Download"), it.url)));
  }));
}

// ---------------------------------------------------------------------------
// Sound: plain summary first, choices and details collapsed (content-creator LRN-47; owner 2026-10-07: "so busy and
// hard to follow"). No scores, rule ids, policy names or internal kinds on screen.
// ---------------------------------------------------------------------------

function audioBlock(p, canEdit) {
  const a = p.options?.audio ?? {};
  const c = a.choice ?? { label: "No added sound", kind: "none" };
  const rec = a.recommendation ?? {};
  const check = a.policy_check ?? {};
  const isNone = (c.kind ?? "none") === "none";
  const alts = [rec.primary, ...(rec.alternatives ?? [])]
    .filter((x) => x && x.id !== c.id && (x.kind ?? "none") !== "none").slice(0, 3);

  const NONE = { id: "none", label: "No added sound", kind: "none", licence: "none", delivery: "none" };
  const byHand = p.platform === "instagram" || p.platform === "facebook";

  async function use(alt) {
    const choice = { id: alt.id, label: alt.label, kind: alt.kind, licence: alt.licence, delivery: alt.delivery,
      contains_instruments: alt.kind === "nasheed_vocal_only" ? null : false };
    const method = methodForSound(p, alt.kind);
    const opts = { ...(p.options ?? {}), audio: { ...a, choice, manual_step: alt.manual_step ?? null, policy_check: { ok: null, errors: [], warnings: ["changed in Studio: run pre-flight"] } } };
    const { error } = await supa.from("posts").update({ options: opts, method }).eq("id", p.id);
    toast(error ? `Could not change the sound: ${error.message}`
      : alt.kind === "none" ? "No sound: this post goes out automatically again. Check it before launching."
        : `Sound set to ${soundName(alt)}. ${byHand ? "You now post this one in the app, from its checklist." : "Check it again before launching."}`, error ? "bad" : "good");
  }

  const editable = store.canEdit() && canEdit && p.status === "draft";
  const more = (x) => {
    const lines = [x.licence_status ? `Licence: ${plainText(x.licence_status)}.` : null,
      ...(x.needs ?? []).map((n) => `Before using it: ${plainText(n)}.`)].filter(Boolean);
    return lines.length ? h("details.small", h("summary.muted", "More details"), h("ul.why", lines.map((l) => h("li.small", l)))) : null;
  };
  const about = [rec.trend_source?.refreshed ? `Trend list from ${rec.trend_source.source ?? "the platform"}, ${rec.trend_source.refreshed}.` : null,
    rec.filtered?.length ? `Not offered because they are not cleared for this brand: ${rec.filtered.map((x) => x.label).slice(0, 5).join(", ")}.` : null].filter(Boolean);

  return h("div.card.audio-card",
    h("div.row", h("strong", "Sound"), check.ok === false ? pill("needs a fix", "bad") : null),
    h("p", h("b", soundName(c)), h("span.muted", ` · ${soundLine(p.platform, c.kind, p.method)}`)),
    check.errors?.length ? h("ul.preflight-list.errors", check.errors.map((e) => h("li", plainText(e)))) : null,
    !isNone && a.manual_step ? h("details", h("summary", "How to add it in the app"), h("p.small", plainText(a.manual_step))) : null,
    !isNone && byHand && editable ? h("div.row", h("button.btn.small", { onclick: () => use(NONE) }, "Use no sound (posts automatically)")) : null,
    alts.length ? h("details",
      h("summary", isNone ? "Add a sound (optional)" : "Choose another sound"),
      byHand && isNone ? h("p.small.muted", "With a sound, this post cannot go out automatically: you post it in the app from a checklist.") : null,
      h("ul.alts", alts.map((x) => h("li",
        h("div.row", h("div", h("b", soundName(x)), h("div.small.muted", soundReason(x, p.platform))),
          editable ? h("button.btn.small.ghost", { onclick: () => use(x) }, "Use this") : null),
        more(x)))),
      about.length ? h("p.small.muted", about.join(" ")) : null) : null);
}

function gateBlock(reel) {
  const g = reel?.package?.gate_report;
  if (!g) return null;
  return h("details.card",
    h("summary", { style: { cursor: "pointer", fontWeight: "800" } },
      "Checks before sending ", g.all_passed ? pill("all passed", "good") : pill("not all passed", "bad")),
    h("ul.gates", (g.gates ?? []).map((x) => h("li",
      h("div.row", x.pass ? pill("PASS", "good") : pill("FAIL", "bad"), h("b", x.label ?? x.gate)),
      x.blocking?.length ? h("ul", x.blocking.map((b) => h("li.small", b))) : null,
      x.needs_reviewer?.length ? h("div.small", "For the human reviewer: ", x.needs_reviewer.map((r) => r.what ?? r.quote ?? JSON.stringify(r)).join("; ")) : null,
      x.advisory?.length ? h("div.small.muted", "Advice: ", x.advisory.map((r) => r.why).join(" ")) : null))),
    g.design_tips?.length ? h("p.small.muted", `Design tips (advice): ${g.design_tips.join(", ")}`) : null,
    reel.package.credits?.length ? h("p.small.muted", `Credits: ${reel.package.credits.map((c) => c.title ?? c.id).join("; ")}`) : null,
    reel.package.skipped?.length ? h("p.small.muted", reel.package.skipped.map((s) => `${s.platform}: ${s.why}`).join(" ")) : null,
    sourceLine(reel.package));
}

/** Where a package came from, in plain words. */
function sourceLine(pk) {
  const s = pk?.source;
  if (!s) return null;
  if (s.tool === "studio upload") {
    return h("p.small.muted", "Uploaded in Studio. The caption was written by hand; the brand reviewers did not read it.");
  }
  if (s.item) {
    const m = pk.metadata ?? {};
    const how = m.source === "auto" ? "Caption, hashtags and alt text written by Claude Code in the brand's voice" : "Caption and hashtags written by hand";
    return h("p.small.muted", `Your own content from content-creator (${s.item}). ${how}, then checked by the brand's gates.`);
  }
  return h("p.small.muted", `From the post generator: run ${s.run}, ${s.variant}.`);
}

/** A video draft sent from content-creator (own content): the sound in the file, the checks, the quality readback. */
export function packagePanel(p) {
  const reel = store.reels.get(p.reel_id);
  const c = p.options?.audio?.choice;
  return h("div.stack.carousel-panel",
    h("p.small", h("b", "Sound: "), !c || c.kind === "none" ? "none in the video." : `${c.label ?? fmt.label(c.kind)}, in the video file (nothing is added in the app).`),
    uncheckedBlock(reel),
    gateBlock(reel),
    qualityBlock(p));
}

function qualityBlock(p) {
  const q = p.options?.quality_readback;
  if (!q) return null;
  if (!q.received) return h("p.small.muted", `Upload quality: ${q.note ?? q.error ?? "not read yet"}.`);
  return h("p.small", q.ok ? pill("quality kept", "good") : pill("quality dropped", "warn"),
    ` ${PLATFORM_NAMES[p.platform]} serves ${q.received.width}x${q.received.height}; Studio sent ${q.sent.width}x${q.sent.height} (${q.source}).`);
}

/** The carousel section of a post's Details. */
export function carouselPanel(p) {
  const reel = store.reels.get(p.reel_id);
  return h("div.stack.carousel-panel",
    h("h3", `Slides (${slidesOf(p).length})`), slideStrip(p),
    audioBlock(p, store.canEdit()),
    uncheckedBlock(reel),
    gateBlock(reel),
    qualityBlock(p));
}

/** Manual steps for a carousel posted by hand (Instagram with a sound) or finished in the TikTok inbox. */
export function carouselSteps(p, copyCaption) {
  const a = p.options?.audio ?? {};
  const sound = a.choice && a.choice.kind !== "none"
    ? (a.manual_step ?? `Add the sound "${a.choice.label}".`)
    : "No added sound for this post.";
  const items = slidesOf(p);
  if (p.platform === "tiktok" && p.method === "manual") {
    return [
      ["quality", MANUAL_QUALITY.tiktok],
      ["download", h("span", `Download the ${items.length} slides (9:16 JPEGs) to the phone: `,
        ...items.map((it, i) => h("span", i ? " · " : "", mediaLink(h("a", { download: it.name, target: "_blank", rel: "noopener" }, String(i + 1)), it.url))))],
      ["create", "In TikTok, tap +, then Upload, switch to Photo, and select the slides in order (1 first)."],
      ["sound", sound],
      ["caption", h("span", "Paste the caption. ", copyCaption)],
      ["post", "Tap Post."],
    ];
  }
  if (p.platform === "tiktok") {
    return [
      ["quality", MANUAL_QUALITY.tiktok],
      ["inbox", "Open TikTok and tap the inbox notification: the photos are waiting as a draft."],
      ["sound", sound],
      ["caption", h("span", "Paste the caption. ", copyCaption)],
      ["post", "Tap Post."],
    ];
  }
  return [
    ["quality", MANUAL_QUALITY[p.platform] ?? MANUAL_QUALITY.instagram],
    ["download", h("span", `Download the ${items.length} slides (upload-ready JPEGs) to the phone: `,
      ...items.map((it, i) => h("span", i ? " · " : "", mediaLink(h("a", { download: it.name, target: "_blank", rel: "noopener" }, String(i + 1)), it.url))))],
    ["create", p.platform === "facebook"
      ? "In the Facebook app, switch to the Page, tap Photo, and select the slides in order (1 first)."
      : "In Instagram, tap +, then Post, and select the slides in order (1 first)."],
    ["sound", sound],
    ["alt", p.platform === "facebook"
      ? "Tap each photo > Alt text: paste each slide's alt text from Details."
      : "Advanced settings > Write alt text: paste each slide's alt text from Details."],
    ["caption", h("span", "Paste the caption. ", copyCaption)],
    ["post", "Share. Organic only: never boost a post with a platform sound."],
  ];
}
