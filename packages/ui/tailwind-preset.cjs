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
        brand: {
          50: "#f1f5ff",
          100: "#e2eaff",
          200: "#c3d3ff",
          300: "#9db3ff",
          400: "#7288ff",
          500: "#4a5ef5",
          600: "#3742d6",
          700: "#2c33ac",
          800: "#262c86",
          900: "#1f2568",
          950: "#12153c",
          // Theme-adaptive text color for links/active-nav/badge text sitting
          // directly on the page surface — unlike the fixed scale above,
          // this repaints per theme so it stays readable on both (see
          // globals.css [data-theme] blocks).
          link: themeVar("--color-brand-link"),
          "link-hover": themeVar("--color-brand-link-hover"),
        },
        accent: {
          300: "#f0abfc",
          400: "#e879f9",
          500: "#c026d3",
          600: "#a21caf",
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
        "brand-gradient": "linear-gradient(135deg, #7288ff 0%, #4a5ef5 45%, #a21caf 100%)",
        "brand-gradient-soft": "linear-gradient(135deg, rgba(114,136,255,0.16) 0%, rgba(162,28,175,0.10) 100%)",
        "mesh-ambient":
          "radial-gradient(ellipse 80% 50% at 20% -10%, rgba(74,94,245,0.25), transparent), radial-gradient(ellipse 60% 40% at 100% 0%, rgba(162,28,175,0.14), transparent)",
        "card-sheen": "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 100%)",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(74,94,245,0.18), 0 8px 24px -4px rgba(74,94,245,0.3)",
        "glow-lg": "0 0 0 1px rgba(74,94,245,0.2), 0 16px 40px -8px rgba(74,94,245,0.35)",
        card: "0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -8px rgba(0,0,0,0.6)",
        "card-hover": "0 1px 2px rgba(0,0,0,0.4), 0 20px 48px -12px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)",
        "inner-top": "inset 0 1px 0 0 rgba(255,255,255,0.06)",
      },
      keyframes: {
        "fade-up": { "0%": { opacity: 0, transform: "translateY(6px)" }, "100%": { opacity: 1, transform: "translateY(0)" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
      },
      animation: {
        "fade-up": "fade-up 0.4s cubic-bezier(0.16,1,0.3,1) both",
        shimmer: "shimmer 2.5s linear infinite",
      },
      letterSpacing: {
        tightest: "-0.04em",
      },
    },
  },
};
