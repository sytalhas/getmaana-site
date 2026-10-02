// Studio shell: sign-in gate, workspace switcher, navigation, hash router,
// live store. One Studio serves several products (Maana, Mawadda); each is a
// workspace with its own data, brand and team roles.
//
// Routes: #/w/<workspace>/<view>[/rest][?query]. Old links (#/<view>) are sent
// to the open workspace, else the last one used on this device, else the
// first one the user may open. Each view is a module in ./views/ exporting
// `render(root, params)`, which may return a cleanup function. Views
// re-render themselves on store changes.

import { supa } from "./supa.js";
import { store, loadWorkspaces, openWorkspace, href } from "./store.js";
import { h, clear, toast, fmt } from "./ui.js";

const VIEWS = [
  { key: "dashboard", label: "Dashboard", module: "./views/dashboard.js" },
  { key: "library", label: "Library", module: "./views/library.js" },
  { key: "launch", label: "Launch", module: "./views/launch.js", edit: true },
  { key: "posts", label: "Posts", module: "./views/posts.js" },
  { key: "experiments", label: "Experiments", module: "./views/experiments.js" },
  { key: "winning", label: "What's winning", module: "./views/winning.js" },
  { key: "calendar", label: "Calendar", module: "./views/calendar.js" },
  { key: "connections", label: "Connections", module: "./views/connections.js" },
  { key: "alerts", label: "Alerts", module: "./views/alerts.js" },
  { key: "settings", label: "Settings", module: "./views/settings.js" },
];

const LAST_WS_KEY = "studio.lastWorkspace";
const app = document.getElementById("app");
let cleanup = null;
let unsubscribe = null;
let switching = null;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  let ws = null;
  if (parts[0] === "w") {
    ws = parts[1] ?? null;
    parts.splice(0, 2);
  }
  const [view = "dashboard", ...rest] = parts;
  return { ws, view, rest, query, params: Object.fromEntries(new URLSearchParams(query)) };
}

function lastWorkspace() {
  try { return localStorage.getItem(LAST_WS_KEY); } catch { return null; }
}
function rememberWorkspace(id) {
  try { localStorage.setItem(LAST_WS_KEY, id); } catch { /* private window: fine */ }
}

/** The workspace to open when the URL names none (or one the user cannot open). */
function defaultWorkspace() {
  const ids = store.workspaces.map((w) => w.id);
  if (store.wsId && ids.includes(store.wsId)) return store.wsId;
  const last = lastWorkspace();
  if (last && ids.includes(last)) return last;
  if (ids.includes("maana")) return "maana";
  return ids[0] ?? null;
}

// ---------------------------------------------------------------------------
// Theme: palette, fonts and title from the workspace row
// ---------------------------------------------------------------------------

