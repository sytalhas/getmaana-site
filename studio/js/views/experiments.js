// Experiments: pre-registered A/B tests (organic, Instagram trial reels, Meta
// Ads split tests) with a live comparison that will not call a winner before
// the minimum sample, and a recorded decision.
//
// Routes: #/experiments, #/experiments/new, #/experiments/<id>, #/experiments/<id>/edit

import { h, clear, fmt, toast, pill, select, field, empty, confirmAction } from "../ui.js";
import { store } from "../store.js";
import { supa, api } from "../supa.js";
import { KPI_BY_KEY, LEVERS, WIN_METRICS, buildRows, compareVariants, sampleSizeFor } from "../kpi.js";
import { kpiText, pText, progressBar, ensureStyle } from "../charts.js";

const KINDS = [["organic_ab", "Organic A/B"], ["ig_trial", "Instagram trial reels"], ["meta_split", "Meta Ads split test"]];
const KIND_LABEL = Object.fromEntries(KINDS);
const UNITS = ["views", "impressions", "installs", "posts"];
const METRICS = [...new Set(["hook_rate", "hold_rate", ...WIN_METRICS])];
const LEVER_OPTS = [...LEVERS.map((l) => [l.key, l.label]), ["caption", "Caption"], ["cover", "Cover frame"], ["posting_time", "Posting time"], ["other", "Other"]];
const EXP_STATUS_KIND = { draft: "", running: "info", decided: "good", abandoned: "muted" };

const expPill = (s) => pill(s, EXP_STATUS_KIND[s] ?? "");
const leverLabel = (k) => LEVER_OPTS.find(([v]) => v === k)?.[1] ?? fmt.label(k);
const reelTitle = (id) => (id ? `${id}${store.reels.get(id)?.title ? `: ${store.reels.get(id).title}` : ""}` : "No reel");

function expRows(exp) {
  const posts = [...store.posts.values()].filter((p) => p.experiment_id === exp.id);
  return { posts, rows: buildRows(posts, store.reels, (id) => store.latest(id)) };
}

// There is no notes column in studio.experiments yet; use one if a later
// migration adds it, otherwise keep notes inside platform_ref.notes.
const notesOf = (exp) => ("notes" in exp ? exp.notes : exp.platform_ref?.notes) ?? "";
function notesPatch(exp, text) {
  if ("notes" in exp) return { notes: text };
  const cur = store.experiments.get(exp.id)?.platform_ref ?? exp.platform_ref ?? {};
  return { platform_ref: { ...cur, notes: text } };
}

async function userId() {
  const { data } = await supa.auth.getUser();
  return data?.user?.id ?? null;
}

async function update(id, patch) {
  const { data, error } = await supa.from("experiments").update(patch).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  if (data) { store.experiments.set(data.id, data); store.emit("experiments"); }
  return data;
}

