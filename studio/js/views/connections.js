// Connections: one card per platform app. Meta is one card because one
// Facebook login connects Instagram, Facebook and Meta Ads together.
//
// Each card walks the owner through three states:
//   1. Set up: numbered steps, values to copy, and boxes for the app keys
//      (saved server-side in Vault; the browser only learns "saved").
//   2. Connect: one tap (OAuth, or keys for App Store Connect).
//   3. Connected: accounts, token expiry, health, limits.

import { supa, api } from "../supa.js";
import { store } from "../store.js";
import { h, clear, toast, confirmAction, fmt, pill, statusKind, PLATFORM_NAMES } from "../ui.js";
import { limitLines } from "./_reel.js";

const CARDS = [
  { key: "meta", title: "Meta", platforms: ["instagram", "facebook", "meta_ads"], lead: "instagram",
    button: "Connect with Facebook",
    what: "Instagram reels and insights, Facebook Page reels, and Meta Ads split tests. One Facebook login connects all three. Spending always needs a confirmation." },
  { key: "youtube", title: "YouTube", platforms: ["youtube"], lead: "youtube", button: "Connect with Google",
    what: "Uploads Shorts and reads YouTube Analytics. Uploads stay private until Google's API audit passes." },
  { key: "tiktok", title: "TikTok", platforms: ["tiktok"], lead: "tiktok", button: "Connect with TikTok",
    what: "Sends videos to your TikTok inbox as drafts (you tap Post) and reads stats for public videos." },
  { key: "asc", title: "App Store", platforms: ["asc"], lead: "asc", button: "Connect",
    what: "Reads installs per campaign link from App Store Connect analytics, once the app is live." },
];

