import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../services/supabase'

export function AdminRoute({ children }) {
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    const verifyAdmin = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user) {
        setStatus('unauthorized')
        return
      }

      const { data: admin, error } = await supabase
        .from('admin_users')
        .select('user_id')
        .eq('user_id', session.user.id)
        .maybeSingle()

      if (error || !admin) {
        await supabase.auth.signOut()
        setStatus('unauthorized')
        return
      }

      setStatus('authorized')
    }

    verifyAdmin()
  }, [])

  if (status === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center">
        Verificando acceso...
      </div>
    )
  }

  if (status === 'unauthorized') {
    return <Navigate to="/login" replace />
  }

  return children
}