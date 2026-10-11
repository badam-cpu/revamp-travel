/**
 * Airbnb-style long description: the first few lines, then "Show more", which
 * opens the full text in a dialog. The button only appears when the text is
 * actually cut off (measured, so it adapts to screen width). The full text
 * stays in the DOM — only visually clamped — so crawlers still read all of it.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { RichText } from "@/components/RichText";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const TEXT = "whitespace-pre-line text-[15px] leading-8 text-basalt/90";

export function ExpandableDescription({
  text,
  title = "About this place",
  lead,
  lines = 6,
  className,
}: {
  text: string;
  title?: string;
  /** Shown above the full text in the dialog (the listing's short description). */
  lead?: string;
  lines?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [clamped, setClamped] = useState(false);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 2);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, lines]);

  return (
    <div className={className}>
      <div ref={ref} style={{ WebkitLineClamp: lines }} className="overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical]">
        <RichText text={text} className={TEXT} />
      </div>
      {clamped && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-5 inline-flex h-11 items-center gap-1 rounded-none bg-chalk px-5 text-sm font-semibold text-basalt hover:bg-basalt/10 focus-visible:outline-2 focus-visible:outline-apricot"
        >
          Show more <ChevronRight className="h-4 w-4" />
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden rounded-none p-0 sm:max-w-2xl">
          <DialogHeader className="border-b border-basalt/10 px-6 py-5 text-left">
            <DialogTitle className="font-display text-2xl tracking-[-0.03em]">{title}</DialogTitle>
            <DialogDescription className="sr-only">The full description.</DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto px-6 py-6">
            {lead && <p className="mb-4 text-lg font-medium leading-relaxed text-basalt">{lead}</p>}
            <RichText text={text} className={cn(TEXT)} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
