/**
 * Floating "chat with Revamp" support widget (bottom-right, site-wide). All
 * traveler messages go to a central Revamp support thread answered first by the
 * AI (POST /api/support-chat); admins take over from the /admin inbox. This is
 * deliberately NOT traveler↔operator messaging.
 *
 * Shown to travelers and signed-out visitors; hidden for operators/admins (they
 * have their own dashboards, and admins reply from the inbox). Messages load
 * under the traveler's own RLS (support_messages read policy scopes to their
 * thread), so a bare select returns only their conversation.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { MessageCircle, Send, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { renderMarkdown } from "@shared/markdown";
import { sendSupportMessage, submitSupportContact, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Msg {
  id: string;
  sender: "traveler" | "ai" | "support";
  body: string;
  created_at?: string;
}

export function SupportWidget() {
  const { user, profile, loading, signInAnonymously } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [contactEmail, setContactEmail] = useState("");
  const [contactSaved, setContactSaved] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();

  // Assistant replies are short Markdown; links to Revamp pages (/listing/…,
  // /explore/…) should open in-app, not a new tab.
  const onReplyClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href") || "";
    if (href.startsWith("/")) {
      e.preventDefault();
      navigate(href);
      setOpen(false);
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
  if (loading || profile?.role === "operator" || profile?.role === "admin") return null;

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
      console.error("[support] send failed", err);
      // Surface the real reason (e.g. anonymous sign-ins disabled) rather than a
      // generic message, so misconfiguration is diagnosable.
      const detail = err instanceof ApiError || err instanceof Error ? err.message : "";
      setMessages((m) => [
        ...m,
        { id: `err-${Date.now()}`, sender: "ai", body: detail ? `Couldn't send that: ${detail}` : "Something went wrong — please try again." },
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
          onClick={() => setOpen(true)}
          aria-label="Chat with the Revamp AI assistant"
          className="fixed bottom-20 right-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-apricot text-white shadow-[0_10px_30px_rgba(241,88,34,0.4)] transition-transform hover:scale-105 lg:bottom-4"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-4 right-4 z-50 flex h-[min(560px,80vh)] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-basalt/10 bg-paper shadow-[0_24px_70px_rgba(35,35,33,0.28)]">
          <div className="flex items-center justify-between bg-basalt px-4 py-3 text-white">
            <div>
              <p className="text-sm font-bold">Revamp AI assistant</p>
              <p className="text-[11px] text-white/60">Usually replies in a moment</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close chat" className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10">
              <X className="h-4 w-4" />
            </button>
          </div>

          {
            <>
              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
                <div className="rounded-2xl rounded-tl-sm bg-chalk px-3.5 py-2.5 text-sm text-basalt/80">
                  Hi{profile?.displayName && profile.displayName !== "Guest" ? ` ${profile.displayName.split(" ")[0]}` : ""}! 👋 Ask us anything about stays, tours, experiences, or booking — no account needed.
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
          }
        </div>
      )}
    </>
  );
}
