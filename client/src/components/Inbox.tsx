/**
 * Unified inbox UI (Phase 1) — a thread list + message pane + composer, reused
 * by travelers (/account), operators (/dashboard) and admins (/admin). Reads are
 * RLS-scoped (lib/messaging.ts): a participant sees their own threads, an admin
 * sees all (pass `admin`). Sends go through the server (lib/api.ts) for guardrail
 * scanning + rate limiting. No realtime yet — it refetches after each send and
 * on an interval while open (Phase 3 swaps in Supabase Realtime).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Loader2, ShieldAlert, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { listConversations, getMessages, markConversationRead, type InboxConversation, type InboxMessage } from "@/lib/messaging";
import { listTemplates, type MessageTemplate } from "@/lib/templates";
import { ahaSuggestReply, sendInboxMessage, moderateInbox, userMessage } from "@/lib/api";
import { FileText, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function Inbox({ userId, admin = false, host = false }: { userId: string; admin?: boolean; host?: boolean }) {
  const [convos, setConvos] = useState<InboxConversation[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  // Admins: what was actually typed, for messages whose contact details were hidden (0111).
  const [originals, setOriginals] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!admin || !messages.length) return setOriginals(new Map());
    const ids = messages.filter((m) => m.flagged).map((m) => m.id);
    if (!ids.length) return setOriginals(new Map());
    let live = true;
    supabase
      .from("message_originals")
      .select("message_id, body")
      .in("message_id", ids)
      .then(({ data, error }) => {
        if (live && !error) setOriginals(new Map(((data ?? []) as { message_id: string; body: string }[]).map((o) => [o.message_id, o.body])));
      });
    return () => {
      live = false;
    };
  }, [admin, messages]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [tplOpen, setTplOpen] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Phones show the list OR the conversation; switching scrolls the inbox back
  // into view (otherwise opening thread #15 can land the page below it).
  const boxRef = useRef<HTMLDivElement>(null);
  const toInboxTop = () => {
    if (window.matchMedia("(max-width: 767px)").matches) requestAnimationFrame(() => boxRef.current?.scrollIntoView({ block: "start" }));
  };
  // Phones have no Shift+Enter: there Enter makes a new line and the button sends.
  const enterSends = typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
  useEffect(() => () => document.body.classList.remove("composer-focus"), []);

  // Operator's own templates (travelers/admins own none → the control stays hidden).
  useEffect(() => {
    listTemplates(userId).then(setTemplates).catch(() => {});
  }, [userId]);

  const loadConvos = useCallback(async () => {
    const list = await listConversations(userId);
    setConvos(list);
    return list;
  }, [userId]);

  useEffect(() => {
    loadConvos();
  }, [loadConvos]);

  const openConvo = useCallback(
    async (id: string) => {
      setActiveId(id);
      const msgs = await getMessages(id);
      setMessages(msgs);
      if (!admin) {
        await markConversationRead(id, userId);
        setConvos((prev) => prev?.map((c) => (c.id === id ? { ...c, unread: 0 } : c)) ?? prev);
      }
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
      toInboxTop();
    },
    [admin, userId],
  );

  // Light polling for new messages while a thread is open (no realtime yet).
  useEffect(() => {
    if (!activeId) return;
    const t = setInterval(async () => {
      const msgs = await getMessages(activeId);
      setMessages(msgs);
    }, 15000);
    return () => clearInterval(t);
  }, [activeId]);

  const active = convos?.find((c) => c.id === activeId) ?? null;

  const redact = async (messageId: string) => {
    if (!window.confirm("Redact this message? Both parties will see it removed.")) return;
    try {
      await moderateInbox({ action: "redact", messageId });
      if (activeId) setMessages(await getMessages(activeId));
      toast("Message redacted.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't redact that message.");
    }
  };

  const toggleClose = async () => {
    if (!active) return;
    const action = active.status === "closed" ? "reopen" : "close";
    try {
      await moderateInbox({ action, conversationId: active.id });
      await loadConvos();
      toast(action === "close" ? "Conversation closed." : "Conversation reopened.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't update the conversation.");
    }
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || !activeId || sending) return;
    setSending(true);
    try {
      const sent = await sendInboxMessage(activeId, body);
      setDraft("");
      if (sent.masked) toast("Contact details were hidden. Phone numbers, emails and links are shared once the stay is booked and paid on Revamp.");
      const msgs = await getMessages(activeId);
      setMessages(msgs);
      loadConvos();
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't send your message.");
    } finally {
      setSending(false);
    }
  };

  // Aha drafts a reply from the listing's details + FAQ into the box — the host edits and sends it.
  const suggest = async () => {
    if (!activeId || suggesting) return;
    setSuggesting(true);
    try {
      const r = await ahaSuggestReply(activeId);
      if (r.reply) {
        setDraft((d) => (d.trim() ? `${d}\n${r.reply}` : (r.reply as string)));
        toast("Aha AI drafted a reply — check it, then send.");
      } else toast(r.reason || "This one needs you — Aha AI couldn't answer it from your listing.");
    } catch (e) {
      toast(userMessage(e, "Aha AI couldn't draft a reply right now. Please try again."));
    } finally {
      setSuggesting(false);
    }
  };

  if (convos === null) {
    return (
      <div className="grid place-items-center py-16 text-basalt/50">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!convos.length) {
    return (
      <div className="rounded-none border border-dashed border-basalt/20 bg-chalk/40 px-6 py-12 text-center">
        <p className="font-display text-xl">No messages yet</p>
        <p className="mt-2 text-sm text-basalt/55">
          {admin ? "Guest and host conversations will appear here." : "When you message a host about a booking, the conversation shows up here."}
        </p>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="grid scroll-mt-24 gap-0 overflow-hidden rounded-none border border-basalt/12 md:min-h-[460px] md:grid-cols-[300px_1fr]">
      {/* Thread list */}
      <ul className={cn("divide-y divide-basalt/10 border-basalt/12 md:border-r", active && "hidden md:block")}>
        {convos.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => openConvo(c.id)}
              className={cn("flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-chalk/50", activeId === c.id && "bg-chalk")}
            >
              {c.counterpart?.logo ? (
                <img src={c.counterpart.logo} alt="" className="mt-0.5 h-9 w-9 shrink-0 rounded-full border border-basalt/10 object-cover" />
              ) : (
                <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-basalt/5 text-xs font-bold text-basalt/50">
                  {(c.counterpart?.name ?? c.parties[0]?.name ?? "?").slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold text-basalt">
                    {admin ? c.parties.map((p) => p.name).join(" ↔ ") : c.counterpart?.name ?? "Revamp"}
                  </p>
                  <span className="shrink-0 text-[11px] text-basalt/50">{timeAgo(c.lastMessageAt)}</span>
                </div>
                {c.listing?.title && <p className="truncate text-xs text-basalt/50">{c.listing.title}</p>}
                <p className="mt-0.5 truncate text-xs text-basalt/55">{c.preview}</p>
              </div>
              <div className="mt-0.5 flex shrink-0 flex-col items-end gap-1">
                {c.unread > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-apricot px-1.5 text-[10px] font-bold text-white">{c.unread}</span>}
                {admin && c.flaggedCount > 0 && <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />}
              </div>
            </button>
          </li>
        ))}
      </ul>

      {/* Message pane */}
      {/* Phones: the open conversation fills the screen (header · messages · composer),
          so the reply box and Back stay in view. */}
      <div className={cn("flex min-w-0 flex-col max-md:h-[calc(100dvh-7rem)]", !active && "hidden md:flex")}>
        {!active ? (
          <div className="grid flex-1 place-items-center p-8 text-sm text-basalt/45">Select a conversation</div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-basalt/10 px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  setActiveId(null);
                  toInboxTop();
                }}
                className="-ml-2 inline-flex h-10 shrink-0 items-center gap-0.5 px-2 text-sm font-semibold text-apricot md:hidden"
              >
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {admin ? active.parties.map((p) => `${p.name} (${p.role})`).join(" ↔ ") : active.counterpart?.name ?? "Revamp"}
                </p>
                {active.listing?.title && <p className="truncate text-xs text-basalt/55">{active.listing.title}</p>}
              </div>
              {active.status === "closed" && <span className="shrink-0 rounded-full bg-basalt/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-basalt/50">Closed</span>}
              {admin && (
                <button type="button" onClick={toggleClose} className="shrink-0 text-xs font-semibold text-basalt/55 underline-offset-2 hover:text-basalt hover:underline">
                  {active.status === "closed" ? "Reopen" : "Close"}
                </button>
              )}
            </div>

            <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain bg-chalk/30 px-4 py-4 md:max-h-[380px]">
              {messages.map((m) => {
                const mine = !admin && m.senderId === userId;
                const isSupport = m.senderRole === "support";
                const isSystem = m.senderRole === "system";
                if (isSystem) {
                  // Automated confirmations (booking confirmed / requested / approved /
                  // declined / cancelled) — a centered, non-chat notice.
                  return (
                    <div key={m.id} className="flex justify-center">
                      <div className="max-w-[88%] rounded-2xl border border-basalt/12 bg-paper px-3.5 py-1.5 text-center text-xs leading-snug text-basalt/70">
                        <span className={cn("whitespace-pre-wrap [overflow-wrap:anywhere]", m.redacted && "italic opacity-70")}>{m.body}</span>
                        {admin && !m.redacted && (
                          <button type="button" onClick={() => redact(m.id)} className="ml-2 font-semibold text-amber-600 underline-offset-2 hover:underline">redact</button>
                        )}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-snug",
                        mine ? "bg-apricot text-white" : isSupport ? "bg-basalt text-white" : "bg-paper border border-basalt/12 text-basalt",
                      )}
                    >
                      {admin && <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide opacity-60">{m.senderRole}</p>}
                      <p className={cn("whitespace-pre-wrap [overflow-wrap:anywhere]", m.redacted && "italic opacity-70")}>{m.body}</p>
                      {m.ai && (
                        <p className={cn("mt-1 flex items-center gap-1 text-[11px] font-semibold", mine ? "text-white/80" : "text-apricot")}>
                          <Sparkles className="h-3 w-3" aria-hidden /> Answered automatically by Aha AI from the listing details
                        </p>
                      )}
                      {admin && originals.get(m.id) && (
                        <p className="mt-1.5 border-t border-amber-500/30 pt-1.5 text-xs leading-snug text-amber-700">
                          <span className="font-semibold">As typed (only admins see this):</span> <span className="whitespace-pre-wrap break-words">{originals.get(m.id)}</span>
                        </p>
                      )}
                      <p className={cn("mt-1 text-[11px]", mine || isSupport ? "text-white/70" : "text-basalt/50")}>
                        {new Date(m.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        {admin && m.flagged && <span className="ml-1 font-semibold text-amber-600">· flagged</span>}
                        {admin && !m.redacted && (
                          <button type="button" onClick={() => redact(m.id)} className="ml-2 font-semibold text-amber-600 underline-offset-2 hover:underline">
                            redact
                          </button>
                        )}
                      </p>
                    </div>
                  </div>
                );
              })}
              {!messages.length && <p className="py-8 text-center text-sm text-basalt/40">No messages yet — say hello.</p>}
            </div>

            {active.status === "closed" && !admin ? (
              <div className="border-t border-basalt/10 p-4 text-center text-sm text-basalt/50">This conversation has been closed by Revamp.</div>
            ) : (
            <div className="border-t border-basalt/10 bg-paper p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {!admin && (
                <p className="mb-1.5 text-xs leading-snug text-basalt/55">
                  Phone numbers, emails and links are shared once a booking is confirmed — until then they're hidden. Keep bookings & payments on Revamp.
                </p>
              )}
              {(templates.length > 0 || (host && active.kind !== "support")) && (
                <div className="relative mb-1.5 flex flex-wrap items-center gap-x-3">
                  {host && active.kind !== "support" && (
                    <button type="button" onClick={suggest} disabled={suggesting} className="-ml-2 inline-flex h-10 items-center gap-1.5 px-2 text-xs font-semibold text-apricot hover:underline disabled:opacity-60">
                      {suggesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Suggest a reply
                    </button>
                  )}
                  {templates.length > 0 && (<>
                  <button type="button" aria-expanded={tplOpen} onClick={() => setTplOpen((o) => !o)} className={cn("inline-flex h-10 items-center gap-1.5 px-2 text-xs font-semibold text-apricot hover:underline", !(host && active.kind !== "support") && "-ml-2")}>
                    <FileText className="h-3.5 w-3.5" /> Templates
                  </button>
                  {/* Tap anywhere else to close. */}
                  {tplOpen && <button type="button" aria-label="Close templates" tabIndex={-1} onClick={() => setTplOpen(false)} className="fixed inset-0 z-[9] cursor-default" />}
                  {tplOpen && (
                    <div className="absolute bottom-11 left-0 z-10 max-h-56 w-[min(18rem,calc(100vw-3rem))] overflow-y-auto border border-basalt/15 bg-paper shadow-lg">
                      {templates.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => { setDraft((d) => (d.trim() ? `${d}\n${t.body}` : t.body)); setTplOpen(false); }}
                          className="block w-full border-b border-basalt/8 px-3 py-2.5 text-left last:border-0 hover:bg-chalk/60"
                        >
                          <span className="block text-xs font-semibold text-basalt">{t.title}</span>
                          <span className="mt-0.5 block truncate text-[11px] text-basalt/50">{t.body}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  </>)}
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (enterSends && e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  // The floating Aha AI button would sit over Send while typing.
                  onFocus={() => document.body.classList.add("composer-focus")}
                  onBlur={() => document.body.classList.remove("composer-focus")}
                  rows={1}
                  enterKeyHint={enterSends ? "send" : "enter"}
                  placeholder={admin ? "Reply as Revamp…" : "Write a message…"}
                  className="max-h-40 min-h-12 min-w-0 flex-1 resize-none rounded-none border border-basalt/15 bg-paper px-3 py-2.5 text-base outline-none [field-sizing:content] focus:border-apricot md:text-sm"
                />
                <Button onClick={send} disabled={sending || !draft.trim()} aria-label="Send message" className="h-12 w-12 shrink-0 rounded-none bg-apricot p-0 text-white hover:bg-apricot/90">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
