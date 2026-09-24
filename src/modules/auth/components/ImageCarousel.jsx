import { useState, useEffect, useCallback } from 'react'

import img1 from '../../../assets/gamer-chair-with-multicolored-neon-lights.jpg'
import img2 from '../../../assets/modern-monitor-elegant-table.jpg'
import img3 from '../../../assets/pexels-sulimansallehi-758532.jpg'
import img4 from '../../../assets/pexels-umudicreative-31862215.jpg'
import img5 from '../../../assets/technology-integrated-everyday-life.jpg'

const SLIDES = [
  { url: img1, alt: 'Silla gamer con luces de neón' },
  { url: img2, alt: 'Monitor moderno en escritorio' },
  { url: img3, alt: 'Setup gaming' },
  { url: img4, alt: 'Comunidad gamer' },
  { url: img5, alt: 'Tecnología integrada' },
]

const dotClass = (isActive) =>
  `rounded-full transition-all duration-300 ${
    isActive ? 'w-6 h-2 bg-white' : 'w-2 h-2 bg-white/50 hover:bg-white/80'
  }`

export function ImageCarousel() {
  const [current, setCurrent] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(false)

  const goTo = useCallback(
    (index) => {
      if (isTransitioning) return
      setIsTransitioning(true)
      setCurrent(index)
      setTimeout(() => setIsTransitioning(false), 500)
    },
    [isTransitioning],
  )

  const next = useCallback(
    () => goTo(current === SLIDES.length - 1 ? 0 : current + 1),
    [current, goTo],
  )

  useEffect(() => {
    const timer = setInterval(next, 4000)
    return () => clearInterval(timer)
  }, [next])

  return (
    <div className="relative w-full h-full overflow-hidden bg-black">
      {SLIDES.map((slide, index) => (
        <div
          key={index}
          className={`absolute inset-0 transition-opacity duration-500 ${
            index === current ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <img src={slide.url} alt={slide.alt} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/10" />
        </div>
      ))}

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex gap-2">
        {SLIDES.map((_, index) => (
          <button
            key={index}
            onClick={() => goTo(index)}
            aria-label={`Ir a imagen ${index + 1}`}
            className={dotClass(index === current)}
          />
        ))}
      </div>
    </div>
  )
}
