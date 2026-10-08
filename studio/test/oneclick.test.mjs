// node --test studio/test/
import test from "node:test";
import assert from "node:assert/strict";
import { carouselPackages, planLaunch, launchIds, launchLine, packageSummary, manualReason } from "../js/oneclick.js";

const NONE = { id: "none", label: "No added sound", kind: "none" };
const RAIN = { id: "sfx-natural", label: "Rain", kind: "sfx" };
const D = (id, platform, method, extra = {}) => ({
  id, reel_id: "g-1", platform, method, format: "carousel", status: "draft", caption: "Sabr.", options: { audio: { choice: NONE } },
  preflight: { ok: true, errors: [] }, ...extra,
});
const ok = { ok: true, errors: [], warnings: [] };

test("packages group carousel drafts by reel, Instagram first; videos and launched posts are left out", () => {
  const pk = carouselPackages([
    D("t", "tiktok", "manual"), D("f", "facebook", "api"), D("i", "instagram", "api"),
    D("v", "instagram", "api", { format: "video" }), D("x", "instagram", "api", { reel_id: "g-2", status: "scheduled" }),
  ]);
  assert.deepEqual([...pk.keys()], ["g-1"]);
  assert.deepEqual(pk.get("g-1").map((p) => p.id), ["i", "f", "t"]);
});

test("one-click default: Instagram and Facebook launch together by API; TikTok stays manual and is never confirmed", () => {
  const drafts = [D("i", "instagram", "api"), D("f", "facebook", "api"), D("t", "tiktok", "manual")];
  const plan = planLaunch(drafts, { i: ok, f: ok });
  assert.deepEqual(launchIds(plan), ["i", "f"]);
  assert.deepEqual(plan.manual.map((x) => x.post.id), ["t"]);
  assert.match(plan.manual[0].why, /verifies Studio's photo link/);
  assert.equal(packageSummary(drafts), "2 by API, 1 manual");
});

test("pre-flight must pass per post: a blocked draft is listed and left out, the rest still launch", () => {
  const plan = planLaunch([D("i", "instagram", "api"), D("f", "facebook", "api")],
    { i: ok, f: { ok: false, errors: ["Caption is empty."] } });
  assert.deepEqual(launchIds(plan), ["i"]);
  assert.deepEqual(plan.blocked.map((x) => [x.post.id, x.why]), [["f", "Caption is empty."]]);
});

test("this run's pre-flight wins over the stored one, and a missing result never launches", () => {
  const stale = D("i", "instagram", "api", { preflight: { ok: true } });
  assert.deepEqual(launchIds(planLaunch([stale], { i: { ok: false, errors: ["x"] } })), []);
  assert.deepEqual(launchIds(planLaunch([D("f", "facebook", "api", { preflight: null })], {})), []);
});

test("a sound added by hand keeps that post manual; a TikTok direct post needs its own screen; an inbox draft launches", () => {
  const ig = D("i", "instagram", "manual", { options: { audio: { choice: RAIN } } });
  const ttDirect = D("t", "tiktok", "api");
  const ttInbox = D("u", "tiktok", "inbox_draft", { reel_id: "g-1" });
  const plan = planLaunch([ig, ttDirect, ttInbox], { t: ok, u: ok });
  assert.deepEqual(launchIds(plan), ["u"]);
  assert.match(manualReason(ig), /add the sound "Rain" by hand/);
  assert.deepEqual(plan.ownScreen.map((x) => x.post.id), ["t"]);
});

test("launch lines say what, where, the sound and when", () => {
  assert.equal(launchLine(D("i", "instagram", "api"), { slides: 7, account: "@maana.app" }),
    "Instagram: carousel of 7 slides published with the API, no added sound, caption 5 characters, account @maana.app, now.");
  assert.match(launchLine(D("u", "tiktok", "inbox_draft"), { slides: 7, when: "Oct 8, 9:00 AM" }), /TikTok inbox as a draft .* at Oct 8, 9:00 AM\.$/);
});

// ---------------------------------------------------------------- own content (content-creator, 2026-10-08)
import { draftPackages, inPackage } from "../js/oneclick.js";

test("own content: a video draft whose reel carries a package joins the launch list; library videos do not", () => {
  const reels = new Map([["o-1", { id: "o-1", package: { schema: "studio-draft/1", format: "video" } }], ["r5", { id: "r5", package: {} }]]);
  const V = (id, platform, method, reel = "o-1") => D(id, platform, method, { reel_id: reel, format: "video", options: { audio: { choice: { id: "own-voice", label: "Our own voice", kind: "voice" } }, title: "When your spouse says fine" } });
  const posts = [V("y", "youtube", "api"), V("t", "tiktok", "inbox_draft"), V("i", "instagram", "api"), V("lib", "instagram", "api", "r5")];
  const pk = draftPackages(posts, reels);
  assert.deepEqual([...pk.keys()], ["o-1"]);
  assert.deepEqual(pk.get("o-1").map((p) => p.id), ["i", "t", "y"]);
  assert.equal(inPackage(posts[3], reels), false);
  assert.equal(inPackage(D("c", "instagram", "api")), true);
  const plan = planLaunch(pk.get("o-1"), { i: ok, t: ok, y: ok });
  assert.deepEqual(launchIds(plan), ["i", "t", "y"]);
  assert.match(launchLine(posts[0]), /the video published with the API as a Short titled "When your spouse says fine"/);
  assert.match(launchLine(posts[1]), /the video sent to the TikTok inbox/);
  assert.match(launchLine(posts[2]), /its own sound \(Our own voice\)/);
  assert.match(launchLine(D("one", "instagram", "api"), { slides: 1 }), /one photo published with the API/);
});
