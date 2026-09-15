/**
 * Admin support inbox on /admin — the human side of the AI-first support chat
 * (see supabase/migrations/0013_support_chat.sql, server/support.ts). Lists
 * every traveler thread (admins read all under RLS), shows the conversation,
 * and lets an admin reply as "Revamp team" (sender = 'support', authorized by
 * the admin RLS insert policy) or mark a thread resolved. Threads the AI routed
 * to a human show a "needs reply" flag.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { MessagesSquare, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Thread {
  id: string;
  traveler_id: string;
  status: "open" | "needs_human" | "resolved";
  last_message_at: string;
  guest_email: string | null;
  guest_name: string | null;
  profiles: { display_name: string } | null;
}
interface Msg {
  id: string;
  sender: "traveler" | "ai" | "support";
  body: string;
  created_at: string;
}

const STATUS = {
  needs_human: { label: "Needs reply", className: "bg-apricot/15 text-apricot" },
  open: { label: "Open", className: "bg-tuff/15 text-tuff" },
  resolved: { label: "Resolved", className: "bg-basalt/10 text-basalt/55" },
};

export function AdminSupportInbox() {
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    const { data } = await supabase
      .from("support_threads")
      .select("id, traveler_id, status, last_message_at, guest_email, guest_name, profiles!traveler_id(display_name)")
      .order("last_message_at", { ascending: false });
    setThreads((data ?? []) as unknown as Thread[]);
  }, []);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  const openThread = useCallback(async (id: string) => {
    setActiveId(id);
    const { data } = await supabase
      .from("support_messages")
      .select("id, sender, body, created_at")
      .eq("thread_id", id)
      .order("created_at", { ascending: true });
    setMessages((data ?? []) as Msg[]);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    const body = reply.trim();
    if (!body || !activeId || sending) return;
    setSending(true);
    try {
      const { error } = await supabase.from("support_messages").insert({ thread_id: activeId, sender: "support", body });
      if (error) throw new Error(error.message);
      await supabase.from("support_threads").update({ status: "open", last_message_at: new Date().toISOString() }).eq("id", activeId);
      setReply("");
      setMessages((m) => [...m, { id: `local-${Date.now()}`, sender: "support", body, created_at: new Date().toISOString() }]);
      loadThreads();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't send the reply.");
    } finally {
      setSending(false);
    }
  };

  const resolve = async (id: string) => {
    const { error } = await supabase.from("support_threads").update({ status: "resolved" }).eq("id", id);
    if (error) return toast(error.message);
    toast("Thread marked resolved.");
    loadThreads();
  };

  return (
    <section className="mt-14 border-t border-basalt/10 pt-10">
      <div className="flex items-center gap-2">
        <MessagesSquare className="h-5 w-5 text-apricot" />
        <h2 className="font-display text-3xl tracking-[-0.03em]">Support inbox</h2>
      </div>
      <p className="mt-2 max-w-xl text-sm text-basalt/55">
        Traveler messages to Revamp. The AI answers first; threads flagged “Needs reply” are waiting on a human.
      </p>

      {threads === null ? (
        <p className="mt-8 text-sm text-basalt/50">Loading…</p>
      ) : threads.length === 0 ? (
        <p className="mt-8 border border-dashed border-basalt/20 bg-chalk px-6 py-10 text-center text-sm text-basalt/55">No support threads yet.</p>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-[300px_1fr]">
          {/* Thread list */}
          <div className="grid max-h-[520px] gap-1.5 overflow-y-auto">
            {threads.map((t) => {
              const s = STATUS[t.status] ?? STATUS.open;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openThread(t.id)}
                  className={cn(
                    "flex items-center justify-between gap-2 border p-3 text-left transition-colors",
                    activeId === t.id ? "border-apricot bg-apricot/5" : "border-basalt/12 bg-paper hover:border-basalt/30",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{t.guest_name || t.profiles?.display_name || "Guest"}</span>
                    <span className="block truncate text-[11px] text-basalt/45">{t.guest_email || new Date(t.last_message_at).toLocaleDateString()}</span>
                  </span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em]", s.className)}>{s.label}</span>
                </button>
              );
            })}
          </div>

          {/* Conversation */}
          <div className="flex min-h-[520px] flex-col border border-basalt/12 bg-paper">
            {!activeId ? (
              <div className="grid flex-1 place-items-center p-8 text-center text-sm text-basalt/45">Select a thread to read and reply.</div>
            ) : (
              <>
                {(() => {
                  const active = threads.find((t) => t.id === activeId);
                  return (
                    <div className="flex items-center justify-between gap-3 border-b border-basalt/10 px-4 py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{active?.guest_name || active?.profiles?.display_name || "Guest"}</span>
                        {active?.guest_email && (
                          <a href={`mailto:${active.guest_email}`} className="block truncate text-[11px] text-apricot hover:underline">{active.guest_email}</a>
                        )}
                      </span>
                      <button type="button" onClick={() => resolve(activeId)} className="shrink-0 text-xs font-semibold text-basalt/50 hover:text-sevan">Mark resolved</button>
                    </div>
                  );
                })()}
                <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
                  {messages.map((m) => (
                    <div key={m.id} className={cn("flex", m.sender === "traveler" ? "justify-start" : "justify-end")}>
                      <div
                        className={cn(
                          "max-w-[80%] whitespace-pre-wrap px-3.5 py-2.5 text-sm",
                          m.sender === "traveler"
                            ? "rounded-2xl rounded-tl-sm bg-chalk text-basalt"
                            : m.sender === "support"
                              ? "rounded-2xl rounded-br-sm bg-sevan text-white"
                              : "rounded-2xl rounded-br-sm bg-apricot/15 text-basalt",
                        )}
                      >
                        <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-[0.1em] opacity-60">
                          {m.sender === "traveler" ? "Traveler" : m.sender === "support" ? "You" : "AI"}
                        </span>
                        {m.body}
                      </div>
                    </div>
                  ))}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    send();
                  }}
                  className="flex items-end gap-2 border-t border-basalt/10 p-3"
                >
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    rows={1}
                    placeholder="Reply as Revamp…"
                    className="max-h-28 flex-1 resize-none rounded-xl border border-basalt/15 bg-paper px-3 py-2 text-sm outline-none focus:border-apricot"
                  />
                  <button type="submit" disabled={!reply.trim() || sending} aria-label="Send reply" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-apricot text-white hover:bg-apricot/90 disabled:opacity-40">
                    <Send className="h-4 w-4" />
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
