/**
 * Shared design tokens for the dashboard (and any future admin surface).
 * Deliberately restrained palette — the product is white-label (CLAUDE.md
 * principle 6), so the dashboard chrome should read as premium SaaS
 * tooling, not compete visually with a tenant's own branding once we add
 * per-tenant theming.
 *
 * `surface.*` and `foreground` resolve through CSS custom properties
 * (see apps/dashboard/app/globals.css's `[data-theme]` blocks) rather
 * than literal hex, so every existing `bg-surface-overlay`,
 * `text-foreground/70`, etc. usage across the dashboard repaints for
 * free when the tenant's theme changes — no per-page rewrite needed.
 * brand/accent/status colors stay constant across themes; only the
 * neutral background/foreground scale shifts.
 */
function themeVar(name) {
  return `rgb(var(${name}) / <alpha-value>)`;
}

module.exports = {
  theme: {
    extend: {
      colors: {
        // Datalyst Africa brand blue — the azure of the mosaic Africa mark
        // in the company logo. 500 is the logo colour itself; the rest is a
        // scale built around it for surfaces, borders and hover states.
        brand: {
          50: "#eff9fe",
          100: "#daf1fc",
          200: "#b6e6fb",
          300: "#79d3f7",
          400: "#35bdf0",
          500: "#12a5e0",
          600: "#0684bd",
          700: "#0a6a99",
          800: "#0f587e",
          900: "#124a69",
          950: "#0b2f46",
          // Theme-adaptive text color for links/active-nav/badge text sitting
          // directly on the page surface — unlike the fixed scale above,
          // this repaints per theme so it stays readable on both (see
          // globals.css [data-theme] blocks).
          link: themeVar("--color-brand-link"),
          "link-hover": themeVar("--color-brand-link-hover"),
        },
        // The red from the logo's "africa" wordmark and its scattered
        // tiles — the brand's accent against the dominant blue, used the
        // way the logo uses it: sparingly, never as a large field.
        accent: {
          300: "#fca5a0",
          400: "#f4645c",
          500: "#ea3d33",
          600: "#d12a20",
        },
        surface: {
          DEFAULT: themeVar("--color-surface"),
          raised: themeVar("--color-surface-raised"),
          overlay: themeVar("--color-surface-overlay"),
          hover: themeVar("--color-surface-hover"),
          border: themeVar("--color-surface-border"),
        },
        foreground: themeVar("--color-foreground"),
        // Theme-adaptive, not fixed hex — each is used both as a tinted
        // background/border (bg-success/10, ring-success/25, fine at low
        // opacity in either theme) and as full-opacity text (badge
        // labels, error messages), where the original fixed values only
        // ever had ~2-2.8:1 contrast on a light surface. See globals.css
        // [data-theme] blocks for the actual per-theme values.
        success: themeVar("--color-success"),
        warning: themeVar("--color-warning"),
        danger: themeVar("--color-danger"),
        info: themeVar("--color-info"),
      },
      fontFamily: {
        sans: ["'Inter var'", "Inter", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xl2: "1.25rem",
        xl3: "1.75rem",
      },
      backgroundImage: {
        // Stays within the blue family rather than running blue -> red:
        // the logo's two colours are near-complementary, so interpolating
        // between them passes through a muddy mauve at the midpoint. Red
        // is the accent token instead, used discretely as the logo does.
        "brand-gradient": "linear-gradient(135deg, #35bdf0 0%, #12a5e0 45%, #0a6a99 100%)",
        "brand-gradient-soft": "linear-gradient(135deg, rgba(53,189,240,0.16) 0%, rgba(18,165,224,0.10) 100%)",
        "mesh-ambient":
          "radial-gradient(ellipse 80% 50% at 20% -10%, rgba(18,165,224,0.25), transparent), radial-gradient(ellipse 60% 40% at 100% 0%, rgba(234,61,51,0.10), transparent)",
        "card-sheen": "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 100%)",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(18,165,224,0.18), 0 8px 24px -4px rgba(18,165,224,0.3)",
        "glow-lg": "0 0 0 1px rgba(18,165,224,0.2), 0 16px 40px -8px rgba(18,165,224,0.35)",
        card: "0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -8px rgba(0,0,0,0.6)",
        "card-hover": "0 1px 2px rgba(0,0,0,0.4), 0 20px 48px -12px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)",
        "inner-top": "inset 0 1px 0 0 rgba(255,255,255,0.06)",
      },
      keyframes: {
        "fade-up": { "0%": { opacity: 0, transform: "translateY(6px)" }, "100%": { opacity: 1, transform: "translateY(0)" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        // Used with SVG `pathLength={1}` (normalizes any path to length 1)
        // so a trend line "draws itself in" on mount regardless of its
        // actual geometry — see packages/ui/src/LineChart.tsx.
        "draw-line": { "0%": { strokeDashoffset: 1 }, "100%": { strokeDashoffset: 0 } },
        "count-in": { "0%": { opacity: 0, transform: "translateY(4px) scale(0.94)" }, "100%": { opacity: 1, transform: "translateY(0) scale(1)" } },
      },
      animation: {
        "fade-up": "fade-up 0.4s cubic-bezier(0.16,1,0.3,1) both",
        shimmer: "shimmer 2.5s linear infinite",
        "draw-line": "draw-line 1.1s cubic-bezier(0.16,1,0.3,1) both",
        "count-in": "count-in 0.35s cubic-bezier(0.16,1,0.3,1) both",
      },
      letterSpacing: {
        tightest: "-0.04em",
      },
    },
  },
};
