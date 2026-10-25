// Word reports (Maana): what learners flag with "Report this card" in the app, triaged in Studio instead of by email.
// The reports live in public.card_reports (learners can only insert); Studio reads and triages them through four
// database functions that only Maana owners and editors may call (maana/supabase/migrations/20261024170000_studio_word_reports.sql).
// Pure (no DOM, no network): views/reports.js draws the pages, store.js and app.js use the badge helpers,
// test/reports.test.mjs tests these rules.
//
// Contact (opt-in): a learner may leave an email when reporting ("Yes, you can email me"). studio.word_reports then
// returns contact_ok and contact_email for that report, and studio.word_report_contributors lists the people who agreed.
// Both come from 20261024220000_report_contact.sql. The address is for replying to the report or inviting the person to
// help improve Maana's content, nothing else (docs/reports/TRIAGE.md).

export const WORKSPACE = "maana";
export const PAGE_SIZE_CAP = 500;     // the database returns at most this many cards or reports per call

/** The one command that sets this up. The owner runs it once, from the Maana repo, in Claude Code. */
export const SETUP_FILE = "supabase/migrations/20261024170000_studio_word_reports.sql";
export const SETUP_COMMAND = `! supabase db query --linked --project-ref vymyqrxvpzlhzpvsuhya -f ${SETUP_FILE}`;

/** The owner's rule, shown on every page of this view. */
export const RULE_LINE = "Fix a card only from a cited source (docs/reports/TRIAGE.md).";

/** Only the Maana workspace has word reports, and only owners and editors may open them (the database checks the same). */
export function reportsEnabled(wsId, role) {
  return wsId === WORKSPACE && (role === "owner" || role === "editor");
}

// ---------------------------------------------------------------------------
// Statuses and tabs
// ---------------------------------------------------------------------------

export const STATUSES = ["new", "triaged", "accepted", "declined", "shipped"];
export const OPEN_STATUSES = ["new", "triaged", "accepted"];

const STATUS_LABEL = { new: "New", triaged: "Triaged", accepted: "Accepted", declined: "Declined", shipped: "Shipped" };
// Pill look per status (ui.js pill kinds, plus the two this view adds in studio.css).
const STATUS_KIND = { new: "warn", triaged: "info", accepted: "good", declined: "muted", shipped: "shipped" };

export function statusLabel(status) {
  if (STATUS_LABEL[status]) return STATUS_LABEL[status];
  const s = String(status ?? "").replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "Unknown";
}

export function statusKind(status) {
  return STATUS_KIND[status] ?? "";
}

export const TABS = [
  { key: "open", label: "Open" },
  { key: "new", label: "New" },
  { key: "accepted", label: "Accepted" },
  { key: "shipped", label: "Shipped" },
  { key: "declined", label: "Declined" },
  { key: "all", label: "All" },
];

/** A tab key from a URL or remembered state; anything unknown is Open. */
export function normalizeTab(tab) {
  return TABS.some((t) => t.key === tab) ? tab : "open";
}

/** The statuses a tab stands for: Open is new + triaged + accepted, All is everything. */
export function tabStatuses(tab) {
  const t = normalizeTab(tab);
  if (t === "open") return OPEN_STATUSES;
  if (t === "all") return STATUSES;
  return [t];
}

export function tabMatches(status, tab) {
  return tabStatuses(tab).includes(status);
}

export function tabLabel(tab) {
  return TABS.find((t) => t.key === normalizeTab(tab)).label;
}

// ---------------------------------------------------------------------------
// Counts and the sidebar badge
// ---------------------------------------------------------------------------

/** studio.word_report_counts() answers one row (an array of one, or the row itself). Anything else is null. */
export function normalizeCounts(data) {
  const r = Array.isArray(data) ? data[0] : data;
  if (!r || typeof r !== "object") return null;
  const n = (v) => (Number.isFinite(Number(v)) && v != null ? Math.max(0, Math.round(Number(v))) : 0);
  const c = {
    new: n(r.new_count), triaged: n(r.triaged_count), accepted: n(r.accepted_count),
    declined: n(r.declined_count), shipped: n(r.shipped_count),
  };
  c.open = r.open_count != null ? n(r.open_count) : c.new + c.triaged + c.accepted;
  c.total = r.total != null ? n(r.total) : c.open + c.declined + c.shipped;
  c.openCards = n(r.open_cards);
  return c;
}

/** How many reports a tab holds, from normalizeCounts(). */
export function tabCount(counts, tab) {
  if (!counts) return null;
  return tabStatuses(tab).reduce((sum, s) => sum + (counts[s] ?? 0), 0);
}

