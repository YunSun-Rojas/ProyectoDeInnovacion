import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { TextGradient } from '../../../components/ui/TextGradient'
import styles from './LoginForm.module.css'
import { useNavigate } from 'react-router-dom'
import { loginDemo } from '../services/demoSession'

const INPUT_CLASS =
  'w-full px-5 py-4 border border-gray-200 rounded-xl text-base text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none transition-all'

export function LoginForm() {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [formData, setFormData] = useState({ username: '', password: '' })

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    const result = await loginDemo(formData.username, formData.password)
    if (!result.ok) {
      const message = result.error?.toLowerCase().includes('email not confirmed')
        ? 'El correo todavía no está confirmado en Supabase.'
        : result.error?.toLowerCase().includes('invalid login credentials')
          ? 'El usuario o la contraseña no coinciden con Supabase.'
          : result.error
      setError(message)
      return
    }
    navigate('/dashboard', { replace: true })
  }

  return (
    <div className={`w-full max-w-lg ${styles.container}`}>
      <div className={styles.logo}>
        <img src="/logo-Eagle.png" alt="Eagle Gaming Logo" className="h-24 w-auto object-contain" />
      </div>

      <div className={styles.heading}>
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

      <form onSubmit={handleSubmit} className={styles.form}>
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-2">
            Usuario
          </label>
          <input
            type="text"
            name="username"
            value={formData.username}
            onChange={handleChange}
            placeholder="Usuario"
            className={`${INPUT_CLASS} ${styles.input}`}
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
              className={`${INPUT_CLASS} ${styles.input} ${styles.password}`}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              className={`absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors ${styles.visibility}`}
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {error && <p role="alert" style={{ color: '#b91c1c', fontSize: 14 }}>{error}</p>}

        <button
          type="submit"
          className={`w-full bg-black text-white rounded-xl text-base font-semibold hover:bg-gray-800 active:bg-gray-900 transition-colors ${styles.submit}`}
        >
          Iniciar sesión
        </button>
      </form>
    </div>
  )
}
