/**
 * Booking window → "Customer journey" (migration 0098): each journey step for
 * this booking — sent (when, how), scheduled (when), off, or not applicable —
 * plus "Send message": pick a step, preview it with this guest's details, choose
 * channels, send now. Server: /api/journey/{schedule,preview,send}.
 * Renders nothing when the feature isn't available (pre-0098) or the booking
 * can't get journey messages.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Clock, Mail, MessageSquare, Send, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RichText } from "@/components/RichText";
import { getJourneySchedule, previewJourneyStep, sendJourneyStepNow, type JourneyPreview, type JourneyScheduleItem, userMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Yerevan" });
const CHANNEL_LABEL: Record<string, string> = { email: "email", inbox: "inbox", sms: "SMS", whatsapp: "WhatsApp", viber: "Viber", telegram: "Telegram" };

export function BookingJourney({ bookingId, status, onSent }: { bookingId: string; status: string; onSent: () => void }) {
  const [items, setItems] = useState<JourneyScheduleItem[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [preview, setPreview] = useState<JourneyPreview | null>(null);
  const [channels, setChannels] = useState({ email: true, text: true, inbox: true });
  const [sending, setSending] = useState(false);
  const sendable = status === "confirmed" || status === "completed";

  const load = useCallback(() => {
    if (!sendable) return;
    getJourneySchedule(bookingId)
      .then(setItems)
      .catch((e) => {
        console.error("[journey] schedule", e);
        setItems(null);
      });
  }, [bookingId, sendable]);
  useEffect(load, [load]);

  const pick = async (s: string) => {
    setStep(s);
    setPreview(null);
    try {
      const p = await previewJourneyStep(bookingId, s);
      setPreview(p);
      setChannels({ email: p.channels.email && p.hasEmail, text: p.channels.text && p.hasPhone, inbox: p.channels.inbox });
    } catch (e) {
      toast(userMessage(e, "Couldn't load that message."));
      setStep(null);
    }
  };

  const send = async () => {
    if (!step) return;
    setSending(true);
    try {
      const r = await sendJourneyStepNow(bookingId, step, channels);
      toast.success(`Sent — ${r.channels.map((c) => CHANNEL_LABEL[c] ?? c).join(", ")}.`);
      setPicking(false);
      setStep(null);
      setPreview(null);
      load();
      onSent();
    } catch (e) {
      toast(userMessage(e, "Couldn't send the message."));
    } finally {
      setSending(false);
    }
  };

  if (!sendable || !items) return null;
  const now = Date.now();

  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-basalt/45">Customer journey</h3>
        {!picking && (
          <button type="button" onClick={() => setPicking(true)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-basalt/55 transition-colors hover:text-apricot">
            <Send className="h-3 w-3" /> Send message
          </button>
        )}
      </div>
      <ul className="mt-2 grid gap-1.5 text-sm">
        {items.map((it) => {
          const last = [...it.sends].reverse().find((s) => s.status === "sent");
          const missed = it.enabled && it.applicable && !last && now > Date.parse(it.latestAt);
          return (
            <li key={it.step} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
              <span className="font-medium">{it.label}</span>
              <span className={cn("inline-flex items-center gap-1 text-xs", last ? "text-sevan" : missed ? "text-tuff" : "text-basalt/50")}>
                {last ? (
                  <>
                    <Check className="h-3.5 w-3.5" /> Sent {fmt(last.at)} · {last.channels.map((c) => CHANNEL_LABEL[c] ?? c).join(", ") || "—"}
                  </>
                ) : !it.applicable ? (
                  it.reason ?? "Not for this booking"
                ) : !it.enabled ? (
                  "Automatic sending off"
                ) : missed ? (
                  "Not sent (too late now)"
                ) : (
                  <>
                    <Clock className="h-3.5 w-3.5" /> Scheduled {fmt(it.dueAt)}
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {picking && (
        <div className="mt-3 grid gap-3 border border-basalt/12 bg-chalk/60 p-3">
          <div className="flex flex-wrap gap-2">
            {items.map((it) => (
              <button
                key={it.step}
                type="button"
                aria-pressed={step === it.step}
                onClick={() => void pick(it.step)}
                className={cn(
                  "min-h-10 rounded-none border px-3 text-xs font-semibold transition-colors",
                  step === it.step ? "border-apricot bg-apricot/10 text-basalt" : "border-basalt/15 bg-paper text-basalt/70 hover:border-basalt/40",
                )}
              >
                {it.label}
              </button>
            ))}
          </div>
          {step && !preview && <p className="text-xs text-basalt/50">Loading preview…</p>}
          {preview && (
            <>
              <div className="max-h-64 overflow-y-auto border border-basalt/10 bg-paper p-3">
                <p className="text-sm font-semibold">{preview.subject}</p>
                <RichText text={preview.body} className="mt-2 whitespace-pre-line text-[13px] leading-6 text-basalt/80" />
                {preview.text && <p className="mt-3 border-t border-basalt/10 pt-2 text-xs text-basalt/55">Text: {preview.text}</p>}
              </div>
              {preview.missing.length > 0 && (
                <p className="text-xs text-tuff">
                  Not filled for this booking (those lines are left out): {preview.missing.join(", ")}. Add them in Customer journey → Listing details.
                </p>
              )}
              <div className="flex flex-wrap gap-3 text-xs">
                <label className={cn("inline-flex items-center gap-1.5", !preview.hasEmail && "opacity-40")}>
                  <input type="checkbox" disabled={!preview.hasEmail} checked={channels.email} onChange={(e) => setChannels((c) => ({ ...c, email: e.target.checked }))} />
                  <Mail className="h-3.5 w-3.5" /> Email
                </label>
                <label className={cn("inline-flex items-center gap-1.5", !preview.hasPhone && "opacity-40")} title={preview.hasPhone ? "SMS / WhatsApp / Viber if the guest opted in; Telegram if linked" : "No phone number on this booking"}>
                  <input type="checkbox" disabled={!preview.hasPhone} checked={channels.text} onChange={(e) => setChannels((c) => ({ ...c, text: e.target.checked }))} />
                  <Smartphone className="h-3.5 w-3.5" /> Text
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={channels.inbox} onChange={(e) => setChannels((c) => ({ ...c, inbox: e.target.checked }))} />
                  <MessageSquare className="h-3.5 w-3.5" /> Inbox
                </label>
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={() => void send()} disabled={sending || (!channels.email && !channels.text && !channels.inbox)} className="h-10 rounded-none bg-apricot text-white hover:bg-apricot/90">
                  {sending ? "Sending…" : "Send now"}
                </Button>
                <button type="button" onClick={() => { setPicking(false); setStep(null); setPreview(null); }} className="text-sm font-semibold text-basalt/50 hover:text-basalt">
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
