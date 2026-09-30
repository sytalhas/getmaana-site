// Settings: team members, targets, ad spend cap, cadence, App Store link
// settings, and the audit log. Owners edit; everyone else reads.

import { supa, api } from "../supa.js";
import { store } from "../store.js";
import { h, clear, toast, confirmAction, fmt, field, select, empty } from "../ui.js";
import { currentUserId } from "./_reel.js";

const ROLES = [["owner", "Owner"], ["editor", "Editor"], ["viewer", "Viewer"]];

export function render(root) {
  const owner = store.isOwner();
  const membersBox = h("div");
  const auditBox = h("div");
  const sections = {};

  clear(root,
    h("div.view-head", h("div", h("h1", "Settings"),
      h("p", owner ? "Changes apply for the whole team straight away and are recorded in the audit log." : "Only the owner can change these. You can read them."))),
    h("section.card.stack",
      h("h2", "Team"),
      h("p.small.muted", { style: { margin: 0 } },
        "Owners change everything, editors launch and edit content, viewers read. Add someone by email, then they sign in with a one-time link."),
      membersBox,
      owner ? addMemberForm() : null),
    h("div.grid.cols-2.section",
      (sections.targets = settingCard("targets", "Targets", targetsForm)).el,
      (sections.ads = settingCard("ads_spend_cap", "Ad spend cap", spendForm)).el,
      (sections.cadence = settingCard("cadence", "Posting cadence", cadenceForm)).el,
      (sections.asc = settingCard("app_store", "App Store", appStoreForm)).el),
    h("section.section",
      h("div.row.between", h("h2", "Audit log"), h("button.btn.ghost.small", { onclick: loadAudit }, "Refresh")),
      h("p.small.muted", "The last 100 changes to reels, posts, experiments, connections, members and settings, plus every confirmed outward action."),
      auditBox));

  // ---- members ---------------------------------------------------------------
  const owners = () => [...store.members.values()].filter((m) => m.role === "owner").length;

  async function reloadMembers() {
    // studio.members is not in the Realtime publication, so refresh it here.
    const { data, error } = await supa.from("members").select("*").order("email");
    if (error) return toast(`Could not reload the team: ${error.message}`, "bad");
    store.members.clear();
    for (const m of data) store.members.set(m.email, m);
    store.emit("members");
  }

  function renderMembers() {
    const list = [...store.members.values()].sort((a, b) => a.email.localeCompare(b.email));
    if (!list.length) return clear(membersBox, empty("No members."));
    clear(membersBox, h("div.table-wrap", h("table.data",
      h("thead", h("tr", ["Email", "Name", "Role", "Signed in", "Added", ""].map((t) => h("th", t)))),
      h("tbody", list.map((m) => {
        const lastOwner = m.role === "owner" && owners() <= 1;
        const me = m.email === store.email;
        const roleSel = owner
          ? select(ROLES, m.role, {
            "aria-label": `Role for ${m.email}`,
            onchange: async (e) => {
              const role = e.target.value;
              if (lastOwner && role !== "owner") {
                e.target.value = "owner";
                return toast("Studio needs at least one owner. Make someone else owner first.", "warn");
              }
              if (me && role !== "owner") {
                const ok = await confirmAction("Give up owner rights?", [`You (${m.email}) become ${role}. Only another owner can change it back.`], "Change my role");
                if (!ok) { e.target.value = m.role; return; }
              }
              const { error } = await supa.from("members").update({ role }).eq("email", m.email);
              if (error) { e.target.value = m.role; return toast(`Could not change the role: ${error.message}`, "bad"); }
              toast(`${m.email} is now ${role}`, "good");
              reloadMembers();
            },
          })
          : fmt.label(m.role);
        return h("tr",
          h("td", m.email, me ? h("span.small.muted", " (you)") : null),
          h("td", m.name ?? "–"),
          h("td", roleSel),
          h("td", m.user_id ? "yes" : h("span.muted", "not yet")),
          h("td", fmt.date(m.created_at)),
          h("td", owner ? h("button.btn.small.danger", {
            disabled: lastOwner,
            title: lastOwner ? "The last owner cannot be removed" : null,
            onclick: () => removeMember(m),
          }, "Remove") : null));
      })))));
  }

  async function removeMember(m) {
    if (m.role === "owner" && owners() <= 1) return toast("The last owner cannot be removed.", "warn");
    const ok = await confirmAction(`Remove ${m.email}?`, [
      "They lose access to Studio straight away. Their past actions stay in the audit log.",
    ], "Remove");
    if (!ok) return;
    const { error } = await supa.from("members").delete().eq("email", m.email);
    if (error) return toast(`Could not remove: ${error.message}`, "bad");
    toast(`${m.email} removed`, "good");
    reloadMembers();
  }

  function addMemberForm() {
    const email = h("input", { type: "email", required: true, placeholder: "teammate@example.com", autocomplete: "off" });
    const name = h("input", { placeholder: "Optional" });
    const role = select(ROLES, "editor");
    const btn = h("button.btn.primary", { type: "submit" }, "Add member");
    return h("form.filters", {
      style: { margin: 0 },
      onsubmit: async (e) => {
        e.preventDefault();
        const em = email.value.trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return toast("Enter a valid email", "warn");
        if (store.members.has(em)) return toast(`${em} is already on the team`, "warn");
        btn.disabled = true;
        const { error } = await supa.from("members").insert({
          email: em, name: name.value.trim() || null, role: role.value, created_by: await currentUserId(),
        });
        btn.disabled = false;
        if (error) return toast(`Could not add: ${error.message}`, "bad");
        email.value = "";
        name.value = "";
        toast(`${em} added. They can sign in at getmaana.com/studio with that email.`, "good");
        reloadMembers();
      },
    }, field("Email", email), field("Name", name), field("Role", role), btn);
  }

  // ---- settings cards --------------------------------------------------------
  // Each card rebuilds from the store when a teammate changes the setting,
  // unless this person has unsaved edits in it.
  function settingCard(key, title, build) {
    const body = h("div.stack");
    const note = h("p.hint", { style: { margin: 0 } });
    const el = h("section.card.stack", h("h2", title), note, body);
    const sec = { key, el, dirty: false, value: null };
    sec.render = () => {
      const row = store.settings.get(key);
      const value = row?.value ?? {};
      const sig = JSON.stringify(value);
      if (sec.dirty || sec.value === sig) return;
      sec.value = sig;
      note.textContent = [row?.note ? row.note.replace(/([^.])$/, "$1.") : null, row?.updated_at ? `Updated ${fmt.ago(row.updated_at)}.` : null].filter(Boolean).join(" ");
      clear(body, build(value, sec));
    };
    sec.save = async (patch) => {
      const row = store.settings.get(key);
      const value = { ...(row?.value ?? {}), ...patch };
      const { error } = row
        ? await supa.from("settings").update({ value, updated_at: new Date().toISOString(), updated_by: await currentUserId() }).eq("key", key)
        : await supa.from("settings").insert({ key, value, updated_by: await currentUserId() });
      if (error) { toast(`Could not save: ${error.message}`, "bad"); return false; }
      sec.dirty = false;
      sec.value = null;
      toast(`${title} saved`, "good");
      return true;
    };
    return sec;
  }

  function numInput(value, attrs = {}) {
    return h("input", { type: "number", value: value == null ? "" : String(value), disabled: !owner, inputmode: "decimal", ...attrs });
  }
  const pctIn = (x) => (x == null ? null : +(x * 100).toFixed(2));
  const pctOut = (s) => (s.trim() === "" ? null : Number(s) / 100);
  const numOut = (s) => (s.trim() === "" ? null : Number(s));

  function formWrap(sec, fields, onSave) {
    const btn = h("button.btn.primary.small", { type: "submit" }, "Save");
    const cancel = h("button.btn.ghost.small", { type: "button", onclick: () => { sec.dirty = false; sec.value = null; sec.render(); } }, "Undo");
    return h("form.stack", {
      oninput: () => { sec.dirty = true; },
      onchange: () => { sec.dirty = true; },
      onsubmit: async (e) => {
        e.preventDefault();
        const patch = onSave();
        if (!patch) return;
        btn.disabled = true;
        const ok = await sec.save(patch);
        btn.disabled = false;
        if (ok) sec.render();
      },
    }, fields, owner ? h("div.row.end", cancel, btn) : null);
  }

  function targetsForm(v, sec) {
    const hook = numInput(pctIn(v.hook_rate), { min: "0", max: "100", step: "0.1" });
    const hold = numInput(pctIn(v.hold_rate), { min: "0", max: "100", step: "0.1" });
    const cpi = numInput(v.cpi, { min: "0", step: "0.01", placeholder: "Not set" });
    const d7 = numInput(pctIn(v.d7_retention), { min: "0", max: "100", step: "0.1", placeholder: "Not set" });
    return formWrap(sec, [
      h("div.grid.cols-2", { style: { gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" } },
        field("Hook rate (%)", hook, "3-second views ÷ impressions. 30% is from STRATEGY.md."),
        field("Hold rate (%)", hold, "40% is from STRATEGY.md."),
        field("CPI (USD)", cpi, "The owner's to set: the app is free, so there is no revenue benchmark."),
        field("Day-7 retention (%)", d7, "The owner's to set.")),
    ], () => {
      const out = { hook_rate: pctOut(hook.value), hold_rate: pctOut(hold.value), cpi: numOut(cpi.value), d7_retention: pctOut(d7.value) };
      for (const [k, x] of Object.entries(out)) {
        if (x != null && (!Number.isFinite(x) || x < 0 || (k !== "cpi" && x > 1))) { toast(`Check the ${fmt.label(k)} value`, "warn"); return null; }
      }
      return out;
    });
  }

  function spendForm(v, sec) {
    const total = numInput(v.total_usd, { min: "0", step: "1" });
    const daily = numInput(v.daily_usd, { min: "0", step: "1", placeholder: "No daily cap" });
    return formWrap(sec, [
      h("div.grid.cols-2", { style: { gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" } },
        field("Total cap (USD)", total), field("Daily cap (USD)", daily)),
      h("p.hint", { style: { margin: 0 } }, "Enforced on the server before any ad object is created or switched on. Every spend still needs a person to confirm it."),
    ], () => {
      const t = numOut(total.value);
      const d = numOut(daily.value);
      if (t == null || t < 0) { toast("Set a total cap (0 blocks all spend)", "warn"); return null; }
      if (d != null && (d < 0 || d > t)) { toast("The daily cap must be between 0 and the total cap", "warn"); return null; }
      return { total_usd: t, daily_usd: d };
    });
  }

  function cadenceForm(v, sec) {
    const min = numInput(v.organic_per_week_min, { min: "0", step: "1" });
    const max = numInput(v.organic_per_week_max, { min: "0", step: "1" });
    return formWrap(sec, [
      h("div.grid.cols-2", { style: { gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" } },
        field("Organic posts per week, at least", min), field("At most", max)),
      h("p.hint", { style: { margin: 0 } }, "3 to 4 a week is the recommendation in STRATEGY.md."),
    ], () => {
      const a = numOut(min.value);
      const b = numOut(max.value);
      if (a == null || b == null || a < 0 || b < a) { toast("Set a minimum and a maximum of at least the minimum", "warn"); return null; }
      return { organic_per_week_min: a, organic_per_week_max: b };
    });
  }

  function appStoreForm(v, sec) {
    const live = h("input", { type: "checkbox", checked: !!v.live, disabled: !owner });
    const pt = h("input", { placeholder: v.provider_token ? "Set. Paste a new one to replace it." : "e.g. 123456789", disabled: !owner, autocomplete: "off" });
    const ptBtn = h("button.btn.small", {
      type: "button", disabled: !owner,
      onclick: async () => {
        const val = pt.value.trim();
        if (!/^\d{3,20}$/.test(val)) return toast("The provider token (pt) is the number after pt= in an App Store campaign link", "warn");
        ptBtn.disabled = true;
        try {
          const out = await api("action/asc/set_provider_token", { pt: val });
          pt.value = "";
          sec.dirty = false;
          toast(out?.message ?? `Provider token saved${out?.filled != null ? `: ${out.filled} campaign links completed` : ""}`, "good");
        } catch (e) {
          toast(`Could not save the token: ${e.message}`, "bad");
        } finally {
          ptBtn.disabled = false;
        }
      },
    }, "Save token");
    return formWrap(sec, [
      h("div.small", "App id: ", h("code", v.app_id ?? "6817107338")),
      h("label.row", live, h("span", h("strong", "The app is live on the App Store")),
        h("span.hint", "Campaign links only work once it is.")),
      field("Provider token (pt)", h("div.row", { style: { flexWrap: "nowrap" } }, pt, ptBtn),
        v.provider_token
          ? "Set. Every post's campaign link is complete."
          : "Not set. Apple shows it after the first campaign link is made in App Store Connect (App Analytics, Campaigns), which needs the live app. Until then each post's campaign id is reserved and its link stays empty."),
    ], () => ({ live: live.checked }));
  }

  // ---- audit log -------------------------------------------------------------
  async function loadAudit() {
    const { data, error } = await supa.from("audit_log").select("*").order("at", { ascending: false }).limit(100);
    if (error) return clear(auditBox, h("div.notice.bad", `Could not load the audit log: ${error.message}`));
    if (!data.length) return clear(auditBox, empty("Nothing recorded yet."));
    clear(auditBox, h("div.table-wrap", { style: { maxHeight: "520px" } }, h("table.data",
      h("thead", h("tr", ["When", "Who", "Action", "What", "Change"].map((t) => h("th", t)))),
      h("tbody", data.map((r) => h("tr",
        h("td", { style: { whiteSpace: "nowrap" } }, fmt.dateTime(r.at)),
        h("td", r.actor_email ?? (r.actor ? "teammate" : "system")),
        h("td", fmt.label(r.action)),
        h("td", `${fmt.label(r.entity)}${r.entity_id ? ` ${r.entity_id}` : ""}`),
        h("td.small", { style: { minWidth: "240px" } }, summarize(r))))))));
  }

  renderMembers();
  Object.values(sections).forEach((s) => s.render());
  loadAudit();
  let auditTimer = null;

  const off = store.on((t) => {
    if (t === "members" || t === "*") renderMembers();
    if (t === "settings" || t === "*") Object.values(sections).forEach((s) => s.render());
    if (t !== "live" && t !== "metrics_snapshots" && t !== "jobs") {
      clearTimeout(auditTimer);
      auditTimer = setTimeout(loadAudit, 1500);
    }
  });
  return () => { off(); clearTimeout(auditTimer); };
}

function summarize(r) {
  const d = r.detail ?? {};
  if (r.action === "update") {
    const keys = Object.keys(d).filter((k) => !["updated_at", "updated_by"].includes(k));
    return keys.slice(0, 4).map((k) => {
      const [a, b] = d[k] ?? [];
      return `${fmt.label(k)}: ${short(a)} to ${short(b)}`;
    }).join("; ") + (keys.length > 4 ? `; ${keys.length - 4} more` : "");
  }
  if (r.action === "insert") return "created";
  if (r.action === "delete") return "deleted";
  if (d.body) return short(d.body, 120);
  return short(d, 120);
}

function short(v, n = 40) {
  const s = v == null ? "empty" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
