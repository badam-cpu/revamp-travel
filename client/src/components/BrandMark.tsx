/**
 * Brandbook rule: use the intact lowercase `revamp.` wordmark with generous clear space.
 * The compact state uses the approved `re.` monogram inside a rounded square.
 */
import { Link } from "wouter";
import { cn } from "@/lib/utils";

export function BrandMark({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  if (compact) {
    return (
      <Link href="/" aria-label="Revamp home" className={cn("grid h-11 w-11 place-items-center rounded-[13px] text-[1.15rem] font-bold tracking-[-0.07em]", light ? "border border-[#212121]/30 bg-white text-[#212121]" : "bg-[#F15822] text-white")}>
        re.
      </Link>
    );
  }

  return (
    <Link href="/" className="inline-flex items-center py-2" aria-label="Revamp home">
      <span className={cn("brand-wordmark text-[1.85rem] font-medium leading-none tracking-[-0.07em]", light ? "text-white" : "text-[#212121]")}>revamp.</span>
    </Link>
  );
}

