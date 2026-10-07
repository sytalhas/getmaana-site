// Tiny DOM helpers shared by every view. No framework.

/** h("div.card#id", {onclick, title}, children...) */
export function h(tag, attrs, ...children) {
  const [, name = "div", rest = ""] = tag.match(/^([a-z0-9-]*)(.*)$/i);
  const el = document.createElement(name || "div");
  for (const part of rest.match(/[.#][^.#]+/g) ?? []) {
    if (part[0] === ".") el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = [el.className, v].filter(Boolean).join(" ");
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "html") el.innerHTML = v; // only for trusted, static markup
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export function toast(msg, kind = "info") {
  const t = h(`div.toast.${kind}`, msg);
  document.getElementById("toasts").append(t);
  setTimeout(() => t.classList.add("out"), 4200);
  setTimeout(() => t.remove(), 4800);
}

// ---------------------------------------------------------------------------
// Modals (content-creator LRN-47). Owner, 2026-10-07: "when im in a modal i can be taken to other pages and
// navigation is annoying". A <dialog> opened with showModal() already makes the page behind inert and traps focus.
// On top of that: the page does not scroll behind it, focus returns to what opened it, browser Back closes the
// dialog instead of changing page, a link inside closes the dialog first, a hash change from code closes it (nothing
// stays open over another page), a busy dialog does not close, and the footer buttons stay in view.
// ---------------------------------------------------------------------------

const open = [];      // open dialogs, top last
let ignorePops = 0;
let seq = 0;
let lastTrigger = null;   // the last button or link used: a dialog opened after an await (its button disabled
                          // meanwhile, so focus fell to the page) still returns focus there

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    if (ignorePops > 0) { ignorePops--; return; }
    const top = open[open.length - 1];
    if (!top) return;
    if (top.busy) { history.pushState({ studioModal: top.id }, "", location.href); toast("Wait until it has finished", "warn"); return; }
    top.close({ fromHistory: true });
  });
  // Registered before the router's own listener (ui.js loads first), so dialogs close before the view changes.
  window.addEventListener("hashchange", () => {
    while (open.length) open[open.length - 1].close({ fromHistory: true, force: true });
  });
  document.addEventListener("pointerdown", (e) => { lastTrigger = e.target.closest?.("button, a[href], [tabindex]") ?? lastTrigger; }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") lastTrigger = document.activeElement; }, true);
  document.addEventListener("click", (e) => {
    const top = open[open.length - 1];
    const a = top && e.target.closest?.("a[href]");
    if (!a || !top.el.contains(a) || a.target === "_blank" || a.hasAttribute("download") || e.metaKey || e.ctrlKey) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname) return;
    e.preventDefault();
    if (top.busy) { toast("Wait until it has finished", "warn"); return; }
    top.close({ force: true });
    location.hash = url.hash;     // close() leaves its history entry behind when the page changes right after
  }, true);
}

/** Focus what opened the dialog; when the view re-rendered meanwhile, the same-looking control in its place. */
function focusBack(t) {
  if (!t) return;
  if (!t.isConnected) {
    const label = t.textContent.trim();
    t = [...document.querySelectorAll(t.tagName)].find((x) => !x.closest("dialog") && x.textContent.trim() === label) ?? null;
  }
  t?.focus({ preventScroll: true });
}

/** Modal dialog. Returns {close, el, busy(on)}. content is a Node or array. A trailing `.row.end` in the content
 *  becomes the footer that stays in view while the body scrolls. */
