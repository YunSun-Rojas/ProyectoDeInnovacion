import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export function useAuthSession() {
  const [session, setSession] = useState(supabase ? undefined : null)

  useEffect(() => {
    if (!supabase) return
    let active = true
    let receivedEvent = false
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      receivedEvent = true
      if (active) setSession(nextSession)
    })
    // Do not let a late initial read overwrite a newer login/logout event.
    supabase.auth.getSession().then(({ data, error }) => {
      if (active && !receivedEvent) setSession(error ? null : data.session)
    }).catch(() => {
      if (active && !receivedEvent) setSession(null)
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  return { session, loading: session === undefined }
}
