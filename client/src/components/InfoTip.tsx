/**
 * Small "?" info affordance used next to metric labels to explain what each
 * number means. Opens on hover (desktop) AND on tap — Radix tooltips ignore
 * touch, so the tap toggles it ourselves (preventDefault keeps Radix from
 * closing it again on the same click); a tap outside closes it. The button has
 * a ~34px hit area around the 14px icon. Relies on the app-root TooltipProvider.
 */
import { useState } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function InfoTip({ text, label }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label ? `What is ${label}?` : "More info"}
          aria-expanded={open}
          className="-m-2.5 inline-flex p-2.5 align-middle text-basalt/35 transition-colors hover:text-basalt/70 focus-visible:outline-none focus-visible:text-basalt/70"
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px] text-xs leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  );
}
