/**
 * Is Aha AI's voice taking calls right now? (GET /api/voice/status — the daily /
 * monthly budget.) Voice entry points hide themselves when it isn't, so guests
 * never see a "no more calls" message. Checked once per few minutes per tab;
 * signed-in team accounts always get voice (their calls aren't counted).
 */
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const ENABLED = !!import.meta.env.VITE_ELEVENLABS_AGENT_ID;
let cached: { at: number; value: Promise<boolean> } | null = null;

function check(): Promise<boolean> {
  if (cached && Date.now() - cached.at < 3 * 60_000) return cached.value;
  const value = (async () => {
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await fetch("/api/voice/status", { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (!r.ok) return true; // unknown → let the call try; the session route still guards the budget
      return ((await r.json()) as { available?: boolean }).available !== false;
    } catch {
      return true;
    }
  })();
  cached = { at: Date.now(), value };
  return value;
}

/** Forget the cached answer (after a call was refused, so the entry points hide). */
export function markVoiceUnavailable() {
  cached = { at: Date.now(), value: Promise.resolve(false) };
  window.dispatchEvent(new Event("aha:voice-status"));
}

/** True while voice is configured and has budget left. */
export function useVoiceAvailable(): boolean {
  const [ok, setOk] = useState(ENABLED);
  useEffect(() => {
    if (!ENABLED) return;
    let live = true;
    const run = () => check().then((v) => live && setOk(v));
    run();
    window.addEventListener("aha:voice-status", run);
    return () => {
      live = false;
      window.removeEventListener("aha:voice-status", run);
    };
  }, []);
  return ok;
}
