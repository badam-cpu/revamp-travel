/**
 * Aha — the one guest-facing AI assistant (bottom-right, site-wide), with three
 * ways in (user, 2026-10-27: unify the support chat, the voice assistant and
 * the trip planner under Aha):
 *  - Chat: messages go to a central Revamp support thread answered first by the
 *    AI (POST /api/support-chat); admins take over from the /admin inbox. This
 *    is deliberately NOT traveler↔operator messaging.
 *  - Talk: the Aha voice call (AhaVoiceCall, lazy) — about the listing on a
 *    listing page, voice search everywhere else. It lives here, outside the
 *    routes, so a call carries on while Aha opens a listing, photo or plan.
 *  - Plan a trip: a short form that opens /plan filled in and builds the plan.
 * Other buttons open it in a mode with `openAha` (lib/ahaPanel.ts).
 *
 * Shown to travelers and signed-out visitors; hidden for operators/admins (they
 * have their own dashboards, and admins reply from the inbox). Messages load
 * under the traveler's own RLS (support_messages read policy scopes to their
 * thread), so a bare select returns only their conversation.
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ChevronUp, Loader2, MessageCircle, Mic, Route, Send, Sparkles, X } from "lucide-react";
import { useListings } from "@/contexts/ListingsContext";
import { onAhaOpen, type AhaMode } from "@/lib/ahaPanel";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { renderMarkdown } from "@shared/markdown";
import { sendSupportMessage, submitSupportContact, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const AhaVoiceCall = lazy(() => import("@/components/AhaVoiceCall"));
const VOICE = !!import.meta.env.VITE_ELEVENLABS_AGENT_ID;
const PLAN_INTERESTS = ["History & monasteries", "Nature & hiking", "Food & wine", "Adventure", "Relaxation", "Photography"];

interface Msg {
  id: string;
  sender: "traveler" | "ai" | "support";
  body: string;
  created_at?: string;
}

export function SupportWidget() {
  const { user, profile, loading, signInAnonymously } = useAuth();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AhaMode>("chat");
  // The voice call stays mounted once started (switching tabs doesn't hang up);
  // `compact` shrinks the panel to a bar so the page Aha just changed is visible.
  const [talkMounted, setTalkMounted] = useState(false);
  const [compact, setCompact] = useState(false);
  const { pageListings } = useListings();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [contactEmail, setContactEmail] = useState("");
  const [contactSaved, setContactSaved] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [location, navigate] = useLocation();
  // The launcher steps aside while it would overlap a page's primary search
  // (marked `data-support-yield`, e.g. the home hero search), so it never sits
  // on top of the Search button.
  const [yieldToSearch, setYieldToSearch] = useState(false);
  useEffect(() => {
    // Checked directly on scroll/resize/DOM changes (one cheap rect read; React
    // skips the update when nothing changed) rather than with an
    // IntersectionObserver on a fixed node: pages are lazy-loaded and can
    // re-render the marked element, which would leave an observer watching a
    // detached node.
    // Only steps aside when it would actually sit on the search (phones) — on a
    // wide screen the search is far from the corner, so the bubble stays.
    const check = () => {
      const lg = window.innerWidth >= 1024;
      const size = 56, gap = 12;
      const bubble = { left: window.innerWidth - 16 - size - gap, right: window.innerWidth, top: window.innerHeight - (lg ? 16 : 80) - size - gap, bottom: window.innerHeight };
      let overlaps = false;
      document.querySelectorAll("[data-support-yield]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.left < bubble.right && r.right > bubble.left && r.top < bubble.bottom && r.bottom > bubble.top) overlaps = true;
      });
      setYieldToSearch(overlaps);
    };
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      mo.disconnect();
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [location]);

  const hidden = loading || profile?.role === "operator" || profile?.role === "admin" || location.startsWith("/trip/") || location.startsWith("/invoice/");
  const show = (m: AhaMode) => {
    setOpen(true);
    setCompact(false);
    setMode(m);
    if (m === "talk") setTalkMounted(true);
  };
  // "Talk to Aha" buttons elsewhere open this panel (lib/ahaPanel.ts).
  useEffect(() => onAhaOpen((m) => {
    if (hidden || (m === "talk" && !VOICE)) return false;
    show(m);
    return true;
  }), [hidden]);
  // Talk is about the listing on a stay / tour / experience page, a search anywhere else.
  const slugOnPage = location.match(/^\/listing\/([^/?#]+)/)?.[1];
  const voiceListing = slugOnPage ? pageListings.find((l) => l.slug === slugOnPage && ["stay", "tour", "experience"].includes(l.type)) : undefined;
  const close = () => {
    setOpen(false);
    setCompact(false);
    setTalkMounted(false);
  };

  // Assistant replies are short Markdown; links to Revamp pages (/listing/…,
  // /explore/…) should open in-app, not a new tab.
  const onReplyClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href") || "";
    if (href.startsWith("/")) {
      e.preventDefault();
      navigate(href);
      close();
    }
  };

  // A guest (anonymous session) has no email; a signed-in traveler already does.
  const isGuest = !!user && !user.email;

  // Load the traveler's own thread when the panel first opens.
  useEffect(() => {
    if (!open || !user || loaded) return;
    supabase
      .from("support_messages")
      .select("id, sender, body, created_at")
      .order("created_at", { ascending: true })
      .then(async ({ data }) => {
        setMessages((data ?? []) as Msg[]);
        // Already left an email on this thread? Then don't ask again.
        const { data: t } = await supabase.from("support_threads").select("guest_email").maybeSingle();
        if (t?.guest_email) setContactSaved(true);
        setLoaded(true);
      });
  }, [open, user, loaded]);

  // Keep the view pinned to the latest message.
  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  // Don't show to operators/admins.
  // Guests' private trip pages have the host's own contacts; keep the screen clear.
  if (hidden) return null;

  const saveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = contactEmail.trim();
    if (!email || savingContact) return;
    setSavingContact(true);
    try {
      await submitSupportContact(email);
      setContactSaved(true);
    } catch (err) {
      setMessages((m) => [...m, { id: `err-${Date.now()}`, sender: "ai", body: err instanceof ApiError ? err.message : "Couldn't save your email — please try again." }]);
    } finally {
      setSavingContact(false);
    }
  };

  const send = async () => {
    const body = input.trim();
    if (!body || sending) return;
    setInput("");
    setLoaded(true); // active conversation — don't let the loader overwrite these
    setMessages((m) => [...m, { id: `local-${Date.now()}`, sender: "traveler", body }]);
    setSending(true);
    try {
      // No account? Get a silent guest session so shoppers can ask without signing up.
      if (!user) await signInAnonymously();
      const { reply } = await sendSupportMessage(body);
      setMessages((m) => [...m, { id: `ai-${Date.now()}`, sender: "ai", body: reply }]);
    } catch (err) {
      // The technical reason goes to the console only (never shown to guests).
      console.error("[support] send failed", err);
      setMessages((m) => [
        ...m,
        { id: `err-${Date.now()}`, sender: "ai", body: err instanceof ApiError && err.message ? err.message : "That didn't send — please try again in a moment." },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          type="button"
          onClick={() => show(mode)}
          aria-label="Ask Aha AI, Revamp's assistant"
          aria-hidden={yieldToSearch || undefined}
          tabIndex={yieldToSearch ? -1 : undefined}
          className={cn(
            "fixed bottom-20 right-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-apricot text-white shadow-[0_10px_30px_rgba(241,88,34,0.4)] transition-[transform,translate,opacity] duration-300 hover:scale-105 lg:bottom-4",
            yieldToSearch && "pointer-events-none translate-y-3 opacity-0",
          )}
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}

      {/* Panel */}
      {open && (
        // z-[110]: above the photo viewer (z-100) so Aha's controls stay reachable while it shows a photo.
        <div className={cn("fixed bottom-4 right-4 z-[110] flex w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-basalt/10 bg-paper shadow-[0_24px_70px_rgba(35,35,33,0.28)]", compact ? "" : "h-[min(600px,82dvh)]")}>
          <div className="flex items-center justify-between gap-2 bg-basalt px-4 py-3 text-white">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-bold"><Sparkles className="h-3.5 w-3.5 text-apricot" /> Aha AI</p>
              {!compact && <p className="text-[11px] text-white/60">Revamp's AI assistant · English or Russian</p>}
            </div>
            <div className="flex items-center gap-1">
              {compact && (
                <button type="button" onClick={() => setCompact(false)} aria-label="Expand Aha AI" className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/10">
                  <ChevronUp className="h-4 w-4" />
                </button>
              )}
              <button type="button" onClick={close} aria-label="Close Aha AI" className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/10">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {!compact && (
            <div role="tablist" aria-label="Ways to use Aha AI" className="grid grid-cols-3 gap-1 border-b border-basalt/10 p-1.5">
              {([
                ["chat", "Chat", MessageCircle],
                ...(VOICE ? [["talk", "Talk", Mic] as const] : []),
                ["plan", "Plan a trip", Route],
              ] as const).map(([m, label, Icon]) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => show(m)}
                  className={cn("inline-flex h-10 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition-colors", mode === m ? "bg-apricot/10 text-apricot" : "text-basalt/65 hover:bg-chalk")}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
          )}

          {talkMounted && (
            <div hidden={mode !== "talk"} className={cn("overflow-y-auto", compact ? "p-3" : "flex-1 p-4")}>
              <Suspense fallback={<div className="grid place-items-center py-8"><Loader2 className="h-5 w-5 animate-spin text-basalt/50" /></div>}>
                <AhaVoiceCall
                  scope={voiceListing ? "listing" : "home"}
                  slug={voiceListing?.slug}
                  onEnd={() => setTalkMounted(false)}
                  compact={compact}
                  onFilled={() => setCompact(true)}
                />
              </Suspense>
            </div>
          )}

          {mode === "plan" && !compact && <PlanQuick onPlan={(qs) => { navigate(`/plan?${qs}`); setOpen(false); }} />}

          {mode === "chat" && !compact && (
            <>
              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
                <div className="rounded-2xl rounded-tl-sm bg-chalk px-3.5 py-2.5 text-sm text-basalt/80">
                  Hi{profile?.displayName && profile.displayName !== "Guest" ? ` ${profile.displayName.split(" ")[0]}` : ""}! 👋 I'm Aha AI. Ask me anything about stays, tours, experiences or booking — no account needed.
                </div>
                {messages.map((m) => (
                  <div key={m.id} className={cn("flex", m.sender === "traveler" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[82%] px-3.5 py-2.5 text-sm [overflow-wrap:anywhere]",
                        m.sender === "traveler"
                          ? "whitespace-pre-wrap rounded-2xl rounded-br-sm bg-apricot text-white"
                          : m.sender === "support"
                            ? "rounded-2xl rounded-tl-sm border border-sevan/30 bg-sevan/10 text-basalt"
                            : "rounded-2xl rounded-tl-sm bg-chalk text-basalt/85",
                      )}
                    >
                      {m.sender === "support" && <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-[0.1em] text-sevan">Revamp team</span>}
                      {m.sender === "traveler" ? (
                        m.body
                      ) : (
                        <div
                          onClick={onReplyClick}
                          className="[&_a]:font-semibold [&_a]:text-apricot [&_a]:underline [&_li]:my-0.5 [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(m.body) }}
                        />
                      )}
                    </div>
                  </div>
                ))}
                {sending && <div className="flex justify-start"><div className="rounded-2xl rounded-tl-sm bg-chalk px-3.5 py-2.5 text-sm text-basalt/40">…</div></div>}
              </div>

              {/* Guest email capture — optional, appears once the chat has started. */}
              {isGuest && messages.length > 0 && (
                contactSaved ? (
                  <div className="border-t border-basalt/10 bg-chalk/60 px-4 py-2 text-[11px] text-basalt/55">
                    ✓ Thanks — we'll follow up by email if we need to.
                  </div>
                ) : (
                  <form onSubmit={saveContact} className="border-t border-basalt/10 bg-chalk/60 px-4 py-3">
                    <p className="mb-2 text-xs text-basalt/60">Want a reply by email? <span className="text-basalt/40">(optional)</span></p>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        required
                        value={contactEmail}
                        onChange={(e) => setContactEmail(e.target.value)}
                        placeholder="you@email.com"
                        className="h-9 flex-1 rounded-lg border border-basalt/15 bg-paper px-3 text-sm outline-none focus:border-apricot"
                      />
                      <button type="submit" disabled={savingContact || !contactEmail.trim()} className="rounded-lg bg-basalt px-3 text-sm font-semibold text-white hover:bg-basalt/90 disabled:opacity-40">
                        {savingContact ? "…" : "Save"}
                      </button>
                    </div>
                  </form>
                )
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
                className="flex items-end gap-2 border-t border-basalt/10 p-3"
              >
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={1}
                  placeholder="Type a message…"
                  className="max-h-28 flex-1 resize-none rounded-xl border border-basalt/15 bg-paper px-3 py-2 text-sm outline-none focus:border-apricot"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || sending}
                  aria-label="Send"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-apricot text-white transition-colors hover:bg-apricot/90 disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** Plan a trip: a few choices, then /plan builds it (the planner reads these and runs). */
function PlanQuick({ onPlan }: { onPlan: (query: string) => void }) {
  const [days, setDays] = useState(4);
  const [from, setFrom] = useState("Yerevan");
  const [travelers, setTravelers] = useState(2);
  const [interests, setInterests] = useState<string[]>(["History & monasteries", "Food & wine"]);
  const toggle = (v: string) => setInterests((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));
  const field = "h-12 w-full rounded-xl border border-basalt/15 bg-paper px-3 text-base outline-none focus:border-apricot sm:h-10 sm:text-sm";
  return (
    <form
      className="flex-1 space-y-4 overflow-y-auto p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const q = new URLSearchParams({ days: String(days), from, travelers: String(travelers), interests: interests.join(","), auto: "1" });
        onPlan(q.toString());
      }}
    >
      <p className="text-sm leading-6 text-basalt/70">Tell me a little about the trip and I'll draft a day-by-day plan with real places you can book. Or switch to Talk and just tell me.</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1 text-xs font-semibold text-basalt/70">
          Days
          <input type="number" min={1} max={21} value={days} onChange={(e) => setDays(Math.min(21, Math.max(1, Number(e.target.value) || 1)))} className={field} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-basalt/70">
          Travellers
          <input type="number" min={1} max={20} value={travelers} onChange={(e) => setTravelers(Math.min(20, Math.max(1, Number(e.target.value) || 1)))} className={field} />
        </label>
      </div>
      <label className="grid gap-1 text-xs font-semibold text-basalt/70">
        Starting from
        <select value={from} onChange={(e) => setFrom(e.target.value)} className={field}>
          <option>Yerevan</option>
          <option>Gyumri</option>
          <option>Dilijan</option>
        </select>
      </label>
      <fieldset>
        <legend className="mb-2 text-xs font-semibold text-basalt/70">What you're into</legend>
        <div className="flex flex-wrap gap-2">
          {PLAN_INTERESTS.map((opt) => (
            <button key={opt} type="button" aria-pressed={interests.includes(opt)} onClick={() => toggle(opt)} className={cn("min-h-10 rounded-full border px-3 text-sm", interests.includes(opt) ? "border-apricot bg-apricot/10 text-apricot" : "border-basalt/15 text-basalt/70")}>
              {opt}
            </button>
          ))}
        </div>
      </fieldset>
      <button type="submit" className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-apricot text-base font-semibold text-white hover:bg-apricot/90">
        <Route className="h-4 w-4" /> Plan my trip
      </button>
    </form>
  );
}
