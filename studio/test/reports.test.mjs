// node --test studio/test/reports.test.mjs
// Word reports (Maana), the rules behind Studio > Reports: status labels, the filter tabs (Open is new + triaged +
// accepted), the sidebar badge (new reports only), the card list order and counts, grouping suggested fixes the way the
// database does, what each triage action allows (shipped is final, declined cannot be shipped, declining needs a note),
// and how an error from the database functions is told apart ("not set up yet" shows the setup command).
import test from "node:test";
import assert from "node:assert/strict";
import {
  WORKSPACE, SETUP_COMMAND, RULE_LINE, STATUSES, OPEN_STATUSES, TABS, ACTIONS, NOTE_MAX, PAGE_SIZE_CAP,
  reportsEnabled, statusLabel, statusKind, normalizeTab, tabStatuses, tabMatches, tabLabel, normalizeCounts, tabCount,
  badgeCount, badgeText, reportsLabel, openSummary, countByStatus, cardCount, sortCards, cardMeta, breakdown, learnersLabel,
  ofTotal, categoryLabel, buildLabel, sensesList, topFixes, newestFirst, reportsForTab, startTab, isSelectable, selectableIds,
  actionProblem, noteProblem, rpcArgs, doneMessage, classifyError, cardPath, listPath,
} from "../js/reports.js";

const R = (id, status, extra = {}) => ({ id, status, created_at: `2026-10-${String(10 + Number(id.replace(/\D/g, "") || 0)).padStart(2, "0")}T12:00:00Z`, ...extra });
const COUNTS_ROW = { new_count: 3, triaged_count: 1, accepted_count: 2, declined_count: 4, shipped_count: 5, open_count: 6, total: 15, open_cards: 4 };

test("only Maana owners and editors have word reports", () => {
  assert.equal(WORKSPACE, "maana");
  assert.equal(reportsEnabled("maana", "owner"), true);
  assert.equal(reportsEnabled("maana", "editor"), true);
  assert.equal(reportsEnabled("maana", "viewer"), false);
  assert.equal(reportsEnabled("mawadda", "owner"), false);
  assert.equal(reportsEnabled(null, "owner"), false);
  assert.equal(reportsEnabled("maana", null), false);
});

test("status labels and pill looks: five statuses, plain words, a fallback for anything else", () => {
  assert.deepEqual(STATUSES.map(statusLabel), ["New", "Triaged", "Accepted", "Declined", "Shipped"]);
  assert.deepEqual(STATUSES.map(statusKind), ["warn", "info", "good", "muted", "shipped"]);
  assert.equal(new Set(STATUSES.map(statusKind)).size, 5, "every status looks different");
  assert.equal(statusLabel("in_review"), "In review");
  assert.equal(statusLabel(null), "Unknown");
  assert.equal(statusKind("whatever"), "");
});

test("filter tabs: Open is new, triaged and accepted; All is everything; the rest are one status", () => {
  assert.deepEqual(TABS.map((t) => t.label), ["Open", "New", "Accepted", "Shipped", "Declined", "All"]);
  assert.deepEqual(tabStatuses("open"), OPEN_STATUSES);
  assert.deepEqual(tabStatuses("all"), STATUSES);
  assert.deepEqual(tabStatuses("declined"), ["declined"]);
  assert.equal(tabMatches("triaged", "open"), true);
  assert.equal(tabMatches("triaged", "new"), false);
  assert.equal(tabMatches("shipped", "open"), false);
  assert.equal(tabMatches("shipped", "all"), true);
  // a tab from a URL that is not one of ours is Open, never an empty list
  assert.equal(normalizeTab("nope"), "open");
  assert.equal(normalizeTab(undefined), "open");
  assert.deepEqual(tabStatuses("nope"), OPEN_STATUSES);
  assert.equal(tabLabel("shipped"), "Shipped");
});

test("counts from word_report_counts(): one row, however it arrives, and the numbers per tab", () => {
  const c = normalizeCounts([COUNTS_ROW]);
  assert.deepEqual(c, { new: 3, triaged: 1, accepted: 2, declined: 4, shipped: 5, open: 6, total: 15, openCards: 4 });
  assert.deepEqual(normalizeCounts(COUNTS_ROW), c);
  assert.equal(normalizeCounts(null), null);
  assert.equal(normalizeCounts([]), null);
  assert.equal(normalizeCounts("x"), null);
  // missing or junk numbers are zero; open and total are worked out when the database leaves them out
  const partial = normalizeCounts({ new_count: "2", triaged_count: null, accepted_count: "x", declined_count: 1, shipped_count: 1 });
  assert.deepEqual(partial, { new: 2, triaged: 0, accepted: 0, declined: 1, shipped: 1, open: 2, total: 4, openCards: 0 });
  assert.equal(tabCount(c, "open"), 6);
  assert.equal(tabCount(c, "new"), 3);
  assert.equal(tabCount(c, "accepted"), 2);
  assert.equal(tabCount(c, "all"), 15);
  assert.equal(tabCount(null, "open"), null);
  assert.equal(openSummary(c), "6 reports open on 4 cards.");
  assert.equal(openSummary({ ...c, open: 1, openCards: 1 }), "1 report open on 1 card.");
  assert.equal(openSummary({ ...c, open: 0 }), "");
  assert.equal(openSummary(null), "");
  assert.equal(reportsLabel(1), "1 report");
  assert.equal(reportsLabel(0), "0 reports");
});

