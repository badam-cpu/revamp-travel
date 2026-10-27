/**
 * Aha Voice Assistant — the call itself (lazy-loaded by AhaVoiceButton so the
 * ElevenLabs/WebRTC code never weighs on the listing page until someone taps it).
 *
 * Starts a voice session (over WebSocket) with the Revamp agent on ElevenLabs (VITE_ELEVENLABS_AGENT_ID,
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
import { requestAhaFill } from "@/lib/ahaBooking";
import { cn } from "@/lib/utils";

const AGENT_ID = import.meta.env.VITE_ELEVENLABS_AGENT_ID as string | undefined;

type Lang = "en" | "ru";
// Short and title-free: listing titles are written for search results, not speech.
const FIRST: Record<Lang, string> = {
  en: "Hi, I'm Aha, Revamp Vacations' voice AI assistant. How can I help you today?",
  ru: "Здравствуйте! Я Аха, голосовой ИИ-помощник Revamp Vacations. Чем могу помочь?",
};
const armeniaToday = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);

// ?voiceDebug=1 shows the technical reason in the window (for us, not guests).
const DEBUG = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("voiceDebug");

type CallProps = { slug: string; title: string; onEnd: () => void; compact?: boolean; onFilled?: () => void };

function Call({ slug, onEnd, compact = false, onFilled }: CallProps) {
  const [lang, setLang] = useState<Lang>("en");
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [debug, setDebug] = useState<string[]>([]);
  const started = useRef(false);
  const connected = useRef(false);
  // Between a failed WebRTC start and the WebSocket retry, the old session's late events are ignored.
  const retrying = useRef(false);
  // The last session's settings, so a failed WebRTC start can be retried over WebSocket.
  const session = useRef<{ opts: Record<string, unknown>; transport: "webrtc" | "websocket" } | null>(null);
  const note = (line: string) => {
    console.info("[aha-voice]", line);
    if (DEBUG) setDebug((d) => [...d.slice(-7), line]);
  };
  const fail = (msg: string) => {
    setProblem(msg);
    setStarting(false);
  };
  const convo = useConversation({
    onConnect: () => {
      connected.current = true;
      note(`connected (${session.current?.transport})`);
    },
    onError: (message: unknown, err?: unknown) => {
      console.error("[aha-voice] error", message, err);
      if (retrying.current) return;
      note(`error: ${String(message)}`);
      if (!connected.current && session.current?.transport === "webrtc") return retryOverWebSocket();
      fail("Aha couldn't connect just now. Please check your internet connection and try again.");
    },
    onDisconnect: (details: unknown) => {
      const d = (details ?? {}) as { reason?: string; message?: string; closeReason?: string; closeCode?: number };
      console.info("[aha-voice] disconnected", details);
      if (retrying.current) return;
      note(`disconnected: ${d.reason ?? "?"}${d.message ? ` — ${d.message}` : ""}${d.closeCode ? ` (${d.closeCode} ${d.closeReason ?? ""})` : ""}`);
      // Never got going over WebRTC (often blocked on some networks) → try the plain web connection once.
      if (!connected.current && session.current?.transport === "webrtc" && d.reason !== "user") return retryOverWebSocket();
      if (!connected.current && d.reason !== "user") return fail("Aha couldn't connect just now. Please try again in a moment, or ask the host in writing.");
      setStarting(false);
    },
  });
  function retryOverWebSocket() {
    if (!session.current) return;
    note("retrying over websocket");
    retrying.current = true;
    session.current = { ...session.current, transport: "websocket" };
    setTimeout(() => {
      retrying.current = false;
      convo.startSession({ ...session.current!.opts, connectionType: "websocket" } as never);
    }, 400);
  }
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
      connected.current = false;
      const opts = {
        agentId: AGENT_ID,
        // The agent's `fill_booking` client tool: fills this page's booking box
        // (dates, guests, start time) — the guest still taps Book and pays.
        clientTools: {
          fill_booking: async (p: Record<string, unknown>) => {
            const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
            const say = await requestAhaFill(slug, {
              startDate: str(p.startDate) ?? str(p.start) ?? "",
              endDate: str(p.endDate) ?? str(p.end),
              guests: Number(p.guests) || undefined,
              time: str(p.time),
            });
            note(`fill_booking → ${say.slice(0, 60)}`);
            if (say.startsWith("Done")) onFilled?.();
            trackEvent("voice_assistant_fill", { item_id: slug, ok: say.startsWith("Done") });
            return say;
          },
        },
        dynamicVariables: { listing_title: ctx.title, listing_slug: slug, listing_context: ctx.context, today: armeniaToday() },
        overrides: { agent: { language: lang, firstMessage: FIRST[lang] } },
      };
      // WebSocket: with our agent, WebRTC sessions connected and were then ended by the
      // agent (2026-10-27), while the same agent works over WebSocket in both languages.
      session.current = { opts, transport: "websocket" };
      note("starting (websocket)");
      convo.startSession({ ...opts, connectionType: "websocket" });
      trackEvent("voice_assistant_start", { item_id: slug, language: lang });
    } catch (err) {
      console.error("[aha-voice] start", err);
      setProblem("Aha isn't available right now. Please try again later, or ask the host in writing.");
      setStarting(false);
    }
  };

  const status = !live ? (starting || convo.status === "connecting" ? "Connecting…" : "Ready when you are") : convo.isSpeaking ? "Aha is speaking…" : convo.isMuted ? "Microphone off" : "Listening…";
  const end = () => {
    convo.endSession();
    onEnd();
  };

  // Shrunk to a bar so the guest can see the page (e.g. the booking box Aha just filled).
  if (compact && live) {
    return (
      <div className="flex items-center gap-2">
        <span aria-hidden className={cn("h-2.5 w-2.5 shrink-0 rounded-full bg-apricot", !convo.isSpeaking && !convo.isMuted && "animate-pulse motion-reduce:animate-none")} />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold" aria-live="polite">{status}</p>
        <button type="button" onClick={() => convo.setMuted(!convo.isMuted)} aria-label={convo.isMuted ? "Unmute" : "Mute"} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-basalt/15 text-basalt hover:border-apricot">
          {convo.isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        <button type="button" onClick={end} aria-label="End the call" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-basalt text-white hover:bg-basalt/90">
          <PhoneOff className="h-4 w-4" />
        </button>
      </div>
    );
  }

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
          <Button onClick={end} className="h-12 rounded-full bg-basalt text-white hover:bg-basalt/90">
            <PhoneOff className="mr-2 h-4 w-4" /> End
          </Button>
        </div>
      )}

      {problem && <p className="rounded-none border border-apricot/30 bg-apricot/[0.05] p-3 text-sm leading-6 text-basalt/80">{problem}</p>}
      {DEBUG && debug.length > 0 && <pre className="max-h-40 overflow-auto whitespace-pre-wrap bg-chalk p-2 text-[11px] leading-4 text-basalt/70">{debug.join("\n")}</pre>}

      <p className="text-xs leading-5 text-basalt/50">
        Aha is an AI voice assistant. It answers from this listing's details, checks your dates and can fill in the booking form — you book and pay yourself on this page. Your voice is processed by our voice provider to reply.{" "}
        <Link href="/privacy" className="underline underline-offset-2">Privacy</Link>
      </p>
    </div>
  );
}

export default function AhaVoiceCall(props: CallProps) {
  return (
    <ConversationProvider>
      <Call {...props} />
    </ConversationProvider>
  );
}
