// node --test studio/test/*.test.mjs   (this file needs Playwright: PW_DIR=<folder with node_modules/playwright>;
// without it the test is skipped)
// Studio > Reports in a real browser against the dev mock (dev/mock-supa.js answers the four word-report functions):
// the sidebar badge counts new reports, the list and its filter tabs, a card's reports, Decline needs a note, Mark
// shipped needs a confirmation, shipped reports are final, a learner's text stays text, the "not set up yet" page shows
// the setup command, viewers and Mawadda do not get the view, a phone has no sideways scroll, and the view follows
// the workspace palette.
// A second test covers the optional contact: "✉ contact ok" with a mailto link on a report whose sender agreed, the
// Contributors view (ranking, mailto links, the cards they reported, triage shows up there), its own "not set up yet" page
// with the exact command, an address that tries to add a mail header, and access.
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
const SETUP = "! supabase db query --linked --project-ref vymyqrxvpzlhzpvsuhya -f supabase/migrations/20261024170000_studio_word_reports.sql";
const CONTACT_SETUP = "! supabase db query --linked --project-ref vymyqrxvpzlhzpvsuhya -f supabase/migrations/20261024220000_report_contact.sql";

/** A static server for the repo, a browser, and `open(query, hash, viewport)` for a page of the dev mock. */
async function studio() {
  const server = createServer(async (req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    let body;
    try { body = await readFile(p); } catch { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] ?? "application/octet-stream" }).end(body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/studio/dev/mock.html`;
  const browser = await chromium.launch();
  const errors = [];
  const open = async (query, hash, viewport = { width: 1280, height: 800 }) => {
    const page = await browser.newPage({ viewport });
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|net::ERR|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on("dialog", (d) => { errors.push(`unexpected browser dialog: ${d.message()}`); d.dismiss(); });
    // The mock page has <base href="../">, so a bare "#/w/..." link would leave it for the real Studio page: keep hash links here.
    await page.addInitScript(() => document.addEventListener("click", (e) => {
      const a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || (a.target && a.target !== "_self")) return;
      e.preventDefault();
      location.hash = a.getAttribute("href");
    }));
    await page.goto(`${base}?${query}${hash}`);
    return page;
  };
  return { base, errors, open, close: async () => { await browser.close(); server.close(); } };
}

test("Studio > Reports: badge, list, card page, triage actions, not set up, access", { skip: !chromium && "set PW_DIR to a folder with playwright" }, async () => {
  const { base, errors, open, close } = await studio();
  const num = (s) => Number(String(s).replace(/\D/g, ""));
  try {
    // ---- the list, its tabs and the badge --------------------------------------------------------------------------
    let page = await open("role=owner", "#/w/maana/reports");
    await page.waitForSelector(".wr-row");
    const nav = page.locator('nav.side a[data-view="reports"]');
    assert.equal((await nav.innerText()).split("\n")[0].trim(), "Reports");
    const newTab = num(await page.locator(".wr-tab", { hasText: /^New/ }).innerText());
    assert.ok(newTab > 0);
    assert.equal(num(await page.locator("#report-count").innerText()), newTab, "the badge counts new reports");
    assert.match(await page.locator(".wr-rule").innerText(), /^Fix a card only from a cited source \(docs\/reports\/TRIAGE\.md\)\.$/);
    assert.deepEqual(await page.locator(".wr-tab").evaluateAll((els) => els.map((e) => e.firstChild.textContent)),
      ["Open", "New", "Accepted", "Shipped", "Declined", "All"]);
    const rows = page.locator(".wr-row");
    assert.equal(await rows.count(), 5);
    assert.match(await rows.first().innerText(), /ʿabd[\s\S]*5 reports/, "the most reported card comes first");
    assert.equal(await rows.first().locator(".wr-ar").getAttribute("lang"), "ar");
    assert.equal(await rows.first().locator(".wr-ar").getAttribute("dir"), "rtl");
    assert.match(await rows.first().locator(".wr-ar").evaluate((e) => getComputedStyle(e).fontFamily), /Amiri/, "Arabic uses the Arabic face");
    await page.getByRole("tab", { name: /^Declined/ }).click();
    await page.waitForFunction(() => document.querySelectorAll(".wr-row").length === 2);
    assert.deepEqual((await rows.allInnerTexts()).map((t) => t.match(/ʿabd|kitāb/)?.[0]).sort(), ["kitāb", "ʿabd"]);
    await page.getByRole("tab", { name: /^All/ }).click();
    await page.waitForFunction(() => document.querySelectorAll(".wr-row").length === 6);

    // ---- one card ----------------------------------------------------------------------------------------------------
    await page.getByRole("tab", { name: /^Open/ }).click();
    await page.waitForFunction(() => document.querySelectorAll(".wr-row").length === 5);
    await rows.first().click();
    await page.waitForSelector(".wr-report");
    assert.match(page.url(), /#\/w\/maana\/reports\?card=abd/);
    assert.equal(await page.locator(".wr-report").count(), 5, "the Open tab of this card shows its 5 open reports");
    assert.equal(await page.locator(".wr-bar").count(), 0, "no action bar until something is ticked");
    assert.match(await page.locator(".wr-facts").innerText(), /servant[\s\S]*1:5/i);
    await page.getByRole("tab", { name: /^All/ }).click();
    assert.equal(await page.locator(".wr-report").count(), 7);
    const shipped = page.locator(".wr-report.final");
    assert.equal(await shipped.count(), 1);
    assert.equal(await shipped.locator("input[type=checkbox]").isDisabled(), true, "a shipped report cannot be ticked");
    await page.getByRole("tab", { name: /^Open/ }).click();

    // ---- Decline needs a note ----------------------------------------------------------------------------------------
    const boxes = page.locator(".wr-report input[type=checkbox]");
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    const bar = page.locator(".wr-bar");
    await bar.waitFor();
    assert.match(await bar.innerText(), /2 selected/);
    const barBox = await bar.boundingBox();
    assert.ok(barBox.y + barBox.height <= 800 && barBox.y >= 0, "the action bar stays in view");
    await page.getByRole("button", { name: "Decline…" }).click();
    const dlg = page.locator("dialog.modal[open]");
    await dlg.waitFor();
    const declineBtn = dlg.getByRole("button", { name: "Decline 2 reports" });
    assert.equal(await declineBtn.isDisabled(), true, "no note, no decline");
    await dlg.locator("textarea").fill("   ");
    assert.equal(await declineBtn.isDisabled(), true, "a blank note is no note");
    await dlg.locator("textarea").fill("Kept as is: the verse uses the word for ownership.");
    assert.equal(await declineBtn.isDisabled(), false);
    await page.goBack();                                   // Back closes the dialog and keeps the page (ui.js modal)
    await page.waitForSelector("dialog.modal", { state: "detached" });
    assert.equal(await page.locator(".wr-report.selected").count(), 2, "cancelling changes nothing");
    const badgeBefore = num(await page.locator("#report-count").innerText());
    await page.getByRole("button", { name: "Decline…" }).click();
    await dlg.waitFor();
    await dlg.locator("textarea").fill("Kept as is: the verse uses the word for ownership.");
    await dlg.getByRole("button", { name: "Decline 2 reports" }).click();
    await page.waitForSelector("dialog.modal", { state: "detached" });
    await page.waitForFunction(() => /2 reports declined/.test(document.getElementById("toasts").innerText));
    await page.waitForFunction(() => document.querySelectorAll(".wr-report").length === 3);   // the page reloads its reports after saving
    assert.equal(await page.locator(".wr-bar").count(), 0, "the ticks are cleared");
    await page.waitForFunction((n) => document.getElementById("report-count").innerText === String(n), badgeBefore - 2);   // the badge follows
    await page.getByRole("tab", { name: /^Declined/ }).click();
    assert.equal(await page.locator(".wr-report").count(), 3);
    assert.match(await page.locator(".wr-resolution").first().innerText(), /Kept as is: the verse uses the word for ownership\./);

    // ---- Accept is one click and reversible; a declined report can be accepted again ---------------------------------
    await page.locator(".wr-report input[type=checkbox]").first().check();
    await page.getByRole("button", { name: "Accept" }).click();
    await page.waitForFunction(() => /1 report accepted/.test(document.getElementById("toasts").innerText));
    await page.waitForFunction(() => document.querySelectorAll(".wr-report").length === 2);   // it left the Declined tab

    // ---- Mark shipped needs a confirmation ------------------------------------------------------------------------------
    await page.getByRole("tab", { name: /^Open/ }).click();
    await page.locator(".wr-report input[type=checkbox]").first().check();
    await page.getByRole("button", { name: "Mark shipped…" }).click();
    await dlg.waitFor();
    assert.match(await dlg.innerText(), /fix must already be in an app build that has been released, or in an active row of content_patches/);
    assert.equal(await dlg.getByRole("button", { name: "Mark shipped" }).isDisabled(), true, "the fix must be confirmed live first");
    await dlg.getByRole("checkbox").check();
    assert.equal(await dlg.getByRole("button", { name: "Mark shipped" }).isDisabled(), false);
    await dlg.locator("textarea").fill("Fixed in version 1.0.3");
    await dlg.getByRole("button", { name: "Mark shipped" }).click();
    await page.waitForSelector("dialog.modal", { state: "detached" });
    await page.waitForFunction(() => /1 report marked shipped/.test(document.getElementById("toasts").innerText));
    await page.waitForFunction(() => document.querySelectorAll(".wr-report").length === 3);   // 4 open before, 1 shipped now
    await page.getByRole("tab", { name: /^Shipped/ }).click();
    assert.equal(await page.locator(".wr-report.final").count(), 2, "shipped reports are final");
    assert.match(await page.locator(".wr-report.final").first().innerText(), /Fixed in version 1\.0\.3/);

    // ---- a learner's text stays text -------------------------------------------------------------------------------------
    await page.goto(`${base}?role=owner#/w/maana/reports?card=salah`);
    await page.waitForSelector(".wr-report");
    assert.match(await page.locator(".wr-notes").allInnerTexts().then((t) => t.join("\n")), /<img src=x onerror=alert\(1\)>/);
    assert.equal(await page.locator("img[src=x], .wr-notes b").count(), 0, "no markup came out of a note");

    // ---- the view follows the workspace palette --------------------------------------------------------------------------
    await page.goto(`${base}?role=owner#/w/maana/reports`);
    await page.waitForSelector(".wr-row");
    await page.evaluate(() => {
      const r = document.documentElement.style;
      r.setProperty("--card", "#101820"); r.setProperty("--paper", "#0b1016"); r.setProperty("--navy", "#e8eef5"); r.setProperty("--line", "#2a3642");
    });
    const painted = await page.evaluate(() => ({
      row: getComputedStyle(document.querySelector(".wr-row")).backgroundColor,
      rowText: getComputedStyle(document.querySelector(".wr-row")).color,
      rule: getComputedStyle(document.querySelector(".wr-rule")).backgroundColor,
      page: getComputedStyle(document.body).backgroundColor,
    }));
    assert.deepEqual(painted, { row: "rgb(16, 24, 32)", rowText: "rgb(232, 238, 245)", rule: "rgb(16, 24, 32)", page: "rgb(11, 16, 22)" });
    await page.close();

    // ---- not set up yet: a calm message with the exact command ------------------------------------------------------------
    page = await open("role=owner&reports=missing", "#/w/maana/reports");
    await page.waitForSelector(".wr-setup");
    assert.match(await page.locator(".wr-setup h2").innerText(), /not set up yet/);
    assert.equal(await page.locator(".wr-setup code").innerText(), SETUP);
    assert.equal(await page.locator(".wr-tab").count(), 0, "no tabs without the functions");
    assert.equal(await page.locator("#report-count").innerText(), "", "no badge without the functions");
    assert.equal(await page.locator(".error-box").count(), 0, "not an error page");
    await page.goto(`${base}?role=owner&reports=missing#/w/maana/reports?card=abd`);
    await page.waitForSelector(".wr-setup");
    await page.close();

    // ---- empty, and refused by the database -------------------------------------------------------------------------------
    page = await open("role=owner&reports=empty", "#/w/maana/reports");
    await page.waitForSelector(".empty");
    assert.match(await page.locator(".empty").innerText(), /No open reports/);
    assert.equal(await page.locator("#report-count").innerText(), "");
    await page.close();
    page = await open("role=owner&reports=denied", "#/w/maana/reports");
    await page.waitForSelector('.notice[role="alert"]');
    assert.match(await page.locator('.notice[role="alert"]').innerText(), /owners and editors of Maana/);
    await page.close();

    // ---- who gets the view ------------------------------------------------------------------------------------------------
    page = await open("role=viewer", "#/w/maana/reports");
    await page.waitForSelector(".notice");
    assert.equal(await page.locator('nav.side a[data-view="reports"]').count(), 0, "viewers have no Reports item");
    assert.match(await page.locator(".notice").innerText(), /owners and editors/);
    await page.close();
    page = await open("role=editor", "#/w/maana/reports");
    await page.waitForSelector(".wr-row");
    assert.equal(await page.locator('nav.side a[data-view="reports"]').count(), 1, "editors do");
    await page.close();
    page = await open("role=owner", "#/w/mawadda/reports");
    await page.waitForSelector(".notice");
    assert.equal(await page.locator('nav.side a[data-view="reports"]').count(), 0, "Mawadda has no Reports item");
    assert.match(await page.locator(".notice").innerText(), /live in the Maana workspace/);
    await page.close();
    page = await open("role=owner", "#/w/maana/reports");
    await page.waitForSelector(".wr-row");
    await page.locator("nav.side .ws-tab", { hasText: "Mawadda" }).click();
    await page.waitForFunction(() => location.hash === "#/w/mawadda/dashboard");
    await page.close();

    // ---- a phone: no sideways scroll, the tabs scroll instead, everything is reachable ------------------------------------------
    page = await open("role=owner", "#/w/maana/reports", { width: 390, height: 844 });
    await page.waitForSelector(".wr-row");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "list: no sideways scroll");
    await page.locator(".wr-row").first().click();
    await page.waitForSelector(".wr-report");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "card page: no sideways scroll");
    await page.locator(".wr-report input[type=checkbox]").first().check();
    const phoneBar = await page.locator(".wr-bar").boundingBox();
    assert.ok(phoneBar.y + phoneBar.height <= 844 && phoneBar.x >= 0 && phoneBar.x + phoneBar.width <= 390, "the action bar fits the phone");
    await page.getByRole("button", { name: "Decline…" }).click();
    await page.waitForSelector("dialog.modal[open]");
    const foot = await page.locator("dialog.modal[open] .modal-foot").boundingBox();
    assert.ok(foot.y + foot.height <= 844, "the dialog's buttons stay in view");
    await page.close();
    page = await open("role=owner&reports=missing", "#/w/maana/reports", { width: 390, height: 844 });
    await page.waitForSelector(".wr-setup");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "setup page: no sideways scroll");
    await page.close();

    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