test("the sidebar badge counts new reports only, and hides itself at zero", () => {
  assert.equal(badgeCount(normalizeCounts(COUNTS_ROW)), 3, "triaged and accepted reports are already being handled");
  assert.equal(badgeText(normalizeCounts(COUNTS_ROW)), "3");
  assert.equal(badgeText(normalizeCounts({ ...COUNTS_ROW, new_count: 0 })), "");
  assert.equal(badgeText(null), "", "not set up, or not loaded yet: no badge");
  assert.equal(badgeText(normalizeCounts({ ...COUNTS_ROW, new_count: 99 })), "99");
  assert.equal(badgeText(normalizeCounts({ ...COUNTS_ROW, new_count: 100 })), "99+");
  assert.equal(badgeCount(undefined), 0);
});

const CARD = (key, extra = {}) => ({
  card_key: key, card_id: key.startsWith("rank:") ? null : key, rank: 10, total: 0, new_count: 0, triaged_count: 0, accepted_count: 0,
  declined_count: 0, shipped_count: 0, reporters: 0, last_reported_at: "2026-10-20T00:00:00Z", ...extra,
});

test("a card row counts the reports its tab shows, and says how they split", () => {
  const abd = CARD("abd", { total: 9, new_count: 3, triaged_count: 1, accepted_count: 1, declined_count: 2, shipped_count: 2, reporters: 4 });
  assert.equal(cardCount(abd, "open"), 5);
  assert.equal(cardCount(abd, "new"), 3);
  assert.equal(cardCount(abd, "declined"), 2);
  assert.equal(cardCount(abd, "all"), 9);
  assert.equal(breakdown(abd, "open"), "3 new, 1 triaged, 1 accepted");
  assert.equal(breakdown(abd, "all"), "3 new, 1 triaged, 1 accepted, 2 declined, 2 shipped");
  assert.equal(breakdown(abd, "new"), "", "a one-status tab needs no breakdown");
  assert.equal(ofTotal(abd, "open"), "9 in all");
  assert.equal(ofTotal(abd, "all"), "");
  assert.equal(learnersLabel(abd, "open"), "from 4 learners");
  assert.equal(learnersLabel({ ...abd, reporters: 1 }, "open"), "from 1 learner");
  assert.equal(learnersLabel(CARD("x", { new_count: 1, total: 1, reporters: 1 }), "open"), "", "one report needs no learner count");
  assert.equal(cardCount(null, "open"), 0);
});

test("the list: most reports under the tab first, then the most recent, then by key; the input is not changed", () => {
  const cards = [
    CARD("c", { new_count: 2, total: 2, last_reported_at: "2026-10-01T00:00:00Z" }),
    CARD("a", { new_count: 1, total: 1, last_reported_at: "2026-10-05T00:00:00Z" }),
    CARD("b", { new_count: 2, total: 2, last_reported_at: "2026-10-09T00:00:00Z" }),
    CARD("d", { new_count: 2, total: 2, last_reported_at: "2026-10-09T00:00:00Z" }),
    CARD("e", { shipped_count: 7, total: 7, last_reported_at: "2026-10-02T00:00:00Z" }),
  ];
  const before = cards.map((c) => c.card_key);
  assert.deepEqual(sortCards(cards, "open").map((c) => c.card_key), ["b", "d", "c", "a", "e"]);
  assert.deepEqual(sortCards(cards, "shipped").map((c) => c.card_key), ["e", "b", "d", "a", "c"], "the card with shipped reports first, the rest by recency");
  assert.deepEqual(cards.map((c) => c.card_key), before);
  assert.deepEqual(sortCards(null, "open"), []);
});

test("card meta: the card id and rank, or just the rank for an older build that sent no card id", () => {
  assert.equal(cardMeta({ card_key: "abd", card_id: "abd", rank: 73 }), "abd · rank 73");
  assert.equal(cardMeta({ card_key: "rank:212", card_id: null, rank: 212 }), "rank 212");
  assert.equal(cardMeta({ card_key: "rank:212" }), "rank:212");
});

