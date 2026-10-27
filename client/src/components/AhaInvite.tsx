/**
 * One-time invitation on the operator dashboard to switch on Aha's automatic
 * answers (0119). Shown only while they're off and until the operator answers
 * it ("Turn on" or "Not now" — remembered in this browser). Off stays the
 * default; nothing changes unless they choose it.
 */
import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getAiReply, setAiReply } from "@/lib/templates";

const key = (uid: string) => `revamp.ahaInvite.${uid}`;

export function AhaInvite({ userId, onLearnMore }: { userId: string; onLearnMore: () => void }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = !!localStorage.getItem(key(userId));
    } catch {
      /* storage unavailable — just show it */
    }
    if (seen) return;
    getAiReply(userId)
      .then((s) => setShow(!!s && !s.auto))
      .catch(() => setShow(false));
  }, [userId]);

  const done = () => {
    try {
      localStorage.setItem(key(userId), new Date().toISOString());
    } catch {
      /* ignore */
    }
    setShow(false);
  };

  const turnOn = async () => {
    setBusy(true);
    try {
      await setAiReply(userId, { auto: true, delayMinutes: 15 });
      toast.success("Aha will answer simple guest questions after 15 minutes without a reply. You'll get a note each time.");
      done();
    } catch (e) {
      console.error(e);
      toast("Couldn't switch it on. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!show) return null;
  return (
    <div className="relative mb-6 border border-apricot/30 bg-apricot/[0.04] p-4 pr-12 sm:p-5 sm:pr-14">
      <button type="button" onClick={done} aria-label="Dismiss" className="absolute right-2 top-2 grid h-10 w-10 place-items-center text-basalt/45 hover:text-basalt">
        <X className="h-4 w-4" />
      </button>
      <p className="flex items-center gap-2 font-semibold text-basalt">
        <Sparkles className="h-4 w-4 shrink-0 text-apricot" aria-hidden /> Let Aha answer simple guest questions while you're away
      </p>
      <p className="mt-1.5 max-w-2xl text-sm leading-6 text-basalt/65">
        If a guest waits 15 minutes, Aha replies from your listing details and FAQ — parking, check-in times, what's included — in the guest's language. Bookings, payments and anything unusual stay with you, and you get a note every time. Off by default; switch it off anytime.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={turnOn} disabled={busy} className="h-11 rounded-full bg-apricot px-5 text-white hover:bg-apricot/90 sm:h-9">
          Turn on
        </Button>
        <Button variant="outline" onClick={done} className="h-11 rounded-full px-5 sm:h-9">
          Not now
        </Button>
        <button type="button" onClick={onLearnMore} className="h-11 px-2 text-sm font-semibold text-apricot underline-offset-4 hover:underline sm:h-9">
          See the settings
        </button>
      </div>
    </div>
  );
}
