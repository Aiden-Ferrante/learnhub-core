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
      // Both stacks are the fleet's, hand-synced from fleet-ui/fleet.css
      // (--fleet-font-sans / --fleet-font-mono). Copied rather than @import-ed
      // for the same reason the app registry is duplicated in _chrome: this
      // builds in Docker, and reaching outside the build context breaks the
      // image rather than the page. Keep the two in step.
      //
      // Inter was here as a "Channel brand" decision. A different typeface is
      // the strongest signal there is that you have left the site, and this is
      // the admin tier, where the promise is the opposite one.
      fontFamily: {
        'sans': ['Geist', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Noto Sans', 'Arial', 'sans-serif', 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji'],
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
      fontSize: {
        micro: ["0.6875rem", { lineHeight: "1.4" }],    /* 11px   — chips, counts, meta */
        meta: ["0.78125rem", { lineHeight: "1.45" }],   /* 12.5px — secondary lines */
        body: ["0.875rem", { lineHeight: "1.6" }],      /* 14px   — descriptions, prose in chrome */
        title: ["0.9375rem", { lineHeight: "1.35" }],   /* 15px   — card titles */
        section: ["1.1875rem", { lineHeight: "1.25" }], /* 19px   — a section heading */
        page: ["1.625rem", { lineHeight: "1.15" }],     /* 26px   — the name of the surface */

        xs: ["0.6875rem", { lineHeight: "1.4" }],       /* -> micro */
        sm: ["0.78125rem", { lineHeight: "1.45" }],     /* -> meta */
        base: ["0.875rem", { lineHeight: "1.6" }],      /* -> body */
        lg: ["0.9375rem", { lineHeight: "1.35" }],      /* -> title */
        xl: ["1.1875rem", { lineHeight: "1.25" }],      /* -> section */
        "2xl": ["1.625rem", { lineHeight: "1.15" }],    /* -> page */
        "3xl": ["1.625rem", { lineHeight: "1.15" }],    /* -> page; nothing lives between section and page */
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

