// Public values only. The anon key is the same one shipped inside the app;
// every Studio table is protected by RLS (members allowlist per workspace).
// Brand values (app ids, store links, media repo) live in studio.workspaces.
export const SUPABASE_URL = "https://vymyqrxvpzlhzpvsuhya.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5bXlxcnh2cHpsaHpwdnN1aHlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3MDYxODMsImV4cCI6MjEwNjI4MjE4M30.-3qFgQhWiliz19M6mAlJmdLIeIRZBCM6zeU4BNaRfbM";
export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
