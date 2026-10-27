/**
 * "Talk to Aha" on listing pages — opens the Aha Voice Assistant (AhaVoiceCall,
 * lazy-loaded). Renders nothing until VITE_ELEVENLABS_AGENT_ID is set, and only
 * for bookable listings (stays, tours, experiences).
 */
import { lazy, Suspense, useState } from "react";
import { Loader2, Mic } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const AhaVoiceCall = lazy(() => import("@/components/AhaVoiceCall"));
const ENABLED = !!import.meta.env.VITE_ELEVENLABS_AGENT_ID;

export function AhaVoiceButton({ listing }: { listing: { slug: string; title: string; type: string } }) {
  const [open, setOpen] = useState(false);
  if (!ENABLED || !["stay", "tour", "experience"].includes(listing.type)) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-none border border-basalt/20 px-4 py-2.5 text-sm font-semibold text-basalt transition-colors hover:border-apricot hover:text-apricot"
      >
        <Mic className="h-4 w-4 text-apricot" /> Talk to Aha <span className="font-normal text-basalt/50">· voice assistant</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm rounded-none">
          <DialogTitle className="font-display text-2xl">Talk to Aha</DialogTitle>
          <DialogDescription className="-mt-1 text-sm text-basalt/60">
            Ask about <span className="font-semibold text-basalt">{listing.title}</span> out loud — in English or Russian.
          </DialogDescription>
          {open && (
            <Suspense fallback={<div className="grid place-items-center py-10"><Loader2 className="h-5 w-5 animate-spin text-basalt/50" /></div>}>
              <AhaVoiceCall slug={listing.slug} title={listing.title} onEnd={() => setOpen(false)} />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
