import { supabase } from './supabase'

const SESSION_KEY = 'eagle-gaming-session'

function clearLegacySession() {
  // These old flags are not proof of an authenticated Supabase session.
  try {
    sessionStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(SESSION_KEY)
  } catch { /* Storage can be unavailable in private/restricted browsers. */ }
}

export async function loginDemo(username, password) {
  if (!supabase) {
    return { ok: false, error: 'Supabase no está configurado. Reinicia el servidor después de crear .env.' }
  }
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: username.trim(),
      password,
    })
    if (error) return { ok: false, error: error.message }
    if (!data.session) return { ok: false, error: 'No se pudo iniciar la sesión. Inténtalo nuevamente.' }
    clearLegacySession()
    return { ok: true }
  } catch {
    return { ok: false, error: 'No se pudo conectar. Revisa tu conexión e inténtalo nuevamente.' }
  }
}

export async function logoutDemo() {
  try {
    if (supabase) {
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      if (error) {
        // Supabase may clear this browser's session even if remote revocation fails.
        const { data, error: sessionError } = await supabase.auth.getSession()
        if (sessionError || data.session) return { ok: false, error: 'No se pudo cerrar la sesión. Inténtalo nuevamente.' }
      }
    }
    clearLegacySession()
    return { ok: true }
  } catch {
    return { ok: false, error: 'No se pudo cerrar la sesión. Revisa tu conexión e inténtalo nuevamente.' }
  }
}
