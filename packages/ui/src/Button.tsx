import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variantClasses: Record<Variant, string> = {
  // primary/danger sit on a fixed, saturated color (the brand gradient,
  // the danger red) that doesn't change with theme — `text-foreground`
  // would flip to dark navy in light mode and lose contrast against
  // those backgrounds, so their label stays a literal white in both
  // themes on purpose.
  primary:
    "bg-brand-gradient bg-[length:160%_auto] bg-left text-white shadow-glow hover:bg-right hover:shadow-glow-lg",
  secondary: "bg-foreground/5 text-foreground hover:bg-foreground/10 ring-1 ring-inset ring-foreground/10",
  ghost: "text-foreground/70 hover:text-foreground hover:bg-foreground/5",
  danger: "bg-danger/90 text-white hover:bg-danger",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = "primary", className = "", ...rest }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all duration-300 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${className}`}
      {...rest}
    />
  );
}
