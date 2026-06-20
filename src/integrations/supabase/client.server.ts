import { createClient } from "@supabase/supabase-js";

const url =
  (import.meta as any).env?.VITE_SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  "";
const serviceKey =
  process.env.APP_SUPABASE_SERVICE_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "";

if (!url || !serviceKey) {
  // eslint-disable-next-line no-console
  console.warn(
    "[supabase.server] Missing VITE_SUPABASE_URL or APP_SUPABASE_SERVICE_KEY — admin operations will fail.",
  );
}

export const supabaseAdmin = createClient(url || "http://localhost", serviceKey || "missing", {
  auth: { persistSession: false, autoRefreshToken: false },
});
