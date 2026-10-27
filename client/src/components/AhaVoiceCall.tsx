/**
 * Aha Voice Assistant — the call itself (lazy-loaded by AhaVoiceButton so the
 * ElevenLabs/WebRTC code never weighs on the listing page until someone taps it).
 *
 * Every call starts at POST /api/voice/session, which counts it against the
 * monthly/daily budget (0121) and returns a signed ElevenLabs link (or the
 * public agent id) plus, on a listing, the listing's own details + FAQ +
 * numbered photos as `listing_context`, or on the homepage the search prompt.
 * Listing: the agent checks dates (`check_dates` → /api/voice/quote), fills the
 * booking box (`fill_booking`) and opens photos (`show_photo`). Homepage: it
 * searches (`search_places` → /api/voice/search) and the results show as cards
 * here. Anywhere, `plan_trip` opens the trip planner filled in and builds the
 * plan (/plan reads the query). Calls end after the server's maxSeconds. English or Russian. Nothing is
 * booked or paid here. Errors stay calm — details go to the console only.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Loader2, Mic, MicOff, PhoneOff } from "lucide-react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";
import { isoDay, requestAhaFill, requestAhaPhoto } from "@/lib/ahaBooking";
import { imgAttrs } from "@/lib/responsiveImg";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { markVoiceUnavailable } from "@/lib/voiceStatus";

const AGENT_ID = import.meta.env.VITE_ELEVENLABS_AGENT_ID as string | undefined;

type Lang = "en" | "ru";
export type VoiceScope = "listing" | "home";
// Short and title-free: listing titles are written for search results, not speech.
const FIRST: Record<VoiceScope, Record<Lang, string>> = {
  listing: {
    en: "Hi, I'm Aha AI, Revamp Vacations' voice assistant. How can I help you today?",
    ru: "Здравствуйте! Я Аха AI, голосовой помощник Revamp Vacations. Чем могу помочь?",
  },
  home: {
    en: "Hi, I'm Aha AI, Revamp Vacations' voice assistant. Where would you like to go, and when?",
    ru: "Здравствуйте! Я Аха AI, голосовой помощник Revamp Vacations. Куда и когда вы хотели бы поехать?",
  },
};
/** What the budget refusals mean for the visitor (POST /api/voice/session → 429). */
// If the budget runs out between the page check and this tap: a warm note instead
// of a refusal (the voice buttons hide themselves from then on — lib/voiceStatus).
const LIMIT_MSG: Record<VoiceScope, string> = {
  listing: "Aha AI's voice is taking a short break. You can still chat with Aha AI — tap Chat above — or ask the host a question.",
  home: "Aha AI's voice is taking a short break. You can still chat with Aha AI — just tap Chat above.",
};

interface VoiceCard {
  slug: string;
  type: string;
  title: string;
  city: string;
  image: string;
  price: string;
  total: number | null;
  room?: string | null;
  nights: number | null;
  available: boolean | null;
}
interface SearchResult {
  cards: VoiceCard[];
  query: { type: string; startDate: string | null; endDate: string | null; guests: number | null };
}
const armeniaToday = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);

// ?voiceDebug=1 shows the technical reason in the window (for us, not guests).
const DEBUG = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("voiceDebug");

type CallProps = { scope?: VoiceScope; slug?: string; onEnd: () => void; compact?: boolean; onFilled?: () => void };

