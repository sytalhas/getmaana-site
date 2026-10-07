// One-click launch for a carousel package (the drafts that share one reel from the post generator's Send to
// Studio): which drafts go out with the API, which stay manual, which pre-flight blocks. Pure (no DOM, no network)
// so the rules are unit-tested (test/oneclick.test.mjs); views/posts.js runs pre-flight, shows the plan in one
// confirmation and calls studio.confirm_posts once with every id in plan.launch.
//
// Safety rails kept: nothing launches without that confirmation; a draft launches only if its own pre-flight
// passed just now; manual drafts (a sound added by hand, TikTok before its photo link is verified) are never
// confirmed here; a TikTok direct post needs its own TikTok screen (privacy and settings chosen per post).

export const PLATFORM_LABEL = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube Shorts", meta_ads: "Meta Ads" };

/** Carousel drafts grouped by reel (one package per reel), only reels with at least one carousel draft. */
export function carouselPackages(posts) {
  const out = new Map();
  for (const p of posts) {
    if (p?.format !== "carousel" || p.status !== "draft") continue;
    if (!out.has(p.reel_id)) out.set(p.reel_id, []);
    out.get(p.reel_id).push(p);
  }
  for (const list of out.values()) list.sort((a, b) => order(a.platform) - order(b.platform));
  return out;
}

const ORDER = ["instagram", "facebook", "tiktok"];
function order(p) {
  const i = ORDER.indexOf(p);
  return i < 0 ? 99 : i;
}

/** Why a manual draft stays manual, in words for the owner. */
export function manualReason(p) {
  const sound = p.options?.audio?.choice;
  if (p.platform === "tiktok") {
    return "stays manual until TikTok verifies Studio's photo link (and, for public posting, the app audit). Launch it from its Details to get the checklist, then post the 9:16 slides in the TikTok app.";
  }
  if (sound && sound.kind !== "none") {
    return `stays manual: you chose to add the sound "${sound.label ?? sound.id}" by hand in the app. Launch it from its Details to get the checklist.`;
  }
  return "stays manual (posted by hand from its checklist). Launch it from its Details.";
}

/**
 * The launch plan for one package.
 * @param drafts   the package's draft posts
 * @param results  post id -> the pre-flight result from this run ({ok, errors, warnings}); falls back to p.preflight
 * @returns {launch, manual, blocked, ownScreen} arrays of {post, why?}
 */
export function planLaunch(drafts, results = {}) {
  const plan = { launch: [], manual: [], blocked: [], ownScreen: [] };
  for (const p of drafts) {
    if (p.status !== "draft") continue;
    if (p.method === "manual") {
      plan.manual.push({ post: p, why: manualReason(p) });
      continue;
    }
    if (p.platform === "tiktok" && p.method === "api") {
      plan.ownScreen.push({ post: p, why: "a TikTok direct post asks for its privacy and settings on its own screen each time: open its Details." });
      continue;
    }
    const r = results[p.id] ?? p.preflight;
    if (!r?.ok) {
      plan.blocked.push({ post: p, why: r?.errors?.[0] ?? "pre-flight has not passed" });
      continue;
    }
    plan.launch.push({ post: p });
  }
  return plan;
}

/** What one launching draft does, as one line of the confirmation. */
export function launchLine(p, { slides = 0, when = null, account = null } = {}) {
  const name = PLATFORM_LABEL[p.platform] ?? p.platform;
  const sound = p.options?.audio?.choice;
  const what = p.method === "inbox_draft"
    ? `${slides} photos sent to the TikTok inbox as a draft (you tap Post in the app)`
    : `carousel of ${slides} slides published with the API`;
  const parts = [what];
  parts.push(sound && sound.kind !== "none" ? `sound "${sound.label}"` : "no added sound");
  parts.push(`caption ${(p.caption ?? "").length} characters`);
  if (account) parts.push(`account ${account}`);
  parts.push(when ? `at ${when}` : "now");
  return `${name}: ${parts.join(", ")}.`;
}

/** The ids confirm_posts receives: every launching draft, nothing else. */
export function launchIds(plan) {
  return plan.launch.map((x) => x.post.id);
}

/** The confirmation's plain summary, one line per platform (content-creator LRN-47: plain summary first, details
 *  collapsed). Returns [{platform, kind: "launch"|"manual"|"own"|"blocked", text}] in the package's order. */
export function launchSummary(plan, { when = () => null } = {}) {
  const rows = [
    ...plan.launch.map(({ post }) => ({ post, kind: "launch",
      text: post.method === "inbox_draft" ? `goes to your TikTok drafts${when(post) ? ` at ${when(post)}` : " now"}: you tap Post in the app`
        : `goes out ${when(post) ? `at ${when(post)}` : "now"}` })),
    ...plan.manual.map(({ post }) => ({ post, kind: "manual",
      text: post.platform !== "tiktok" && post.options?.audio?.choice && post.options.audio.choice.kind !== "none"
        ? "stays with you: you post it in the app with the sound (checklist in its Details)"
        : "stays with you: you post it from its checklist (in its Details)" })),
    ...plan.ownScreen.map(({ post }) => ({ post, kind: "own", text: "needs its own TikTok screen: open its Details" })),
    ...plan.blocked.map(({ post, why }) => ({ post, kind: "blocked", text: `not launched: ${why}` })),
  ];
  return rows.sort((a, b) => order(a.post.platform) - order(b.post.platform))
    .map(({ post, kind, text }) => ({ platform: post.platform, kind, text: `${PLATFORM_LABEL[post.platform] ?? post.platform}: ${text}` }));
}

/** The button label for a package, e.g. "Check and launch all (2 by API, 1 manual)". */
export function packageSummary(drafts) {
  const api = drafts.filter((p) => p.method !== "manual" && !(p.platform === "tiktok" && p.method === "api")).length;
  const manual = drafts.filter((p) => p.method === "manual").length;
  const own = drafts.length - api - manual;
  return [api ? `${api} by API` : null, manual ? `${manual} manual` : null, own ? `${own} on its own screen` : null].filter(Boolean).join(", ");
}
