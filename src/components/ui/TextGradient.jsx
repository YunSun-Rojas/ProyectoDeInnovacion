import { motion } from 'motion/react'

export function TextGradient({
  children,
  as: Component = 'p',
  className = '',
  colors = ['#000000', '#cc0000', '#000000', '#cc0000'],
  duration = 4,
  angle = 135,
}) {
  const MotionComponent = motion.create(Component)

  return (
    <MotionComponent
      animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
      className={`inline-block bg-clip-text text-transparent ${className}`}
      style={{
        backgroundImage: `linear-gradient(${angle}deg, ${[...colors, ...colors].join(', ')})`,
        backgroundSize: `${colors.length * 100}% 100%`,
      }}
      transition={{ duration, ease: 'linear', repeat: Infinity }}
    >
      {children}
    </MotionComponent>
  )
}

export default TextGradient
