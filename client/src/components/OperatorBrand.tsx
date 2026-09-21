/**
 * "Hosted by <logo> <Business name>" block shown on a listing/tour page.
 * Fetches the operator's public profile (business_name / display_name / logo_url)
 * by operatorId — profiles are publicly readable (migration 0001). Renders
 * nothing until there's a name or logo to show. select("*") stays resilient if
 * the logo_url column (migration 0037) hasn't been added yet.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Brand { name: string | null; logo: string | null }

export function OperatorBrand({ operatorId, className = "" }: { operatorId: string; className?: string }) {
  const [brand, setBrand] = useState<Brand | null>(null);

  useEffect(() => {
    if (!operatorId || operatorId === "seed") return;
    let active = true;
    supabase
      .from("profiles")
      .select("*")
      .eq("id", operatorId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !data) return;
        const row = data as { business_name?: string | null; display_name?: string | null; logo_url?: string | null };
        setBrand({ name: row.business_name || row.display_name || null, logo: row.logo_url ?? null });
      });
    return () => {
      active = false;
    };
  }, [operatorId]);

  if (!brand || (!brand.name && !brand.logo)) return null;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {brand.logo ? (
        <img src={brand.logo} alt="" className="h-11 w-11 shrink-0 rounded-full border border-basalt/12 object-cover" />
      ) : (
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-basalt/5 text-sm font-bold text-basalt/50">{(brand.name ?? "?").slice(0, 1).toUpperCase()}</div>
      )}
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-basalt/40">Hosted by</p>
        <p className="truncate text-sm font-semibold">{brand.name}</p>
      </div>
    </div>
  );
}
