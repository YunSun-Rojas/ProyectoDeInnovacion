import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { TextGradient } from './TextGradient'

const INPUT_CLASS =
  'w-full px-5 py-4 border border-gray-200 rounded-xl text-base text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none transition-all'

export function LoginForm() {
  const [showPassword, setShowPassword] = useState(false)
  const [formData, setFormData] = useState({ email: '', password: '' })

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    console.log('Login submitted:', formData)
  }

  return (
    <div className="w-full max-w-lg px-12 py-14">
      <div className="mb-4">
        <img src="/logo-Eagle.png" alt="Eagle Gaming Logo" className="h-24 w-auto object-contain" />
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
            className={INPUT_CLASS}
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
              className={`${INPUT_CLASS} pr-12`}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          className="w-full bg-black text-white py-4 rounded-xl text-base font-semibold hover:bg-gray-800 active:bg-gray-900 transition-colors mt-2"
        >
          Iniciar sesión
        </button>
      </form>
    </div>
  )
}