function Call({ scope = "listing", slug = "", onEnd, compact = false, onFilled }: CallProps) {
  const [results, setResults] = useState<SearchResult | null>(null);
  const [, navigate] = useLocation();
  // Why the last call ended on its own: time limit, nobody talking, or the guest left the tab.
  const [autoEnded, setAutoEnded] = useState<null | "time" | "quiet" | "away">(null);
  const lastActivity = useRef(Date.now());
  const speaking = useRef(false);
  const maxSeconds = useRef(240);
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
      lastActivity.current = Date.now();
      setAutoEnded(null);
      note(`connected (${session.current?.transport})`);
    },
    // Anything said by either side counts as activity (for the quiet hang-up).
    onMessage: () => {
      lastActivity.current = Date.now();
    },
    onModeChange: ({ mode }: { mode: string }) => {
      speaking.current = mode === "speaking";
      lastActivity.current = Date.now();
    },
    onError: (message: unknown, err?: unknown) => {
      console.error("[aha-voice] error", message, err);
      if (retrying.current) return;
      note(`error: ${String(message)}`);
      if (!connected.current && session.current?.transport === "webrtc") return retryOverWebSocket();
      fail("Aha AI couldn't connect just now. Please check your internet connection and try again.");
    },
    onDisconnect: (details: unknown) => {
      const d = (details ?? {}) as { reason?: string; message?: string; closeReason?: string; closeCode?: number };
      console.info("[aha-voice] disconnected", details);
      if (retrying.current) return;
      note(`disconnected: ${d.reason ?? "?"}${d.message ? ` — ${d.message}` : ""}${d.closeCode ? ` (${d.closeCode} ${d.closeReason ?? ""})` : ""}`);
      // Never got going over WebRTC (often blocked on some networks) → try the plain web connection once.
      if (!connected.current && session.current?.transport === "webrtc" && d.reason !== "user") return retryOverWebSocket();
      if (!connected.current && d.reason !== "user") return fail("Aha AI couldn't connect just now. Please try again in a moment, or ask the host in writing.");
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
      setProblem("Aha AI needs your microphone. Allow microphone access for this site, then tap Start again.");
      setStarting(false);
      return;
    }
    try {
      // Signed in? Send the session so team test calls don't count against guests' limits.
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await fetch("/api/voice/session", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ scope, slug, lang }) });
      const ctx = (await r.json().catch(() => ({}))) as { error?: string; agentId?: string; signedUrl?: string; maxSeconds?: number; title?: string; context?: string; prompt?: string };
      if (r.status === 429) {
        markVoiceUnavailable();
        setProblem(LIMIT_MSG[scope]);
        setStarting(false);
        return;
      }
      if (!r.ok || (!ctx.agentId && !ctx.signedUrl)) throw new Error(`session ${r.status} ${ctx.error ?? ""}`);
      maxSeconds.current = ctx.maxSeconds || 240;
      started.current = true;
      connected.current = false;
      setResults(null);
      const opts = {
        ...(ctx.signedUrl ? { signedUrl: ctx.signedUrl } : { agentId: ctx.agentId }),
        // The agent's client tools run here, in the page — they only fill the
        // booking box, open a photo or show search results; the guest still books and pays.
        clientTools: {
          fill_booking: async (p: Record<string, unknown>) => {
            const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
            const say = await requestAhaFill(slug, {
              startDate: isoDay(p.startDate) ?? isoDay(p.start) ?? "",
              endDate: isoDay(p.endDate) ?? isoDay(p.end),
              guests: Number(p.guests) || undefined,
              time: str(p.time),
            });
            note(`fill_booking → ${say.slice(0, 60)}`);
            if (say.startsWith("Done")) onFilled?.();
            trackEvent("voice_assistant_fill", { item_id: slug, ok: say.startsWith("Done") });
            return say;
          },
          show_photo: async (p: Record<string, unknown>) => {
            const n = Math.round(Number(p.number ?? p.photo ?? p.index));
            const say = await requestAhaPhoto(slug, n - 1);
            note(`show_photo ${n} → ${say.slice(0, 50)}`);
            if (say.startsWith("Photo")) onFilled?.();
            trackEvent("voice_assistant_photo", { item_id: slug });
            return say;
          },
          plan_trip: async (p: Record<string, unknown>) => {
            const days = Math.min(21, Math.max(1, Math.round(Number(p.days)) || 4));
            const q = new URLSearchParams({ days: String(days), auto: "1" });
            const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
            if (str(p.startCity ?? p.from)) q.set("from", str(p.startCity ?? p.from));
            if (Number(p.travelers ?? p.guests) > 0) q.set("travelers", String(Math.round(Number(p.travelers ?? p.guests))));
            if (str(p.pace)) q.set("pace", str(p.pace).toLowerCase());
            if (str(p.budget)) q.set("budget", str(p.budget).toLowerCase());
            if (str(p.interests)) q.set("interests", str(p.interests));
            navigate(`/plan?${q.toString()}`);
            onFilled?.();
            note(`plan_trip ${q.toString().slice(0, 60)}`);
            trackEvent("voice_assistant_plan", { days });
            return `I'm building your ${days}-day plan now — it will appear on the screen in a few seconds, with real places you can book. Tell me if you'd like it slower, cheaper or different.`;
          },
          search_places: async (p: Record<string, unknown>) => {
            try {
              const res = await fetch("/api/voice/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p) });
              const data = (await res.json()) as SearchResult & { say: string };
              setResults({ cards: data.cards ?? [], query: data.query });
              note(`search_places → ${data.cards?.length ?? 0} cards`);
              trackEvent("voice_assistant_search", { results: data.cards?.length ?? 0 });
              return data.say;
            } catch (err) {
              console.error("[aha-voice] search", err);
              return "I couldn't search just now — the search box on the page works too.";
            }
          },
        },
        // check_dates (a webhook on the agent) reads listing_slug; every variable is always sent.
        dynamicVariables: { listing_title: ctx.title ?? "Revamp Vacations", listing_slug: slug, listing_context: ctx.context ?? "", today: armeniaToday() },
        overrides: { agent: { language: lang, firstMessage: FIRST[scope][lang], ...(ctx.prompt ? { prompt: { prompt: ctx.prompt } } : {}) } },
      };
      // WebSocket: with our agent, WebRTC sessions connected and were then ended by the
      // agent (2026-10-27), while the same agent works over WebSocket in both languages.
      session.current = { opts, transport: "websocket" };
      note(`starting (websocket${ctx.signedUrl ? ", signed" : ""})`);
      convo.startSession({ ...opts, connectionType: "websocket" } as never);
      trackEvent("voice_assistant_start", { item_id: slug || "home", language: lang, scope });
    } catch (err) {
      console.error("[aha-voice] start", err);
      setProblem(scope === "home" ? "Aha AI isn't available right now. Please use the search box above." : "Aha AI isn't available right now. Please try again later, or ask the host in writing.");
      setStarting(false);
    }
  };

  // Aha AI hangs up by itself (budget + a call left running by mistake): near the
  // server's time limit (the agent has the same max duration), after 40 s with
  // nobody talking, or 30 s after the guest leaves the tab. It first says a short,
  // friendly goodbye (asked for with a note the guest never sees), then ends the
  // call once it has finished speaking.
  const QUIET_MS = 40_000;
  const AWAY_MS = 30_000;
  const wrapping = useRef(false);
  useEffect(() => {
    if (!live) return;
    wrapping.current = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const wrapUp = (why: "time" | "quiet" | "away") => {
      if (wrapping.current) return;
      wrapping.current = true;
      const reason = why === "time" ? "the call has reached its time limit" : why === "quiet" ? "the guest has been quiet for a while" : "the guest has left the page";
      convo.sendUserMessage(
        `(Note from the website, not from the guest: ${reason}. Say a short, warm goodbye in the language of this call, like "Thanks for chatting! I'll hang up for now — tap Start talking any time you need me." — and nothing else.)`,
      );
      // End once the goodbye has been spoken (it started and stopped), or after 12 s at the most.
      const started = Date.now();
      let heard = false;
      const poll = setInterval(() => {
        if (speaking.current) heard = true;
        if ((heard && !speaking.current) || Date.now() - started > 12_000) {
          clearInterval(poll);
          timers.push(setTimeout(() => {
            setAutoEnded(why);
            convo.endSession();
          }, 700));
        }
      }, 250);
      timers.push(poll as unknown as ReturnType<typeof setTimeout>);
    };
    timers.push(setTimeout(() => wrapUp("time"), Math.max(10, maxSeconds.current - 12) * 1000));
    const quiet = setInterval(() => {
      if (!speaking.current && Date.now() - lastActivity.current > QUIET_MS) wrapUp("quiet");
    }, 5000);
    let away: ReturnType<typeof setTimeout> | undefined;
    const onVisibility = () => {
      clearTimeout(away);
      if (document.visibilityState === "hidden") away = setTimeout(() => wrapUp("away"), AWAY_MS);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      timers.forEach((t) => {
        clearTimeout(t);
        clearInterval(t as unknown as ReturnType<typeof setInterval>);
      });
      clearInterval(quiet);
      clearTimeout(away);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const status = !live ? (starting || convo.status === "connecting" ? "Connecting…" : "Ready when you are") : convo.isSpeaking ? "Aha AI is speaking…" : convo.isMuted ? "Microphone off" : "Listening…";
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
    // Fills the Aha AI panel so the footer note sits at the bottom, not mid-panel.
    <div className="flex h-full flex-col gap-5">
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

      {results && <SearchCards results={results} />}
      {autoEnded && !live && (
        <p className="text-sm leading-6 text-basalt/70">
          {autoEnded === "time" ? `Calls with Aha AI are kept to ${Math.round(maxSeconds.current / 60)} minutes.` : autoEnded === "quiet" ? "Aha AI hung up after a quiet moment." : "Aha AI hung up while you were away."} Tap Start talking to carry on.
        </p>
      )}
      {problem && <p className="rounded-none border border-apricot/30 bg-apricot/[0.05] p-3 text-sm leading-6 text-basalt/80">{problem}</p>}
      {DEBUG && debug.length > 0 && <pre className="max-h-40 overflow-auto whitespace-pre-wrap bg-chalk p-2 text-[11px] leading-4 text-basalt/70">{debug.join("\n")}</pre>}

      <p className="mt-auto text-xs leading-5 text-basalt/50">
        You always book and pay yourself.{" "}
        <Link href="/privacy" className="underline underline-offset-2">Privacy Policy</Link>
      </p>
    </div>
  );
}

/** Search results Aha found, as tappable cards (dates + party carried to the listing). */
function SearchCards({ results }: { results: SearchResult }) {
  const { cards, query } = results;
  if (!cards.length) return <p className="text-sm leading-6 text-basalt/70">No matches yet — tell Aha AI what to change.</p>;
  const params = new URLSearchParams();
  if (query.startDate) params.set("checkin", query.startDate);
  if (query.endDate) params.set("checkout", query.endDate);
  if (query.guests) params.set("guests", String(query.guests));
  const qs = params.toString();
  return (
    <ul className="grid gap-2" aria-label="What Aha AI found">
      {cards.map((c) => (
        <li key={c.slug}>
          <Link href={`/listing/${c.slug}${qs ? `?${qs}` : ""}`} className="flex min-h-16 items-center gap-3 rounded-none border border-basalt/12 bg-paper p-2 transition-colors hover:border-apricot">
            <img {...imgAttrs(c.image, "64px")} alt="" className="h-14 w-14 shrink-0 rounded-[10px] object-cover" />
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-sm font-semibold leading-5 text-basalt">{c.title}</span>
              <span className="mt-0.5 block truncate text-xs text-basalt/60">
                {c.city}
                {c.room ? ` · ${c.room}` : ""} · {c.total != null && c.nights ? `֏${c.total.toLocaleString("en-US")} for ${c.nights} night${c.nights === 1 ? "" : "s"}` : c.price}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function AhaVoiceCall(props: CallProps) {
  return (
    <ConversationProvider>
      <Call {...props} />
    </ConversationProvider>
  );
}
