/**
 * Shared design tokens for the dashboard (and any future admin surface).
 * Deliberately restrained palette — the product is white-label (CLAUDE.md
 * principle 6), so the dashboard chrome should read as premium SaaS
 * tooling, not compete visually with a tenant's own branding once we add
 * per-tenant theming.
 */
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
        },
        accent: {
          300: "#f0abfc",
          400: "#e879f9",
          500: "#c026d3",
          600: "#a21caf",
        },
        surface: {
          DEFAULT: "#08090f",
          raised: "#0f1119",
          overlay: "#171a26",
          hover: "#1c2030",
          border: "#232837",
        },
        success: "#2fbf71",
        warning: "#e8a53d",
        danger: "#e5484d",
        info: "#4a9eff",
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
