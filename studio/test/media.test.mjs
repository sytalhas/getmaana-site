// node --test studio/test/
import test from "node:test";
import assert from "node:assert/strict";
import { mediaUrl, isReleaseUrl, forgetMediaUrl, _setMediaRequest } from "../js/media.js";

const REL = (n) => `https://github.com/sytalhas/maana-media/releases/download/library/${n}`;

function fake(handler) {
  const calls = [];
  let t = 1_000_000;
  const clock = () => t;
  _setMediaRequest(async (urls) => {
    calls.push(urls);
    return handler(urls);
  }, clock);
  return { calls, advance: (ms) => { t += ms; } };
}
const sign = (urls) => ({ links: Object.fromEntries(urls.map((u) => [u, `${u}?sig=1`])), expires_in_s: 300 });

test("only GitHub release downloads are signed", async () => {
  const f = fake(sign);
  assert.equal(isReleaseUrl(REL("a.jpg")), true);
  assert.equal(isReleaseUrl("https://github.com/sytalhas/maana-media/blob/main/a.jpg"), false);
  assert.equal(await mediaUrl("../apple-touch-icon.png"), "../apple-touch-icon.png");
  assert.equal(f.calls.length, 0);
});

test("requests in the same tick go out as one batch, deduplicated", async () => {
  const f = fake(sign);
  const out = await Promise.all([mediaUrl(REL("a.jpg")), mediaUrl(REL("b.mp4")), mediaUrl(REL("a.jpg"))]);
  assert.deepEqual(out, [`${REL("a.jpg")}?sig=1`, `${REL("b.mp4")}?sig=1`, `${REL("a.jpg")}?sig=1`]);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0], [REL("a.jpg"), REL("b.mp4")]);
});

test("cached until shortly before expiry, then asked again", async () => {
  const f = fake(sign);
  await mediaUrl(REL("a.jpg"));
  f.advance(200_000); // 3m20s of a 5 min link: still good
  await mediaUrl(REL("a.jpg"));
  assert.equal(f.calls.length, 1);
  f.advance(50_000); // 4m10s: inside the one minute margin
  await mediaUrl(REL("a.jpg"));
  assert.equal(f.calls.length, 2);
});

test("a forgotten link (media error) is fetched again", async () => {
  const f = fake(sign);
  await mediaUrl(REL("a.jpg"));
  forgetMediaUrl(REL("a.jpg"));
  await mediaUrl(REL("a.jpg"));
  assert.equal(f.calls.length, 2);
});

test("falls back to the original URL when the API fails", async () => {
  const f = fake(() => { throw Object.assign(new Error("404 unknown route"), { status: 404 }); });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await mediaUrl(REL("a.jpg")), REL("a.jpg"));
    await mediaUrl(REL("a.jpg")); // cached fallback, no second call right away
    assert.equal(f.calls.length, 1);
  } finally {
    console.warn = warn;
  }
});

test("a URL the server leaves out keeps its original", async () => {
  fake(() => ({ links: {}, expires_in_s: 300 }));
  assert.equal(await mediaUrl(REL("x.jpg")), REL("x.jpg"));
});

test("more than 200 URLs are split into batches", async () => {
  const f = fake(sign);
  await Promise.all(Array.from({ length: 450 }, (_, i) => mediaUrl(REL(`f${i}.jpg`))));
  assert.deepEqual(f.calls.map((c) => c.length), [200, 200, 50]);
});
