// Public client configuration. The anon key is designed to be public; all data access is governed by row-level security.
window.QB_CONFIG = {
  SUPABASE_URL: "",          // e.g. https://xxxx.supabase.co   (empty = local demo mode, progress kept in this browser only)
  SUPABASE_ANON_KEY: "",
  BUCKET: "content",
  DEMO_BASE: "../"           // demo mode: where app_data/ and snippets/ live relative to this page
};