export function render(root, { rest = [] } = {}) {
  ensureStyle();
  const [id, sub] = rest;
  if (id === "new") return formView(root, null);
  if (id && sub === "edit") return formView(root, id);
  if (id) return detailView(root, id);
  return listView(root);
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function listView(root) {
  const head = h("div.view-head",
    h("div", h("h1", "Experiments"), h("p", "Pre-register the metric and minimum sample, then let the data decide.")),
    store.canEdit() ? h("a.btn.primary", { href: "#/experiments/new" }, "New experiment") : null);
  const body = h("div");
  clear(root, head, body);

  function draw() {
    const exps = [...store.experiments.values()].sort((a, b) =>
      (a.status === "running" ? 0 : a.status === "draft" ? 1 : 2) - (b.status === "running" ? 0 : b.status === "draft" ? 1 : 2) ||
      String(b.created_at).localeCompare(String(a.created_at)));
    if (!exps.length) {
      clear(body, empty("No experiments yet.", store.canEdit() ? h("a.btn", { href: "#/experiments/new" }, "Pre-register the first one") : null));
      return;
    }
    clear(body, h("div.table-wrap", h("table.data",
      h("thead", h("tr", h("th", "Name"), h("th", "Kind"), h("th", "Lever"), h("th", "Metric"), h("th", "Status"),
        h("th", "Progress to minimum"), h("th", "Verdict"))),
      h("tbody", exps.map((exp) => {
        const { rows } = expRows(exp);
        const cmp = compareVariants(rows, exp);
        const minProg = cmp.variants.length ? Math.min(...cmp.variants.map((v) => v.progress)) : 0;
        const verdict = exp.status === "decided"
          ? `Decided: ${exp.decision_variant || "no winner"}`
          : exp.status === "abandoned" ? "Abandoned" : cmp.verdict;
        return h("tr",
          h("td", h("a", { href: `#/experiments/${exp.id}` }, h("strong", exp.name))),
          h("td", KIND_LABEL[exp.kind] ?? exp.kind),
          h("td", leverLabel(exp.lever)),
          h("td", KPI_BY_KEY[exp.metric]?.label ?? exp.metric),
          h("td", expPill(exp.status)),
          h("td", { style: { minWidth: "140px" } }, progressBar(minProg, minProg >= 1 ? "" : "coral"),
            h("div.small.muted", `Slowest variant at ${Math.round(minProg * 100)}%`)),
          h("td.small", verdict));
      })))));
  }
  draw();
  return store.on(() => draw());
}

// ---------------------------------------------------------------------------
// Create / edit (pre-registration)
// ---------------------------------------------------------------------------

function formView(root, id) {
  const exp = id ? store.experiments.get(id) : null;
  if (id && !exp) { clear(root, empty("This experiment does not exist or was deleted.", h("a.btn", { href: "#/experiments" }, "All experiments"))); return; }
  if (!store.canEdit()) { clear(root, empty("Viewers can read experiments but not edit them.", h("a.btn", { href: "#/experiments" }, "All experiments"))); return; }
  const locked = exp && exp.status !== "draft";
  const dis = locked ? { disabled: true } : {};
  const v = exp ?? { kind: "organic_ab", metric: "hook_rate", sample_unit: "views", lever: "hook_type",
    variants: [{ label: "A", reel_id: "" }, { label: "B", reel_id: "" }] };

  const name = h("input", { value: v.name ?? "", required: true, maxlength: 120, ...dis });
  const hypothesis = h("textarea", { required: true, placeholder: "If we open on a question instead of a statement, hook rate rises, because ...", ...dis }, v.hypothesis ?? "");
  const lever = select(LEVER_OPTS, v.lever, dis);
  const kind = select(KINDS, v.kind, dis);
  const metric = select(METRICS.map((k) => [k, KPI_BY_KEY[k].label]), v.metric, dis);
  const minSample = h("input", { type: "number", min: 1, step: 1, value: v.min_sample ?? "", required: true, ...dis });
  const unit = select(UNITS, v.sample_unit, dis);
  const budget = h("input", { type: "number", min: 0, step: "0.01", value: v.budget_usd ?? "", ...dis });
  const starts = h("input", { type: "date", value: v.starts_at?.slice(0, 10) ?? "", ...dis });
  const ends = h("input", { type: "date", value: v.ends_at?.slice(0, 10) ?? "", ...dis });
  const notes = h("textarea", { placeholder: "Anything the team should know while it runs" }, notesOf(v));
  const budgetField = field("Budget (USD)", budget, "Total for the whole split test. The server also enforces the Studio spend cap.");
  const sampleHint = h("span.hint");

  const reelOpts = [["", "Choose a reel"], ...[...store.reels.values()].sort((a, b) => a.id.localeCompare(b.id)).map((r) => [r.id, reelTitle(r.id)])];
  const variantsEl = h("div.stack");
  function variantRow(vr = {}) {
    const row = h("div.variant-row",
      field("Label", h("input", { value: vr.label ?? "", maxlength: 40, "data-k": "label", ...dis })),
      field("Reel", select(reelOpts, vr.reel_id ?? "", { "data-k": "reel_id", ...dis })),
      locked ? h("span") : h("button.btn.ghost.small", { type: "button", onclick: () => row.remove() }, "Remove"));
    return row;
  }
  for (const vr of v.variants ?? []) variantsEl.append(variantRow(vr));

  function syncKind() { budgetField.style.display = kind.value === "meta_split" ? "" : "none"; }
  function syncHint() {
    const k = KPI_BY_KEY[metric.value];
    if (!k?.rate) { sampleHint.textContent = "Per variant, counted in the sample unit."; return; }
    const allRows = buildRows([...store.posts.values()], store.reels, (pid) => store.latest(pid));
    const base = k.calc(allRows);
    const n = sampleSizeFor(base.value, 0.2);
    sampleHint.textContent = n
      ? `Per variant. At the current overall ${k.label.toLowerCase()} of ${kpiText(k, base.value)} (${base.posts} posts), detecting a 20% relative lift with 80% power at p < 0.05 needs about ${fmt.int(n)} ${k.denLabel} per variant.`
      : `Per variant. No baseline ${k.label.toLowerCase()} yet to size the test from.`;
  }
  kind.addEventListener("change", syncKind);
  metric.addEventListener("change", syncHint);
  syncKind();
  syncHint();

  const changed = h("div");
  const form = h("form.card.stack", { onsubmit: async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      if (locked) {
        await update(exp.id, notesPatch(exp, notes.value));
        toast("Notes saved", "good");
        location.hash = `#/experiments/${exp.id}`;
        return;
      }
      const variants = [...variantsEl.children].map((r) => ({
        label: r.querySelector("[data-k=label]").value.trim(),
        reel_id: r.querySelector("[data-k=reel_id]").value || null,
      })).filter((x) => x.label || x.reel_id);
      const labels = variants.map((x) => x.label);
      if (variants.length < 2) throw new Error("Add at least two variants.");
      if (labels.some((l) => !l)) throw new Error("Every variant needs a label.");
      if (new Set(labels).size !== labels.length) throw new Error("Variant labels must be unique.");
      if (kind.value !== "organic_ab" && variants.some((x) => !x.reel_id)) throw new Error("Trial reels and split tests need a reel for every variant.");
      const min = parseInt(minSample.value, 10);
      if (!(min > 0)) throw new Error("Minimum sample must be a positive whole number.");
      const payload = {
        name: name.value.trim(), hypothesis: hypothesis.value.trim(), lever: lever.value, kind: kind.value,
        metric: metric.value, min_sample: min, sample_unit: unit.value, variants,
        budget_usd: kind.value === "meta_split" && budget.value !== "" ? Number(budget.value) : null,
        starts_at: starts.value ? new Date(starts.value + "T00:00:00").toISOString() : null,
        ends_at: ends.value ? new Date(ends.value + "T23:59:59").toISOString() : null,
      };
      if (!payload.name || !payload.hypothesis) throw new Error("Name and hypothesis are required.");
      if (payload.kind === "meta_split" && !(payload.budget_usd > 0)) throw new Error("A Meta split test needs a budget.");
      let saved;
      if (exp) saved = await update(exp.id, { ...payload, ...notesPatch(exp, notes.value) });
      else {
        const { data, error } = await supa.from("experiments")
          .insert({ ...payload, status: "draft", created_by: await userId(), platform_ref: notes.value ? { notes: notes.value } : {} })
          .select().single();
        if (error) throw new Error(error.message);
        saved = data;
        store.experiments.set(saved.id, saved);
        store.emit("experiments");
      }
      toast("Experiment saved as a draft", "good");
      location.hash = `#/experiments/${saved.id}`;
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      btn.disabled = false;
    }
  } },
  locked ? h("div.notice.info", `This experiment is ${exp.status}, so its pre-registration is locked. Only notes can change.`) : null,
  changed,
  field("Name", name),
  field("Hypothesis", hypothesis, "Write it before any data: what you expect to change, and why."),
  h("div.grid.cols-3", field("Lever", lever), field("Kind", kind), field("Metric", metric)),
  h("div.grid.cols-3", field("Minimum sample", minSample), field("Sample unit", unit), budgetField),
  sampleHint,
  h("div", h("div.field-label", "Variants"), variantsEl,
    locked ? null : h("button.btn.ghost.small", { type: "button", style: { marginTop: "8px" },
      onclick: () => variantsEl.append(variantRow({ label: String.fromCharCode(65 + variantsEl.children.length) })) }, "Add variant")),
  h("div.grid.cols-3", field("Starts", starts), field("Ends", ends)),
  field("Notes", notes),
  h("div.row.end", h("a.btn.ghost", { href: exp ? `#/experiments/${exp.id}` : "#/experiments" }, "Cancel"),
    h("button.btn.primary", { type: "submit" }, locked ? "Save notes" : "Save draft")));

  clear(root, h("div.view-head", h("div", h("h1", exp ? `Edit: ${exp.name}` : "New experiment"),
    h("p", "Pre-registration: fix the metric and minimum sample before the data comes in."))), form);

  // Never rebuild the form under someone's cursor; just tell them it changed.
  const seen = exp?.updated_at;
  return store.on(() => {
    const now = id ? store.experiments.get(id) : null;
    if (id && (!now || now.updated_at !== seen)) {
      clear(changed, h("div.notice", now ? `A teammate changed this experiment (now ${now.status}). Saving will overwrite their edit.` : "This experiment was deleted by a teammate."));
    }
  });
}

