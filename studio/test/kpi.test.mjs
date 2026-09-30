// node --test studio/test/
import test from "node:test";
import assert from "node:assert/strict";
import { postRow, computeAll, proportionTest, isoWeek, buildRows, inRange, dailyViews, leverEffects, confidence, compareVariants, KPI_BY_KEY, weekStart, cadenceStatus, sampleSizeFor } from "../js/kpi.js";
import { toCSV } from "../js/csv.js";

const P = (id, extra = {}) => ({ id, reel_id: "r1", platform: "instagram", post_type: "organic", ...extra });

test("hook rate is a ratio of sums, not a mean of ratios", () => {
  // Post A: 10 views, skip 0.0 -> 10 hooked. Post B: 1000 views, skip 0.8 -> 200 hooked.
  const rows = [
    postRow(P("a"), { ig: { source: "instagram_insights", views: 10, skip_rate: 0 } }),
    postRow(P("b"), { ig: { source: "instagram_insights", views: 1000, skip_rate: 0.8 } }),
  ];
  const k = computeAll(rows);
  assert.equal(k.hook_rate.posts, 2);
  assert.ok(Math.abs(k.hook_rate.value - 210 / 1010) < 1e-9); // mean of ratios would be 0.6
});

test("ads hook rate uses 3-second views / impressions", () => {
  const rows = [postRow(P("a", { platform: "meta_ads", post_type: "paid" }),
    { ads: { source: "meta_ads", impressions: 1000, three_s_views: 310, thruplays: 124, spend_usd: 12, installs: 10, views: 900 } })];
  const k = computeAll(rows);
  assert.equal(k.hook_rate.value, 0.31);
  assert.equal(k.hold_rate.value, 0.4);
  assert.equal(k.cpi.value, 1.2);
});

test("installs from ads and ASC are not double counted", () => {
  const row = postRow(P("a"), {
    ads: { source: "meta_ads", views: 1000, installs: 8 },
    asc: { source: "asc_reports", installs: 10, views: 99999 },
  });
  assert.equal(row.installs, 10);
  assert.equal(row.views, 1000); // ASC never overrides platform metrics
});

test("posts without data are excluded from the denominator", () => {
  const rows = [
    postRow(P("a"), { ig: { source: "instagram_insights", views: 100, shares: 5 } }),
    postRow(P("b"), { tt: { source: "tiktok_video_list", views: 900 } }), // shares unknown
  ];
  const k = computeAll(rows);
  assert.equal(k.share_rate.value, 0.05);
  assert.equal(k.share_rate.posts, 1);
});

test("proportion test and iso week", () => {
  const t = proportionTest(300, 1000, 200, 1000);
  assert.ok(t.p < 0.001);
  assert.equal(isoWeek("2026-09-30T12:00:00Z"), "2026-W40");
});

// ---- insights helpers -------------------------------------------------------

const snap = (views, skip, extra = {}) => ({ source: "instagram_insights", views, skip_rate: skip, ...extra });

