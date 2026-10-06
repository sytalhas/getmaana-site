// Carousel drafts from the content-creator post generator ("Send to Studio"): the slides, the sound (the chosen
// one, why, its licence, the brand policy check, the step to do in the app, the alternatives), the gate report,
// credits and the upload-quality readback. Shown inside a post's Details. Editing the sound changes the draft's
// options, which clears its pre-flight (guard_posts), so it is checked again before anyone can Launch it.

import { supa } from "../supa.js";
import { store } from "../store.js";
import { h, toast, pill, fmt, PLATFORM_NAMES } from "../ui.js";
import { mediaSrc, mediaLink } from "../media.js";

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

function why(list) {
  return list?.length ? h("ul.why", list.map((w) => h("li.small", w))) : null;
}

function audioBlock(p, canEdit) {
  const a = p.options?.audio ?? {};
  const c = a.choice ?? { label: "No added sound", kind: "none" };
  const rec = a.recommendation ?? {};
  const check = a.policy_check ?? {};
  const alts = [rec.primary, ...(rec.alternatives ?? [])].filter((x) => x && x.id !== c.id);
  const status = check.ok === false ? pill("blocked by the brand policy", "bad") : pill("allowed by the brand policy", "good");

  async function use(alt) {
    const choice = { id: alt.id, label: alt.label, kind: alt.kind, licence: alt.licence, delivery: alt.delivery,
      contains_instruments: alt.kind === "nasheed_vocal_only" ? null : false };
    const method = p.platform === "instagram" ? (alt.kind === "none" ? "api" : "manual") : p.method;
    const opts = { ...(p.options ?? {}), audio: { ...a, choice, manual_step: alt.manual_step ?? null, policy_check: { ok: null, errors: [], warnings: ["changed in Studio: run pre-flight"] } } };
    const { error } = await supa.from("posts").update({ options: opts, method }).eq("id", p.id);
    toast(error ? `Could not change the sound: ${error.message}` : `Sound set to ${alt.label}. Run pre-flight again.`, error ? "bad" : "good");
  }

  return h("div.card.audio-card",
    h("div.row", h("strong", "Sound"), status),
    h("p", h("b", c.label ?? c.id), h("span.muted", ` · ${fmt.label(c.kind ?? "none")}`)),
    check.errors?.length ? h("ul.preflight-list.errors", check.errors.map((e) => h("li", e))) : null,
    a.manual_step ? h("div.notice", h("b", "Do this in the app (the API cannot add a sound): "), a.manual_step) : null,
    a.api?.note ? h("p.small.muted", a.api.note) : null,
    rec.primary && rec.primary.id === c.id ? why(rec.primary.why) : null,
    alts.length ? h("details",
      h("summary", { style: { cursor: "pointer", fontWeight: "700" } }, `Alternatives (${alts.length})`),
      h("ul.alts", alts.map((x) => h("li",
        h("div.row", h("b", x.label), h("span.small.muted", `score ${Number(x.score ?? 0).toFixed(2)} · ${x.licence_status ?? ""}`),
          canEdit && p.status === "draft" ? h("button.btn.small.ghost", { onclick: () => use(x) }, "Use this") : null),
        why(x.why), x.needs?.length ? h("div.small", "Before using: ", x.needs.join("; ")) : null)))) : null,
    rec.filtered?.length ? h("details",
      h("summary.small", { style: { cursor: "pointer" } }, `Blocked sounds (${rec.filtered.length})`),
      h("ul", rec.filtered.map((x) => h("li.small", h("b", x.label), ": ", x.reasons.join("; "))))) : null,
    h("p.small.muted", rec.trend_source?.note ?? (rec.trend_source?.refreshed ? `Trend list from ${rec.trend_source.source ?? "the platform"}, ${rec.trend_source.refreshed}.` : "")),
    rec.conversion ? h("p.small.muted", rec.conversion) : null);
}

function gateBlock(reel) {
  const g = reel?.package?.gate_report;
  if (!g) return null;
  return h("details.card",
    h("summary", { style: { cursor: "pointer", fontWeight: "800" } },
      "Gate report ", g.all_passed ? pill("all passed", "good") : pill("not all passed", "bad")),
    h("ul.gates", (g.gates ?? []).map((x) => h("li",
      h("div.row", x.pass ? pill("PASS", "good") : pill("FAIL", "bad"), h("b", x.label ?? x.gate)),
      x.blocking?.length ? h("ul", x.blocking.map((b) => h("li.small", b))) : null,
      x.needs_reviewer?.length ? h("div.small", "For the human reviewer: ", x.needs_reviewer.map((r) => r.what ?? r.quote ?? JSON.stringify(r)).join("; ")) : null,
      x.advisory?.length ? h("div.small.muted", "Advice: ", x.advisory.map((r) => r.why).join(" ")) : null))),
    g.design_tips?.length ? h("p.small.muted", `Design tips (advice): ${g.design_tips.join(", ")}`) : null,
    reel.package.credits?.length ? h("p.small.muted", `Credits: ${reel.package.credits.map((c) => c.title ?? c.id).join("; ")}`) : null,
    reel.package.skipped?.length ? h("p.small.muted", reel.package.skipped.map((s) => `${s.platform}: ${s.why}`).join(" ")) : null,
    reel.package.source ? h("p.small.muted", `From the post generator: run ${reel.package.source.run}, ${reel.package.source.variant}.`) : null);
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
    ["create", "In Instagram, tap +, then Post, and select the slides in order (1 first)."],
    ["sound", sound],
    ["alt", "Advanced settings > Write alt text: paste each slide's alt text from Details."],
    ["caption", h("span", "Paste the caption. ", copyCaption)],
    ["post", "Share. Organic only: never boost a post with a platform sound."],
  ];
}
