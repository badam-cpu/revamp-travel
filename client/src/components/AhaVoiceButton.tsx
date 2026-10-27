/**
 * "Talk to Aha" on listing pages — opens the Aha Voice Assistant (AhaVoiceCall,
 * lazy-loaded). Renders nothing until VITE_ELEVENLABS_AGENT_ID is set, and only
 * for bookable listings (stays, tours, experiences).
 *
 * The call runs in a floating, non-modal panel so the page stays usable while
 * the guest talks; it shrinks to a small bar when Aha fills in the booking box
 * (or when the guest minimises it), and the call keeps going either way.
 */
import { lazy, Suspense, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, Loader2, Mic, X } from "lucide-react";
import { cn } from "@/lib/utils";

const AhaVoiceCall = lazy(() => import("@/components/AhaVoiceCall"));
const ENABLED = !!import.meta.env.VITE_ELEVENLABS_AGENT_ID;

export function AhaVoiceButton({ listing }: { listing: { slug: string; title: string; type: string } }) {
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  if (!ENABLED || !["stay", "tour", "experience"].includes(listing.type)) return null;
  const close = () => {
    setOpen(false);
    setCompact(false);
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-none border border-basalt/20 px-4 py-2.5 text-sm font-semibold text-basalt transition-colors hover:border-apricot hover:text-apricot"
      >
        <Mic className="h-4 w-4 text-apricot" /> Talk to Aha <span className="font-normal text-basalt/50">· voice assistant</span>
      </button>
      {open &&
        createPortal(
          <section
            role="dialog"
            aria-modal="false"
            aria-label="Talk to Aha"
            className={cn(
              "fixed inset-x-3 bottom-[84px] z-[60] border border-basalt/12 bg-paper shadow-[0_24px_60px_-20px_rgba(33,33,33,0.45)] sm:inset-x-auto sm:bottom-6 sm:left-6 sm:w-[360px] lg:bottom-6",
              compact ? "p-3" : "max-h-[calc(100dvh-110px)] overflow-y-auto p-5",
            )}
          >
            <div className={cn("flex items-center gap-2", compact ? "mb-2" : "mb-3")}>
              <p className="min-w-0 flex-1 truncate font-display text-lg leading-tight">
                Talk to Aha
                {!compact && <span className="mt-0.5 block truncate text-xs font-normal text-basalt/55">{listing.title} · English or Russian</span>}
              </p>
              <button type="button" onClick={() => setCompact((c) => !c)} aria-label={compact ? "Expand" : "Minimise"} className="grid h-10 w-10 place-items-center rounded-full text-basalt/55 hover:bg-chalk hover:text-basalt">
                {compact ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              <button type="button" onClick={close} aria-label="Close and end the call" className="grid h-10 w-10 place-items-center rounded-full text-basalt/55 hover:bg-chalk hover:text-basalt">
                <X className="h-4 w-4" />
              </button>
            </div>
            <Suspense fallback={<div className="grid place-items-center py-8"><Loader2 className="h-5 w-5 animate-spin text-basalt/50" /></div>}>
              <AhaVoiceCall slug={listing.slug} title={listing.title} onEnd={close} compact={compact} onFilled={() => setCompact(true)} />
            </Suspense>
          </section>,
          document.body,
        )}
    </>
  );
}
