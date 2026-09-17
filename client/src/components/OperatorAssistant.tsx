/**
 * Floating AI assistant for operators — data-only Q&A about their own bookings
 * and payouts (POST /api/operator-assistant, RLS-scoped server-side). Shown only
 * to operators; travelers/admins/signed-out visitors get nothing. Stateless:
 * the chat history lives in component state and is sent with each request; the
 * server re-fetches fresh data each time, so answers are always current.
 *
 * Deliberately not the guest support chat (that's SupportWidget, hidden for
 * operators) — this is the host's private helper and never sees other operators.
 */
import { useEffect, useRef, useState } from "react";
import { Sparkles, Send, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { askOperatorAssistant, ApiError, type OperatorChatTurn } from "@/lib/api";

const SUGGESTIONS = ["How much am I owed?", "What bookings are coming up?", "When is my next payout?", "How many bookings this month?"];

export function OperatorAssistant() {
  const { profile, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<OperatorChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  // Operators only.
  if (loading || profile?.role !== "operator") return null;

  const send = async (text: string) => {
    const body = text.trim();
    if (!body || sending) return;
    const next: OperatorChatTurn[] = [...messages, { role: "user", body }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      const { reply } = await askOperatorAssistant(next);
      setMessages((prev) => [...prev, { role: "assistant", body: reply }]);
    } catch (err) {
      const msg = err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong. Try again.";
      setMessages((prev) => [...prev, { role: "assistant", body: msg }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open the operator assistant"
          className="fixed bottom-20 right-4 z-50 inline-flex items-center gap-2 rounded-full bg-basalt px-4 py-3 text-sm font-semibold text-paper shadow-[0_16px_40px_rgba(35,35,33,0.32)] transition-transform hover:-translate-y-0.5 lg:bottom-4"
        >
          <Sparkles className="h-4 w-4 text-apricot" /> Assistant
        </button>
      )}

      {open && (
        <div className="fixed bottom-4 right-4 z-50 flex h-[min(560px,80vh)] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-basalt/10 bg-paper shadow-[0_24px_70px_rgba(35,35,33,0.28)]">
          <div className="flex items-center justify-between border-b border-basalt/10 bg-basalt px-4 py-3 text-paper">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-apricot" />
              <span className="font-semibold">Operator assistant</span>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-paper/70 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="text-sm text-basalt/60">
                <p>Hi! Ask me about your bookings and payouts — I only see your own data.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="rounded-full border border-basalt/15 bg-chalk px-3 py-1.5 text-xs font-medium text-basalt/70 transition-colors hover:border-apricot hover:text-basalt"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] whitespace-pre-line rounded-2xl rounded-br-sm bg-apricot px-3.5 py-2 text-sm text-white"
                      : "max-w-[90%] whitespace-pre-line rounded-2xl rounded-bl-sm bg-chalk px-3.5 py-2 text-sm text-basalt"
                  }
                >
                  {m.body}
                </div>
              </div>
            ))}
            {sending && <div className="text-xs text-basalt/40">Thinking…</div>}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 border-t border-basalt/10 p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about bookings or payouts…"
              className="h-10 flex-1 rounded-none border border-basalt/15 bg-paper px-3 text-sm outline-none focus:border-apricot"
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              aria-label="Send"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-none bg-apricot text-white transition-opacity disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