// ---------------------------------------------------------------------------
// Detail: live comparison, platform actions, notes, decision
// ---------------------------------------------------------------------------

function detailView(root, id) {
  const headEl = h("div"), preregEl = h("div"), compareEl = h("section.section"), actionsEl = h("section.section"),
    notesEl = h("section.section"), decisionEl = h("section.section");
  clear(root, headEl, preregEl, compareEl, actionsEl, notesEl, decisionEl);
  let lastStatus = null;

  function drawHead(exp) {
    clear(headEl, h("div.view-head",
      h("div", h("p.small", h("a", { href: "#/experiments" }, "All experiments")),
        h("h1", exp.name), h("div.row", expPill(exp.status), pill(KIND_LABEL[exp.kind] ?? exp.kind, "info"))),
      store.canEdit() && exp.status === "draft" ? h("a.btn", { href: `#/experiments/${exp.id}/edit` }, "Edit pre-registration") : null));
  }

  function drawPrereg(exp) {
    const k = KPI_BY_KEY[exp.metric];
    const cap = store.setting("ads_spend_cap");
    clear(preregEl, h("div.card",
      h("h3", "Pre-registration"),
      h("dl.kv",
        h("dt", "Hypothesis"), h("dd", exp.hypothesis),
        h("dt", "Lever"), h("dd", leverLabel(exp.lever)),
        h("dt", "Metric"), h("dd", k ? `${k.label} (${k.help})` : exp.metric),
        h("dt", "Minimum sample"), h("dd", `${fmt.int(exp.min_sample)} ${exp.sample_unit} per variant`),
        h("dt", "Variants"), h("dd", (exp.variants ?? []).map((v) => h("div", h("strong", v.label), ` ${reelTitle(v.reel_id)}`))),
        exp.kind === "meta_split" ? [h("dt", "Budget"), h("dd", exp.budget_usd != null ? `${fmt.usd(Number(exp.budget_usd))} (spend cap ${cap?.total_usd != null ? fmt.usd(Number(cap.total_usd)) : "not set"})` : "Not set")] : null,
        h("dt", "Dates"), h("dd", `${exp.starts_at ? `From ${fmt.date(exp.starts_at)}` : "No start date"}, ${exp.ends_at ? `until ${fmt.date(exp.ends_at)}` : "no end date"}`),
        h("dt", "Created"), h("dd", fmt.dateTime(exp.created_at)))));
  }

  function drawCompare(exp) {
    const k = KPI_BY_KEY[exp.metric];
    const { posts, rows } = expRows(exp);
    const cmp = compareVariants(rows, exp);
    const labels = new Set((exp.variants ?? []).map((v) => v.label));
    const stray = posts.filter((p) => !labels.has(p.variant_label));
    const kind = cmp.winner ? "good" : cmp.ready ? "info" : "";
    clear(compareEl,
      h("h2", "Live comparison"),
      h("div.table-wrap", h("table.data",
        h("thead", h("tr", h("th", "Variant"), h("th", "Reel"), h("th.num", "Posts"), h("th.num", k?.label ?? exp.metric),
          h("th.num", "Sample behind the rate"), h("th", `Progress to ${fmt.int(exp.min_sample)} ${exp.sample_unit}`))),
        h("tbody", cmp.variants.map((v) => h("tr",
          h("td", h("strong", v.label), cmp.winner === v.label ? [" ", pill("winner", "good")] : null),
          h("td", { style: { minWidth: "140px" } }, reelTitle(v.reel_id)),
          h("td.num", String(v.n)),
          h("td.num", v.kpi.value == null ? h("span.nodata", "no data") : kpiText(k, v.kpi.value)),
          h("td.num", v.kpi.posts ? `${fmt.int(v.kpi.num)} / ${fmt.int(v.kpi.den)} ${k?.denLabel ?? ""}` : h("span.nodata", "no data")),
          h("td", { style: { minWidth: "160px" } }, progressBar(v.progress, v.met ? "" : "coral"),
            h("div.small.muted", `${fmt.int(v.sample)} of ${fmt.int(exp.min_sample)} (${Math.round(v.progress * 100)}%)`))))))),
      cmp.test ? h("p.small.muted", `Two-proportion z-test, leader vs runner-up: z = ${cmp.test.z.toFixed(2)}, p ${cmp.test.p < 0.001 ? "" : "= "}${pText(cmp.test.p)}. ` +
        "Views are treated as independent, which overstates confidence when they cluster by post.") : null,
      h("div.notice" + (kind ? "." + kind : ""), h("strong", "Verdict: "), cmp.verdict),
      stray.length ? h("p.small.muted", `${stray.length} post(s) are linked to this experiment without a matching variant label and are left out.`) : null,
      !posts.length ? h("p.small.muted", "No posts are linked to this experiment yet. Launch each variant with the experiment selected.") : null);
    return cmp;
  }

  async function runAction(name, body, label) {
    try {
      const out = await api(`action/meta_ads/${name}`, body);
      toast(out?.message ?? `${label}: done`, "good");
    } catch (e) {
      toast(`${label} failed: ${e.message}`, "bad");
    }
  }

  function drawActions(exp) {
    if (!store.canEdit()) { clear(actionsEl); return; }
    const open = exp.status === "draft" || exp.status === "running";
    const parts = [];
    if (exp.status === "draft") {
      parts.push(h("button.btn.primary", { onclick: async () => {
        const ok = await confirmAction("Start this experiment?", [
          "Starting locks the pre-registration: hypothesis, metric, minimum sample and variants can no longer change.",
          "Notes stay editable."], "Start and lock");
        if (!ok) return;
        try {
          await update(exp.id, { status: "running", starts_at: exp.starts_at ?? new Date().toISOString() });
          toast("Experiment running", "good");
        } catch (e) { toast(e.message, "bad"); }
      } }, "Start experiment"));
    }
    if (open) {
      parts.push(h("button.btn.ghost", { onclick: async () => {
        const ok = await confirmAction("Abandon this experiment?", ["It stays in the list, marked abandoned, with no decision."], "Abandon");
        if (!ok) return;
        try { await update(exp.id, { status: "abandoned" }); } catch (e) { toast(e.message, "bad"); }
      } }, "Abandon"));
    }

    const launch = [];
    if (exp.status === "running" && (exp.kind === "ig_trial" || exp.kind === "organic_ab")) {
      const type = exp.kind === "ig_trial" ? "trial" : "organic";
      for (const v of exp.variants ?? []) {
        if (!v.reel_id) continue;
        const q = new URLSearchParams({ reel: v.reel_id, type, experiment: exp.id, variant: v.label });
        launch.push(h("a.btn" + (exp.kind === "ig_trial" ? ".coral" : ""), { href: `#/launch?${q}` },
          exp.kind === "ig_trial" ? `Launch ${v.label} as a trial reel` : `Launch ${v.label}`));
      }
    }

    let ads = null;
    if (exp.kind === "meta_split") {
      const ref = Object.entries(exp.platform_ref ?? {}).filter(([key]) => key !== "notes");
      const cap = store.setting("ads_spend_cap") ?? {};
      const budget = exp.budget_usd != null ? Number(exp.budget_usd) : null;
      ads = h("div.card.stack",
        h("h3", "Meta Ads split test"),
        ref.length ? h("dl.kv", ref.map(([key, val]) => [h("dt", fmt.label(key)), h("dd", typeof val === "object" ? JSON.stringify(val) : String(val))]))
          : h("p.small.muted", "No ad objects yet."),
        h("div.row",
          h("button.btn", { disabled: !open, onclick: async () => {
            if (!(budget > 0)) { toast("Set a budget in the pre-registration first.", "bad"); return; }
            const ok = await confirmAction("Create a paused split test?", [
              `Creates a Meta Ads split test with ${(exp.variants ?? []).length} variants (${(exp.variants ?? []).map((v) => `${v.label}: ${v.reel_id}`).join(", ")}).`,
              `Budget ${fmt.usd(budget)}. Everything is created paused, so nothing spends until someone activates it.`], "Create paused");
            if (ok) runAction("create_split_test", { confirm: true, experiment_id: exp.id }, "Create split test");
          } }, "Create paused split test"),
          h("button.btn.coral", { disabled: exp.status !== "running", title: exp.status !== "running" ? "Start the experiment first so the pre-registration is locked" : "",
            onclick: async () => {
              const total = cap.total_usd != null ? Number(cap.total_usd) : null;
              if (!(budget > 0)) { toast("Set a budget in the pre-registration first.", "bad"); return; }
              if (total != null && budget > total) { toast(`Budget ${fmt.usd(budget)} is above the spend cap of ${fmt.usd(total)}. The owner can raise the cap in Settings.`, "bad"); return; }
              const ok = await confirmAction("Activate: this starts spending money", [
                `Budget for this test: ${fmt.usd(budget)}.`,
                `Studio spend cap: ${total != null ? fmt.usd(total) + " total" : "no total cap set"}${cap.daily_usd != null ? `, ${fmt.usd(Number(cap.daily_usd))} per day` : ""}. The server refuses anything above the cap.`,
                "Meta starts delivering and charging the ad account as soon as you confirm. You can pause at any time."], "Activate and spend");
              if (ok) runAction("activate", { confirm: true, experiment_id: exp.id }, "Activate");
            } }, "Activate (starts spending)"),
          h("button.btn.ghost", { onclick: () => runAction("pause", { experiment_id: exp.id }, "Pause") }, "Pause"),
          h("button.btn.ghost", { onclick: () => runAction("sync_insights", { experiment_id: exp.id }, "Sync ad insights") }, "Sync ad insights")));
    }

    clear(actionsEl,
      parts.length || launch.length ? h("div.row", parts, launch) : null,
      launch.length && exp.kind === "ig_trial" ? h("p.hint", "Trial reels are shown to non-followers first. Each launch is linked to this experiment and variant.") : null,
      exp.status === "draft" && exp.kind !== "meta_split" ? h("p.hint", "Start the experiment to launch its variants, so no data arrives before the pre-registration is locked.") : null,
      ads);
  }

  function drawNotes(exp, keep) {
    const text = h("textarea", { disabled: !store.canEdit() }, keep ?? notesOf(exp));
    clear(notesEl, h("h2", "Notes"),
      store.canEdit()
        ? h("div.stack", text, h("div.row.end", h("button.btn", { onclick: async (e) => {
          e.target.disabled = true;
          try {
            await update(exp.id, notesPatch(store.experiments.get(id) ?? exp, text.value));
            toast("Notes saved", "good");
          } catch (err) { toast(err.message, "bad"); } finally { e.target.disabled = false; }
        } }, "Save notes")))
        : (notesOf(exp) ? h("p", notesOf(exp)) : h("p.muted", "No notes.")));
  }

  function memberName(uid) {
    const m = [...store.members.values()].find((x) => x.user_id === uid);
    return m ? (m.name || m.email) : "a teammate";
  }

  function drawDecision(exp, keep = {}) {
    if (exp.status === "decided") {
      clear(decisionEl, h("h2", "Decision"), h("div.notice.good",
        h("p", h("strong", exp.decision_variant ? `Winner: ${exp.decision_variant}` : "No winner")),
        exp.decision ? h("p", exp.decision) : null,
        h("p.small", `Recorded by ${memberName(exp.decided_by)} on ${fmt.dateTime(exp.decided_at)}.`)));
      return;
    }
    if (exp.status !== "running" || !store.canEdit()) {
      clear(decisionEl, exp.status === "running" ? [h("h2", "Decision"), h("p.muted", "Not decided yet.")] : null);
      return;
    }
    const winner = select([["", "No winner (tie or inconclusive)"], ...(exp.variants ?? []).map((v) => [v.label, v.label])], keep.winner ?? "");
    const text = h("textarea", { placeholder: "What we decided and what we will do next" }, keep.text ?? "");
    const ack = h("input", { type: "checkbox", checked: !!keep.ack });
    const early = h("label.row.small", ack, "I know the minimum sample is not met and this decision is early.");
    decisionEl._read = () => ({ winner: winner.value, text: text.value, ack: ack.checked });
    clear(decisionEl, h("h2", "Record a decision"), h("div.card.stack",
      field("Winner", winner), field("Decision", text), early,
      h("div.row.end", h("button.btn.primary", { onclick: async (e) => {
        const cur = store.experiments.get(id) ?? exp;
        const cmp = compareVariants(expRows(cur).rows, cur);
        if (!text.value.trim()) { toast("Write down the decision first.", "bad"); return; }
        if (!cmp.ready && !ack.checked) { toast("The minimum sample is not met. Tick the box to record an early decision.", "bad"); return; }
        if (winner.value && cmp.ready && cmp.winner !== winner.value) {
          const ok = await confirmAction("This differs from the test", [
            cmp.winner ? `The test's significant leader is ${cmp.winner}.` : "The test found no significant difference.",
            `You are recording ${winner.value} as the winner.`], "Record anyway");
          if (!ok) return;
        }
        e.target.disabled = true;
        try {
          await update(id, { status: "decided", decision: text.value.trim(), decision_variant: winner.value || null,
            decided_at: new Date().toISOString(), decided_by: await userId() });
          toast("Decision recorded", "good");
        } catch (err) { toast(err.message, "bad"); e.target.disabled = false; }
      } }, "Record decision"))));
  }

  function draw() {
    const exp = store.experiments.get(id);
    if (!exp) { clear(root, empty("This experiment does not exist or was deleted.", h("a.btn", { href: "#/experiments" }, "All experiments"))); return; }
    drawHead(exp);
    drawPrereg(exp);
    drawCompare(exp);
    drawActions(exp);
    // Forms rebuild only when the status changes, keeping anything typed.
    if (exp.status !== lastStatus) {
      const typedNotes = lastStatus != null ? notesEl.querySelector("textarea")?.value : undefined;
      const typedDecision = decisionEl._read?.();
      drawNotes(exp, typedNotes);
      drawDecision(exp, typedDecision);
      lastStatus = exp.status;
    }
  }

  draw();
  return store.on(() => draw());
}
