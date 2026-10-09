import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, FUNCTIONS_URL } from "./config.js";

export const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: "studio" },
  auth: { persistSession: true, detectSessionInUrl: true, flowType: "pkce" },
});

// The open workspace; every studio-api call carries it (the server checks the
// caller's role in that workspace).
let workspace = null;
export function setApiWorkspace(id) {
  workspace = id;
}

/** Call the studio-api Edge Function with the member's session, in the open workspace. */
export async function api(path, body, method = "POST") {
  const { data } = await supa.auth.getSession();
  const token = data.session?.access_token;
  let url = `${FUNCTIONS_URL}/studio-api/${path.replace(/^\//, "")}`;
  if (method === "GET" && workspace) url += `${url.includes("?") ? "&" : "?"}workspace=${encodeURIComponent(workspace)}`;
  const res = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: method === "GET" ? undefined : JSON.stringify({ ...(body ?? {}), ...(workspace ? { workspace } : {}) }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(out.error || `${res.status} ${res.statusText}`), { status: res.status });
  return out;
}

/** How long one upload may take: Studio's server (a Supabase Edge Function, free plan) stops a request at about
 *  150 s, and the server still has to pass the file on to GitHub. Measured 2026-10-08: about 0.2 MB/s from a 1.5 Mbps
 *  connection (20 MB in 107 s worked; 60 MB never finished and hung). */
export const UPLOAD_BUDGET_S = 130;

/** The message when this connection is too slow for a file: never a silent hang. */
export function tooSlowMessage(bytes, bytesPerSecond) {
  const mb = bytes / 1024 / 1024;
  const fits = Math.max(1, Math.floor((bytesPerSecond * UPLOAD_BUDGET_S) / 1024 / 1024));
  return `At this connection's speed (${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s) this ${mb.toFixed(0)} MB file would take about ` +
    `${Math.ceil(bytes / bytesPerSecond / 60)} minutes, and Studio can take one upload for about 2 minutes. Export it smaller ` +
    `(about ${fits} MB or less: 1080x1920 at a lower bitrate), use a faster connection, or send it from content-creator's Own content, which has no time limit.`;
}

/**
 * Send one file to studio-api /upload (Studio uploads, content-creator LRN-52): the server puts it in the workspace's
 * own GitHub release and answers {url, bytes, sha256}. XMLHttpRequest, so the page can show the upload's progress and
 * stop early, with a plain message, when the connection is too slow to finish inside Studio's time limit.
 */
export async function uploadFile({ upload, slot }, blob, onProgress) {
  const { data } = await supa.auth.getSession();
  const token = data.session?.access_token;
  const q = new URLSearchParams({ workspace: workspace ?? "", upload, slot });
  return await new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", `${FUNCTIONS_URL}/studio-api/upload?${q}`);
    x.setRequestHeader("authorization", `Bearer ${token}`);
    x.setRequestHeader("apikey", SUPABASE_ANON_KEY);
    x.setRequestHeader("content-type", blob.type || "application/octet-stream");
    const t0 = Date.now();
    let stopped = null;
    x.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      onProgress?.(e.loaded / e.total);
      const s = (Date.now() - t0) / 1000;
      if (s > 6 && e.loaded < e.total && e.loaded / s > 0) {
        const projected = e.total / (e.loaded / s);
        if (projected > UPLOAD_BUDGET_S && !stopped) { stopped = tooSlowMessage(e.total, e.loaded / s); x.abort(); }
      }
    };
    x.timeout = (UPLOAD_BUDGET_S + 60) * 1000;
    x.ontimeout = () => reject(new Error("Studio did not answer in time (the file may be too big for this connection). Nothing was posted. Try a smaller file."));
    x.onabort = () => reject(new Error(stopped ?? "The upload was stopped."));
    x.onload = () => {
      let out = {};
      try { out = JSON.parse(x.responseText || "{}"); } catch { /* not JSON */ }
      if (x.status >= 200 && x.status < 300) resolve(out);
      else reject(Object.assign(new Error(out.error || `Upload failed (${x.status})`), { status: x.status }));
    };
    x.onerror = () => reject(new Error("The upload stopped (no connection to Studio). Try again."));
    x.send(blob);
  });
}
