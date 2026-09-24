import { supabase } from './supabase'

const SESSION_KEY = 'eagle-gaming-session'

export function hasDemoSession() {
  return sessionStorage.getItem(SESSION_KEY) === 'supabase'
    || localStorage.getItem(SESSION_KEY) === 'supabase'
}

export async function loginDemo(username, password) {
  if (!supabase) {
    return { ok: false, error: 'Supabase no está configurado. Reinicia el servidor después de crear .env.' }
  }
  const { error } = await supabase.auth.signInWithPassword({
    email: username.trim(),
    password,
  })
  if (error) return { ok: false, error: error.message }
  sessionStorage.setItem(SESSION_KEY, 'supabase')
  localStorage.setItem(SESSION_KEY, 'supabase')
  return { ok: true }
}

export async function logoutDemo() {
  if (supabase) await supabase.auth.signOut()
  sessionStorage.removeItem(SESSION_KEY)
  localStorage.removeItem(SESSION_KEY)
}
