/**
 * Small "?" info affordance with a hover/tap tooltip, used next to metric labels
 * to explain what each number means. Relies on the app-root TooltipProvider.
 */
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function InfoTip({ text, label }: { text: string; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label ? `What is ${label}?` : "More info"}
          className="inline-flex align-middle text-basalt/35 transition-colors hover:text-basalt/70 focus-visible:outline-none focus-visible:text-basalt/70"
          onClick={(e) => e.preventDefault()}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px] text-xs leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  );
}
