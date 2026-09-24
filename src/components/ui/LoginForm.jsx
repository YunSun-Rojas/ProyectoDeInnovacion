import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { TextGradient } from './TextGradient'
import { supabase } from '../../services/supabase'

const INPUT_CLASS =
  'w-full px-5 py-4 border border-gray-200 rounded-xl text-base text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none transition-all'

export function LoginForm() {
  const navigate = useNavigate()

  const [showPassword, setShowPassword] = useState(false)
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleChange = (e) => {
    const { name, value } = e.target

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }))

    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({
          email: formData.email.trim(),
          password: formData.password,
        })

      if (authError || !authData.user) {
        setError('Correo o contraseña incorrectos.')
        return
      }

      const { data: admin, error: adminError } = await supabase
        .from('admin_users')
        .select('user_id')
        .eq('user_id', authData.user.id)
        .maybeSingle()

      if (adminError) {
        await supabase.auth.signOut()
        setError('No se pudo comprobar el permiso de administrador.')
        return
      }

      if (!admin) {
        await supabase.auth.signOut()
        setError('No tienes permisos de administrador.')
        return
      }

      navigate('/dashboard', { replace: true })
    } catch {
      setError('Ocurrió un error. Inténtalo nuevamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-lg px-12 py-14">
      <div className="mb-4">
        <img
          src="/logo-Eagle.png"
          alt="Eagle Gaming Logo"
          className="h-24 w-auto object-contain"
        />
      </div>

      <div className="mb-10">
        <h1 className="text-3xl font-bold text-gray-900 leading-snug">
          Bienvenido al
        </h1>

        <TextGradient
          as="h1"
          colors={['#000000', '#cc0000', '#000000', '#cc0000']}
          duration={4}
          angle={135}
          className="text-3xl font-bold leading-snug"
        >
          Inventario de Eagle Gaming
        </TextGradient>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-2">
            Correo electrónico
          </label>

          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            placeholder="Correo electrónico"
            autoComplete="email"
            className={INPUT_CLASS}
            disabled={loading}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-500 mb-2">
            Contraseña
          </label>

          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Contraseña"
              autoComplete="current-password"
              className={`${INPUT_CLASS} pr-12`}
              disabled={loading}
              required
            />

            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={
                showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'
              }
              className="absolute right-4 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
            >
              {showPassword ? (
                <EyeOff className="w-5 h-5" />
              ) : (
                <Eye className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-black text-white py-4 rounded-xl text-base font-semibold hover:bg-gray-800 active:bg-gray-900 transition-colors mt-2 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {loading ? 'Verificando...' : 'Iniciar sesión'}
        </button>
      </form>
    </div>
  )
}