test("labels: the category names the app shows, the build, the senses", () => {
  assert.deepEqual(["wrong-meaning", "wrong-example", "audio-problem", "arabic-issue", "root-family", "other"].map(categoryLabel),
    ["Meaning", "Example ayah", "Audio", "Arabic text", "Root or family", "Something else"]);
  assert.equal(categoryLabel("new-kind"), "New kind");
  assert.equal(categoryLabel(null), "Unknown");
  assert.equal(buildLabel({ platform: "ios", app_version: "1.0.2" }), "iOS 1.0.2");
  assert.equal(buildLabel({ platform: "android", app_version: null }), "Android");
  assert.equal(buildLabel({ platform: "macos", app_version: "0.9" }), "macOS 0.9");
  assert.equal(buildLabel({ platform: "plan9" }), "plan9");
  assert.equal(buildLabel({}), "Unknown build");
  assert.deepEqual(sensesList("servant · worshipper"), ["servant", "worshipper"]);
  assert.deepEqual(sensesList(null), []);
  assert.deepEqual(sensesList("light"), ["light"]);
});

test("suggested fixes are grouped like the database: trimmed, case-insensitive, most common first, newest spelling shown", () => {
  const reports = [
    R("1", "new", { suggested_fix: "servant" }),
    R("2", "new", { suggested_fix: "Servant " }),
    R("3", "triaged", { suggested_fix: "worshipper" }),
    R("4", "new", { suggested_fix: "  " }),
    R("5", "new", { suggested_fix: null }),
    R("6", "new", { suggested_fix: "slave" }),
    R("7", "new", { suggested_fix: "SERVANT" }),
  ];
  assert.deepEqual(topFixes(reports), [{ fix: "SERVANT", n: 3 }, { fix: "slave", n: 1 }, { fix: "worshipper", n: 1 }]);
  assert.deepEqual(topFixes(reports, 1), [{ fix: "SERVANT", n: 3 }]);
  assert.deepEqual(topFixes([], 5), []);
  assert.deepEqual(topFixes(null), []);
  const many = Array.from({ length: 8 }, (_, i) => R(String(i), "new", { suggested_fix: `fix ${i}` }));
  assert.equal(topFixes(many).length, 5, "at most five");
});

test("one card's reports: counted by status, filtered by tab, newest first, and the page opens on a tab that has something", () => {
  const reports = [R("1", "new"), R("2", "new"), R("3", "triaged"), R("4", "declined"), R("5", "shipped")];
  assert.deepEqual(countByStatus(reports), { new: 2, triaged: 1, accepted: 0, declined: 1, shipped: 1 });
  assert.deepEqual(countByStatus(null), { new: 0, triaged: 0, accepted: 0, declined: 0, shipped: 0 });
  assert.deepEqual(reportsForTab(reports, "open").map((r) => r.id), ["1", "2", "3"]);
  assert.deepEqual(reportsForTab(reports, "declined").map((r) => r.id), ["4"]);
  assert.deepEqual(reportsForTab(reports, "all").map((r) => r.id), ["1", "2", "3", "4", "5"]);
  assert.deepEqual(newestFirst(reports).map((r) => r.id), ["5", "4", "3", "2", "1"]);
  assert.equal(startTab(reports, "open"), "open");
  assert.equal(startTab(reports, "declined"), "declined");
  assert.equal(startTab([R("4", "declined")], "open"), "all", "nothing open on this card: show everything it has");
  assert.equal(startTab([R("4", "declined")], "shipped"), "all");
  assert.equal(startTab([], "open"), "open");
});

test("shipped is final: a shipped report cannot be ticked, so a fix that is live is never moved back", () => {
  assert.equal(isSelectable(R("1", "new")), true);
  assert.equal(isSelectable(R("2", "declined")), true, "a declined report can be reconsidered");
  assert.equal(isSelectable(R("3", "shipped")), false);
  assert.deepEqual(selectableIds([R("1", "new"), R("3", "shipped"), R("2", "accepted")]), ["1", "2"]);
});

test("the four actions: what they set, and when they are refused", () => {
  assert.deepEqual(Object.values(ACTIONS).map((a) => a.status), ["triaged", "accepted", "declined", "shipped"]);
  assert.deepEqual(Object.values(ACTIONS).map((a) => a.label), ["Mark triaged", "Accept", "Decline", "Mark shipped"]);
  const open = [R("1", "new"), R("2", "triaged")];
  for (const key of Object.keys(ACTIONS)) assert.equal(actionProblem(key, open), null, key);
  assert.match(actionProblem("accept", []), /Select at least one/);
  assert.match(actionProblem("accept", [R("1", "new"), R("2", "shipped")]), /shipped report cannot be changed/);
  assert.match(actionProblem("ship", [R("1", "new"), R("2", "declined")]), /declined report cannot be shipped/);
  assert.equal(actionProblem("accept", [R("2", "declined")]), null, "a declined report can be accepted when the decision changes");
  assert.equal(actionProblem("triage", [R("2", "declined")]), null);
  assert.match(actionProblem("explode", open), /Unknown action/);
});

