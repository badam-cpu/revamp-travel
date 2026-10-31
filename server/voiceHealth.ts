/**
 * Can Aha AI's voice really start a call? (Admin → Health, 2026-10-31.) Voice
 * went down with every key still "set" and credits left: the ElevenLabs key had
 * read access only, and a signed link needs write. So this runs the two server
 * steps of POST /api/voice/session without starting anything: ask ElevenLabs for
 * a signed link (no call, no credits), then run the budget counter with limits
 * of zero (it stops before counting). Admin-only; the key is never shown.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const voiceLimits = () => ({ day: Number(process.env.VOICE_DAILY_CALLS) || 8, month: Number(process.env.VOICE_MONTHLY_CALLS) || 90 });
/** Today in Armenia. */
export const voiceDay = (now = Date.now()) => new Date(now + 4 * 3_600_000).toISOString().slice(0, 10);

export interface VoiceHealth {
  status: "ok" | "warn" | "bad" | "off";
  detail: string;
  callsToday: number | null;
  callsThisMonth: number | null;
  dayLimit: number;
  monthLimit: number;
}

async function signedLinkProblem(key: string, agentId: string): Promise<string | null> {
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`, { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(8000) });
    if (r.ok) return null;
    if (r.status === 401 || r.status === 403) return "ElevenLabs refused the key, so calls can't start. In ElevenLabs → API keys, give it write access to Agents.";
    if (r.status === 404) return "ElevenLabs can't find the agent, so calls can't start. Check ELEVENLABS_AGENT_ID in Netlify.";
    return `ElevenLabs answered ${r.status}, so calls can't start right now.`;
  } catch (e) {
    console.error("[voice-health] signed url", e);
    return "Couldn't reach ElevenLabs, so calls can't start right now.";
  }
}

export async function checkVoice(admin: SupabaseClient, now = Date.now()): Promise<VoiceHealth> {
  const { day: dayLimit, month: monthLimit } = voiceLimits();
  const day = voiceDay(now);
  const { data, error } = await admin.from("voice_call_days").select("day, calls").gte("day", `${day.slice(0, 7)}-01`).lte("day", day);
  const rows = error ? null : ((data ?? []) as { day: string; calls: number | null }[]);
  const callsThisMonth = rows ? rows.reduce((n, r) => n + (r.calls ?? 0), 0) : null;
  const callsToday = rows ? rows.filter((r) => r.day === day).reduce((n, r) => n + (r.calls ?? 0), 0) : null;
  const result = (status: VoiceHealth["status"], detail: string): VoiceHealth => ({ status, detail, callsToday, callsThisMonth, dayLimit, monthLimit });

  const agentId = process.env.ELEVENLABS_AGENT_ID || process.env.VITE_ELEVENLABS_AGENT_ID;
  if (!agentId) return result("off", "Not set up: there's no ElevenLabs agent ID in Netlify.");
  const key = process.env.ELEVENLABS_API_KEY;
  if (key) {
    const problem = await signedLinkProblem(key, agentId);
    if (problem) return result("bad", problem);
  }

  const { error: counter } = await admin.rpc("claim_voice_call", { p_scope: "listing", p_day: day, p_day_limit: 0, p_month_limit: 0 });
  if (counter) {
    // Same exception as the session route: without 0121 calls still start, uncounted.
    if (/claim_voice_call|PGRST202|42883/.test(`${counter.code} ${counter.message}`)) return result("warn", "Calls can start, but they aren't being counted: run migration 0121.");
    console.error("[voice-health] claim", counter);
    return result("bad", "The daily call counter failed, so calls can't start.");
  }

  if (callsThisMonth !== null && callsThisMonth >= monthLimit) return result("warn", "This month's calls are used up, so Talk is hidden until next month.");
  if (callsToday !== null && callsToday >= dayLimit) return result("warn", "Today's calls are used up, so Talk is hidden for guests until tomorrow.");
  if (!key) return result("warn", "Calls can start, but ELEVENLABS_API_KEY isn't set, so the agent can be used without going through our call limits.");
  return result("ok", "Calls can start: ElevenLabs accepted the key and the call counter works.");
}