export function render(root) {
  const owner = store.isOwner();
  const brand = store.brand();
  const S = { adapters: null, adaptersError: null, busy: new Set(), draft: {}, open: {} };
  const grid = h("div.stack", { style: { gap: "16px" } });
  const intro = h("div");

  clear(root,
    h("div.view-head", h("div", h("h1", "Connections"),
      h("p", `${brand}'s own accounts. Each platform needs ${brand}'s developer app once; after that, connecting is one tap. Keys and tokens stay on the server and are never shared with another workspace.`))),
    owner ? null : h("div.notice.info", { style: { marginBottom: "16px" } },
      "Only the owner can set up and connect accounts. You can see their health here."),
    intro,
    grid);

  // Nothing connected yet: say where to start.
  function renderIntro() {
    const any = [...store.connections.values()].some((c) => c.status !== "disconnected");
    clear(intro, any ? null : h("section.card.welcome.stack", { style: { marginBottom: "16px" } },
      h("h2", { style: { margin: 0 } }, `Connect ${brand}'s Instagram first`),
      h("p", { style: { margin: 0 } }, owner
        ? `Start with the Meta card below: it connects ${brand}'s Instagram (and its Facebook Page and ad account, if it has them). No Facebook Page? Open "Connect Instagram only" on that card. YouTube, TikTok and the App Store can follow any time.`
        : `The owner connects ${brand}'s accounts here. Once Instagram is connected, posts and insights start to flow.`)));
  }

  const conns = (p) => [...store.connections.values()].filter((c) => c.platform === p && c.status !== "disconnected");

  async function run(key, fn) {
    if (S.busy.has(key)) return;
    S.busy.add(key);
    renderAll();
    try {
      await fn();
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      S.busy.delete(key);
      renderAll();
    }
  }

  async function loadAdapters() {
    try {
      S.adapters = await api("adapters", null, "GET");
      S.adaptersError = null;
    } catch (e) {
      S.adaptersError = e.message;
    }
    renderAll();
  }

  function connect(card) {
    return run(`connect:${card.key}`, async () => {
      const a = S.adapters?.[card.lead];
      if (a?.oauth) {
        const { url } = await api(`oauth/${card.lead}/start`);
        if (!url) throw new Error("No sign-in URL came back");
        location.href = url;
      } else {
        const out = await api(`connect/${card.lead}`);
        toast(out.message ?? `${card.title} connected`, "good");
      }
    });
  }

  function saveKeys(card, setup) {
    return run(`save:${card.key}`, async () => {
      const values = {};
      for (const f of setup.fields) {
        const v = (S.draft[f.name] ?? "").trim();
        if (v) values[f.name] = v;
      }
      if (!Object.keys(values).length) throw new Error("Paste at least one value first");
      await api("config", { values });
      for (const k of Object.keys(values)) delete S.draft[k];
      toast("Saved. Keys are stored on the server only.", "good");
      await loadAdapters();
    });
  }

  // Instagram API with Instagram Login: connects Instagram with no Facebook Page.
  function connectIgOnly() {
    return run("connect:meta-ig", async () => {
      const { url } = await api("action/instagram/oauth_start_ig", {});
      if (!url) throw new Error("No sign-in URL came back");
      location.href = url;
    });
  }

  function igOnlyBlock(alt) {
    const key = "meta-ig";
    const igLogin = conns("instagram").some((c) => c.info?.token_kind === "ig_login" || c.info?.api_host === "graph.instagram.com");
    // Open by default until Meta is connected: it is the quickest route when no Facebook Page exists.
    const metaConnected = ["instagram", "facebook", "meta_ads"].some((p) => conns(p).length);
    const open = S.open[key] ?? (igLogin || !metaConnected || alt.fields.some((f) => f.source));
    const busy = S.busy.has(`connect:${key}`);
    return h("details.setup-alt", {
      open,
      ontoggle: (e) => { S.open[key] = e.target.open; },
      style: { borderTop: "1px solid var(--line)", paddingTop: "10px" },
    },
      h("summary", { style: { cursor: "pointer", fontWeight: "700" } }, "No Facebook Page? Connect Instagram only"),
      h("div.stack", { style: { marginTop: "8px" } },
        h("p.small.muted", { style: { margin: 0 } },
          `${alt.title}. Publishes reels (trial reels too) and reads insights. Facebook and Meta Ads are not included. About ${alt.minutes} min.`),
        setupPanel({ key }, alt, false),
        alt.ready
          ? h("div.row",
            h("button.btn.coral", { disabled: busy, onclick: connectIgOnly },
              busy ? "Opening" : igLogin ? "Reconnect with Instagram" : "Connect with Instagram"),
            h("span.hint", `Sign in with the ${brand} Instagram account.`))
          : h("span.hint", "Save the Instagram app ID and secret to turn on Connect with Instagram.")));
  }

  function checkNow(p) {
    return run(`health:${p}`, async () => {
      const out = await api(`health/${p}`, {});
      const bad = (out.results ?? []).filter((r) => r.status === "error");
      if (!out.results?.length) toast("No account to check yet", "warn");
      else toast(bad.length ? `${PLATFORM_NAMES[p]}: ${bad[0].last_error ?? "error"}` : `${PLATFORM_NAMES[p]} is healthy`,
        bad.length ? "bad" : "good");
    });
  }

  async function disconnect(conn) {
    const ok = await confirmAction(`Disconnect ${PLATFORM_NAMES[conn.platform]}?`, [
      `Account: ${conn.account_name ?? conn.account_id}.`,
      "Studio forgets this connection and its stored token. Scheduled posts for it will fail until you connect again.",
      "Nothing is deleted on the platform itself.",
    ], "Disconnect");
    if (!ok) return;
    const { error } = await supa.from("connections").delete().eq("workspace_id", store.wsId).eq("id", conn.id);
    toast(error ? `Could not disconnect: ${error.message}` : "Disconnected", error ? "bad" : "good");
  }

  function copyRow(c) {
    return h("div.copy-row",
      h("span.small.muted", c.label),
      h("code", c.value),
      h("button.btn.small.ghost", {
        onclick: async (e) => {
          try {
            await navigator.clipboard.writeText(c.value);
            e.target.textContent = "Copied";
            setTimeout(() => { e.target.textContent = "Copy"; }, 1500);
          } catch {
            toast("Copy failed: select the text instead", "warn");
          }
        },
      }, "Copy"));
  }

  function keyField(f) {
    const saved = f.source === "studio" ? "Saved in Studio" : f.source === "secret" ? "Set as a server secret" : null;
    const attrs = {
      placeholder: saved ? `${saved}. Paste to replace.` : f.optional ? "Optional" : "",
      value: S.draft[f.name] ?? "",
      autocomplete: "off",
      spellcheck: false,
      oninput: (e) => { S.draft[f.name] = e.target.value; },
    };
    const input = f.multiline
      ? h("textarea", { ...attrs, rows: 4, style: { fontFamily: "ui-monospace, monospace", fontSize: "12px" } })
      : h("input", { ...attrs, type: f.secret ? "password" : "text" });
    return h("label.field",
      h("span.field-label", f.label, saved ? h("span.pill.good", { style: { marginLeft: "8px" } }, "saved") : null),
      input,
      f.hint ? h("span.hint", f.hint) : null);
  }

  function setupPanel(card, setup, collapsed) {
    const body = h("div.stack",
      h("ol.setup-steps", setup.steps.map((s) => h("li", s))),
      setup.copy.length ? h("div.stack", { style: { gap: "6px" } }, setup.copy.map(copyRow)) : null,
      owner
        ? h("div.stack",
          h("div.grid.cols-2", setup.fields.map(keyField)),
          h("div.row",
            h("button.btn.primary", { disabled: S.busy.has(`save:${card.key}`), onclick: () => saveKeys(card, setup) },
              S.busy.has(`save:${card.key}`) ? "Saving" : "Save keys"),
            h("span.hint", "Stored in Supabase Vault. Studio never shows them again.")))
        : null);
    if (!collapsed) return h("div.setup-panel", body);
    const d = h("details", { open: !!S.open[card.key], ontoggle: (e) => { S.open[card.key] = e.target.open; } },
      h("summary", { style: { cursor: "pointer", fontWeight: "700" } }, "App keys and setup steps"), body);
    return d;
  }

  function account(c) {
    const exp = c.token_expires_at ? new Date(c.token_expires_at) : null;
    const days = exp ? Math.round((exp - Date.now()) / 864e5) : null;
    return h("div.stack", { style: { gap: "4px", padding: "10px", background: "var(--paper)", borderRadius: "8px" } },
      h("div.row.between",
        h("strong", `${PLATFORM_NAMES[c.platform]}: ${c.account_name ?? c.account_id}`),
        pill(c.status, statusKind(c.status))),
      h("div.small", "Token: ", exp
        ? h("span", { style: days != null && days < 7 ? { color: "var(--red)", fontWeight: "700" } : null },
          `expires ${fmt.date(c.token_expires_at)} (${days < 0 ? `${-days} days ago` : `in ${days} day${days === 1 ? "" : "s"}`})`)
        : "does not expire"),
      h("div.small", `Last checked ${fmt.ago(c.last_checked_at)}`),
      c.last_error ? h("div.notice.bad", { style: { fontSize: "13px" } }, c.last_error) : null,
      owner ? h("div.row.end",
        h("button.btn.small", { disabled: S.busy.has(`health:${c.platform}`), onclick: () => checkNow(c.platform) },
          S.busy.has(`health:${c.platform}`) ? "Checking" : "Check now"),
        h("button.btn.small.danger", { onclick: () => disconnect(c) }, "Disconnect")) : null);
  }

  function card(cd) {
    const a = S.adapters?.[cd.lead];
    const setup = a?.setup;
    const accounts = cd.platforms.flatMap(conns);
    const connected = accounts.length > 0;
    const ready = !!setup?.ready;
    const missing = cd.platforms.filter((p) => !conns(p).length);
    const limits = [...new Set(cd.platforms.flatMap((p) => limitLines(S.adapters?.[p]?.limits)))];

    let status;
    if (connected) status = pill(missing.length ? "partly connected" : "connected", missing.length ? "warn" : "good");
    else if (ready) status = pill("ready to connect", "info");
    else status = pill("set up needed", "muted");

    return h("section.card.stack",
      h("div.row.between",
        h("h2", { style: { margin: 0 } }, cd.title),
        status),
      h("p.small.muted", { style: { margin: 0 } }, cd.what),

      !S.adapters && !S.adaptersError ? h("p.hint", "Loading setup") : null,
      S.adaptersError ? h("div.notice.bad", `Could not load setup: ${S.adaptersError}`) : null,

      // 1. Set up (open until the keys are in)
      setup && !ready ? h("div.stack",
        h("h3", { style: { margin: "6px 0 0" } }, `One-time setup (about ${setup.minutes} min)`),
        setupPanel(cd, setup, false)) : null,

      // 2. Connect
      setup && ready && owner ? h("div.row",
        h("button.btn.coral", { disabled: S.busy.has(`connect:${cd.key}`), onclick: () => connect(cd) },
          S.busy.has(`connect:${cd.key}`) ? "Opening" : connected ? cd.button.replace(/^Connect/, "Reconnect") : cd.button),
        connected && missing.length
          ? h("span.hint", `Not connected yet: ${missing.map((p) => PLATFORM_NAMES[p]).join(", ")}. Reconnect and allow every permission.`)
          : null) : null,

      // 3. Connected accounts
      accounts.map(account),

      limits.length ? h("details",
        h("summary", { style: { cursor: "pointer", fontWeight: "700" } }, "Policy limits"),
        h("ul.small", { style: { margin: "4px 0 0", paddingLeft: "18px" } }, limits.map((l) => h("li", l)))) : null,

      setup && ready ? setupPanel(cd, setup, true) : null,

      // Alternative: Instagram only, no Facebook Page (Meta card, owner only)
      owner && a?.setupAlt ? igOnlyBlock(a.setupAlt) : null);
  }

  function renderAll() {
    // Keep what the owner is typing: only rebuild when no key box has focus.
    const active = document.activeElement;
    if (active && grid.contains(active) && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
    renderIntro();
    clear(grid, CARDS.map(card));
  }

  renderAll();
  loadAdapters();
  return store.on((t) => { if (t === "connections" || t === "*") renderAll(); });
}
