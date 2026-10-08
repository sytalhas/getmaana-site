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

/**
 * Send one file to studio-api /upload (Studio uploads, content-creator LRN-52): the server puts it in the workspace's
 * own GitHub release and answers {url, bytes, sha256}. XMLHttpRequest, so the page can show the upload's progress.
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
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
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
