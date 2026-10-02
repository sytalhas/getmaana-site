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
