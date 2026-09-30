// Maana Studio shell: sign-in gate, navigation, hash router, live store.
// Each view is a module in ./views/ exporting `render(root, params)`, which
// may return a cleanup function. Views re-render themselves on store changes.

import { supa } from "./supa.js";
import { store, loadAll } from "./store.js";
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

const app = document.getElementById("app");
let cleanup = null;
let unsubscribe = null;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const [view = "dashboard", ...rest] = path.split("/").filter(Boolean);
  return { view, rest, params: Object.fromEntries(new URLSearchParams(query)) };
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
    h("h1", "Maana Studio"),
    h("p", "Team sign-in. You get a one-time link by email."),
    h("label.field", h("span.field-label", "Email"), email),
    h("button.btn.primary.block", { type: "submit" }, "Email me a sign-in link"),
    status);
  clear(app, h("main.signin", form));
}

function renderNotMember(email) {
  clear(app, h("main.signin", h("div.signin-card",
    h("h1", "Not on the team yet"),
    h("p", `${email} is signed in but is not a Studio member. Ask the owner to add you in Settings.`),
    h("button.btn.ghost", { onclick: () => supa.auth.signOut() }, "Sign out"))));
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function shell() {
  const nav = h("nav.side", h("a.brand", { href: "#/dashboard" },
    h("img", { src: "../apple-touch-icon.png", alt: "" }), h("span", "Studio")),
  VIEWS.filter((v) => !v.edit || store.canEdit()).map((v) =>
    h("a.nav-link", { href: `#/${v.key}`, "data-view": v.key }, v.label,
      v.key === "alerts" ? h("span.badge#alert-count") : null)),
  h("div.side-foot",
    h("span.live-dot#live-dot", { title: "Realtime connection" }),
    h("span.who", `${store.email} (${store.role})`),
    h("button.link-btn", { onclick: () => supa.auth.signOut() }, "Sign out")));
  const main = h("main.view#view");
  const menu = h("button.menu-btn", { "aria-label": "Menu", onclick: () => document.body.classList.toggle("nav-open") }, "☰");
  clear(app, h("div.layout", menu, nav, main));
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

async function route() {
  if (!store.ready) return;
  const { view, rest, params } = parseHash();
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
    renderSignIn();
    return;
  }
  if (booted) return;
  booted = true;
  const email = session.user.email?.toLowerCase();
  store.email = email;
  const { data: role, error } = await supa.rpc("claim_membership");
  if (error) {
    booted = false;
    renderSignIn(`Studio is not reachable: ${error.message}`);
    return;
  }
  if (!role) {
    renderNotMember(email);
    return;
  }
  store.role = role;
  clear(app, h("div.boot", "Loading your library"));
  try {
    await loadAll();
  } catch (e) {
    clear(app, h("div.error-box", h("h2", "Could not load Studio data"), h("pre", String(e.message ?? e))));
    return;
  }
  shell();
  route();
}

window.addEventListener("hashchange", route);
supa.auth.onAuthStateChange((_event, session) => {
  // Defer: supabase-js warns against awaiting other calls inside this callback.
  setTimeout(() => onSession(session), 0);
});

// Exposed for debugging in the console.
window.studio = { store, supa, fmt };
