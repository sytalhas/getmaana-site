// In-memory mirror of ONE workspace of the studio schema (Maana or Mawadda),
// kept live with Supabase Realtime. Views read from `store.<table>` and call
// `store.on(fn)` to re-render when anything changes, so a teammate's edit
// shows up without a refresh. Every read and every Realtime subscription is
// filtered by workspace_id; switching workspace reloads everything.

import { supa, setApiWorkspace } from "./supa.js";
import { setLeverFields } from "./kpi.js";

const TABLES = {
  reels: { order: "id", key: "id" },
  assets: { order: "created_at", key: "id" },
  posts: { order: "created_at", key: "id" },
  experiments: { order: "created_at", key: "id" },
  connections: { order: "created_at", key: "id" },
  alerts: { order: "created_at", key: "id", filter: (q) => q.is("resolved_at", null).limit(200) },
  settings: { order: "key", key: "key" },
  members: { order: "email", key: "email" },
  jobs: {
    order: "created_at", key: "id",
    filter: (q) => q.gte("created_at", new Date(Date.now() - 14 * 864e5).toISOString()).limit(500),
  },
};

export const store = {
  ready: false,
  role: null,
  email: null,
  /** id of the open workspace, e.g. "maana" */
  wsId: null,
  /** the open studio.workspaces row */
  workspace: null,
  /** every workspace this user may open, in display order */
  workspaces: [],
  /** workspace_id -> role */
  memberships: new Map(),
  reels: new Map(),
  assets: new Map(),
  posts: new Map(),
  experiments: new Map(),
  connections: new Map(),
  alerts: new Map(),
  settings: new Map(),
  members: new Map(),
  jobs: new Map(),
  /** post_id -> array of snapshots, oldest first */
  metrics: new Map(),
  listeners: new Set(),
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },
  emit(table) {
    for (const fn of this.listeners) {
      try { fn(table); } catch (e) { console.error(e); }
    }
  },
  setting(key) {
    return this.settings.get(key)?.value ?? null;
  },
  /** Brand copy from the workspace row: store.copy("brand"). */
  copy(key, fallback = null) {
    return this.workspace?.copy?.[key] ?? fallback;
  },
  brand() {
    return this.workspace?.name ?? "Studio";
  },
  /** Lever fields for this workspace: [{key, label, kind, store}] */
  leverFields() {
    return this.workspace?.levers?.fields ?? [];
  },
  vocab(key) {
    return this.workspace?.levers?.vocab?.[key] ?? null;
  },
  /** A reel's lever value: column or reels.levers jsonb, per the field definition. */
  lever(reel, key) {
    if (!reel) return null;
    const f = this.leverFields().find((x) => x.key === key);
    if (f?.store === "levers") return reel.levers?.[key] ?? null;
    return reel[key] ?? reel.levers?.[key] ?? null;
  },
  /** Maana-only: recitation is added by hand in Instagram (igaudio cuts). */
  recitation() {
    return !!this.workspace?.preflight?.recitation_rules;
  },
  canEdit() {
    return this.role === "owner" || this.role === "editor";
  },
  isOwner() {
    return this.role === "owner";
  },
  /** Latest snapshot per source for a post: { instagram_insights: {...}, asc_reports: {...} } */
  latest(postId) {
    const out = {};
    for (const s of this.metrics.get(postId) ?? []) out[s.source] = s;
    return out;
  },
};

let emitTimer = null;
function emitSoon(table) {
  clearTimeout(emitTimer);
  emitTimer = setTimeout(() => store.emit(table), 60);
}

function addMetric(row) {
  const list = store.metrics.get(row.post_id) ?? [];
  list.push(row);
  list.sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  store.metrics.set(row.post_id, list);
}

async function loadTable(name) {
  const t = TABLES[name];
  let q = supa.from(name).select("*").eq("workspace_id", store.wsId).order(t.order, { ascending: true });
  if (t.filter) q = t.filter(q);
  const { data, error } = await q;
  if (error) throw new Error(`${name}: ${error.message}`);
  const m = store[name];
  m.clear();
  for (const r of data) m.set(r[t.key], r);
}

async function loadMetrics() {
  store.metrics.clear();
  // Paged: keeps working as history grows.
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supa.from("metrics_snapshots").select("*").eq("workspace_id", store.wsId)
      .order("captured_at", { ascending: true }).range(from, from + page - 1);
    if (error) throw new Error(`metrics: ${error.message}`);
    for (const r of data) addMetric(r);
    if (data.length < page) break;
  }
}

let channel = null;
let channelSeq = 0;
let loadSeq = 0;

// Full reloads after a Realtime reconnect are coalesced: one in flight at a
// time, at least RELOAD_GAP_MS apart, none while the tab is hidden (it runs when
// the tab is visible again), and a failed reload retries with capped backoff.
const RELOAD_GAP_MS = 2000;
const RELOAD_RETRIES = 4;
const reload = { timer: null, inFlight: false, wanted: false, last: 0, tries: 0 };

function hidden() {
  return typeof document !== "undefined" && document.hidden;
}

function requestReload(delay = 0) {
  reload.wanted = true;
  if (reload.timer || reload.inFlight || hidden()) return;
  const wait = Math.max(delay, reload.last + RELOAD_GAP_MS - Date.now(), 0);
  reload.timer = setTimeout(runReload, wait);
}