export function modal(title, content, { wide = false, onClose } = {}) {
  const body = h("div.modal-body", content);
  const dlg = h("dialog.modal" + (wide ? ".wide" : ""),
    h("header.modal-head", h("h2", title), h("button.icon-btn", { "aria-label": "Close", onclick: () => close() }, "×")),
    body);
  const last = body.lastElementChild;
  if (last?.matches(".row.end")) { last.classList.add("modal-foot"); dlg.append(last); }
  const active = document.activeElement;
  const trigger = active && active !== document.body ? active : lastTrigger;
  const entry = { id: ++seq, el: dlg, busy: false, trigger, closed: false };
  document.body.append(dlg);
  dlg.showModal();
  document.documentElement.classList.add("modal-open");
  open.push(entry);
  history.pushState({ studioModal: entry.id }, "", location.href);

  function close({ fromHistory = false, force = false } = {}) {
    if (entry.closed) return true;
    if (entry.busy && !force) { toast("Wait until it has finished", "warn"); return false; }
    entry.closed = true;
    open.splice(open.indexOf(entry), 1);
    if (dlg.open) dlg.close();
    dlg.remove();
    if (!open.length) document.documentElement.classList.remove("modal-open");
    focusBack(entry.trigger);
    if (!fromHistory) {
      // Drop the dialog's history entry, unless the code that closed it navigates right away (then Back from the
      // new page simply lands on the old one).
      const here = location.href;
      setTimeout(() => {
        if (location.href === here && history.state?.studioModal === entry.id) { ignorePops++; history.back(); }
      }, 0);
    }
    onClose?.();
    return true;
  }
  entry.close = close;
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  return { close: () => close(), el: dlg, busy: (on) => { entry.busy = !!on; dlg.classList.toggle("busy", entry.busy); } };
}

/** One-click confirmation for outward actions. Resolves true/false. */
export function confirmAction(title, lines, cta = "Confirm") {
  return new Promise((resolve) => {
    const m = modal(title, [
      h("div.confirm-lines", lines.map((l) => (l instanceof Node && /^(UL|OL|DETAILS|DIV|P)$/.test(l.tagName) ? l : h("p", l)))),
      h("div.row.end",
        // Resolve before close(): close() fires onClose, which resolves false.
        h("button.btn.ghost", { onclick: () => { resolve(false); m.close(); } }, "Cancel"),
        h("button.btn.primary", { onclick: () => { resolve(true); m.close(); } }, cta)),
    ], { onClose: () => resolve(false) });
  });
}

export const fmt = {
  int: (n) => (n == null || Number.isNaN(n) ? "–" : Math.round(n).toLocaleString()),
  pct: (x, d = 1) => (x == null || !Number.isFinite(x) ? "–" : `${(x * 100).toFixed(d)}%`),
  usd: (x) => (x == null || !Number.isFinite(x) ? "–" : `$${x.toFixed(2)}`),
  sec: (x) => (x == null || !Number.isFinite(x) ? "–" : `${x.toFixed(1)} s`),
  date: (s) => (s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "–"),
  dateTime: (s) => (s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "–"),
  ago(s) {
    if (!s) return "never";
    const d = (Date.now() - new Date(s).getTime()) / 1000;
    if (d < 60) return "just now";
    if (d < 3600) return `${Math.floor(d / 60)} min ago`;
    if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
    return `${Math.floor(d / 86400)} d ago`;
  },
  label: (s) => (s ? String(s).replace(/_/g, " ") : "–"),
};

export const PLATFORM_NAMES = {
  instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", tiktok: "TikTok",
  meta_ads: "Meta Ads", asc: "App Store",
};

export function pill(text, kind = "") {
  return h(`span.pill${kind ? "." + kind : ""}`, fmt.label(text));
}

export function statusKind(status) {
  return {
    live: "good", ready: "good", connected: "good", done: "good", decided: "good",
    scheduled: "info", publishing: "info", running: "info", in_production: "info", inbox_draft: "info",
    awaiting_manual: "warn", private_until_audit: "warn", expiring: "warn", draft: "", idea: "",
    failed: "bad", error: "bad", shelved: "muted", retired: "muted", cancelled: "muted", disconnected: "muted",
  }[status] ?? "";
}

export function field(label, input, hint) {
  return h("label.field", h("span.field-label", label), input, hint ? h("span.hint", hint) : null);
}

export function select(options, value, attrs = {}) {
  return h("select", attrs, options.map((o) => {
    const [v, t] = Array.isArray(o) ? o : [o, fmt.label(o)];
    return h("option", { value: v ?? "", selected: (v ?? "") === (value ?? "") }, t);
  }));
}

export function empty(msg, action) {
  return h("div.empty", h("p", msg), action ?? null);
}

export function downloadFile(name, text, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
