/**
 * Brandbook rule: use the intact lowercase `revamp.` wordmark with generous clear space.
 * The compact state uses the approved `re.` monogram inside a rounded square.
 */
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { useSite } from "@/contexts/SiteContext";

export function BrandMark({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  // On revampstay the wordmark reads "revampstay." with an apricot "stay." —
  // same type treatment, so the brand clearly carries over. Default site keeps
  // the intact "revamp." exactly as before.
  const site = useSite();
  if (compact) {
    return (
      <Link href="/" aria-label={site === "stay" ? "Revamp Stay home" : "Revamp home"} className={cn("grid h-11 w-11 place-items-center rounded-[13px] text-[1.15rem] font-bold tracking-[-0.07em]", light ? "border border-[#212121]/30 bg-white text-[#212121]" : "bg-[#F15822] text-white")}>
        re.
      </Link>
    );
  }

  return (
    <Link href="/" className="inline-flex items-center py-2" aria-label={site === "stay" ? "Revamp Stay home" : "Revamp home"}>
      <span className={cn("brand-wordmark text-[1.85rem] font-medium leading-none tracking-[-0.07em]", light ? "text-white" : "text-[#212121]")}>
        revamp{site === "stay" ? <span className="text-[#F15822]">stay.</span> : "."}
      </span>
    </Link>
  );
}