function applyTheme(ws) {
  let style = document.getElementById("ws-theme");
  if (!style) {
    style = document.createElement("style");
    style.id = "ws-theme";
    document.head.append(style);
  }
  const vars = Object.entries(ws?.palette ?? {})
    .filter(([k, v]) => /^--[a-z0-9-]+$/i.test(k) && typeof v === "string" && /^[#a-z0-9(),.%\s-]+$/i.test(v))
    .map(([k, v]) => `${k}: ${v};`);
  const f = ws?.fonts ?? {};
  const q = (s) => `"${String(s).replace(/["\\]/g, "")}"`;
  if (f.display) vars.push(`--serif: ${q(f.display)}, Georgia, serif;`);
  if (f.body) vars.push(`--sans: ${q(f.body)}, system-ui, -apple-system, "Segoe UI", sans-serif;`);
  style.textContent = `:root { ${vars.join(" ")} }`;
  if (f.css && /^https:\/\/fonts\.googleapis\.com\//.test(f.css)) {
    let link = document.getElementById("ws-fonts");
    if (!link) {
      link = document.createElement("link");
      link.id = "ws-fonts";
      link.rel = "stylesheet";
      document.head.append(link);
    }
    if (link.href !== f.css) link.href = f.css;
  }
  document.title = ws?.copy?.studio_name ?? `${ws?.name ?? ""} Studio`.trim();
  document.documentElement.dataset.workspace = ws?.id ?? "";
}

function logo(ws, cls = "") {
  return ws?.logo_url
    ? h(`img.ws-logo${cls}`, { src: ws.logo_url, alt: "" })
    : h(`span.ws-logo.ws-mono${cls}`, (ws?.short_name ?? ws?.name ?? "?").slice(0, 1));
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

function renderSignIn(message) {
  const email = h("input", { type: "email", required: true, placeholder: "you@example.com", autocomplete: "email" });
  const status = h("p.hint", message ?? "");
  const form = h("form.signin-card",
    { onsubmit: async (e) => {
      e.preventDefault();
      status.textContent = "Sending link";
      const redirect = location.origin + location.pathname;
      const { error } = await supa.auth.signInWithOtp({
        email: email.value.trim().toLowerCase(),
        options: { emailRedirectTo: redirect, shouldCreateUser: true },
      });
      status.textContent = error ? `Could not send: ${error.message}` : "Check your email for the sign-in link.";
    } },
    h("img.signin-mark", { src: "../apple-touch-icon.png", alt: "" }),
    h("h1", "Studio"),
    h("p", "Content for Maana and Mawadda. Team sign-in: you get a one-time link by email."),
    h("label.field", h("span.field-label", "Email"), email),
    h("button.btn.primary.block", { type: "submit" }, "Email me a sign-in link"),
    status);
  clear(app, h("main.signin", form));
}

function renderNotMember(email) {
  clear(app, h("main.signin", h("div.signin-card",
    h("h1", "Not on the team yet"),
    h("p", `${email} is signed in but is not a member of any Studio workspace. Ask an owner to add you in Settings.`),
    h("button.btn.ghost", { onclick: () => supa.auth.signOut() }, "Sign out"))));
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function switchTo(id) {
  if (id === store.wsId) return;
  const { view } = parseHash();
  location.hash = `#/w/${id}/${VIEWS.some((v) => v.key === view) ? view : "dashboard"}`;
}

/** Segmented "Maana | Mawadda" control; nothing when there is one workspace. */
function switcher(compact = false) {
  if (store.workspaces.length < 2) return null;
  return h(`div.ws-switch${compact ? ".compact" : ""}`, { role: "tablist", "aria-label": "Workspace" },
    store.workspaces.map((w) => h("button.ws-tab" + (w.id === store.wsId ? ".active" : ""), {
      role: "tab", type: "button", "aria-selected": String(w.id === store.wsId),
      title: `Open ${w.copy?.studio_name ?? w.name}`,
      onclick: () => switchTo(w.id),
    }, compact ? null : logo(w, ".tiny"), h("span", w.short_name ?? w.name))));
}

function shell() {
  const ws = store.workspace;
  const brandName = ws?.copy?.studio_name ?? `${ws?.name} Studio`;
  const nav = h("nav.side",
    h("div.side-top",
      h("a.brand", { href: href("dashboard"), title: brandName }, logo(ws),
        h("span.brand-text", h("span.brand-name", ws?.name ?? "Studio"), h("span.brand-sub", "Studio"))),
      switcher()),
    VIEWS.filter((v) => !v.edit || store.canEdit()).map((v) =>
      h("a.nav-link", { href: href(v.key), "data-view": v.key }, v.label,
        v.key === "alerts" ? h("span.badge#alert-count") : null)),
    h("div.side-foot",
      h("span.live-dot#live-dot", { title: "Realtime connection" }),
      h("span.who", `${store.email} (${store.role} in ${ws?.short_name ?? ws?.name})`),
      h("button.link-btn", { onclick: () => supa.auth.signOut() }, "Sign out")));
  const main = h("main.view#view");
  const topbar = h("header.topbar",
    h("button.menu-btn", { "aria-label": "Menu", onclick: () => document.body.classList.toggle("nav-open") }, "☰"),
    h("a.topbar-brand", { href: href("dashboard") }, logo(ws), h("span", ws?.short_name ?? ws?.name)),
    switcher(true));
  clear(app, h("div.layout", topbar, nav, main));
  if (unsubscribe) unsubscribe();
  unsubscribe = store.on(updateChrome);
  updateChrome();
}

function updateChrome() {
  const dot = document.getElementById("live-dot");
  if (dot) {
    dot.classList.toggle("on", !!store.live);
    dot.title = store.live ? "Live: changes appear for everyone instantly" : "Reconnecting";
  }
  const badge = document.getElementById("alert-count");
  if (badge) {
    const n = [...store.alerts.values()].filter((a) => a.severity === "error" || a.severity === "warn").length;
    badge.textContent = n ? String(n) : "";
  }
}

async function enterWorkspace(id) {
  if (switching?.id === id) return switching.p;
  const p = (async () => {
    if (cleanup) {
      try { cleanup(); } catch (e) { console.error(e); }
      cleanup = null;
    }
    const ws = store.workspaces.find((w) => w.id === id);
    applyTheme(ws);
    clear(app, h("div.boot", `Loading ${ws?.name ?? ""} Studio`));
    await openWorkspace(id);
    rememberWorkspace(id);
    shell();
  })();
  switching = { id, p };
  try {
    await p;
  } finally {
    if (switching?.p === p) switching = null;
  }
}

async function route() {
  if (!store.workspaces.length) return;
  const { ws, view, rest, query, params } = parseHash();

  // Old links and unknown or forbidden workspaces go to a workspace the user may open.
  if (!ws || !store.workspaces.some((w) => w.id === ws)) {
    const target = defaultWorkspace();
    if (ws) toast(`You are not a member of "${ws}", so ${store.workspaces.find((w) => w.id === target)?.name} is open instead.`, "warn");
    const path = ws ? "dashboard" : [view, ...rest].join("/");
    // Full URL: a bare "#..." would resolve against a <base> element (the dev mock has one).
    location.replace(`${location.pathname}${location.search}#/w/${target}/${path}${query && !ws ? `?${query}` : ""}`);
    return;
  }

  if (ws !== store.wsId || !store.ready) {
    try {
      await enterWorkspace(ws);
    } catch (e) {
      console.error(e);
      clear(app, h("div.error-box", h("h2", "Could not load Studio data"), h("pre", String(e.message ?? e))));
      return;
    }
    if (parseHash().ws !== ws) return; // switched again while loading
  }

  const def = VIEWS.find((v) => v.key === view) ?? VIEWS[0];
  document.querySelectorAll(".nav-link").forEach((a) => a.classList.toggle("active", a.dataset.view === def.key));
  document.body.classList.remove("nav-open");
  if (cleanup) {
    try { cleanup(); } catch (e) { console.error(e); }
    cleanup = null;
  }
  const root = document.getElementById("view");
  clear(root, h("div.loading", "Loading"));
  try {
    const mod = await import(def.module);
    clear(root);
    cleanup = (await mod.render(root, { rest, params })) ?? null;
    if (params.ok) toast(params.ok, "good");
    if (params.error) toast(params.error, "bad");
  } catch (e) {
    console.error(e);
    clear(root, h("div.error-box", h("h2", "This view failed to load"), h("pre", String(e.message ?? e))));
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

let booted = false;
async function onSession(session) {
  if (!session) {
    booted = false;
    store.ready = false;
    store.workspaces = [];
    renderSignIn();
    return;
  }
  if (booted) return;
  booted = true;
  const email = session.user.email?.toLowerCase();
  store.email = email;
  try {
    await loadWorkspaces();
  } catch (e) {
    booted = false;
    renderSignIn(`Studio is not reachable: ${e.message}`);
    return;
  }
  if (!store.workspaces.length) {
    renderNotMember(email);
    return;
  }
  route();
}

window.addEventListener("hashchange", route);
supa.auth.onAuthStateChange((_event, session) => {
  // Defer: supabase-js warns against awaiting other calls inside this callback.
  setTimeout(() => onSession(session), 0);
});

// Exposed for debugging in the console.
window.studio = { store, supa, fmt };
