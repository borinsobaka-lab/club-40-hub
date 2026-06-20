import { createMiddleware } from "@tanstack/react-start";
import { getHeader } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const auth = getHeader("authorization") ?? getHeader("Authorization");
  if (!auth) throw new Response("Unauthorized: No authorization header provided", { status: 401 });
  const token = auth.replace(/^Bearer\s+/i, "");
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Response("Unauthorized", { status: 401 });
  return next({ context: { supabase, userId: data.user.id, claims: data.user } });
});
