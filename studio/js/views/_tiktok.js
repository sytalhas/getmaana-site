// The TikTok Direct Post screen (TikTok's content sharing guidelines; rules in ../tiktok_ux.js). Used by Launch
// (videos) and by a TikTok draft's Details in Posts (carousels and videos) whenever the method is a direct post.
// It reads the creator info live from studio-api (action/tiktok/creator_info, read only) each time it opens.

import { api } from "../supa.js";
import { h, clear } from "../ui.js";
import { mediaSrc } from "../media.js";
import {
  emptyUx, disclosurePrompt, declaration, privacyChoices, uxProblems, toOptions, PROCESSING_NOTE,
  BRAND_ORGANIC_HELP, BRANDED_CONTENT_HELP, BRANDED_PRIVATE, MUSIC_USAGE_URL, BRANDED_POLICY_URL,
} from "../tiktok_ux.js";

/**
 * @param {object} o
 * @param {"video"|"photo"} o.kind
 * @param {string|null} o.connectionId
 * @param {number|null} [o.durationS]   video length, for the max duration check
 * @param {string[]} [o.photos]          slide URLs for the preview (photo posts)
 * @param {string|null} [o.videoUrl]     video URL for the preview
 * @param {object|null} [o.saved]        options.tiktok saved earlier (restores the person's own choices)
 * @param {string|null} [o.caption]      the post's caption: when given, the screen shows it (and a photo title) editable
 * @param {() => void} [o.onChange]
 */
