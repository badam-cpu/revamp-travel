/**
 * Opt-in control to link the signed-in account's Telegram for free booking
 * notifications. Renders nothing until the server confirms the feature is
 * configured (TELEGRAM_BOT_TOKEN set). "Connect" opens a t.me deep link; the
 * user taps Start in Telegram, the webhook links their chat, and they refresh.
 */
import { useEffect, useState } from "react";
import { Send, Check, Loader2 } from "lucide-react";
import { telegramConnect, telegramStatus, telegramDisconnect, ApiError } from "@/lib/api";
import { toast } from "sonner";

export function TelegramConnect() {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    telegramStatus()
      .then((s) => { setConnected(s.connected); setConfigured(s.configured); })
      .catch(() => {})
      .finally(() => setLoading(false));
  useEffect(() => { refresh(); }, []);

  if (loading || !configured) return null;

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await telegramConnect();
      window.open(url, "_blank", "noopener");
      toast("Telegram opened — tap Start there, then come back and hit refresh.");
    } catch (e) {
      toast(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't start the connection.");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try { await telegramDisconnect(); setConnected(false); toast("Telegram disconnected."); }
    catch { toast("Couldn't disconnect."); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-8 max-w-xl border-t border-basalt/10 pt-6">
      <h3 className="text-sm font-semibold">Booking updates on Telegram</h3>
      <p className="mt-1 text-sm text-basalt/55">Get booking confirmations on Telegram — free and instant, no SMS charges.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {connected ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600"><Check className="h-4 w-4" /> Connected</span>
            <button type="button" onClick={disconnect} disabled={busy} className="text-sm font-semibold text-basalt/50 hover:text-destructive disabled:opacity-50">Disconnect</button>
          </>
        ) : (
          <>
            <button type="button" onClick={connect} disabled={busy} className="inline-flex items-center gap-2 rounded-none bg-[#229ED9] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Connect Telegram
            </button>
            <button type="button" onClick={refresh} className="text-sm font-semibold text-basalt/50 hover:text-apricot">I've connected — refresh</button>
          </>
        )}
      </div>
    </div>
  );
}