/** The badge counts new reports: the ones nobody has looked at. */
export function badgeCount(counts) {
  return counts?.new > 0 ? counts.new : 0;
}

/** Badge text for the sidebar: empty when there is nothing new (the badge hides itself), "99+" when large. */
export function badgeText(counts) {
  const n = badgeCount(counts);
  return n ? (n > 99 ? "99+" : String(n)) : "";
}

export function reportsLabel(n) {
  return `${n} report${n === 1 ? "" : "s"}`;
}

/** "12 reports open on 7 cards", from normalizeCounts(); empty when nothing is open (the empty list says so). */
export function openSummary(counts) {
  if (!counts?.open) return "";
  return `${reportsLabel(counts.open)} open${counts.openCards ? ` on ${counts.openCards} card${counts.openCards === 1 ? "" : "s"}` : ""}.`;
}

/** The count of reports in per-status counts shaped like {new: 2, ...} for one tab. */
export function countByStatus(reports) {
  const c = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of reports ?? []) if (r.status in c) c[r.status] += 1;
  return c;
}

/** A card's reports under a tab: the sum of its per-status counts (a card row carries new_count, triaged_count, ...). */
export function cardCount(card, tab) {
  return tabStatuses(tab).reduce((sum, s) => sum + (Number(card?.[`${s}_count`]) || 0), 0);
}

// ---------------------------------------------------------------------------
// Cards (the list)
// ---------------------------------------------------------------------------

/** The list order, the same as the database's: most reports under the tab first, then the most recent, then by key. */
export function sortCards(cards, tab) {
  return [...(cards ?? [])].sort((a, b) =>
    cardCount(b, tab) - cardCount(a, tab)
    || String(b.last_reported_at ?? "").localeCompare(String(a.last_reported_at ?? ""))
    || String(a.card_key).localeCompare(String(b.card_key)));
}

/** "abd · rank 73", or "rank 73" for reports from an older build that sent no card id. */
export function cardMeta(card) {
  const rank = card?.rank != null ? `rank ${card.rank}` : null;
  const id = card?.card_id ?? null;
  return [id, rank].filter(Boolean).join(" · ") || String(card?.card_key ?? "");
}

