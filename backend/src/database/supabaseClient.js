import { createClient } from '@supabase/supabase-js';

// Cada sesión tiene su propio cliente; los permisos pertenecen al usuario.
export function createSupabaseClient(config) {
  return createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
