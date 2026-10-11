/**
 * Dashboard → Integrations: "Get paid directly" (migration 0094). An operator
 * with their own PayLink merchant account enters its API credentials once; the
 * server verifies them with PayLink and stores them service-role only — they're
 * never sent back to the browser. From then on guests pay the operator's
 * account directly and Revamp bills its commission (+ checkout add-ons, minus
 * any Revamp gift-card portion) on a monthly statement (Dashboard → Billing).
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, Check, Lock, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  paylinkAccountConnect,
  paylinkAccountDisconnect,
  paylinkAccountStatus,
  type PaymentAccountStatus,
} from "@/lib/api";

const HOW_IT_WORKS = [
  "Guests pay straight into your PayLink account — same price they see today, 10% tax included for you to remit.",
  "On the 1st of each month Revamp sends a statement: its commission plus any checkout add-ons, minus gift-card amounts Revamp owes you.",
  "Pay it within 14 days from the link in the email. If it's unpaid after that, new bookings are paid to Revamp (and reach you through regular payouts) until it's settled.",
];

export function PayLinkConnect() {
  const [status, setStatus] = useState<PaymentAccountStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [partnerId, setPartnerId] = useState("");
  const [partnerKey, setPartnerKey] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await paylinkAccountStatus());
      setUnavailable(false);
    } catch (e) {
      console.error("[paylink-connect] status", e);
      setUnavailable(true);
      setStatus({ connected: false });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const connect = async () => {
    if (!partnerId.trim() || !partnerKey.trim()) {
      toast("Enter both your PayLink partner ID and API key.");
      return;
    }
    setBusy(true);
    try {
      const s = await paylinkAccountConnect(partnerId.trim(), partnerKey.trim());
      setPartnerKey("");
      setPartnerId("");
      setStatus(s);
      toast(s.status === "paused" ? "PayLink connected — direct payments resume once your statement is paid." : "PayLink connected — new bookings are now paid to you directly.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't connect right now. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect your PayLink account? New bookings will be paid to Revamp and reach you through regular payouts.")) return;
    setBusy(true);
    try {
      await paylinkAccountDisconnect();
      setStatus({ connected: false });
      toast("Disconnected. New bookings are paid to Revamp.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't disconnect right now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 border border-basalt/12 bg-paper p-6">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-apricot/10 text-apricot"><Wallet className="h-5 w-5" /></div>
        <div>
          <p className="font-display text-lg leading-tight">Get paid directly with PayLink</p>
          <p className="mt-1 text-sm text-basalt/60">Already have a PayLink merchant account? Connect it and guests' payments go straight to you instead of through Revamp.</p>
        </div>
      </div>

      {status === null ? (
        <p className="text-sm text-basalt/45">Loading…</p>
      ) : !status.connected ? (
        <div className="grid gap-4">
          <ul className="grid gap-2">
            {HOW_IT_WORKS.map((t) => (
              <li key={t} className="flex gap-2.5 text-sm leading-6 text-basalt/75">
                <Check className="mt-1 h-4 w-4 shrink-0 text-apricot" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
          {unavailable || status.available === false ? (
            <p className="text-sm text-basalt/55">Direct payments aren't available yet — check back soon.</p>
          ) : (
            <div className="grid gap-3 border-t border-basalt/10 pt-4">
              <p className="text-xs leading-5 text-basalt/55">Use the <strong>API partner ID and key</strong> PayLink issued for your merchant account — not your PayLink login email or password. Ask PayLink support if you don't have them.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="pl-partner-id" className="text-sm font-semibold">Partner ID</Label>
                  <Input id="pl-partner-id" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} placeholder="e.g. 1234" autoComplete="off" className="h-11 rounded-none font-mono text-sm" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="pl-partner-key" className="text-sm font-semibold">API key</Label>
                  <Input id="pl-partner-key" type="password" value={partnerKey} onChange={(e) => setPartnerKey(e.target.value)} placeholder="Paste your API key" autoComplete="off" className="h-11 rounded-none font-mono text-sm" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={connect} disabled={busy} className="h-11 rounded-none bg-apricot px-6 text-white hover:bg-apricot/90">{busy ? "Checking with PayLink…" : "Verify & connect"}</Button>
                <p className="inline-flex items-center gap-1.5 text-[11px] text-basalt/45"><Lock className="h-3 w-3" /> Verified with PayLink, stored securely, never shown again.</p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {status.status === "paused" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-amber-800"><AlertTriangle className="h-3.5 w-3.5" /> Paused</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-emerald-700"><Check className="h-3.5 w-3.5" /> Active</span>
            )}
            {status.accountHint && <span className="font-mono text-xs text-basalt/55">PayLink {status.accountHint}</span>}
            {status.connectedAt && <span className="text-xs text-basalt/45">· connected {new Date(status.connectedAt).toLocaleDateString()}</span>}
            <button type="button" onClick={disconnect} disabled={busy} className="ml-auto text-xs font-semibold text-basalt/45 hover:text-destructive">Disconnect</button>
          </div>
          {status.status === "paused" ? (
            <p className="text-sm leading-6 text-basalt/70">
              {status.pausedReason || "Direct payments are paused."} New bookings are paid to Revamp for now.{" "}
              <Link href="/dashboard?section=billing" className="font-semibold text-apricot hover:underline">See your statements</Link>
            </p>
          ) : (
            <p className="text-sm leading-6 text-basalt/70">
              New bookings and QR payments are paid straight to your PayLink account. Revamp's commission is billed monthly —{" "}
              <Link href="/dashboard?section=billing" className="font-semibold text-apricot hover:underline">see your statements</Link>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
