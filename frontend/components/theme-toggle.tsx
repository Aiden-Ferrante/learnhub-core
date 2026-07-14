"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "./theme-provider"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  
  const nextTheme = theme === "dark" ? "light" : "dark"
  const label = `Switch to ${nextTheme} theme (currently ${theme})`

  return (
    <button
      className="btn-icon relative focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-lg"
      onClick={() => setTheme(nextTheme)}
      aria-label={label}
      title={`Switch to ${nextTheme} theme`}
    >
      <Sun
        className={`h-5 w-5 transition-all ${theme === "dark" ? "opacity-0 scale-0 rotate-90 absolute" : "opacity-100 scale-100 rotate-0 relative"}`}
      />
      <Moon
        className={`h-5 w-5 transition-all ${theme === "light" ? "opacity-0 scale-0 -rotate-90 absolute" : "opacity-100 scale-100 rotate-0 relative"}`}
      />
    </button>
  )
}

