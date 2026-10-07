// Sound in plain words for Studio's carousel drafts (content-creator LRN-47; owner 2026-10-07: the sound screens
// were "so busy and hard to follow"). Pure (no DOM, no network): test/sound_words.test.mjs.

const PLATFORM_NAMES = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube" };
const KIND_NAME = { nasheed_vocal_only: "A nasheed with voices only", sfx: "Natural sound (rain, pages turning or birds)",
  voice: "Your own voice reading the first slide" };
const KIND_REASON = { nasheed_vocal_only: "Voices only", recitation: "Recited softly, whole ayat", sfx: "Quiet, no music", voice: "Personal" };

/** A sound's name in plain words. */
export function soundName(x) {
  if (!x || (x.kind ?? "none") === "none") return "No sound";
  if (x.kind === "recitation") {
    const m = String(x.id ?? "").match(/^recitation:(.+)$/);
    return m ? `Qur'an recitation of ${m[1].split(",").join(" and ")}` : (x.label ?? "Qur'an recitation");
  }
  return KIND_NAME[x.kind] ?? x.label ?? x.id;
}

/** One short reason for a suggested sound. */
export function soundReason(x, platform) {
  const t = x?.trend;
  if (t?.rank) return `#${t.rank} trending on ${PLATFORM_NAMES[platform] ?? platform}${t.date ? ` (list from ${t.date})` : ""}`;
  const fit = (x?.why ?? []).map((w) => String(w).match(/^fit: fits the post's (\w+)/)).find(Boolean);
  const base = KIND_REASON[x?.kind] ?? "Fits this post";
  return fit ? `${base}, fits a ${fit[1]} post` : base;
}

/** Text meant for a person: no rule ids or policy names. */
export function plainText(s) {
  return String(s ?? "")
    .replace(/\s*\((?:playbook\s+)?(?:[A-Z]{2,3}-\d{2}(?:,\s*|\s+to\s+)?)+\)/g, "")
    .replace(/\b[A-Z]{2,3}-\d{2}\b:?\s*/g, "")
    .replace(/\b(maana|mawadda) audio policy\b/gi, "brand's sound rules")
    .replace(/\baudio policy\b/gi, "sound rules")
    .replace(/_/g, " ").replace(/\s{2,}/g, " ").trim();
}

/** What happens to this draft, given its sound, in one line. */
export function soundLine(platform, kind, method) {
  const none = (kind ?? "none") === "none";
  if (platform === "tiktok" && method === "manual") return none ? "You post it in the TikTok app from its checklist." : "You post it in the TikTok app from its checklist and add the sound there.";
  if (platform === "tiktok") return none ? "Goes to your TikTok drafts: you tap Post." : "Goes to your TikTok drafts: you add the sound and tap Post.";
  return none ? "Posts automatically when you launch it." : `You post it in the ${PLATFORM_NAMES[platform] ?? platform} app and add the sound there (the checklist has the steps).`;
}