test("buildRows joins reel levers and skips posts without metrics", () => {
  const reels = new Map([["r1", { id: "r1", batch: "batch1", hook_type: "question", arabic_frame0: true }]]);
  const posts = [P("a", { published_at: "2026-09-30T10:00:00Z", variant_label: "A" }), P("b")];
  const latest = { a: { ig: snap(100, 0.5) } };
  const rows = buildRows(posts, reels, (id) => latest[id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hook_type, "question");
  assert.equal(rows[0].arabic_frame0, "yes");
  assert.equal(rows[0].batch, "batch1");
  assert.equal(rows[0].week, "2026-W40");
  assert.equal(rows[0].variant_label, "A");
  assert.equal(buildRows(posts, reels, (id) => latest[id], { includeEmpty: true }).length, 2);
});

test("inRange filters by published date", () => {
  const now = Date.parse("2026-09-30T00:00:00Z");
  assert.ok(inRange("2026-09-25T00:00:00Z", 7, now));
  assert.ok(!inRange("2026-09-01T00:00:00Z", 7, now));
  assert.ok(!inRange(null, 7, now));
  assert.ok(inRange(null, null, now));
});

test("dailyViews uses deltas of cumulative views and never sums sources", () => {
  const m = new Map([
    ["a", [
      { source: "instagram_insights", captured_at: "2026-09-01T08:00:00Z", views: 100 },
      { source: "instagram_insights", captured_at: "2026-09-01T20:00:00Z", views: 150 },
      { source: "manual", captured_at: "2026-09-02T09:00:00Z", views: 140 }, // lower manual entry: no negative delta
      { source: "instagram_insights", captured_at: "2026-09-03T09:00:00Z", views: 400 },
      { source: "asc_reports", captured_at: "2026-09-03T09:00:00Z", views: 99999, installs: 3 },
    ]],
    ["b", [{ source: "tiktok_video_list", captured_at: "2026-09-02T10:00:00Z", views: 50 }]],
  ]);
  const d = dailyViews(m, ["a", "b"], "2026-09-01", "2026-09-04");
  assert.deepEqual(d.map((x) => x.views), [150, 50, 250, 0]);
  assert.deepEqual(d.map((x) => x.posts), [1, 1, 1, 0]);
  const sum = d.reduce((s, x) => s + x.views, 0);
  assert.equal(sum, 450); // equals latest cumulative per post (400 + 50)
});

function rowsFor(spec) {
  // spec: [[leverValue, views, skip], ...]
  return spec.map(([v, views, skip], i) => ({ ...postRow(P("p" + i), { ig: snap(views, skip) }), hook_type: v }));
}

test("leverEffects: ratio of sums per value vs the rest, ranked by effect", () => {
  const rows = rowsFor([
    ["question", 1000, 0.5], ["question", 1000, 0.5], ["question", 1000, 0.5],
    ["statement", 1000, 0.7], ["statement", 1000, 0.7], ["statement", 1000, 0.7],
    [null, 5000, 0.0], // unset lever: excluded from both sides
  ]);
  const out = leverEffects(rows, "hook_type", "hook_rate");
  assert.equal(out[0].value, "question");
  assert.equal(out[0].a.value, 0.5);
  assert.ok(Math.abs(out[0].b.value - 0.3) < 1e-9);
  assert.ok(Math.abs(out[0].lift - (0.5 / 0.3 - 1)) < 1e-9);
  assert.equal(out[0].n, 3);
  assert.ok(out[0].p < 0.001);
  // 3 posts per side: significant but fewer than 5 per side -> only "suggestive"
  assert.equal(out[0].conf.level, "suggestive");
  assert.equal(out[1].value, "statement");
});

test("confidence labels follow the stated rules", () => {
  const k = KPI_BY_KEY.hook_rate;
  const big = { posts: 6, den: 5000 };
  assert.equal(confidence({ posts: 2, den: 5000 }, big, { p: 0.001 }, k).level, "thin");
  assert.equal(confidence({ posts: 6, den: 900 }, big, { p: 0.001 }, k).level, "thin");
  assert.equal(confidence(big, big, { p: 0.01 }, k).level, "likely");
  assert.equal(confidence(big, big, { p: 0.08 }, k).level, "suggestive");
  assert.equal(confidence(big, big, { p: 0.3 }, k).level, "unclear");
  assert.equal(confidence({ posts: 6, den: 2000 }, { posts: 6, den: 2000 }, null, KPI_BY_KEY.cpi).level, "untested");
});

test("leverEffects ranks lower-is-better metrics the right way", () => {
  const mk = (v, spend, installs) => ({ ...postRow(P(v + spend), { ads: { source: "meta_ads", spend_usd: spend, installs, views: 1000 } }), look: v });
  const out = leverEffects([mk("paper", 10, 20), mk("night", 10, 5)], "look", "cpi");
  assert.equal(out[0].value, "paper"); // cheaper installs first
  assert.equal(out[0].p, null); // no z-test for cost
});

test("compareVariants refuses a winner before min_sample", () => {
  const rows = [
    { ...postRow(P("a"), { ig: snap(800, 0.5) }), variant_label: "A" },
    { ...postRow(P("b"), { ig: snap(800, 0.8) }), variant_label: "B" },
  ];
  const exp = { metric: "hook_rate", min_sample: 1000, sample_unit: "views", variants: [{ label: "A" }, { label: "B" }] };
  const r = compareVariants(rows, exp);
  assert.equal(r.ready, false);
  assert.equal(r.winner, null);
  assert.match(r.verdict, /Not enough data/);
  assert.equal(r.variants[0].progress, 0.8);
  const r2 = compareVariants(rows, { ...exp, min_sample: 500 });
  assert.equal(r2.ready, true);
  assert.equal(r2.winner, "A");
  const tie = compareVariants([
    { ...postRow(P("a"), { ig: snap(600, 0.5) }), variant_label: "A" },
    { ...postRow(P("b"), { ig: snap(600, 0.51) }), variant_label: "B" },
  ], { ...exp, min_sample: 500 });
  assert.equal(tie.winner, null);
  assert.match(tie.verdict, /no significant difference/);
  assert.match(compareVariants([], exp).verdict, /No data/);
});

test("weekStart is Monday and cadence status", () => {
  assert.equal(weekStart("2026-10-04T23:00:00Z"), "2026-09-28"); // Sunday -> Monday before
  assert.equal(weekStart("2026-09-28T00:00:00Z"), "2026-09-28");
  const c = { organic_per_week_min: 3, organic_per_week_max: 4 };
  assert.equal(cadenceStatus(2, c), "below");
  assert.equal(cadenceStatus(3, c), "ok");
  assert.equal(cadenceStatus(5, c), "above");
});

test("toCSV escapes quotes, commas, newlines and formula prefixes", () => {
  const csv = toCSV(["a", "b"], [{ a: 'x,"y"', b: "=SUM(1)" }, { a: null, b: 3 }]);
  assert.equal(csv, 'a,b\r\n"x,""y""",\'=SUM(1)\r\n,3\r\n');
});

test("sampleSizeFor matches the textbook two-proportion formula", () => {
  // 30% -> 36%: 2.80159^2 * (0.21 + 0.2304) / 0.06^2 = 960.2, rounded up
  assert.equal(sampleSizeFor(0.3, 0.2), 961);
  assert.equal(sampleSizeFor(0, 0.2), null);
  assert.equal(sampleSizeFor(null), null);
});
