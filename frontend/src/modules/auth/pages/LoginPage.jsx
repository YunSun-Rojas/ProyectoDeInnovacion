import { ImageCarousel } from '../components/ImageCarousel'
import { LoginForm } from '../components/LoginForm'

export function LoginPage() {
  return (
    <div className="h-screen w-screen flex overflow-hidden">
      <div className="flex-1 relative">
        <ImageCarousel />
      </div>
      <div className="flex-1 flex items-center justify-center bg-white">
        <LoginForm />
      </div>
    </div>
  )
}
