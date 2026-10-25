// Word reports: what learners flag with "Report this card" in the Maana app, read and triaged here instead of by
// email. A list of cards (one row per card, filter tabs), a page per card with its individual reports, and the triage
// actions on the reports you tick. Owners and editors of Maana only.
//
// Data comes from four database functions (studio.word_report_cards, word_reports, set_word_report_status,
// word_report_counts; maana/supabase/migrations/20261024170000_studio_word_reports.sql). They check the caller's
// role themselves, never return a reporter's user or device id, and never touch card content: shipping a fix stays a
// separate step (an app build or a content_patches row, docs/reports/TRIAGE.md). If the functions have not been applied
// yet, the page says so and shows the one command that sets them up. The rules live in ../reports.js (unit-tested).

import { supa } from "../supa.js";
import { store, href, setReportCounts } from "../store.js";
import { h, clear, toast, fmt, modal, empty } from "../ui.js";
import {
  RULE_LINE, SETUP_COMMAND, PAGE_SIZE_CAP, NOTE_MAX, TABS, STATUSES, ACTIONS,
  reportsEnabled, normalizeTab, normalizeCounts, tabCount, openSummary, cardCount, sortCards, cardMeta, breakdown, ofTotal, learnersLabel,
  categoryLabel, buildLabel, sensesList, statusLabel, statusKind, reportsLabel, topFixes, newestFirst, reportsForTab,
  countByStatus, startTab, isSelectable, selectableIds, actionProblem, noteProblem, rpcArgs, doneMessage, classifyError,
  cardPath, listPath,
} from "../reports.js";

// The list remembers its tab while you move around Studio (like What's winning remembers its metric).
const state = { tab: "open" };

/** supabase-js answers {data, error}; a network failure becomes an error too, so callers have one path. */
function call(name, args) {
  return Promise.resolve(supa.rpc(name, args)).then((r) => r, (e) => ({ data: null, error: e }));
}

const arabic = (text, size = "") =>
  h(`span.wr-ar${size ? "." + size : ""}`, { lang: "ar", dir: "rtl" }, text ?? "");

function head(actions) {
  return h("div.view-head",
    h("div", h("h1", "Word reports"),
      h("p", "What learners flagged with “Report this card” in the Maana app. Read and triage them here: nothing is emailed.")),
    actions ?? null);
}

const ruleLine = () => h("p.wr-rule", RULE_LINE);

function copyRow(text) {
  return h("div.copy-row.wr-copy",
    h("code", text),
    h("button.btn.small.ghost", {
      type: "button",
      onclick: async (e) => {
        const btn = e.currentTarget;
        try {
          await navigator.clipboard.writeText(text);
          btn.textContent = "Copied";
          setTimeout(() => { btn.textContent = "Copy"; }, 1500);
        } catch {
          toast("Copy failed: select the text instead", "warn");
        }
      },
    }, "Copy"));
}

/** The calm "not set up yet" page, with the exact command. */
function setupPanel() {
  return h("section.card.setup-panel.stack.wr-setup", { role: "status" },
    h("h2", { style: { margin: 0 } }, "Word reports are not set up yet"),
    h("p", { style: { margin: 0 } },
      "This page reads the “Report this card” submissions through four database functions, and they have not been applied " +
      "to the Maana project yet. Nothing is lost meanwhile: the reports are kept and will be here once this is done."),
    h("ol.setup-steps",
      h("li", "In Claude Code, in the Maana repo, run this once:", copyRow(SETUP_COMMAND)),
      h("li", "Reload this page.")),
    h("p.hint", { style: { margin: 0 } }, "The leading ! runs the line as a shell command in Claude Code. The Supabase CLI must be signed in to the Maana project."));
}

function problemPanel(err, retry) {
  if (err.kind === "not_set_up") return setupPanel();
  if (err.kind === "forbidden") {
    return h("div.notice", { role: "alert" }, "Word reports are for owners and editors of Maana. Ask an owner to change your role in Settings.");
  }
  return h("div.error-box", { role: "alert" },
    h("h2", "Could not load word reports"), h("pre", err.message),
    retry ? h("button.btn", { onclick: retry }, "Try again") : null);
}

