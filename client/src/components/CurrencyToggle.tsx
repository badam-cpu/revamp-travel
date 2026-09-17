/**
 * AMD / USD display-currency switch. Shown only when a rate is configured (see
 * CurrencyContext). Purely a display preference — prices settle in AMD; USD is
 * a converted reference.
 */
import { useCurrency } from "@/contexts/CurrencyContext";
import { cn } from "@/lib/utils";

export function CurrencyToggle({ className, light = false }: { className?: string; light?: boolean }) {
  const { currency, setCurrency, switchable } = useCurrency();
  if (!switchable) return null;
  return (
    <div
      className={cn("inline-flex overflow-hidden rounded-none border text-xs font-bold", light ? "border-white/25" : "border-basalt/20", className)}
      role="group"
      aria-label="Display currency"
    >
      {(["AMD", "USD"] as const).map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => setCurrency(c)}
          aria-pressed={currency === c}
          className={cn(
            "px-2 py-1.5 transition-colors",
            currency === c ? "bg-apricot text-white" : light ? "text-paper/70 hover:text-white" : "text-basalt/60 hover:text-basalt",
          )}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
