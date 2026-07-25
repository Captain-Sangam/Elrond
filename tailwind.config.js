/**
 * Tailwind is kept for layout utilities only; all colors and radii resolve to
 * Astryx (Gothic) design tokens. The official `@astryxdesign/core/tailwind-theme.css`
 * bridge is Tailwind v4-only (`@theme inline`), so v3 maps the tokens here.
 *
 * `color-mix` wrapping is load-bearing: it keeps Tailwind's `/opacity` modifiers
 * working (bg-muted/30, hover:bg-accent/50, ...). A bare `var(--token)` would
 * silently drop the alpha.
 */
const tok = (name) =>
  `color-mix(in srgb, var(${name}) calc(<alpha-value> * 100%), transparent)`

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        border: tok('--color-border'),
        input: tok('--color-border'),
        ring: tok('--color-text-accent'),
        background: tok('--color-background-body'),
        foreground: tok('--color-text-primary'),
        primary: {
          DEFAULT: tok('--color-text-accent'),
          foreground: tok('--color-on-accent')
        },
        secondary: {
          DEFAULT: tok('--color-background-muted'),
          foreground: tok('--color-text-primary')
        },
        destructive: {
          DEFAULT: tok('--color-error'),
          foreground: tok('--color-on-error')
        },
        muted: {
          DEFAULT: tok('--color-background-muted'),
          foreground: tok('--color-text-secondary')
        },
        /*
         * `accent` is the hover/selected tint in this app (hover:bg-accent on
         * buttons, bg-accent on the active sidebar row), not a brand color.
         * Gothic's overlay-pressed token is exactly that, and stays distinct
         * from `muted` panel surfaces.
         */
        accent: {
          DEFAULT: tok('--color-overlay-pressed'),
          foreground: tok('--color-text-primary')
        },
        popover: {
          DEFAULT: tok('--color-background-popover'),
          foreground: tok('--color-text-primary')
        },
        card: {
          DEFAULT: tok('--color-background-card'),
          foreground: tok('--color-text-primary')
        }
      },
      borderRadius: {
        lg: 'var(--radius-container)',
        md: 'var(--radius-element)',
        sm: 'var(--radius-inner)'
      },
      fontFamily: {
        sans: 'var(--font-family-body)',
        mono: 'var(--font-family-code)'
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' }
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' }
        }
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out'
      }
    }
  },
  plugins: [
    require('tailwindcss-animate'),
    require('@tailwindcss/typography')
  ]
}
