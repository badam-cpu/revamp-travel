/**
 * The Revamp logo, drawn from the brandbook's own outlines (shared/brandLogo.ts):
 * "re" in Cartesian + "vamp" in Circular Std Medium + a round period.
 *
 * Brandbook colours: orange `revamp.` on white (the default), white on charcoal
 * or orange (`light`). The compact mark is the `re.` icon — a rounded square in
 * orange with white, or white with a thin charcoal keyline (`light`). Never
 * recolour letters separately, outline, shadow, stretch or stack the logo.
 */
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { useSite } from "@/contexts/SiteContext";
import { ICON_RADIUS, ICON_RE_PATH, ICON_VIEWBOX, RE_PATH, RE_VIEWBOX, WORDMARK_PATH, WORDMARK_VIEWBOX } from "@shared/brandLogo";

/** The `revamp.` wordmark as an SVG in `currentColor` — size it with a height class. */
export function Wordmark({ className, title = "revamp." }: { className?: string; title?: string | null }) {
  return (
    <svg viewBox={WORDMARK_VIEWBOX} className={cn("block h-6 w-auto shrink-0", className)} fill="currentColor" role={title ? "img" : undefined} aria-label={title ?? undefined} aria-hidden={title ? undefined : true} focusable="false">
      <path d={WORDMARK_PATH} />
    </svg>
  );
}

/**
 * The `re.` letters alone in `currentColor`, for the brandbook's "logo as a
 * pattern" use (large, cropped, faint). Sized in em so it follows the
 * surrounding font-size, sitting on the baseline like the text it replaced.
 */
export function ReMark({ className }: { className?: string }) {
  return (
    <svg viewBox={RE_VIEWBOX} className={cn("inline-block h-[0.47em] w-auto align-baseline", className)} fill="currentColor" aria-hidden focusable="false">
      <path d={RE_PATH} />
    </svg>
  );
}

/** The `re.` app icon (rounded square). */
export function BrandIcon({ light = false, className }: { light?: boolean; className?: string }) {
  return (
    <svg viewBox={ICON_VIEWBOX} className={cn("block h-11 w-11", className)} aria-hidden focusable="false">
      <rect x={light ? 1.5 : 0} y={light ? 1.5 : 0} width={light ? 258.84 : 261.84} height={light ? 258.84 : 261.84} rx={ICON_RADIUS} fill={light ? "#FFFFFF" : "#F15822"} stroke={light ? "rgba(33,33,33,.3)" : undefined} strokeWidth={light ? 3 : undefined} />
      <path d={ICON_RE_PATH} fill={light ? "#212121" : "#FFFFFF"} />
    </svg>
  );
}

export function BrandMark({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  const site = useSite();
  const label = site === "stay" ? "Revamp Stay home" : "Revamp home";
  if (compact) {
    return (
      <Link href="/" aria-label={label} className="inline-flex">
        <BrandIcon light={light} />
      </Link>
    );
  }

  // revampstay keeps its typed "revamp" + orange "stay." treatment until the
  // designer supplies an official revampstay lockup.
  if (site === "stay") {
    return (
      <Link href="/" className="inline-flex items-center py-2" aria-label={label}>
        <span className={cn("brand-wordmark text-[1.85rem] font-medium leading-none tracking-[-0.07em]", light ? "text-white" : "text-[#212121]")}>
          revamp<span className="text-[#F15822]">stay.</span>
        </span>
      </Link>
    );
  }

  return (
    <Link href="/" className="inline-flex items-center py-2" aria-label={label}>
      <Wordmark title={null} className={cn("h-[1.55rem]", light ? "text-white" : "text-[#F15822]")} />
    </Link>
  );
}