function notAvailable() {
  const inMaana = store.wsId === "maana";
  return h("div.stack",
    head(),
    inMaana
      ? h("div.notice", "Word reports are for owners and editors of Maana.")
      : h("div.notice", "Word reports come from the Maana app, so they live in the Maana workspace. ",
        h("a", { href: "#/w/maana/reports" }, "Open Maana's word reports")));
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export function render(root, { params = {} } = {}) {
  if (!reportsEnabled(store.wsId, store.role)) {
    clear(root, notAvailable());
    return null;
  }
  const ctx = { stop: false };
  if (params.card) renderCard(root, ctx, String(params.card), params);
  else renderList(root, ctx, params);
  return () => { ctx.stop = true; };
}

// ---------------------------------------------------------------------------
// The list: one row per card
// ---------------------------------------------------------------------------

function renderList(root, ctx, params) {
  if (params.tab) state.tab = normalizeTab(params.tab);
  const S = { cards: null, counts: null, error: null, seq: 0 };
  const tabs = h("div.wr-tabs", { role: "tablist", "aria-label": "Which reports to show" });
  const summary = h("p.small.muted.wr-summary");
  const body = h("div");

  clear(root,
    head(h("button.btn.ghost.small", { type: "button", onclick: () => load() }, "Refresh")),
    ruleLine(), tabs, summary, body);

  function row(card) {
    const tab = state.tab;
    const n = cardCount(card, tab);
    const fix = (card.top_fixes ?? [])[0];
    const more = breakdown(card, tab);
    const who = learnersLabel(card, tab);
    const all = ofTotal(card, tab);
    const senses = sensesList(card.senses);
    return h("a.wr-row", { href: href(cardPath(card.card_key, tab)), role: "listitem" },
      arabic(card.lemma_ar),
      h("span.wr-who",
        h("strong", card.lemma_translit),
        h("span.small.muted", cardMeta(card)),
        senses.length ? h("span.small.wr-senses", senses.join(" · ")) : null),
      h("span.wr-what",
        h("span.tags", (card.categories ?? []).map((c) => h("span.tag.wr-cat", categoryLabel(c)))),
        fix ? h("span.small.muted", "Suggested: ", h("strong", { dir: "auto" }, fix.fix), fix.n > 1 ? ` (${fix.n})` : "") : null),
      h("span.wr-n",
        h("strong", reportsLabel(n)),
        more ? h("span.small.muted", more) : null,
        who ? h("span.small.muted", who) : null,
        all ? h("span.small.muted", all) : null,
        h("span.small.muted", card.last_reported_at ? `Last ${fmt.date(card.last_reported_at)}` : "")));
  }

  function draw() {
    // Until the database functions exist there is nothing to filter: just the setup message.
    if (S.error?.kind === "not_set_up") {
      clear(tabs);
      summary.textContent = "";
      return clear(body, problemPanel(S.error, load));
    }
    clear(tabs, TABS.map((t) => {
      const n = tabCount(S.counts, t.key);
      const on = state.tab === t.key;
      return h(`button.wr-tab${on ? ".active" : ""}`, {
        type: "button", role: "tab", "aria-selected": String(on),
        onclick: () => { if (state.tab !== t.key) { state.tab = t.key; load(); } },
      }, t.label, n != null ? h("span.wr-tab-n", String(n)) : null);
    }));
    summary.textContent = state.tab === "open" && S.counts ? openSummary(S.counts) : "";
    if (S.error) return clear(body, problemPanel(S.error, load));
    if (!S.cards) return clear(body, h("div.loading", "Loading"));
    if (!S.cards.length) {
      return clear(body, empty(state.tab === "open"
        ? "No open reports. New ones appear here when learners tap “Report this card”."
        : state.tab === "all" ? "No reports yet." : `Nothing in ${TABS.find((t) => t.key === state.tab).label} yet.`));
    }
    clear(body,
      h("div.wr-list", { role: "list" }, sortCards(S.cards, state.tab).map(row)),
      S.cards.length >= PAGE_SIZE_CAP ? h("p.hint", `Showing the first ${PAGE_SIZE_CAP} cards.`) : null);
  }

  async function load() {
    const seq = ++S.seq;
    S.cards = null;
    S.error = null;
    draw();
    const [cards, counts] = await Promise.all([call("word_report_cards", { p_status: state.tab }), call("word_report_counts")]);
    if (ctx.stop || seq !== S.seq) return;
    if (cards.error) {
      S.error = classifyError(cards.error);
      setReportCounts(null);
    } else {
      S.cards = cards.data ?? [];
      S.counts = counts.error ? null : normalizeCounts(counts.data);
      setReportCounts(counts.error ? null : counts.data);
    }
    draw();
  }

  load();
}

// ---------------------------------------------------------------------------
// One card: its reports, and the triage actions
// ---------------------------------------------------------------------------

function renderCard(root, ctx, key, params) {
  const S = {
    reports: null, error: null, tab: normalizeTab(params.tab), picked: false,
    selected: new Set(), busy: false, seq: 0, rows: new Map(),
  };
  const back = h("a.wr-back", { href: href(listPath(params.tab)) }, "← All word reports");
  const top = h("div");
  const tabs = h("div.wr-tabs", { role: "tablist", "aria-label": "Which of this card's reports to show" });
  const toolbar = h("div.wr-toolbar");
  const items = h("div.wr-reports");
  const bar = h("div.wr-bar-wrap");   // sticks to the bottom of the screen while reports are ticked
  clear(root, back, top, ruleLine(), tabs, toolbar, items, bar);

  const visible = () => reportsForTab(S.reports, S.tab);
  const chosen = () => (S.reports ?? []).filter((r) => S.selected.has(r.id));

  // ---- header: the word, what learners saw, the suggested fixes ----
  function fact(label, ...content) {
    const real = content.flat().filter((c) => c != null && c !== "");
    return real.length ? h("div.wr-fact", h("dt", label), h("dd", real)) : null;
  }

  function drawTop() {
    if (S.error) return clear(top, problemPanel(S.error, load));
    if (!S.reports) return clear(top, h("div.loading", "Loading"));
    if (!S.reports.length) {
      return clear(top, empty("No reports found for this card. It may have been removed.", h("a.btn.small", { href: href(listPath(params.tab)) }, "Back to the list")));
    }
    const newest = S.reports[0];
    const counts = countByStatus(S.reports);
    const fixes = topFixes(visible());
    const senses = sensesList(newest.card_senses);
    clear(top, h("section.card.wr-card.stack",
      h("div.wr-card-head",
        arabic(newest.card_lemma_ar, "xl"),
        h("div",
          h("h1", { style: { margin: 0 } }, newest.card_lemma_translit),
          h("p.small.muted", { style: { margin: "2px 0 0" } },
            cardMeta({ card_key: key, card_id: key.startsWith("rank:") ? null : key, rank: newest.card_rank }),
            ` · ${reportsLabel(S.reports.length)}`))),
      h("div.row", STATUSES.filter((s) => counts[s]).map((s) => h(`span.pill${statusKind(s) ? "." + statusKind(s) : ""}`, `${counts[s]} ${statusLabel(s).toLowerCase()}`))),
      h("dl.wr-facts",
        fact("What learners saw", senses.length ? h("span.tags", senses.map((s) => h("span.tag", s))) : null),
        fact("Example verse", newest.card_verse_key),
        fact("Highlighted word", newest.card_highlight_ar ? [arabic(newest.card_highlight_ar, "sm"), newest.card_highlight_gloss ? ` ${newest.card_highlight_gloss}` : ""] : null),
        fact(S.tab === "all" ? "Suggested fixes" : "Suggested fixes in this view",
          fixes.length ? h("span.tags", fixes.map((f) => h("span.tag.wr-fixtag", h("strong", { dir: "auto" }, f.fix), ` ×${f.n}`))) : null))));
  }

  // ---- tabs and the select-all line ----
  function drawTabs() {
    if (!S.reports?.length) return clear(tabs);
    clear(tabs, TABS.map((t) => {
      const n = reportsForTab(S.reports, t.key).length;
      const on = S.tab === t.key;
      return h(`button.wr-tab${on ? ".active" : ""}`, {
        type: "button", role: "tab", "aria-selected": String(on),
        onclick: () => { S.tab = t.key; S.picked = true; S.selected.clear(); drawAll(); },
      }, t.label, h("span.wr-tab-n", String(n)));
    }));
  }

  function drawToolbar() {
    const ids = selectableIds(visible());
    if (!ids.length) return clear(toolbar, visible().length ? h("p.small.muted", "Shipped reports are final here.") : null);
    const on = ids.filter((id) => S.selected.has(id)).length;
    clear(toolbar, h("label.check", {},
      h("input", {
        type: "checkbox", checked: on === ids.length, indeterminate: on > 0 && on < ids.length,
        onchange: (e) => {
          for (const id of ids) e.target.checked ? S.selected.add(id) : S.selected.delete(id);
          syncRows();
        },
      }),
      on ? `${on} of ${ids.length} selected` : `Select all ${ids.length}`),
    on ? null : h("span.small.muted", "Tick reports, then mark triaged, accept, decline or mark shipped."));
  }

  // ---- the reports ----
  function reportItem(r) {
    const selectable = isSelectable(r);
    const cb = h("input", {
      type: "checkbox", checked: S.selected.has(r.id), disabled: !selectable,
      "aria-label": `Select this ${categoryLabel(r.category).toLowerCase()} report from ${fmt.date(r.created_at)}`,
      onchange: (e) => {
        if (e.target.checked) S.selected.add(r.id); else S.selected.delete(r.id);
        syncRows();
      },
    });
    const newest = S.reports[0];
    const newestSenses = newest?.card_senses;
    const article = h(`article.wr-report${S.selected.has(r.id) ? ".selected" : ""}${selectable ? "" : ".final"}`,
      h("label.wr-pick", { title: selectable ? "Select this report" : "Shipped reports can't be changed here" }, cb),
      h("div.wr-report-body",
        h("div.row.wr-meta",
          h("span.tag.wr-cat", categoryLabel(r.category)),
          h(`span.pill${statusKind(r.status) ? "." + statusKind(r.status) : ""}`, statusLabel(r.status)),
          r.notify ? h("span.tag", { title: "The learner asked to be told when it's fixed" }, "Asked to be told") : null,
          h("span.small.muted", `${buildLabel(r)} · ${fmt.dateTime(r.created_at)}`)),
        r.suggested_fix
          ? h("p.wr-fix", h("span.small.muted", "Suggested fix"), h("strong", { dir: "auto" }, r.suggested_fix))
          : h("p.small.muted", { style: { margin: 0 } }, "No fix suggested"),
        r.notes ? h("p.wr-notes", { dir: "auto" }, r.notes) : null,
        r.card_verse_key && (r.card_verse_key !== newest?.card_verse_key || r.card_highlight_ar !== newest?.card_highlight_ar)
          ? h("p.small.muted.wr-example", `That learner saw the example ${r.card_verse_key}`,
            r.card_highlight_ar ? [", highlighted ", arabic(r.card_highlight_ar, "sm")] : null,
            r.card_highlight_gloss ? ` (${r.card_highlight_gloss})` : null)
          : null,
        r.card_senses && r.card_senses !== newestSenses
          ? h("p.small.muted.wr-example", `That learner saw: ${sensesList(r.card_senses).join(" · ")}`) : null,
        r.resolution_note || r.resolved_at || r.content_version != null
          ? h("p.small.wr-resolution",
            r.resolution_note ? [h("strong", "Note: "), r.resolution_note] : null,
            r.resolved_at ? h("span.muted", `${r.resolution_note ? " · " : ""}${statusLabel(r.status)} ${fmt.date(r.resolved_at)}`) : null,
            r.content_version != null ? h("span.muted", ` · content patch v${r.content_version}`) : null)
          : null));
    S.rows.set(r.id, { article, cb });
    return article;
  }

  function drawItems() {
    S.rows.clear();
    if (!S.reports?.length) return clear(items);
    const list = visible();
    clear(items, list.length
      ? list.map(reportItem)
      : empty(`None of this card's reports are ${S.tab === "open" ? "open" : S.tab}.`));
  }

  /** Selection changed: update the rows, the select-all line and the action bar in place (no focus is lost). */
  function syncRows() {
    for (const [id, { article, cb }] of S.rows) {
      const on = S.selected.has(id);
      article.classList.toggle("selected", on);
      cb.checked = on;
    }
    drawToolbar();
    drawBar();
  }

  // ---- the action bar ----
  function drawBar() {
    const sel = chosen();
    if (!sel.length) return clear(bar);
    const button = (key, kind) => {
      const a = ACTIONS[key];
      const problem = actionProblem(key, sel);
      return h(`button.btn.small${kind}`, {
        type: "button", disabled: S.busy || !!problem, title: problem ?? "",
        onclick: () => run(key),
      }, a.label + (a.needsNote || a.confirm ? "…" : ""));
    };
    clear(bar, h("div.wr-bar", { role: "region", "aria-label": "Actions for the selected reports" },
      h("strong.wr-bar-n", S.busy ? "Saving…" : `${sel.length} selected`),
      h("div.row.wr-bar-actions",
        button("triage", ".ghost"), button("accept", ".primary"), button("decline", ".danger"), button("ship", ".coral")),
      h("button.link-btn", { type: "button", disabled: S.busy, onclick: () => { S.selected.clear(); syncRows(); } }, "Clear")));
  }

  function drawAll() {
    drawTop();
    drawTabs();
    drawToolbar();
    drawItems();
    drawBar();
  }

  // ---- doing something with the selection ----
  async function run(actionKey) {
    const sel = chosen();
    const problem = actionProblem(actionKey, sel);
    if (problem) return toast(problem, "warn");
    let note = null;
    if (ACTIONS[actionKey].needsNote || ACTIONS[actionKey].confirm) {
      const answer = await askNote(actionKey, sel);
      if (!answer || ctx.stop) return;
      note = answer.note;
    }
    S.busy = true;
    drawBar();
    const ids = sel.map((r) => r.id);
    const { data, error } = await call("set_word_report_status", rpcArgs(actionKey, ids, note));
    S.busy = false;
    if (ctx.stop) return;
    if (error) {
      toast(`Could not save: ${error.message}`, "bad");
      return drawBar();
    }
    const changed = (data ?? []).length;
    toast(doneMessage(actionKey, changed), "good");
    if (changed < ids.length) toast(`${reportsLabel(ids.length - changed)} could not be found (removed since this page loaded).`, "warn");
    S.selected.clear();
    await load();
  }

  async function load() {
    const seq = ++S.seq;
    S.error = null;
    const [out, counts] = await Promise.all([call("word_reports", { p_card: key }), call("word_report_counts")]);
    if (ctx.stop || seq !== S.seq) return;
    if (out.error) {
      S.error = classifyError(out.error);
      S.reports = null;
    } else {
      S.reports = newestFirst(out.data ?? []);
      if (!S.picked) S.tab = startTab(S.reports, S.tab);
      // Drop ticks for reports that are gone or have become final.
      const keep = new Set(selectableIds(S.reports));
      for (const id of [...S.selected]) if (!keep.has(id)) S.selected.delete(id);
    }
    if (!counts.error) setReportCounts(counts.data);
    drawAll();
  }

  drawAll();
  load();
}

// ---------------------------------------------------------------------------
// Decline and Mark shipped ask first
// ---------------------------------------------------------------------------

/**
 * The dialog for Decline (a note is required: the learner reads it) and Mark shipped (a confirmation that the fix is
 * already live, plus an optional note). Resolves {note} when confirmed, null when cancelled.
 */
function askNote(actionKey, selected) {
  return new Promise((resolve) => {
    const ship = actionKey === "ship";
    const n = selected.length;
    const note = h("textarea.wr-input", {
      rows: 4, maxlength: String(NOTE_MAX), "aria-label": ship ? "Where it shipped (optional)" : "Note for the learner",
      placeholder: ship ? "Optional. For example: Fixed in version 1.0.3." : "For example: We kept this because …",
    });
    const live = ship ? h("input", { type: "checkbox" }) : null;
    const problem = h("p.small", { style: { margin: 0, color: "var(--red)" }, role: "alert" });
    const go = h(`button.btn${ship ? ".coral" : ".danger"}`, { type: "button", disabled: true }, ship ? "Mark shipped" : `Decline ${reportsLabel(n)}`);

    function refresh() {
      const bad = noteProblem(actionKey, note.value);
      problem.textContent = note.value.trim() && bad ? bad : "";
      go.disabled = !!bad || (ship && !live.checked);
    }
    note.addEventListener("input", refresh);
    live?.addEventListener("change", refresh);
    go.addEventListener("click", () => {
      if (go.disabled) return;
      resolve({ note: note.value.trim() });   // resolve before close(): close() fires onClose, which resolves null
      m.close();
    });

    const fixes = topFixes(selected, 3);
    const m = modal(ship ? `Mark ${reportsLabel(n)} as shipped?` : `Decline ${reportsLabel(n)}`, [
      ship
        ? h("div.stack",
          h("div.notice", h("strong", "Only do this once the fix is live. "),
            "Shipped tells learners the card is fixed. The fix must already be in an app build that has been released, " +
            "or in an active row of content_patches (the steps are in docs/reports/TRIAGE.md)."),
          h("p", { style: { margin: 0 } }, "Studio does not change any card or content patch: it only records the status. Learners who asked to be told will see an “It’s fixed” message the next time they open the app."),
          h("p.small.muted", { style: { margin: 0 } }, "A fix shipped as a content patch is closed with tools/reports/02_accept_and_ship.sql, which also records the patch version for that message. Use Mark shipped for fixes that went out in an app build."),
          h("label.check", live, " The fix is already live in a released build or an active content patch."),
          h("label.field", h("span.field-label", "Where it shipped (the learner can read this)"), note))
        : h("div.stack",
          h("p", { style: { margin: 0 } }, "Say why the card stays as it is. The learner can read this note under “Your reports” in the app, so keep it short and kind."),
          fixes.length
            ? h("p.small.muted", { style: { margin: 0 } }, "Suggested in these reports: ",
              fixes.map((f, i) => [i ? ", " : "", h("bdi", f.fix), ` (${f.n})`]), ".")
            : null,
          h("label.field", h("span.field-label", "Note for the learner"), note)),
      problem,
      h("div.row.end",
        h("button.btn.ghost", { type: "button", onclick: () => { resolve(null); m.close(); } }, "Cancel"),
        go),
    ], { onClose: () => resolve(null) });
    (ship ? live : note).focus();
  });
}
