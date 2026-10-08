// node --test studio/test/upload.test.mjs
// Studio uploads (owner 2026-10-08, content-creator LRN-52): one video or 1 to 10 images; image sizes follow the shape
// like content-creator own.py; captions get their hashtags; what blocks before upload; the package studio-api /drafts
// takes (u- ids, unchecked); and the brand reminders that replace the AI reviewers (shown, never required).
import test from "node:test";
import assert from "node:assert/strict";
import { classify, chooseSets, fitRect, captionFor, cleanTags, soundChoice, problems, buildPackage, newUploadId, reminders,
  isUnchecked, MAX_FILE_BYTES } from "../js/upload_rules.js";

const F = (name, type, size = 1000) => ({ name, type, size });

test("one video, or 1 to 10 images", () => {
  assert.equal(classify([F("a.mp4", "video/mp4")]).kind, "video");
  assert.equal(classify([F("a.jpg", "image/jpeg")]).kind, "photo");
  assert.deepEqual(classify([F("10.png", "image/png"), F("2.png", "image/png")]).files.map((f) => f.name), ["2.png", "10.png"]);
  assert.match(classify([F("a.mp4", "video/mp4"), F("b.jpg", "image/jpeg")]).error, /Not both/);
  assert.match(classify([F("a.mov", "video/quicktime")]).error, /MP4/);
  assert.match(classify([F("a.mp4", "video/mp4", MAX_FILE_BYTES + 1)]).error, /95 MB/);
  assert.match(classify(Array.from({ length: 11 }, (_, i) => F(`${i}.jpg`, "image/jpeg"))).error, /at most 10/);
  assert.match(classify([F("a.gif", "image/gif")]).error, /JPEG, PNG or WebP/);
});

test("sizes follow the images' shape; nothing is cropped", () => {
  assert.deepEqual(chooseSets([1080 / 1920, 1080 / 1920]), { feed: "4x5", tall: "9x16" });
  assert.deepEqual(chooseSets([0.8]), { feed: "4x5", tall: "4x5" });
  assert.deepEqual(chooseSets([1, 1.5]), { feed: "1x1", tall: "1x1" });
  const r = fitRect(1080, 1920, 1080, 1350);
  assert.ok(r.w <= 1080 && r.h === 1350 && r.padded);
  assert.equal(fitRect(2160, 2700, 1080, 1350).padded, false);
});

test("captions carry their hashtags once; per-platform text wins", () => {
  const form = { caption: "Tea for one. #tea", hashtags: "#tea muslimcouples, #Marriage", per: { tiktok: "Short one" } };
  assert.deepEqual(cleanTags(form.hashtags), ["#tea", "#muslimcouples", "#Marriage"]);
  assert.equal(captionFor(form, "instagram"), "Tea for one. #tea\n\n#muslimcouples #Marriage");
  assert.equal(captionFor(form, "tiktok"), "Short one\n\n#tea #muslimcouples #Marriage");
});

test("what blocks before anything is uploaded", () => {
  const base = { title: "Tea", platforms: ["instagram", "youtube"], caption: "Hi", hashtags: "", per: {}, youtubeTitle: "", alts: [], sound: { kind: "voice" } };
  assert.deepEqual(problems(base, "video", ["none", "voice"]), []);
  assert.match(problems({ ...base, caption: "A — dash" }, "video", ["none", "voice"]).join(), /long dashes/);
  assert.match(problems({ ...base, title: "", youtubeTitle: "" }, "video", ["voice"]).join(), /YouTube needs a title/);
  assert.match(problems({ ...base, sound: { kind: null } }, "video", ["voice"]).join(), /what sound/);
  assert.match(problems({ ...base, sound: { kind: "nasheed_vocal_only" } }, "video", ["none", "voice"]).join(), /not allowed/);
  assert.match(problems({ ...base, sound: { kind: "nasheed_vocal_only" } }, "video", ["nasheed_vocal_only"]).join(), /Listen to the whole nasheed/);
  assert.match(problems({ ...base, platforms: [] }, "video", ["voice"]).join(), /at least one platform/);
  assert.equal(soundChoice({ kind: "voice" }).delivery, "file");
  assert.equal(soundChoice({ kind: "nasheed_vocal_only", listened: false }).contains_instruments, null);
  assert.equal(soundChoice({ kind: "none" }).delivery, "none");
});

test("the package: u- id, not checked, one post per platform", () => {
  const id = newUploadId("Tea at 11pm!", () => 0.5);
  assert.equal(id, "u-tea-at-11pm-888888");
  const form = { title: "Tea", platforms: ["instagram", "tiktok"], caption: "Hi", hashtags: "#tea", per: {}, alts: ["one", "two"] };
  const files = { sets: { "4x5": [{ url: "u1", width: 1080, height: 1350 }, { url: "u2", width: 1080, height: 1350 }],
    "9x16": [{ url: "t1", width: 1080, height: 1920 }, { url: "t2", width: 1080, height: 1920 }] } };
  const pkg = buildPackage({ ws: "mawadda", uploadId: id, kind: "carousel", form, files, setKeys: { feed: "4x5", tall: "9x16" } });
  assert.equal(pkg.metadata.checked, false);
  assert.equal(pkg.source.tool, "studio upload");
  assert.deepEqual(pkg.posts.map((p) => [p.platform, p.set, p.method]), [["instagram", "4x5", "api"], ["tiktok", "9x16", "inbox_draft"]]);
  assert.deepEqual(pkg.sets["4x5"].items.map((i) => [i.n, i.alt]), [[1, "one"], [2, "two"]]);
  const v = buildPackage({ ws: "maana", uploadId: id, kind: "video", form: { ...form, platforms: ["youtube"], youtubeTitle: "", sound: { kind: "sfx" } },
    files: { video: { url: "v", width: 1080, height: 1920, duration_s: 12 }, poster: { url: "p" } } });
  assert.deepEqual([v.format, v.posts[0].title, v.video.sound.kind, v.poster.url], ["video", "Tea", "sfx", "p"]);
});

test("the reminders replace the AI reviewers, per brand", () => {
  assert.ok(reminders("mawadda").some((r) => /sunnah\.com/.test(r)));
  assert.ok(reminders("mawadda").some((r) => /husband or the wife/.test(r)));
  assert.ok(reminders("maana").some((r) => /Premium/.test(r)));
  assert.ok(reminders("other").length >= 3);
  assert.ok(reminders("mawadda").every((r) => !/[—–]/.test(r)));
  assert.equal(isUnchecked({ package: { checked: false } }), true);
  assert.equal(isUnchecked({ package: { schema: "studio-draft/1" } }), false);
});
