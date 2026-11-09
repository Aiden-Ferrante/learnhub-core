import type { Config } from "tailwindcss"

const config: Config = {
  // Dark only, with the fleet (2026-09-04). There are no `dark:` utilities in
  // src and the tokens in globals.css have one value each; this key is inert.
  darkMode: "media",
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // Study Hall (v0.29.0): Inter and Newsreader come from next/font in layout.tsx as
      // CSS variables; mono stays the Geist Mono copy declared in globals.css.
      fontFamily: {
        'sans': ['var(--font-sans)', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji'],
        'serif': ['var(--font-serif)', 'Newsreader', 'Georgia', 'Iowan Old Style', 'serif'],
        'mono': ['Geist Mono', 'ui-monospace', 'SF Mono', 'Cascadia Mono', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'],
      },
      letterSpacing: {
        'tighter': '-0.02em',
        'tight': '-0.01em',
        'normal': '0',
        'wide': '0.01em',
        'wider': '0.02em',
        'widest': '0.05em',
        // The three uppercase-label registers, matching shipyard: section
        // eyebrows, tile/facet labels, table headers. The scale above tops out
        // at 0.05em, so every uppercase label in the app was rendering at
        // essentially no tracking — the one idiom that most says "shipyard".
        // One label register since fleet.css v2: every uppercase label tracks
        // 0.08em. The three names stay so call sites need not change.
        'label': '0.08em',
        'tile': '0.08em',
        'th': '0.08em',
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
        // Paper reading-surface palette — defined on :root in globals.css, NOT on
        // .reading-surface-paper. These are constants, and the consumers are not all
        // nested under that class, so scoped tokens resolved to nothing at some call
        // sites. On :root these utilities work anywhere.
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
        // INKS — the colours for coloured WORDS (fleet KIT.md: fills measure as low as
        // 2.8:1 at micro size, so text never wears a fill). text-ink-accent replaces
        // text-brand / text-primary on words; ok/warn/danger replace text-status-*
        // mastered/due/error on words. Fills (bg-*, border-*, dots) keep the fill tokens.
        ink: {
          accent: "var(--fleet-accent-text)",
          ok: "var(--fleet-ok-text)",
          warn: "var(--fleet-warn-text)",
          danger: "var(--fleet-danger-text)",
          dim: "var(--fleet-text-dim)",
          "on-accent": "var(--fleet-on-accent)",
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
      },
      // THE TYPE SCALE — the fleet's six steps, hand-synced from fleet.css
      // (--fleet-text-*). Shipyard's note on why they exist: hierarchy carried
      // by grey level alone is the weakest of the three channels and the first
      // to collapse under density.
      //
      // The six are named, AND Tailwind's own names are aliased onto them. That
      // is the fleet's standard adoption trick applied to type instead of
      // colour: ~380 existing `text-xs` / `text-sm` call sites move onto the
      // scale in this one edit instead of 380 of them. Every alias resolves
      // DOWN or level (12->11, 14->12.5, 16->14, 20->19), so fixed-height rows
      // and small buttons gain slack rather than clipping. New code should
      // prefer the named steps; the aliases exist so the old code is not a lie.
      //
      // Untouched on purpose: the @tailwindcss/typography `prose-*` chain, which
      // the reading surface drives from user preference and which carries its
      // own scale (see app/styleguide/page.tsx).
      // THE TYPE SCALE, Study Hall (v0.29.0): one step up from the fleet's dense instrument
      // scale, so body text is 15px and a page title 30px. Tailwind's own names stay aliased
      // onto the six steps so the ~380 existing call sites move with it.
      fontSize: {
        micro: ["0.75rem", { lineHeight: "1.45" }],     /* 12px   — chips, counts, meta */
        meta: ["0.84375rem", { lineHeight: "1.5" }],    /* 13.5px — secondary lines */
        body: ["0.9375rem", { lineHeight: "1.6" }],     /* 15px   — descriptions, prose in chrome */
        title: ["1rem", { lineHeight: "1.4" }],         /* 16px   — card titles */
        section: ["1.3125rem", { lineHeight: "1.3" }],  /* 21px   — a section heading (serif) */
        page: ["1.875rem", { lineHeight: "1.15" }],     /* 30px   — the name of the surface (serif) */

        xs: ["0.75rem", { lineHeight: "1.45" }],        /* -> micro */
        sm: ["0.84375rem", { lineHeight: "1.5" }],      /* -> meta */
        base: ["0.9375rem", { lineHeight: "1.6" }],     /* -> body */
        lg: ["1rem", { lineHeight: "1.4" }],            /* -> title */
        xl: ["1.3125rem", { lineHeight: "1.3" }],       /* -> section */
        "2xl": ["1.875rem", { lineHeight: "1.15" }],    /* -> page */
        "3xl": ["1.875rem", { lineHeight: "1.15" }],    /* -> page */
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

