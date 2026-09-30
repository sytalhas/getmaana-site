// Connections: one card per platform with its health, token expiry, policy
// limits and setup note. Owners connect (OAuth or from function secrets),
// check health now, and disconnect. Tokens never reach the browser.

import { supa, api } from "../supa.js";
import { store } from "../store.js";
import { h, clear, toast, confirmAction, fmt, pill, statusKind, PLATFORM_NAMES } from "../ui.js";
import { limitLines } from "./_reel.js";

const PLATFORMS = ["instagram", "facebook", "meta_ads", "youtube", "tiktok", "asc"];

const WHAT = {
  instagram: "Publishes reels and pulls reel insights (Instagram Graph API, professional account linked to a Facebook Page).",
  facebook: "Publishes Page reels and pulls video insights.",
  meta_ads: "Runs split tests with existing reels as creatives and reports spend, 3-second views and ThruPlays. Spending needs a confirmation every time.",
  youtube: "Uploads Shorts and pulls YouTube Analytics. Uploads stay private until Google's API audit passes.",
  tiktok: "Sends videos to the TikTok inbox as drafts and reads video stats. Direct public posting needs TikTok's audit.",
  asc: "Reads installs by campaign link from App Store Connect analytics reports.",
};

export function render(root) {
  const owner = store.isOwner();
  const S = { adapters: null, adaptersError: null, busy: new Set() };
  const grid = h("div.grid.cols-2");

  clear(root,
    h("div.view-head", h("div", h("h1", "Connections"),
      h("p", "Company accounts Studio posts to and reads from. Tokens stay on the server and refresh automatically."))),
    owner ? null : h("div.notice.info", { style: { marginBottom: "16px" } }, "Only the owner can connect, check or disconnect accounts. You can see their health here."),
    grid);

  function conns(p) {
    return [...store.connections.values()].filter((c) => c.platform === p)
      .sort((a, b) => (a.status === "disconnected") - (b.status === "disconnected"));
  }

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

  function connect(p) {
    const a = S.adapters?.[p];
    return run(`connect:${p}`, async () => {
      if (a?.oauth) {
        const { url } = await api(`oauth/${p}/start`);
        if (!url) throw new Error("No sign-in URL came back");
        location.href = url;
      } else if (a?.connectFromSecrets) {
        const out = await api(`connect/${p}`);
        toast(out.message ?? `${PLATFORM_NAMES[p]} connected`, "good");
      } else {
        throw new Error(`${PLATFORM_NAMES[p]} has no connect method yet`);
      }
    });
  }

  function checkNow(p, conn) {
    return run(`health:${p}`, async () => {
      const out = await api(`health/${p}`, conn ? { connection_id: conn.id } : {});
      const bad = (out.results ?? []).filter((r) => r.status === "error");
      if (!out.results?.length) toast("No account to check yet", "warn");
      else toast(bad.length ? `${PLATFORM_NAMES[p]}: ${bad[0].last_error ?? "error"}` : `${PLATFORM_NAMES[p]} is healthy`, bad.length ? "bad" : "good");
    });
  }

  async function disconnect(conn) {
    const ok = await confirmAction(`Disconnect ${PLATFORM_NAMES[conn.platform]}?`, [
      `Account: ${conn.account_name ?? conn.account_id}.`,
      "Studio forgets this connection and its stored token. Scheduled posts for it will fail until you connect again.",
      "Nothing is deleted on the platform itself. To revoke the app completely, also remove it in the platform's settings.",
    ], "Disconnect");
    if (!ok) return;
    const { error } = await supa.from("connections").delete().eq("id", conn.id);
    toast(error ? `Could not disconnect: ${error.message}` : "Disconnected", error ? "bad" : "good");
  }

  function card(p) {
    const list = conns(p);
    const a = S.adapters?.[p];
    const main = list[0] ?? null;
    const canConnect = !!(a?.oauth || a?.connectFromSecrets);
    const connectLabel = main && main.status !== "disconnected" ? "Reconnect" : "Connect";
    const limits = [...limitLines(a?.limits)];
    return h("section.card.stack",
      h("div.row.between",
        h("h2", { style: { margin: 0 } }, PLATFORM_NAMES[p]),
        main ? pill(main.status, statusKind(main.status)) : pill("not connected", "muted")),
      h("p.small.muted", { style: { margin: 0 } }, WHAT[p]),
      list.length ? list.map((c) => account(c)) : null,
      limits.length || list.some((c) => Object.keys(c.limits ?? {}).length)
        ? h("div",
          h("div.field-label", "Policy limits"),
          h("ul.small", { style: { margin: "4px 0 0", paddingLeft: "18px" } },
            [...new Set([...limits, ...list.flatMap((c) => limitLines(c.limits))])].map((l) => h("li", l))))
        : null,
      a?.setupNote ? h("details", h("summary", { style: { cursor: "pointer", fontWeight: "700" } }, "Setup"),
        h("p.small", { style: { whiteSpace: "pre-wrap" } }, a.setupNote)) : null,
      S.adaptersError && !a ? h("p.hint", `Setup notes unavailable: ${S.adaptersError}`) : null,
      owner ? h("div.row",
        h("button.btn.primary.small", {
          disabled: !canConnect || S.busy.has(`connect:${p}`),
          title: canConnect ? null : "This platform's connector is not available yet",
          onclick: () => connect(p),
        }, S.busy.has(`connect:${p}`) ? "Opening" : connectLabel),
        main ? h("button.btn.small", { disabled: S.busy.has(`health:${p}`), onclick: () => checkNow(p) },
          S.busy.has(`health:${p}`) ? "Checking" : "Check now") : null) : null);
  }

  function account(c) {
    const exp = c.token_expires_at ? new Date(c.token_expires_at) : null;
    const days = exp ? Math.round((exp - Date.now()) / 864e5) : null;
    return h("div.stack", { style: { gap: "4px", padding: "10px", background: "var(--paper)", borderRadius: "8px" } },
      h("div.row.between",
        h("strong", c.account_name ?? c.account_id),
        list0(c) ? pill(c.status, statusKind(c.status)) : null),
      h("div.small", "Token: ", exp
        ? h("span", { style: days != null && days < 7 ? { color: "var(--red)", fontWeight: "700" } : null },
          `expires ${fmt.date(c.token_expires_at)} (${days < 0 ? `${-days} days ago` : `in ${days} day${days === 1 ? "" : "s"}`})`)
        : "no expiry reported"),
      h("div.small", `Last checked ${fmt.ago(c.last_checked_at)}`),
      c.scopes?.length ? h("div.small.muted", `Scopes: ${c.scopes.join(", ")}`) : null,
      c.last_error ? h("div.notice.bad", { style: { fontSize: "13px" } }, c.last_error) : null,
      owner ? h("div.row.end", h("button.btn.small.danger", { onclick: () => disconnect(c) }, "Disconnect")) : null);
  }

  // Show a per-account pill only when a platform has more than one account.
  function list0(c) {
    return conns(c.platform).length > 1;
  }

  function renderAll() {
    clear(grid, PLATFORMS.map(card));
  }

  renderAll();
  api("adapters", null, "GET")
    .then((a) => { S.adapters = a; })
    .catch((e) => { S.adaptersError = e.message; })
    .finally(renderAll);

  return store.on((t) => { if (t === "connections" || t === "*") renderAll(); });
}
