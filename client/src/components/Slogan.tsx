/**
 * The Revamp Vacations slogan — "Stay. Experience. Repeat." — always set the
 * same way: three stacked words, "Experience." in brand orange. It's a fixed
 * brand asset (not admin-editable); use this component wherever it appears so
 * the setting never drifts. `onDark` keeps the outer words white on charcoal.
 */
import { cn } from "@/lib/utils";

export function Slogan({ className, onDark = false, as: Tag = "p" }: { className?: string; onDark?: boolean; as?: "p" | "h1" | "h2" }) {
  return (
    // Line-height goes last: tailwind-merge drops `leading-*` when a font-size
    // class follows it, and callers size the slogan via className.
    <Tag className={cn("font-display tracking-[-0.05em]", onDark ? "text-paper" : "text-basalt", className, "leading-[0.88]")}>
      Stay.
      <br />
      <span className="text-apricot">Experience.</span>
      <br />
      Repeat.
    </Tag>
  );
}
