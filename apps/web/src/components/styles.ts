const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");

export type Variant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_BASE =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition duration-300 ease-cream disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  secondary: "border border-line bg-surface text-fg hover:bg-surface-2",
  ghost: "text-fg hover:bg-surface-2",
  danger: "border border-danger bg-surface text-danger hover:bg-danger-bg",
};

export function buttonClass(variant: Variant = "primary", extra?: string): string {
  return cx(BUTTON_BASE, BUTTON_VARIANTS[variant], extra);
}
