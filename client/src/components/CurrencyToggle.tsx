/**
 * AMD / USD display-currency switch. Shown only when a rate is configured (see
 * CurrencyContext). Purely a display preference — prices settle in AMD; USD is
 * a converted reference.
 */
import { Check, ChevronDown } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const SIGN = { AMD: "֏", USD: "$" } as const;

/** Compact header version: "֏ AMD ▾" opening AMD / USD (most visitors never change it). */
export function CurrencyMenu() {
  const { currency, setCurrency, switchable } = useCurrency();
  if (!switchable) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-10 items-center gap-1 rounded-full px-3 text-sm font-semibold text-basalt/75 outline-none transition-colors hover:text-basalt focus-visible:outline-2 focus-visible:outline-apricot" aria-label={`Display currency: ${currency}`}>
        <span aria-hidden>{SIGN[currency]}</span> {currency} <ChevronDown className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        {(["AMD", "USD"] as const).map((c) => (
          <DropdownMenuItem key={c} onSelect={() => setCurrency(c)} className="flex items-center justify-between gap-3">
            <span>{SIGN[c]} {c === "AMD" ? "Armenian dram" : "US dollar"}</span>
            {currency === c && <Check className="h-4 w-4 text-apricot" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