test("Studio > Reports > Contributors: the contact mark, the people who agreed, mailto links, not set up yet, access", { skip: !chromium && "set PW_DIR to a folder with playwright" }, async () => {
  const { errors, open, close } = await studio();
  const names = (page) => page.locator(".wr-person-mail").allInnerTexts().then((t) => t.map((x) => x.replace("✉", "").trim()));
  try {
    // ---- the mark on a report: only where the learner agreed ---------------------------------------------------------------
    let page = await open("role=owner", "#/w/maana/reports?card=abd");
    await page.waitForSelector(".wr-report");
    const marks = page.locator(".wr-contact-link");
    assert.equal(await marks.count(), 4, "4 of this card's 5 open reports came from people who agreed to be contacted");
    assert.equal(await marks.first().innerText(), "✉ contact ok");
    assert.equal(await marks.first().getAttribute("href"), "mailto:amina.k@example.com?subject=About%20your%20Maana%20report%20on%20%CA%BFabd");
    assert.match(await page.locator(".wr-report").first().locator(".wr-contact").innerText(), /contact ok[\s\S]*amina\.k@example\.com/, "the address is shown next to the mark");
    assert.equal(await page.locator(".wr-report").nth(2).locator(".wr-contact").count(), 0, "a report whose sender did not agree has no mark and no address");
    assert.doesNotMatch(await page.locator(".wr-report").nth(2).innerText(), /@/);
    await page.close();

    // ---- the Contributors view, from the list --------------------------------------------------------------------------------
    page = await open("role=owner", "#/w/maana/reports");
    await page.waitForSelector(".wr-row");
    assert.deepEqual(await page.locator(".wr-mode").allInnerTexts(), ["By card", "Contributors"]);
    assert.equal(await page.locator(".wr-mode.active").innerText(), "By card");
    await page.getByRole("link", { name: "Contributors" }).click();
    await page.waitForSelector(".wr-person");
    assert.match(page.url(), /#\/w\/maana\/reports\?view=contributors/);
    assert.equal(await page.locator(".wr-mode.active").innerText(), "Contributors");
    assert.equal(await page.locator(".wr-mode.active").getAttribute("aria-current"), "page");
    assert.equal(await page.locator(".wr-consent").innerText(), "People who agreed to be contacted. Use this only to reply or invite them to help.");
    assert.equal(await page.locator(".wr-rule").count(), 0, "the fix-a-card rule belongs to the cards, not to this page");
    assert.match(await page.locator(".view-head").innerText(), /Nothing is sent from here/);
    assert.deepEqual(await names(page), ["amina.k@example.com", "layla@example.net", "yusuf.m@example.org", "sam+maana@example.com"],
      "ranked by accepted + shipped, then total, then the latest report (Sam has 3 reports and none accepted or shipped)");
    assert.deepEqual(await page.locator(".wr-person-mail").evaluateAll((els) => els.map((e) => e.getAttribute("href"))),
      ["mailto:amina.k@example.com", "mailto:layla@example.net", "mailto:yusuf.m@example.org", "mailto:sam%2Bmaana@example.com"]);
    assert.match(await page.locator(".wr-summary").innerText(), /^4 people agreed to be contacted, 10 reports in all\. Ranked by accepted plus shipped reports, then by total\.$/);
    const first = page.locator(".wr-person").first();
    assert.match(await first.innerText(), /3 reports[\s\S]*1 shipped, 2 open/);
    assert.match(await first.innerText(), /Reports from Oct \d+ to Oct \d+/);
    assert.equal(await first.locator(".wr-cardchip").count(), 1);
    assert.match(await first.locator(".wr-cardchip").innerText(), /ʿabd[\s\S]*×3/);
    assert.equal(await first.locator(".wr-cardchip .wr-ar").getAttribute("lang"), "ar");
    assert.equal(await first.locator(".wr-cardchip .wr-ar").getAttribute("dir"), "rtl");
    assert.equal(await page.locator(".wr-person").nth(1).locator(".wr-cardchip").count(), 2, "Layla reported two cards");
    // a card they reported opens on its page, showing every status
    await page.locator(".wr-person").nth(1).locator(".wr-cardchip", { hasText: "kitāb" }).click();
    await page.waitForSelector(".wr-report");
    assert.match(page.url(), /#\/w\/maana\/reports\?card=kitab&tab=all/);
    assert.equal(await page.locator(".wr-report").count(), 2);
    assert.equal(await page.locator(".wr-contact-link").count(), 2, "both of this card's reports came from people who agreed");

    // ---- triage shows up there: accept Amina's newest report on abd, then look again ---------------------------------------
    await page.goto(`${page.url().split("#")[0]}#/w/maana/reports?card=abd`);
    await page.waitForSelector(".wr-report");
    await page.locator(".wr-report input[type=checkbox]").first().check();
    await page.getByRole("button", { name: "Accept" }).click();
    await page.waitForFunction(() => /1 report accepted/.test(document.getElementById("toasts").innerText));
    await page.goto(`${page.url().split("#")[0]}#/w/maana/reports?view=contributors`);
    await page.waitForSelector(".wr-person");
    assert.match(await page.locator(".wr-person").first().innerText(), /amina\.k@example\.com[\s\S]*3 reports[\s\S]*1 accepted, 1 shipped, 1 open/);
    // and back to the cards
    await page.getByRole("link", { name: "By card" }).click();
    await page.waitForSelector(".wr-row");
    assert.equal(await page.locator(".wr-mode.active").innerText(), "By card");
    await page.close();

    // ---- an address that tries to add a mail header is only text, and the link keeps it inside the address -------------------
    page = await open("role=owner&contact=hostile", "#/w/maana/reports?card=yawm&tab=all");
    await page.waitForSelector(".wr-report");
    const hostile = page.locator(".wr-contact-link");
    assert.equal(await hostile.count(), 1);
    assert.equal(await hostile.getAttribute("href"), "mailto:x@y.co%3Fbcc%3Da%2540evil.co?subject=About%20your%20Maana%20report%20on%20yawm");
    assert.equal(await page.locator(".wr-contact-who").innerText(), "x@y.co?bcc=a%40evil.co");
    await page.goto(`${page.url().split("#")[0]}#/w/maana/reports?view=contributors`);
    await page.waitForSelector(".wr-person");
    assert.equal(await page.locator(".wr-person").count(), 5);
    assert.ok((await page.locator(".wr-person-mail").evaluateAll((els) => els.map((e) => e.getAttribute("href")))).includes("mailto:x@y.co%3Fbcc%3Da%2540evil.co"));
    await page.close();

    // ---- before the optional-email migration: the reports look as before; Contributors says so, with the command -----------------
    page = await open("role=owner&reports=nocontact", "#/w/maana/reports?view=contributors");
    await page.waitForSelector(".wr-setup");
    assert.match(await page.locator(".wr-setup h2").innerText(), /Contributors are not set up yet/);
    assert.equal(await page.locator(".wr-setup code").innerText(), CONTACT_SETUP);
    assert.equal(await page.locator(".error-box").count(), 0, "not an error page");
    assert.equal(await page.locator(".wr-person").count(), 0);
    assert.equal(await page.locator(".wr-consent").innerText(), "People who agreed to be contacted. Use this only to reply or invite them to help.");
    await page.getByRole("link", { name: "By card" }).click();
    await page.waitForSelector(".wr-row");
    assert.equal(await page.locator(".wr-setup").count(), 0, "the cards work without it");
    await page.locator(".wr-row").first().click();
    await page.waitForSelector(".wr-report");
    assert.equal(await page.locator(".wr-contact").count(), 0, "no contact marks without the new columns");
    await page.close();
    page = await open("role=owner&reports=missing", "#/w/maana/reports?view=contributors");
    await page.waitForSelector(".wr-setup");
    assert.equal(await page.locator(".wr-setup code").innerText(), CONTACT_SETUP);
    await page.close();

    // ---- nobody yet, refused by the database, and who gets the view ---------------------------------------------------------------
    page = await open("role=owner&reports=empty", "#/w/maana/reports?view=contributors");
    await page.waitForSelector(".empty");
    assert.match(await page.locator(".empty").innerText(), /Nobody has agreed to be contacted yet/);
    assert.equal(await page.locator(".wr-summary").innerText(), "");
    await page.close();
    page = await open("role=owner&reports=denied", "#/w/maana/reports?view=contributors");
    await page.waitForSelector('.notice[role="alert"]');
    assert.match(await page.locator('.notice[role="alert"]').innerText(), /owners and editors of Maana/);
    await page.close();
    page = await open("role=viewer", "#/w/maana/reports?view=contributors");
    await page.waitForSelector(".notice");
    assert.equal(await page.locator(".wr-person").count(), 0, "viewers never see an address");
    assert.match(await page.locator(".notice").innerText(), /owners and editors/);
    await page.close();
    page = await open("role=editor", "#/w/maana/reports?view=contributors");
    await page.waitForSelector(".wr-person");
    await page.close();
    page = await open("role=owner", "#/w/mawadda/reports?view=contributors");
    await page.waitForSelector(".notice");
    assert.equal(await page.locator(".wr-person").count(), 0, "Mawadda has no word reports");
    await page.close();

    // ---- a phone: nothing sideways, every row inside the screen ---------------------------------------------------------------------
    page = await open("role=owner", "#/w/maana/reports?view=contributors", { width: 390, height: 844 });
    await page.waitForSelector(".wr-person");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "contributors: no sideways scroll");
    for (const box of await page.locator(".wr-person").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.right]; }))) {
      assert.ok(box[0] >= 0 && box[1] <= 390, `a row fits the phone: ${box}`);
    }
    await page.close();
    page = await open("role=owner&reports=nocontact", "#/w/maana/reports?view=contributors", { width: 390, height: 844 });
    await page.waitForSelector(".wr-setup");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "contributors setup page: no sideways scroll");
    await page.close();
    page = await open("role=owner", "#/w/maana/reports?card=abd", { width: 390, height: 844 });
    await page.waitForSelector(".wr-report");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "card page with contact marks: no sideways scroll");
    await page.close();

    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});