async function runReload() {
  reload.timer = null;
  if (!reload.wanted || reload.inFlight || hidden()) return;
  reload.wanted = false;
  reload.inFlight = true;
  reload.last = Date.now();
  const seq = loadSeq;
  const wsId = store.wsId;
  let retry = 0;
  try {
    await loadData();
    if (seq === loadSeq && wsId === store.wsId) {
      reload.tries = 0;
      store.emit("*");
    }
  } catch (e) {
    console.error(e);
    if (seq === loadSeq && reload.tries < RELOAD_RETRIES) {
      reload.tries += 1;
      retry = Math.min(60e3, RELOAD_GAP_MS * 2 ** reload.tries);
      reload.wanted = true;
    }
  } finally {
    reload.inFlight = false;
  }
  if (reload.wanted && seq === loadSeq) requestReload(retry);
}

function resetReload() {
  clearTimeout(reload.timer);
  Object.assign(reload, { timer: null, wanted: false, last: Date.now(), tries: 0 });
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!hidden() && reload.wanted) requestReload();
  });
}

/** Loads the memberships and the workspace rows this user may open. */
export async function loadWorkspaces() {
  const { data: mem, error } = await supa.rpc("claim_memberships");
  if (error) throw error;
  store.memberships = new Map((mem ?? []).map((m) => [m.workspace_id, m.role]));
  if (!store.memberships.size) {
    store.workspaces = [];
    return [];
  }
  const { data: rows, error: e2 } = await supa.from("workspaces").select("*").order("sort", { ascending: true });
  if (e2) throw e2;
  store.workspaces = (rows ?? []).filter((w) => store.memberships.has(w.id));
  return store.workspaces;
}

/** Opens one workspace: role, theme, data, Realtime. */
export async function openWorkspace(id) {
  const seq = ++loadSeq;
  const ws = store.workspaces.find((w) => w.id === id);
  if (!ws) throw new Error(`not a member of ${id}`);
  store.ready = false;
  store.wsId = id;
  store.workspace = ws;
  store.role = store.memberships.get(id) ?? null;
  setApiWorkspace(id);
  setLeverFields(ws.levers?.fields ?? null);
  for (const name of Object.keys(TABLES)) store[name].clear();
  store.metrics.clear();
  resetReload();
  await loadAll(seq);
  // A brand-new workspace has no settings rows: an owner seeds the defaults once.
  if (seq === loadSeq && !store.settings.size && store.isOwner()) {
    const { error } = await supa.rpc("seed_workspace_settings", { p_workspace: id });
    if (!error) await loadTable("settings");
  }
}

function loadData() {
  return Promise.all([...Object.keys(TABLES).map(loadTable), loadMetrics()]);
}

/** Loads the open workspace and (re)subscribes to it. Only openWorkspace calls this. */
export async function loadAll(seq = loadSeq) {
  const wsId = store.wsId;
  await loadData();
  if (seq !== loadSeq || wsId !== store.wsId) return; // switched meanwhile
  store.ready = true;
  reload.last = Date.now();
  subscribe();
  store.emit("*");
}

function subscribe() {
  // Detach the old channel BEFORE removing it: removing it fires its CLOSED
  // status, which must not count as "the connection dropped". (It used to set a
  // shared flag, so every reload's resubscribe started the next reload: a full
  // reload of every table, back to back, from one dropped connection.)
  const old = channel;
  channel = null;
  if (old) supa.removeChannel(old);
  const wsId = store.wsId;
  // A fresh topic each time: supabase-js hands back an existing channel with the
  // same topic while the old one is still leaving.
  const ch = supa.channel(`studio-live-${wsId}-${++channelSeq}`);
  channel = ch;
  for (const name of [...Object.keys(TABLES), "metrics_snapshots"]) {
    ch.on("postgres_changes", { event: "*", schema: "studio", table: name, filter: `workspace_id=eq.${wsId}` }, (msg) => {
      if (wsId !== store.wsId) return;
      const row = msg.eventType === "DELETE" ? msg.old : msg.new;
      if (row?.workspace_id && row.workspace_id !== wsId) return;
      if (name === "metrics_snapshots") {
        if (msg.eventType === "INSERT") addMetric(msg.new);
      } else {
        const key = TABLES[name].key;
        const m = store[name];
        if (msg.eventType === "DELETE") m.delete(msg.old[key]);
        else if (name === "alerts" && msg.new.resolved_at) m.delete(msg.new[key]);
        else m.set(msg.new[key], msg.new);
      }
      emitSoon(name);
    });
  }
  let down = false;
  ch.subscribe((status) => {
    if (ch !== channel || wsId !== store.wsId) return; // a replaced or old workspace's channel
    store.live = status === "SUBSCRIBED";
    emitSoon("live");
    if (status === "SUBSCRIBED") {
      // Back after this channel was down: reload once (coalesced) so nothing
      // missed while offline is lost. Data only; the channel stays as it is.
      if (down) {
        down = false;
        reload.tries = 0;
        requestReload();
      }
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      down = true;
    }
  });
}

/** Hash link inside the open workspace: href("posts?post=1") -> "#/w/maana/posts?post=1". */
export function href(path = "") {
  return `#/w/${store.wsId ?? "maana"}/${String(path).replace(/^\/+/, "")}`;
}
