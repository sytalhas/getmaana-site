import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, FUNCTIONS_URL } from "./config.js";

export const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: "studio" },
  auth: { persistSession: true, detectSessionInUrl: true, flowType: "pkce" },
});

/** Call the studio-api Edge Function with the member's session. */
export async function api(path, body, method = "POST") {
  const { data } = await supa.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${FUNCTIONS_URL}/studio-api/${path.replace(/^\//, "")}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `${res.status} ${res.statusText}`);
  return out;
}