/** The breakdown under a count on a tab that holds several statuses, e.g. "3 new, 1 accepted" (zero counts left out). */
export function breakdown(card, tab) {
  const statuses = tabStatuses(tab);
  if (statuses.length < 2) return "";
  return statuses
    .map((s) => [s, Number(card?.[`${s}_count`]) || 0])
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}`)
    .join(", ");
}

/** "from 3 learners": how many different people sent the reports a tab shows (not for a single report). */
export function learnersLabel(card, tab) {
  const reporters = Number(card?.reporters) || 0;
  return cardCount(card, tab) > 1 && reporters > 0 ? `from ${reporters} learner${reporters === 1 ? "" : "s"}` : "";
}

/** "5 in all" when the card has more reports than the tab shows. */
export function ofTotal(card, tab) {
  const n = cardCount(card, tab);
  const total = Number(card?.total) || 0;
  return total > n ? `${total} in all` : "";
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** The category names the app shows learners (report_card_sheet.dart), keyed by card_reports.category. */
export const CATEGORY_LABEL = {
  "wrong-meaning": "Meaning",
  "wrong-example": "Example ayah",
  "audio-problem": "Audio",
  "arabic-issue": "Arabic text",
  "root-family": "Root or family",
  other: "Something else",
};

export function categoryLabel(category) {
  if (CATEGORY_LABEL[category]) return CATEGORY_LABEL[category];
  const s = String(category ?? "").replace(/[-_]/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "Unknown";
}

const PLATFORM_LABEL = { ios: "iOS", android: "Android", web: "Web", macos: "macOS", windows: "Windows", linux: "Linux" };

/** "iOS 1.0.2", "iOS" or "Unknown build" for a report's platform and app_version. */
export function buildLabel(report) {
  const p = report?.platform ? (PLATFORM_LABEL[report.platform] ?? String(report.platform)) : null;
  const v = report?.app_version ? String(report.app_version) : null;
  return [p, v].filter(Boolean).join(" ") || "Unknown build";
}

/** The senses are stored joined with " · " (the app does `resolvedSenses.join(' · ')`). */
export function sensesList(senses) {
  return String(senses ?? "").split(" · ").map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// One card's reports
// ---------------------------------------------------------------------------

/**
 * The most suggested fixes among some reports, grouped the way the database does (trimmed, case-insensitive), most
 * common first, at most n. The text shown is the newest report's spelling: [{fix: "Servant", n: 2}, ...].
 */
export function topFixes(reports, n = 5) {
  const groups = new Map();
  for (const r of reports ?? []) {
    const fix = String(r.suggested_fix ?? "").trim();
    if (!fix) continue;
    const k = fix.toLowerCase();
    const g = groups.get(k) ?? { fix, n: 0, at: "" };
    g.n += 1;
    if (String(r.created_at ?? "") >= g.at) { g.fix = fix; g.at = String(r.created_at ?? ""); }
    groups.set(k, g);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([, g]) => ({ fix: g.fix, n: g.n }));
}

/** Newest first, the order the database returns them in. */
export function newestFirst(reports) {
  return [...(reports ?? [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(a.id).localeCompare(String(b.id)));
}

/** A card's reports under a tab. */
export function reportsForTab(reports, tab) {
  return (reports ?? []).filter((r) => tabMatches(r.status, tab));
}

/** Which tab a card's page opens on: the tab you came from, or All when that tab holds none of this card's reports. */
export function startTab(reports, wanted) {
  const tab = normalizeTab(wanted);
  return reportsForTab(reports, tab).length || !(reports ?? []).length ? tab : "all";
}

/** Shipped is final here: a shipped report is not selectable (the learner may already have seen "It's fixed"). */
export function isSelectable(report) {
  return report?.status !== "shipped";
}

export function selectableIds(reports) {
  return (reports ?? []).filter(isSelectable).map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Triage actions
// ---------------------------------------------------------------------------

export const NOTE_MAX = 1000;

export const ACTIONS = {
  triage: { key: "triage", status: "triaged", label: "Mark triaged", done: "marked triaged" },
  accept: { key: "accept", status: "accepted", label: "Accept", done: "accepted" },
  decline: { key: "decline", status: "declined", label: "Decline", done: "declined", needsNote: true },
  ship: { key: "ship", status: "shipped", label: "Mark shipped", done: "marked shipped", confirm: true },
};

/** Why an action cannot be used on these selected reports, or null when it can. */
export function actionProblem(actionKey, selected) {
  const list = selected ?? [];
  if (!ACTIONS[actionKey]) return "Unknown action.";
  if (!list.length) return "Select at least one report first.";
  if (list.some((r) => r.status === "shipped")) return "A shipped report cannot be changed here.";
  if (actionKey === "ship" && list.some((r) => r.status === "declined")) {
    return "A declined report cannot be shipped. Accept it first if the decision changed.";
  }
  return null;
}

/** Why this note is not acceptable for the action, or null. Declining needs a note; every note is at most 1000 characters. */
export function noteProblem(actionKey, note) {
  const text = String(note ?? "").trim();
  if (ACTIONS[actionKey]?.needsNote && !text) return "Write a short note: the learner can read it under “Your reports”.";
  if (text.length > NOTE_MAX) return `Keep the note under ${NOTE_MAX} characters.`;
  return null;
}

/** The arguments of studio.set_word_report_status(). */
export function rpcArgs(actionKey, ids, note) {
  const text = String(note ?? "").trim();
  return { p_ids: [...new Set(ids ?? [])], p_status: ACTIONS[actionKey].status, p_note: text || null };
}

/** "3 reports declined" for the toast after an action. */
export function doneMessage(actionKey, n) {
  return `${reportsLabel(n)} ${ACTIONS[actionKey].done}`;
}

// ---------------------------------------------------------------------------
// Errors from the database functions
// ---------------------------------------------------------------------------

/**
 * Sorts an error from supabase-js into what the page should say:
 *   not_set_up  the functions do not exist (the migration has not been applied): show the setup command
 *   forbidden   the person is signed in but may not open word reports
 *   other       anything else, with the message
 */
export function classifyError(error) {
  if (!error) return null;
  const message = String(error.message ?? error.details ?? error ?? "Something went wrong.");
  const code = String(error.code ?? "");
  if (code === "PGRST202" || code === "42883" || /could not find the function|schema cache|function [\w.]+\(.*\) does not exist/i.test(message)) {
    return { kind: "not_set_up", message };
  }
  if (code === "42501" || /not allowed|permission denied/i.test(message)) return { kind: "forbidden", message };
  return { kind: "other", message };
}

// ---------------------------------------------------------------------------
// Contact: people who agreed to be contacted (opt-in)
// ---------------------------------------------------------------------------

/** The one command that sets up the contact fields and the Contributors view. The owner runs it once, in Claude Code. */
export const CONTACT_FILE = "supabase/migrations/20261024220000_report_contact.sql";
export const CONTACT_SETUP_COMMAND = `! supabase db query --linked --project-ref vymyqrxvpzlhzpvsuhya -f ${CONTACT_FILE}`;

/** Said at the top of the Contributors view, and the only things these addresses are for. */
export const CONTACT_LINE = "People who agreed to be contacted. Use this only to reply or invite them to help.";

/** The mark on a report whose sender agreed to be contacted. */
export const CONTACT_MARK = "✉ contact ok";

export const MODES = [
  { key: "cards", label: "By card" },
  { key: "contributors", label: "Contributors" },
];

/** The list's mode from a URL: Contributors, or the cards (anything else). */
export function normalizeMode(mode) {
  return mode === "contributors" ? "contributors" : "cards";
}

/** The path (for store.href) to the Contributors view. */
export const contributorsPath = "reports?view=contributors";

// A light look at an address before it becomes a link. The database only keeps ASCII addresses of a plain shape; this is
// the second line of defence for a value that got there another way.
const ADDRESS = /^[^\s@]+@[^\s@]+$/;

/** The address of a report whose sender agreed to be contacted (contact_ok true and a usable address), else null. */
export function contactOf(report) {
  if (report?.contact_ok !== true) return null;
  const email = typeof report.contact_email === "string" ? report.contact_email.trim() : "";
  return ADDRESS.test(email) ? email : null;
}

/**
 * A mailto: link for an address. The address is percent-encoded (the @ kept), so a ?, &, # or % inside it can never turn
 * into a mail header such as bcc: it stays part of the address. The subject is optional.
 */
export function mailtoHref(email, subject) {
  const to = encodeURIComponent(String(email ?? "").trim()).replace(/%40/g, "@");
  return `mailto:${to}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
}

