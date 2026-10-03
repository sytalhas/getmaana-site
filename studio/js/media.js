// Library media links. Posters, videos and downloads are GitHub release assets
// (https://github.com/<owner>/<repo>/releases/download/<tag>/<name>), which
// stop working without auth once the media repo is private. For those URLs the
// browser asks studio-api POST /media-links {urls} (in the open workspace) for
// short-lived signed links, batched, cached until shortly before they expire,
// and swapped into img/video elements lazily as they come into view. A media
// error (expired link) asks again once. If the API is not available, or the
// server has no media token yet, the original URL is used, so this is a no-op
// while the repo is public. Any other URL (logos, the dev mock's local files)
// is set directly.

const RELEASE = /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//;
const MAX_BATCH = 200; // the server's limit per call
const MARGIN_MS = 60_000; // treat a link as expired this long before it really is
const FALLBACK_MS = 60_000; // after an API failure, use original URLs this long before trying again

let request = async (urls) => (await import("./supa.js")).api("media-links", { urls });
let now = () => Date.now();

const cache = new Map(); // url -> { link, exp }
const waiting = new Map(); // url -> [resolve]
const inflight = new Set(); // urls in a request right now
let queued = new Set();
let timer = null;

/** Test hooks: replace the API call and the clock. */
export function _setMediaRequest(fn, clock) {
  request = fn;
  if (clock) now = clock;
  cache.clear();
}

export function isReleaseUrl(url) {
  return typeof url === "string" && RELEASE.test(url);
}

function fresh(url, minLeftMs = 0) {
  const hit = cache.get(url);
  return hit && hit.exp - now() > minLeftMs ? hit.link : null;
}

/** Drop the cached link for url (after a media error). */
export function forgetMediaUrl(url) {
  cache.delete(url);
}

/** A URL the browser can load now: a signed link for a release asset, else the URL itself. */
export function mediaUrl(url, { minLeftMs = 0 } = {}) {
  if (!isReleaseUrl(url)) return Promise.resolve(url);
  const hit = fresh(url, minLeftMs);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    if (!waiting.has(url)) waiting.set(url, []);
    waiting.get(url).push(resolve);
    if (inflight.has(url)) return;
    queued.add(url);
    timer ??= setTimeout(flush, 0);
  });
}

async function flush() {
  timer = null;
  const urls = [...queued];
  queued = new Set();
  for (const u of urls) inflight.add(u);
  for (let i = 0; i < urls.length; i += MAX_BATCH) {
    const chunk = urls.slice(i, i + MAX_BATCH);
    let links = {}, ttl = FALLBACK_MS;
    try {
      const out = await request(chunk);
      links = out?.links ?? {};
      ttl = Math.max(0, Number(out?.expires_in_s ?? 300) * 1000 - MARGIN_MS);
    } catch (e) {
      console.warn(`media links unavailable, using the original URLs: ${e?.message ?? e}`);
    }
    for (const u of chunk) {
      inflight.delete(u);
      const link = typeof links[u] === "string" && links[u] ? links[u] : u;
      cache.set(u, { link, exp: now() + ttl });
      for (const resolve of waiting.get(u) ?? []) resolve(link);
      waiting.delete(u);
    }
  }
}

// ---- elements ---------------------------------------------------------------

const io = typeof IntersectionObserver === "function"
  ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      load(e.target);
    }
  }, { rootMargin: "400px" })
  : null;

async function load(el, retry = false) {
  const url = el.dataset.mediaUrl;
  const attr = el.dataset.mediaAttr || "src";
  if (!url) return;
  const link = await mediaUrl(url);
  if (el.dataset.mediaUrl !== url) return; // re-pointed meanwhile
  if (el.getAttribute(attr) === link) return;
  const isVideo = el instanceof HTMLMediaElement && attr === "src";
  const t = isVideo && retry ? el.currentTime : 0;
  const playing = isVideo && retry && !el.paused;
  el.setAttribute(attr, link);
  if (isVideo && retry) {
    el.load();
    if (t) el.addEventListener("loadedmetadata", () => { el.currentTime = t; if (playing) el.play().catch(() => {}); }, { once: true });
  }
}

function onError(ev) {
  const el = ev.currentTarget;
  const url = el.dataset.mediaUrl;
  if (!url || !isReleaseUrl(url)) return;
  const last = Number(el.dataset.mediaRetry || 0);
  if (now() - last < 30_000) return; // at most one retry per element every 30 s
  el.dataset.mediaRetry = String(now());
  forgetMediaUrl(url);
  load(el, true);
}

/**
 * Point el's src (or another attribute, for example a video's "poster") at a
 * library URL. Release assets load lazily through signed links; anything else
 * is set at once. Returns el, so it can wrap h(...).
 */
export function mediaSrc(el, url, attr = "src") {
  if (!el) return el;
  if (!url) {
    delete el.dataset.mediaUrl;
    el.removeAttribute(attr);
    return el;
  }
  if (!isReleaseUrl(url)) {
    el.setAttribute(attr, url);
    return el;
  }
  if (attr === "src") {
    el.dataset.mediaUrl = url;
    el.dataset.mediaAttr = attr;
    if (!el.dataset.mediaBound) {
      el.dataset.mediaBound = "1";
      el.addEventListener("error", onError);
    }
    const hit = fresh(url);
    if (hit) el.setAttribute(attr, hit);
    else if (io && el.getAttribute("loading") === "lazy") io.observe(el);
    else load(el);
  } else {
    // Secondary attributes (a video's poster) have no error event: just resolve once.
    const hit = fresh(url);
    if (hit) el.setAttribute(attr, hit);
    else mediaUrl(url).then((link) => el.setAttribute(attr, link));
  }
  return el;
}

/** True when el's src currently shows url (signed or not). */
export function showsMedia(el, url) {
  return url ? (el.dataset.mediaUrl ?? el.getAttribute("src")) === url && el.hasAttribute("src") : !el.hasAttribute("src");
}

/**
 * Make an <a> open or download a library file. The href is a signed link,
 * refreshed when the pointer comes near; a click on a stale link fetches a
 * new one first.
 */
export function mediaLink(a, url) {
  if (!a || !url) return a;
  a.setAttribute("href", url);
  if (!isReleaseUrl(url)) return a;
  const refresh = () => mediaUrl(url, { minLeftMs: 30_000 }).then((link) => a.setAttribute("href", link));
  refresh();
  a.addEventListener("pointerenter", refresh);
  a.addEventListener("focus", refresh);
  a.addEventListener("click", (ev) => {
    const hit = fresh(url, 15_000);
    if (hit) {
      a.setAttribute("href", hit);
      return;
    }
    ev.preventDefault();
    const w = window.open("", "_blank");
    mediaUrl(url, { minLeftMs: 30_000 }).then((link) => {
      a.setAttribute("href", link);
      if (w) {
        w.opener = null;
        w.location.href = link;
      } else {
        location.href = link;
      }
    });
  });
  return a;
}
