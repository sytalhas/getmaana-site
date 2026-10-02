// DEV ONLY. Screenshots of the Studio mock (dev/mock.html) for both
// workspaces, every main view, desktop and phone widths, plus a brand-new
// Mawadda workspace and a Mawadda-only member. Also fails on console errors.
//
//   cd "/Volumes/The Wall/Coding/content-creator-wt" && python3 -m http.server 8799 &
//   PW_DIR=/path/with/node_modules/playwright BASE=http://localhost:8799/studio-site/studio/dev/mock.html \
//     OUT=/tmp/shots node studio/dev/shots.mjs
//
// PW_DIR: a folder where `npm i playwright` was run (kept out of the repo).

import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(process.env.PW_DIR ? `${process.env.PW_DIR.replace(/\/$/, "")}/` : import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.BASE ?? "http://localhost:8799/studio-site/studio/dev/mock.html";
const OUT = process.env.OUT ?? "/tmp/studio-shots";
mkdirSync(OUT, { recursive: true });

const VIEWS = ["dashboard", "calendar", "library", "connections", "settings", "posts", "launch", "alerts", "winning", "experiments"];
const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const CASES = [
  ...["maana", "mawadda"].flatMap((ws) => VIEWS.map((v) => ({ name: `${ws}-${v}`, q: "role=owner", hash: `#/w/${ws}/${v}` }))),
  ...["dashboard", "library", "calendar", "connections", "settings", "posts", "launch"].map((v) => ({ name: `mawadda-empty-${v}`, q: "role=owner&mawadda=empty", hash: `#/w/mawadda/${v}` })),
  { name: "mawadda-only-dashboard", q: "member=mawadda&role=owner", hash: "#/w/mawadda/dashboard" },
  { name: "mawadda-only-forbidden-maana", q: "member=mawadda&role=editor", hash: "#/w/maana/library" },
  { name: "legacy-hash", q: "role=viewer", hash: "#/calendar" },
];

const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const browser = await chromium.launch();
const problems = [];
for (const [sizeName, viewport] of Object.entries(SIZES)) {
  for (const c of CASES) {
    if (only && !only.test(c.name)) continue;
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${BASE}?${c.q}${c.hash}`);
    await page.waitForSelector("#view", { timeout: 10000 }).catch(() => errors.push("no #view"));
    await page.waitForTimeout(1200);
    const file = `${OUT}/${c.name}-${sizeName}.png`;
    await page.screenshot({ path: file, fullPage: sizeName === "desktop" ? false : false });
    const info = await page.evaluate(() => ({
      hash: location.hash, title: document.title, ws: window.studio?.store?.wsId,
      // Brand leaks: the other product's name in the open workspace's view.
      text: document.body.innerText,
    }));
    const other = info.ws === "mawadda" ? /Maana/ : info.ws === "maana" ? /Mawadda Studio/ : null;
    const leak = other && other.test(info.text.replace(/Maana\s*\n?\s*Mawadda|Mawadda\s*\n?\s*Maana/g, "")) ? "brand leak" : null;
    const bad = errors.filter((e) => !/fonts\.g|net::ERR|Failed to load resource/.test(e));
    console.log(`${sizeName.padEnd(7)} ${c.name.padEnd(34)} ${info.hash.padEnd(28)} ${info.title}${bad.length ? `  ERRORS: ${bad.join(" | ")}` : ""}${leak ? `  ${leak}` : ""}`);
    if (bad.length || leak) problems.push(`${c.name} ${sizeName}: ${bad.join(" | ")} ${leak ?? ""}`);
    await page.close();
  }
}
await browser.close();
if (problems.length) {
  console.error(`\n${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`\nAll clean. Screenshots in ${OUT}`);
