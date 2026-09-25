// Public client configuration. The anon key is designed to be public; all data access is governed by row-level security.
window.QB_CONFIG = {
  SUPABASE_URL: "https://nnrdlqupqfkmyqfauotc.supabase.co",          // e.g. https://xxxx.supabase.co   (empty = local demo mode, progress kept in this browser only)
  SUPABASE_ANON_KEY: "sb_publishable_R38_tyw5pK_0N4a4RH6t7w_Rh-UWwFt",
  BUCKET: "content",
  EXPLAIN_FN: "explain",     // Edge Function behind the "Explain this to me" button (empty = button hidden)
  DEMO_BASE: "../"           // demo mode: where app_data/ and snippets/ live relative to this page
};
// Local development: run in demo mode (progress in this browser only, content from ../app_data and ../snippets).
if (/^(localhost|127\.)/.test(location.hostname)) window.QB_CONFIG.SUPABASE_URL = "";
