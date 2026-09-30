// In-memory mirror of the studio schema, kept live with Supabase Realtime.
// Views read from `store.<table>` and call `store.on(fn)` to re-render when
// anything changes, so a teammate's edit shows up without a refresh.

import { supa } from "./supa.js";

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
  let q = supa.from(name).select("*").order(t.order, { ascending: true });
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
    const { data, error } = await supa.from("metrics_snapshots").select("*")
      .order("captured_at", { ascending: true }).range(from, from + page - 1);
    if (error) throw new Error(`metrics: ${error.message}`);
    for (const r of data) addMetric(r);
    if (data.length < page) break;
  }
}

let channel = null;

export async function loadAll() {
  await Promise.all([...Object.keys(TABLES).map(loadTable), loadMetrics()]);
  store.ready = true;
  subscribe();
  store.emit("*");
}

function subscribe() {
  if (channel) supa.removeChannel(channel);
  channel = supa.channel("studio-live");
  for (const name of [...Object.keys(TABLES), "metrics_snapshots"]) {
    channel.on("postgres_changes", { event: "*", schema: "studio", table: name }, (msg) => {
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
  channel.subscribe((status) => {
    store.live = status === "SUBSCRIBED";
    emitSoon("live");
    // After a dropped connection, reload so nothing missed while offline is lost.
    if (status === "SUBSCRIBED" && store._wasDown) {
      store._wasDown = false;
      loadAll();
    }
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") store._wasDown = true;
  });
}
