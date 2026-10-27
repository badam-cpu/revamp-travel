/**
 * Aha Voice Assistant — the call itself (lazy-loaded by AhaVoiceButton so the
 * ElevenLabs/WebRTC code never weighs on the listing page until someone taps it).
 *
 * Starts a voice session with the Revamp agent on ElevenLabs (VITE_ELEVENLABS_AGENT_ID,
 * a public agent id) and hands it the listing's own details + FAQ as
 * `listing_context` (GET /api/voice/context). For dates the agent calls our
 * `check_dates` tool (POST /api/voice/quote). English or Russian, chosen before
 * the call. Nothing is booked or paid here; the guest books on the page.
 * Errors stay calm — details go to the console only.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Loader2, Mic, MicOff, PhoneOff } from "lucide-react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";

const AGENT_ID = import.meta.env.VITE_ELEVENLABS_AGENT_ID as string | undefined;

type Lang = "en" | "ru";
const FIRST: Record<Lang, (title: string) => string> = {
  en: (t) => `Hi, I'm Aha, Revamp's assistant. Ask me anything about ${t} — parking, check-in, what's included, or whether your dates are free.`,
  ru: (t) => `Здравствуйте! Я Аха, помощник Revamp. Спросите меня о «${t}» — парковка, заезд, что включено, свободны ли ваши даты.`,
};
const armeniaToday = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);

function Call({ slug, title, onEnd }: { slug: string; title: string; onEnd: () => void }) {
  const [lang, setLang] = useState<Lang>("en");
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const started = useRef(false);
  const convo = useConversation({
    onError: (err: unknown) => {
      console.error("[aha-voice]", err);
      setProblem("The call dropped. Please try again in a moment.");
      setStarting(false);
    },
    onDisconnect: () => setStarting(false),
  });
  const live = convo.status === "connected";

  // Hang up when the window closes.
  useEffect(() => () => {
    if (started.current) convo.endSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async () => {
    if (!AGENT_ID) return;
    setProblem(null);
    setStarting(true);
    try {
      // Ask for the microphone first so a "no" gets a clear message.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      console.error("[aha-voice] microphone", err);
      setProblem("Aha needs your microphone. Allow microphone access for this site, then tap Start again.");
      setStarting(false);
      return;
    }
    try {
      const r = await fetch(`/api/voice/context?slug=${encodeURIComponent(slug)}`);
      if (!r.ok) throw new Error(`context ${r.status}`);
      const ctx = (await r.json()) as { title: string; context: string };
      started.current = true;
      convo.startSession({
        agentId: AGENT_ID,
        connectionType: "webrtc",
        dynamicVariables: { listing_title: ctx.title, listing_slug: slug, listing_context: ctx.context, today: armeniaToday() },
        overrides: { agent: { language: lang, firstMessage: FIRST[lang](ctx.title) } },
      });
      trackEvent("voice_assistant_start", { item_id: slug, language: lang });
    } catch (err) {
      console.error("[aha-voice] start", err);
      setProblem("Aha isn't available right now. Please try again later, or ask the host in writing.");
      setStarting(false);
    }
  };

  const status = !live ? (starting || convo.status === "connecting" ? "Connecting…" : "Ready when you are") : convo.isSpeaking ? "Aha is speaking…" : convo.isMuted ? "Microphone off" : "Listening…";

  return (
    <div className="grid gap-5">
      <div className="grid place-items-center py-2">
        <div
          aria-hidden
          className={cn(
            "grid h-28 w-28 place-items-center rounded-full bg-apricot/10 transition-transform duration-300 motion-reduce:transition-none",
            live && convo.isSpeaking && "scale-110 bg-apricot/20",
            live && !convo.isSpeaking && !convo.isMuted && "animate-pulse motion-reduce:animate-none",
          )}
        >
          <div className="grid h-16 w-16 place-items-center rounded-full bg-apricot text-white">
            {starting && !live ? <Loader2 className="h-6 w-6 animate-spin" /> : convo.isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
          </div>
        </div>
        <p className="mt-4 text-sm font-semibold text-basalt" aria-live="polite">{status}</p>
      </div>

      {!live ? (
        <>
          <div role="radiogroup" aria-label="Language" className="grid grid-cols-2 gap-2">
            {(["en", "ru"] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={lang === l}
                onClick={() => setLang(l)}
                className={cn("h-11 rounded-full border text-sm font-semibold", lang === l ? "border-apricot bg-apricot/10 text-apricot" : "border-basalt/15 text-basalt/70")}
              >
                {l === "en" ? "English" : "Русский"}
              </button>
            ))}
          </div>
          <Button onClick={start} disabled={starting || !AGENT_ID} className="h-12 rounded-full bg-apricot text-base text-white hover:bg-apricot/90">
            {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mic className="mr-2 h-4 w-4" />} Start talking
          </Button>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => convo.setMuted(!convo.isMuted)} className="h-12 rounded-full">
            {convo.isMuted ? <Mic className="mr-2 h-4 w-4" /> : <MicOff className="mr-2 h-4 w-4" />} {convo.isMuted ? "Unmute" : "Mute"}
          </Button>
          <Button
            onClick={() => {
              convo.endSession();
              onEnd();
            }}
            className="h-12 rounded-full bg-basalt text-white hover:bg-basalt/90"
          >
            <PhoneOff className="mr-2 h-4 w-4" /> End
          </Button>
        </div>
      )}

      {problem && <p className="rounded-none border border-apricot/30 bg-apricot/[0.05] p-3 text-sm leading-6 text-basalt/80">{problem}</p>}

      <p className="text-xs leading-5 text-basalt/50">
        Aha is an AI voice assistant. It answers from this listing's details and can check your dates — it doesn't book or take payments; you book on this page. Your voice is processed by our voice provider to reply.{" "}
        <Link href="/privacy" className="underline underline-offset-2">Privacy</Link>
      </p>
    </div>
  );
}

export default function AhaVoiceCall(props: { slug: string; title: string; onEnd: () => void }) {
  return (
    <ConversationProvider>
      <Call {...props} />
    </ConversationProvider>
  );
}