export function tiktokPanel({ kind, connectionId, durationS = null, photos = [], videoUrl = null, saved = null, caption = null, onChange = () => {} }) {
  const ux = { ...emptyUx(), ...(saved ? pick(saved) : {}) };
  // Preset text is always editable (guideline 2a): the photo title starts as the caption's first line.
  if (caption != null && kind === "photo") ux.title = saved?.title ?? shortTitle(String(caption).split("\n")[0]);
  let text = caption;
  const captionBox = caption == null ? null : h("textarea", { rows: 5, oninput: (e) => { text = e.target.value; onChange(); } });
  if (captionBox) captionBox.value = caption;
  const titleBox = caption != null && kind === "photo"
    ? h("input", { maxLength: 90, oninput: (e) => { ux.title = e.target.value; onChange(); } }) : null;
  if (titleBox) titleBox.value = ux.title;
  let creator = null;
  const el = h("div.stack.tiktok-screen", { style: { gap: "10px" } });

  const changed = () => { draw(); onChange(); };

  function draw() {
    if (!creator) return clear(el, h("p.muted", "Loading the TikTok account (creator info)"));
    if (creator.error) return clear(el, h("div.notice.bad", `Could not read the TikTok account: ${creator.error}`));
    if (!creator.direct_post) return clear(el, h("div.notice", creator.message ?? "TikTok direct posting is off."));

    const who = h("div.row", { style: { gap: "10px", alignItems: "center" } },
      creator.creator_avatar_url ? h("img", { src: creator.creator_avatar_url, alt: "", width: 36, height: 36, style: { borderRadius: "50%" } }) : null,
      h("div", h("div.small.muted", "Posting to TikTok as"),
        h("strong", creator.creator_nickname ?? "TikTok account"),
        creator.creator_username ? h("span.muted", ` @${creator.creator_username}`) : null));
    if (creator.can_post === false) {
      return clear(el, who, h("div.notice.bad", `TikTok says this account cannot post right now. ${creator.message ?? "Try again later."}`));
    }

    const privacy = h("select", {
      "aria-label": "Who can see this post",
      onchange: (e) => { ux.privacy_level = e.target.value; changed(); },
    },
    h("option", { value: "", disabled: true, selected: !ux.privacy_level }, "Choose who can see this post"),
    privacyChoices(creator, ux).map((o) => h("option", {
      value: o.value, disabled: o.disabled, selected: ux.privacy_level === o.value,
      title: o.disabled ? BRANDED_PRIVATE : null,
    }, o.disabled ? `${o.label} (branded content can't be private)` : o.label)));

    const interactions = [
      ["allow_comment", "Allow comments", "comment_disabled"],
      ...(kind === "video" ? [["allow_duet", "Allow Duet", "duet_disabled"], ["allow_stitch", "Allow Stitch", "stitch_disabled"]] : []),
    ].map(([key, label, flag]) => {
      const off = !!creator[flag];
      return h(`label.row.small${off ? ".muted" : ""}`, { style: { gap: "6px", opacity: off ? ".55" : "1" } },
        h("input", { type: "checkbox", checked: !off && !!ux[key], disabled: off, onchange: (e) => { ux[key] = e.target.checked; changed(); } }),
        label, off ? h("span.small", " (turned off in this account's TikTok settings)") : null);
    });

    const brandedLocked = ux.privacy_level === "SELF_ONLY";
    const disclosure = h("div.stack", { style: { gap: "6px" } },
      h("label.row", { style: { gap: "8px", fontWeight: "700" } },
        h("input", { type: "checkbox", role: "switch", checked: !!ux.disclose, onchange: (e) => { ux.disclose = e.target.checked; changed(); } }),
        "Disclose post content"),
      h("p.small.muted", "Turn on to show that this post promotes goods or services in exchange for something of value. It can promote yourself, a third party, or both."),
      ux.disclose ? h("div.stack", { style: { gap: "6px", paddingLeft: "22px" } },
        h("label.row.small", { style: { gap: "6px", alignItems: "flex-start" } },
          h("input", { type: "checkbox", checked: !!ux.brand_organic, onchange: (e) => { ux.brand_organic = e.target.checked; changed(); } }),
          h("span", h("b", "Your brand"), h("br"), BRAND_ORGANIC_HELP)),
        h("label.row.small", { style: { gap: "6px", alignItems: "flex-start", opacity: brandedLocked ? ".55" : "1" }, title: brandedLocked ? BRANDED_PRIVATE : null },
          h("input", { type: "checkbox", checked: !!ux.branded_content, disabled: brandedLocked, onchange: (e) => { ux.branded_content = e.target.checked; changed(); } }),
          h("span", h("b", "Branded content"), h("br"), BRANDED_CONTENT_HELP, brandedLocked ? h("span", h("br"), h("i", BRANDED_PRIVATE)) : null)),
        h("div.notice.info.small", disclosurePrompt(ux, kind))) : null);

    const preview = kind === "photo"
      ? h("div.slide-strip", photos.slice(0, 35).map((u, i) => {
        const img = h("img", { alt: `Photo ${i + 1}`, width: 60, height: 107, loading: "lazy", style: { objectFit: "cover", borderRadius: "6px" } });
        mediaSrc(img, u);
        return h("figure.slide", img);
      }))
      : videoUrl ? (() => {
        const v = h("video", { controls: true, muted: true, playsInline: true, preload: "metadata", style: { width: "120px", borderRadius: "8px", background: "#000" } });
        mediaSrc(v, videoUrl);
        return v;
      })() : null;

    const probs = uxProblems(ux, creator, { kind, durationS });
    clear(el,
      who,
      creator.audited ? null : h("div.notice.small", "Until TikTok approves Studio's audit, TikTok only accepts private posts from it, so Only me is the one choice. Everything else on this screen works as it will after the audit."),
      preview ? h("div.field", h("span.field-label", "Preview"), preview) : null,
      titleBox ? h("label.field", h("span.field-label", "Title (up to 90 characters)"), titleBox) : null,
      captionBox ? h("label.field", h("span.field-label", kind === "photo" ? "Description (caption and hashtags)" : "Caption and hashtags"), captionBox) : null,
      h("label.field", h("span.field-label", "Who can see this post"), privacy),
      h("div.field", h("span.field-label", "Allow users to"), h("div.stack", { style: { gap: "4px" } }, interactions)),
      disclosure,
      probs.length ? h("ul.preflight-list.errors", probs.map((p) => h("li", p))) : null,
      h("p.small.tiktok-declaration", declarationNode(ux)),
      h("p.small.muted", "The title, caption and hashtags are yours to edit. Studio adds no watermark or logo to the post."));
  }

  const ready = api("action/tiktok/creator_info", { connection_id: connectionId ?? null })
    .then((c) => { creator = c; })
    .catch((e) => { creator = { error: e.message }; })
    .finally(changed);
  draw();

  return {
    el,
    ready,
    /** Problems that block the launch (empty: ready). */
    problems: () => (creator?.error ? [`TikTok account: ${creator.error}`] : !creator ? ["Loading the TikTok account."]
      : !creator.direct_post ? [creator.message ?? "TikTok direct posting is off."] : uxProblems(ux, creator, { kind, durationS })),
    /** What goes into posts.options.tiktok. */
    value: () => toOptions(ux, creator, kind),
    creator: () => creator,
    /** The edited caption (null when the screen shows none). */
    caption: () => text,
    processingNote: PROCESSING_NOTE,
  };
}

function declarationNode(ux) {
  const music = h("a", { href: MUSIC_USAGE_URL, target: "_blank", rel: "noopener" }, "Music Usage Confirmation");
  if (ux.disclose && ux.branded_content) {
    return h("span", "By posting, you agree to TikTok's ",
      h("a", { href: BRANDED_POLICY_URL, target: "_blank", rel: "noopener" }, "Branded Content Policy"), " and ", music, ".");
  }
  return h("span", "By posting, you agree to TikTok's ", music, ".");
}

/** The caption's first line, cut at a word boundary to TikTok's 90-character photo title. */
export function shortTitle(line) {
  const chars = [...line.trim()];
  if (chars.length <= 90) return chars.join("");
  const cut = chars.slice(0, 90).join("");
  const at = cut.lastIndexOf(" ");
  return (at > 40 ? cut.slice(0, at) : cut).replace(/[\s,:;.]+$/, "");
}

function pick(s) {
  const out = {};
  for (const k of ["privacy_level", "allow_comment", "allow_duet", "allow_stitch", "disclose", "brand_organic", "branded_content"]) {
    if (s[k] != null) out[k] = s[k];
  }
  if (!out.privacy_level) out.privacy_level = "";
  return out;
}

export { declaration };