test("declining needs a note; every note is at most 1000 characters", () => {
  assert.match(noteProblem("decline", ""), /Write a short note/);
  assert.match(noteProblem("decline", "   \n "), /Write a short note/);
  assert.match(noteProblem("decline", null), /Write a short note/);
  assert.equal(noteProblem("decline", "We kept this: the verse uses the word for ownership."), null);
  assert.equal(noteProblem("ship", ""), null, "a shipped note is optional");
  assert.equal(noteProblem("accept", ""), null);
  assert.equal(NOTE_MAX, 1000);
  assert.equal(noteProblem("ship", "x".repeat(1000)), null);
  assert.match(noteProblem("ship", "x".repeat(1001)), /under 1000/);
});

test("what is sent to set_word_report_status: unique ids, the status, a trimmed note or null", () => {
  assert.deepEqual(rpcArgs("decline", ["a", "b", "a"], "  Kept as is.  "), { p_ids: ["a", "b"], p_status: "declined", p_note: "Kept as is." });
  assert.deepEqual(rpcArgs("accept", ["a"], ""), { p_ids: ["a"], p_status: "accepted", p_note: null });
  assert.deepEqual(rpcArgs("ship", ["a"], undefined), { p_ids: ["a"], p_status: "shipped", p_note: null });
  assert.deepEqual(rpcArgs("triage", [], null), { p_ids: [], p_status: "triaged", p_note: null });
  assert.equal(doneMessage("decline", 3), "3 reports declined");
  assert.equal(doneMessage("ship", 1), "1 report marked shipped");
  assert.equal(doneMessage("triage", 2), "2 reports marked triaged");
  assert.equal(doneMessage("accept", 1), "1 report accepted");
});

test("errors from the database functions: not set up (show the command), not allowed, or something else", () => {
  // PostgREST's answer when the migration has not been applied
  assert.equal(classifyError({ code: "PGRST202", message: "Could not find the function studio.word_report_cards(p_status) in the schema cache" }).kind, "not_set_up");
  assert.equal(classifyError({ message: "Could not find the function studio.word_report_counts without parameters in the schema cache" }).kind, "not_set_up");
  assert.equal(classifyError({ code: "42883", message: "function studio.word_reports(text) does not exist" }).kind, "not_set_up");
  // the database functions' own refusal, and a missing grant
  assert.equal(classifyError({ code: "42501", message: "Not allowed: word reports are for owners and editors of the Maana workspace." }).kind, "forbidden");
  assert.equal(classifyError({ code: "42501", message: "permission denied for function word_report_cards" }).kind, "forbidden");
  // everything else keeps its message
  const other = classifyError({ code: "22023", message: "Unknown filter \"bogus\"" });
  assert.deepEqual(other, { kind: "other", message: "Unknown filter \"bogus\"" });
  assert.equal(classifyError(new TypeError("Failed to fetch")).kind, "other");
  assert.equal(classifyError(null), null);
  assert.equal(classifyError({}).kind, "other");
});

test("the setup command is the one the owner runs, and the rule line is the owner's sentence", () => {
  assert.equal(SETUP_COMMAND,
    "! supabase db query --linked --project-ref vymyqrxvpzlhzpvsuhya -f supabase/migrations/20261024170000_studio_word_reports.sql");
  assert.equal(RULE_LINE, "Fix a card only from a cited source (docs/reports/TRIAGE.md).");
  assert.equal(PAGE_SIZE_CAP, 500);
});

test("links: a card key (even rank:212) survives the hash, and the tab comes back with you", () => {
  assert.equal(cardPath("abd", "open"), "reports?card=abd");
  assert.equal(cardPath("abd", "declined"), "reports?card=abd&tab=declined");
  assert.equal(cardPath("rank:212", "open"), "reports?card=rank%3A212");
  assert.equal(cardPath("a b/c?d&e", "nope"), "reports?card=a%20b%2Fc%3Fd%26e");
  assert.equal(listPath("open"), "reports");
  assert.equal(listPath("shipped"), "reports?tab=shipped");
  assert.equal(listPath("nope"), "reports");
  // what the router will read back
  assert.equal(new URLSearchParams("card=rank%3A212&tab=declined").get("card"), "rank:212");
});
