/**
 * Unified inbox UI (Phase 1) — a thread list + message pane + composer, reused
 * by travelers (/account), operators (/dashboard) and admins (/admin). Reads are
 * RLS-scoped (lib/messaging.ts): a participant sees their own threads, an admin
 * sees all (pass `admin`). Sends go through the server (lib/api.ts) for guardrail
 * scanning + rate limiting. No realtime yet — it refetches after each send and
 * on an interval while open (Phase 3 swaps in Supabase Realtime).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, ShieldAlert, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { listConversations, getMessages, markConversationRead, type InboxConversation, type InboxMessage } from "@/lib/messaging";
import { sendInboxMessage } from "@/lib/api";
import { toast } from "sonner";

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function Inbox({ userId, admin = false }: { userId: string; admin?: boolean }) {
  const [convos, setConvos] = useState<InboxConversation[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  const send = async () => {
    const body = draft.trim();
    if (!body || !activeId || sending) return;
    setSending(true);
    try {
      await sendInboxMessage(activeId, body);
      setDraft("");
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
    <div className="grid gap-0 overflow-hidden rounded-none border border-basalt/12 md:grid-cols-[300px_1fr]" style={{ minHeight: 460 }}>
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
                  <span className="shrink-0 text-[10px] text-basalt/40">{timeAgo(c.lastMessageAt)}</span>
                </div>
                {c.listing?.title && <p className="truncate text-[11px] text-basalt/45">{c.listing.title}</p>}
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
      <div className={cn("flex flex-col", !active && "hidden md:flex")}>
        {!active ? (
          <div className="grid flex-1 place-items-center p-8 text-sm text-basalt/45">Select a conversation</div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-basalt/10 px-4 py-3">
              <button type="button" onClick={() => setActiveId(null)} className="text-xs font-semibold text-apricot md:hidden">
                ← Back
              </button>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{admin ? active.parties.map((p) => `${p.name} (${p.role})`).join(" ↔ ") : active.counterpart?.name ?? "Revamp"}</p>
                {active.listing?.title && <p className="truncate text-[11px] text-basalt/45">{active.listing.title}</p>}
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto bg-chalk/30 px-4 py-4" style={{ maxHeight: 380 }}>
              {messages.map((m) => {
                const mine = !admin && m.senderId === userId;
                const isSupport = m.senderRole === "support";
                return (
                  <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-snug",
                        mine ? "bg-apricot text-white" : isSupport ? "bg-basalt text-white" : "bg-paper border border-basalt/12 text-basalt",
                      )}
                    >
                      {admin && <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide opacity-60">{m.senderRole}</p>}
                      <p className={cn("whitespace-pre-wrap break-words", m.redacted && "italic opacity-70")}>{m.body}</p>
                      <p className={cn("mt-1 text-[10px]", mine || isSupport ? "text-white/60" : "text-basalt/40")}>
                        {new Date(m.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        {m.flagged && <span className="ml-1 font-semibold text-amber-300">· flagged</span>}
                      </p>
                    </div>
                  </div>
                );
              })}
              {!messages.length && <p className="py-8 text-center text-sm text-basalt/40">No messages yet — say hello.</p>}
            </div>

            <div className="border-t border-basalt/10 p-3">
              {!admin && (
                <p className="mb-1.5 text-[10px] leading-tight text-basalt/40">
                  Keep bookings & payments on Revamp — sharing contact details or paying off-platform isn't covered by our protection.
                </p>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={1}
                  placeholder={admin ? "Reply as Revamp…" : "Write a message…"}
                  className="max-h-28 min-h-10 flex-1 resize-none rounded-none border border-basalt/15 bg-paper px-3 py-2 text-sm outline-none focus:border-apricot"
                />
                <Button onClick={send} disabled={sending || !draft.trim()} className="h-10 shrink-0 rounded-none bg-apricot px-4 text-white hover:bg-apricot/90">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
