// node --test studio/test/*.test.mjs   (this file needs Playwright: PW_DIR=<folder with node_modules/playwright>;
// without it the test is skipped)
// Studio's dialogs in a real browser against the dev mock (content-creator LRN-47; owner 2026-10-07: "when im in a
// modal i can be taken to other pages and navigation is annoying"): browser Back closes the dialog and keeps the
// page, Escape closes it and focus returns to its button, the page behind does not scroll, the footer buttons stay
// in view, a link inside closes the dialog before the page changes, and the carousel sound and launch screens read
// plainly (summary first, no scores, rule ids or policy names).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let chromium = null;
try {
  const require = createRequire(process.env.PW_DIR ? `${process.env.PW_DIR.replace(/\/$/, "")}/` : import.meta.url);
  ({ chromium } = require("playwright"));
} catch { /* skipped below */ }

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon" };
const JARGON = /[A-Z]{2}-\d{2}|policy|score \d|\bcml\b|nasheed_vocal_only|inbox_draft/;

test("Studio dialogs behave like dialogs, and the carousel screens read plainly", { skip: !chromium && "set PW_DIR to a folder with playwright" }, async () => {
  const server = createServer(async (req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    let body;
    try { body = await readFile(p); } catch { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] ?? "application/octet-stream" }).end(body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/studio/dev/mock.html?role=owner`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 720 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${base}#/w/maana/posts`);
    const launch = page.getByRole("button", { name: "Check and launch all" }).first();
    await launch.waitFor({ timeout: 15000 });

    // Check and launch all: plain summary first, details collapsed
    await launch.click();
    await page.waitForSelector("dialog.modal[open] .launch-summary");
    const text = await page.innerText("dialog.modal[open] .modal-body");
    assert.doesNotMatch(text.split("Details")[0], JARGON);
    assert.equal(await page.evaluate(() => document.querySelector("dialog.modal[open] details").open), false);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("modal-open")), true);
    const foot = await page.locator("dialog.modal[open] .modal-foot").boundingBox();
    assert.ok(foot && foot.y + foot.height <= 720, "the footer buttons are in view");

    // Back closes the dialog, the page stays
    await page.goBack();
    await page.waitForSelector("dialog.modal", { state: "detached" });
    assert.match(await page.evaluate(() => location.hash), /^#\/w\/maana\/posts/);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("modal-open")), false);

    // Escape closes it, and focus returns to the button
    await launch.click();
    await page.waitForSelector("dialog.modal[open]");
    await page.keyboard.press("Escape");
    await page.waitForSelector("dialog.modal", { state: "detached" });
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Check and launch all");
    await page.waitForTimeout(100);
    assert.match(await page.evaluate(() => location.hash), /^#\/w\/maana\/posts/);

    // A carousel draft's Details: the sound reads plainly; a link inside closes the dialog before the page changes
    const id = await page.evaluate(() => [...window.studio.store.posts.values()].find((p) => p.format === "carousel" && p.platform === "instagram")?.id);
    assert.ok(id, "the mock has a carousel draft");
    await page.evaluate((pid) => { location.hash = `#/w/maana/posts?post=${pid}`; }, id);
    await page.waitForSelector("dialog.modal[open] .audio-card");
    assert.doesNotMatch(await page.innerText("dialog.modal[open] .audio-card"), JARGON);
    await page.locator("dialog.modal[open] a[href*='library']").first().click();
    await page.waitForFunction(() => location.hash.includes("/library"));
    await page.waitForTimeout(200);
    assert.equal(await page.locator("dialog.modal[open]").count(), 0, "no dialog left open over another page");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
