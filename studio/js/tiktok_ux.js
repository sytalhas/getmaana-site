// TikTok Direct Post screen rules (developers.tiktok.com content-sharing-guidelines, read 2026-10-07), pure so they
// are unit-tested (test/tiktok_ux.test.mjs). views/_tiktok.js draws the screen; the server enforces the same rules
// after the audit (maana _shared/preflight.ts tiktokUxErrors, platforms/tiktok.ts directPostInfo).
//
//  - show the creator's nickname (creator_info) so they know which account receives the post; stop if it cannot post
//  - privacy from privacy_level_options, chosen by the person, no default
//  - Allow comments / Duet / Stitch: none on by default; greyed out when the account turns them off; photos: comments only
//  - commercial content disclosure: off by default; on needs Your brand and/or Branded content; the label prompt;
//    branded content cannot be private
//  - the consent declaration next to the publish button; a preview; the processing notice after publishing
//  - videos: no longer than max_video_post_duration_sec

export const PRIVACY_LABELS = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends (followers you follow back)",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

export const MUSIC_USAGE_URL = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
export const BRANDED_POLICY_URL = "https://www.tiktok.com/legal/page/global/bc-policy/en";

export const PROCESSING_NOTE = "After it is published, it may take a few minutes for the post to process and appear on the TikTok profile.";

export const BRAND_ORGANIC_HELP = "You are promoting yourself or your own business. This content will be classified as Brand Organic.";
export const BRANDED_CONTENT_HELP = "You are promoting another brand or a third party. This content will be classified as Branded Content.";
export const BRANDED_PRIVATE = "Visibility for branded content can't be private.";

/** An empty set of choices: nothing selected, nothing on (TikTok allows no defaults). */
export function emptyUx() {
  return { privacy_level: "", allow_comment: false, allow_duet: false, allow_stitch: false, disclose: false, brand_organic: false, branded_content: false };
}

/** The label prompt under the disclosure toggle, or null when the toggle is off. */
export function disclosurePrompt(ux, kind = "video") {
  if (!ux?.disclose) return null;
  const what = kind === "photo" ? "photo" : "video";
  if (ux.branded_content) return `Your ${what} will be labeled as "Paid partnership".`;
  if (ux.brand_organic) return `Your ${what} will be labeled as "Promotional content".`;
  return "You need to indicate if your content promotes yourself, a third party, or both.";
}

/** The consent declaration shown next to the publish button (exact TikTok wording). */
export function declaration(ux) {
  return ux?.disclose && ux?.branded_content
    ? "By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation."
    : "By posting, you agree to TikTok's Music Usage Confirmation.";
}

/** Privacy options the person may pick now (SELF_ONLY is not offered while Branded content is on). */
export function privacyChoices(creator, ux) {
  const all = creator?.privacy_level_options ?? [];
  return all.map((v) => ({ value: v, label: PRIVACY_LABELS[v] ?? v, disabled: v === "SELF_ONLY" && !!(ux?.disclose && ux?.branded_content) }));
}

/** Everything that stops a direct post from being sent, in words for the person. Empty: ready. */
export function uxProblems(ux, creator, { kind = "video", durationS = null } = {}) {
  const out = [];
  if (!creator) return ["Loading the TikTok account."];
  if (creator.can_post === false) {
    out.push(`TikTok says this account cannot post right now. ${creator.message ?? "Try again later."}`.trim());
    return out;
  }
  if (!ux?.privacy_level) out.push("Choose who can see this post.");
  else if (!(creator.privacy_level_options ?? []).includes(ux.privacy_level)) out.push("That privacy option is not available for this account.");
  if (ux?.disclose && !ux.brand_organic && !ux.branded_content) out.push("Commercial content is on: choose Your brand, Branded content or both, or turn it off.");
  if (ux?.disclose && ux.branded_content && ux.privacy_level === "SELF_ONLY") out.push(BRANDED_PRIVATE);
  const max = Number(creator.max_video_post_duration_sec ?? 0);
  if (kind === "photo" && typeof ux?.title === "string" && !ux.title.trim()) out.push("Enter a title for the photo post.");
  if (kind === "video" && max && durationS && Number(durationS) > max) {
    out.push(`This video is ${Math.round(Number(durationS))} s; this account can post at most ${max} s through the API.`);
  }
  return out;
}

/** What is stored in posts.options.tiktok (the server reads exactly these fields). */
export function toOptions(ux, creator, kind = "video") {
  const off = (flag) => !!creator?.[flag];
  return {
    privacy_level: ux.privacy_level || null,
    allow_comment: !!ux.allow_comment && !off("comment_disabled"),
    ...(kind === "video"
      ? { allow_duet: !!ux.allow_duet && !off("duet_disabled"), allow_stitch: !!ux.allow_stitch && !off("stitch_disabled") }
      : {}),
    disclose: !!ux.disclose,
    brand_organic: !!(ux.disclose && ux.brand_organic),
    branded_content: !!(ux.disclose && ux.branded_content),
    ...(kind === "photo" && typeof ux.title === "string" ? { title: [...ux.title].slice(0, 90).join("") } : {}),
    declaration: declaration(ux),
    creator: creator?.creator_username ?? creator?.creator_nickname ?? null,
  };
}
