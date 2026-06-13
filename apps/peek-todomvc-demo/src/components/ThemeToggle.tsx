import { motion } from 'framer-motion'
import { Moon, Sun } from 'lucide-react'
import { cn } from '../lib/utils'

export function ThemeToggle({ theme, onToggle }: { theme: 'light' | 'dark'; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Toggle theme"
      data-testid="theme-toggle"
      className={cn(
        'inline-flex h-10 w-10 items-center justify-center rounded-full',
        'border border-border bg-card/70 text-muted-foreground backdrop-blur',
        'transition-colors hover:bg-accent hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <motion.span
        key={theme}
        initial={{ rotate: -90, opacity: 0 }}
        animate={{ rotate: 0, opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        {theme === 'dark' ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />}
      </motion.span>
    </button>
  )
}