/** The subject suggested when replying to one report: "About your Maana report on ʿabd". */
export function replySubject(report) {
  const word = String(report?.card_lemma_translit ?? "").trim();
  return word ? `About your Maana report on ${word}` : "About your Maana report";
}

/** "1 person" / "5 people". */
export function peopleLabel(n) {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

const count = (v) => (Number.isFinite(Number(v)) && v != null ? Math.max(0, Math.round(Number(v))) : 0);

/** How many of their reports were accepted or shipped: the first thing contributors are ranked by. */
export function contributorScore(c) {
  return count(c?.accepted_count) + count(c?.shipped_count);
}

/**
 * Contributors in the database's order: accepted + shipped, then total, then the latest report, then the address. The
 * input is not changed.
 */
export function sortContributors(rows) {
  return [...(rows ?? [])].sort((a, b) =>
    contributorScore(b) - contributorScore(a)
    || count(b.total) - count(a.total)
    || String(b.last_reported_at ?? "").localeCompare(String(a.last_reported_at ?? ""))
    || String(a.email ?? "").localeCompare(String(b.email ?? "")));
}

/** How a contributor's reports stand, zero counts left out: "1 accepted, 1 shipped, 2 open, 1 declined". */
export function contributorBreakdown(c) {
  return [["accepted", c?.accepted_count], ["shipped", c?.shipped_count], ["open", c?.open_count], ["declined", c?.declined_count]]
    .map(([label, n]) => [label, count(n)])
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${n} ${label}`)
    .join(", ");
}

/** The cards a contributor reported, most reported first, as the database listed them (at most 30). */
export function contributorCards(c) {
  return (Array.isArray(c?.cards) ? c.cards : []).filter((x) => x && x.card_key);
}

/** "+3 more" when the database cut the list of cards (it sends at most 30 of card_count). */
export function moreCards(c) {
  const more = count(c?.card_count) - contributorCards(c).length;
  return more > 0 ? `+${more} more` : "";
}

/** "4 people agreed to be contacted, 11 reports in all." Empty when there is nobody (the empty state says so). */
export function contributorsSummary(rows) {
  const list = rows ?? [];
  if (!list.length) return "";
  const reports = list.reduce((sum, c) => sum + count(c.total), 0);
  return `${peopleLabel(list.length)} agreed to be contacted, ${reportsLabel(reports)} in all.`;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/** The path (for store.href) to a card's page; the tab is kept so Back lands where you were. */
export function cardPath(cardKey, tab) {
  const t = normalizeTab(tab);
  return `reports?card=${encodeURIComponent(cardKey)}${t === "open" ? "" : `&tab=${t}`}`;
}

export function listPath(tab) {
  const t = normalizeTab(tab);
  return t === "open" ? "reports" : `reports?tab=${t}`;
}
