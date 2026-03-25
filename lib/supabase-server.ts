import { createClient } from "@supabase/supabase-js";

function env(name: string): string {
  return (process.env[name] || "").trim();
}

export function getSupabaseServerClient() {
  const url = env("SUPABASE_URL");
  const serviceRole = env("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRole) {
    return null;
  }

  return createClient(url, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
