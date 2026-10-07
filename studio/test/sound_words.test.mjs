// node --test studio/test/
// Plain words on Studio's carousel sound and launch screens (content-creator LRN-47): no scores, rule ids, policy
// names or internal kinds; one line per platform in the launch confirmation.
import test from "node:test";
import assert from "node:assert/strict";
import { soundName, soundReason, soundLine, plainText } from "../js/sound_words.js";
import { planLaunch, launchSummary } from "../js/oneclick.js";

const JARGON = /[A-Z]{2}-\d{2}|policy|score|\bcml\b|nasheed_vocal_only|inbox_draft|fit review/;

test("sound names and reasons are plain", () => {
  assert.equal(soundName({ kind: "none" }), "No sound");
  assert.equal(soundName({ id: "nasheed-vocal", kind: "nasheed_vocal_only", label: "A vocal-only nasheed from the app's library" }), "A nasheed with voices only");
  assert.equal(soundName({ id: "recitation:2:45,18:28", kind: "recitation" }), "Qur'an recitation of 2:45 and 18:28");
  const r = soundReason({ kind: "sfx", why: ["trend: not a trend item", "fit: fits the post's reflective, warm mood", "policy: allowed"] }, "instagram");
  assert.equal(r, "Quiet, no music, fits a reflective post");
  assert.equal(soundReason({ kind: "unclassified", trend: { rank: 3, date: "2026-10-06" } }, "tiktok"), "#3 trending on TikTok (list from 2026-10-06)");
  for (const s of [r, soundName({ kind: "voice" }), soundLine("instagram", "sfx"), soundLine("tiktok", "none", "inbox_draft")]) assert.doesNotMatch(s, JARGON);
});

test("what happens per platform follows the sound and the method", () => {
  assert.equal(soundLine("instagram", "none"), "Posts automatically when you launch it.");
  assert.match(soundLine("facebook", "sfx"), /You post it in the Facebook app/);
  assert.match(soundLine("tiktok", "none", "inbox_draft"), /TikTok drafts: you tap Post/);
  assert.match(soundLine("tiktok", "none", "manual"), /from its checklist/);
});

test("rule ids and policy names never reach the screen", () => {
  assert.equal(plainText("Instagram has no sound field for carousels (AU-04)."), "Instagram has no sound field for carousels.");
  assert.equal(plainText("the mawadda audio policy has no instruments"), "the brand's sound rules has no instruments");
});

test("the launch confirmation is one plain line per platform, in package order", () => {
  const D = (id, platform, method, extra = {}) => ({ id, reel_id: "g", platform, method, format: "carousel", status: "draft", caption: "x",
    options: { audio: { choice: { id: "none", kind: "none" } } }, ...extra });
  const ok = { ok: true, errors: [] };
  const plan = planLaunch([D("t", "tiktok", "manual"), D("f", "facebook", "api"), D("i", "instagram", "api")],
    { i: ok, f: { ok: false, errors: ["Caption is empty."] } });
  const rows = launchSummary(plan);
  assert.deepEqual(rows.map((r) => [r.platform, r.kind]), [["instagram", "launch"], ["facebook", "blocked"], ["tiktok", "manual"]]);
  assert.equal(rows[0].text, "Instagram: goes out now");
  assert.equal(rows[1].text, "Facebook: not launched: Caption is empty.");
  assert.match(rows[2].text, /^TikTok: stays with you/);
  for (const r of rows) assert.doesNotMatch(r.text, JARGON);
});
