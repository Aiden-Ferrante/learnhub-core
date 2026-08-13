import type { Config } from "tailwindcss"

const config: Config = {
  // Follow the OS, as shipyard does. Was ["class"] with no class ever set on
  // <html>, which left every `dark:` utility permanently inactive.
  darkMode: "media",
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        'sans': ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        'mono': ['JetBrains Mono', 'Fira Code', 'Consolas', 'Monaco', 'Courier New', 'monospace'],
      },
      letterSpacing: {
        'tighter': '-0.02em',
        'tight': '-0.01em',
        'normal': '0',
        'wide': '0.01em',
        'wider': '0.02em',
        'widest': '0.05em',
      },
      colors: {
        // Canonical Channel brand accent (theme-aware via CSS var).
        // Use `text-brand` / `bg-brand`.
        brand: {
          DEFAULT: "hsl(var(--brand-accent))",
          dark: "hsl(var(--brand-accent-dark))",
          light: "hsl(var(--brand-accent-light))",
        },
        // Concept-kind hues (see globals.css) — chips in the reader/concept surfaces.
        kind: {
          definition: "hsl(var(--kind-definition))",
          theorem: "hsl(var(--kind-theorem))",
          principle: "hsl(var(--kind-principle))",
          result: "hsl(var(--kind-result))",
          method: "hsl(var(--kind-method))",
        },
        // Paper reading-surface palette — defined on .reading-surface-paper.
        paper: {
          card: "hsl(var(--paper-card))",
          border: "hsl(var(--paper-border))",
          ink: "hsl(var(--paper-ink))",
          "ink-strong": "hsl(var(--paper-ink-strong))",
          muted: "hsl(var(--paper-muted))",
        },
        // Domain status vocabulary (see globals.css) — text-status-due, bg-status-mastered/15, …
        status: {
          mastered: "hsl(var(--status-mastered))",
          ready: "hsl(var(--status-ready))",
          due: "hsl(var(--status-due))",
          fading: "hsl(var(--status-fading))",
          building: "hsl(var(--status-building))",
          error: "hsl(var(--status-error))",
        },
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        // Add these custom text colors
        "text-dark": "#333333",
        "text-light": "#E6E6E6",
      },
      fontSize: {
        // Make text-lg the same visual size as current text-base for hierarchy without increasing size
        lg: ["1rem", { lineHeight: "1.5rem" }],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    require("@tailwindcss/forms"),
    require("@tailwindcss/typography"),
  ],
}
export default config

