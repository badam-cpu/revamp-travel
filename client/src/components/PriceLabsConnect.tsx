/**
 * PriceLabs connection (operator, in /dashboard → Settings → Integrations).
 * v1 is sign-up + connect only: the operator signs up on PriceLabs, records the
 * connection on their profile (pricelabs_account/connected_at, migration 0045),
 * and gets each listing's iCal export URL to add in PriceLabs so it can read
 * availability. Automatic two-way price sync is a later phase (needs PriceLabs'
 * partner API). No secrets stored here — just the account reference the operator
 * enters.
 */
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useListings } from "@/contexts/ListingsContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, TrendingUp } from "lucide-react";

const PRICELABS_SIGNUP = "https://pricelabs.co/";

export function PriceLabsConnect() {
  const { user, profile, updateProfile } = useAuth();
  const { listings } = useListings();
  const [account, setAccount] = useState("");
  const [saving, setSaving] = useState(false);

  const connected = !!profile?.pricelabsConnectedAt;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const myStays = listings.filter(
    (l) => (l as { operatorId?: string }).operatorId === user?.id && l.type === "stay",
  );

  const connect = async () => {
    if (!account.trim()) {
      toast("Enter the email you used on PriceLabs.");
      return;
    }
    setSaving(true);
    try {
      await updateProfile({ pricelabsAccount: account.trim(), pricelabsConnectedAt: new Date().toISOString() });
      toast("PriceLabs connected.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect PriceLabs? Your listings stay as they are.")) return;
    setSaving(true);
    try {
      await updateProfile({ pricelabsAccount: null, pricelabsConnectedAt: null });
      setAccount("");
      toast("PriceLabs disconnected.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't update. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => toast("Copied."), () => toast("Couldn't copy."));
  };

  return (
    <div className="grid gap-5 border border-basalt/12 bg-paper p-6">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-apricot/10 text-apricot"><TrendingUp className="h-5 w-5" /></div>
        <div>
          <p className="font-display text-lg leading-tight">Dynamic pricing with PriceLabs</p>
          <p className="mt-1 text-sm text-basalt/60">
            PriceLabs recommends optimal nightly rates from local demand and seasonality. Sign up, then connect your Revamp stays so PriceLabs can read their availability.
          </p>
        </div>
      </div>

      {!connected ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <a href={PRICELABS_SIGNUP} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-none bg-basalt px-4 py-2.5 text-sm font-semibold text-paper hover:bg-basalt/90">
              Sign up on PriceLabs <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <span className="text-xs text-basalt/45">Opens PriceLabs in a new tab. Come back here once you have an account.</span>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pl-account" className="text-sm font-semibold">Your PriceLabs email</Label>
            <div className="flex items-end gap-2">
              <Input id="pl-account" type="email" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="you@email.com" className="h-11 max-w-xs rounded-none" />
              <Button onClick={connect} disabled={saving} className="h-11 rounded-none bg-apricot text-white hover:bg-apricot/90">{saving ? "Connecting…" : "Connect"}</Button>
            </div>
          </div>
        </>
      ) : (
        <div className="grid gap-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-emerald-700"><Check className="h-3.5 w-3.5" /> Connected</span>
            <span className="text-basalt/55">{profile?.pricelabsAccount}</span>
            <button type="button" onClick={disconnect} disabled={saving} className="ml-auto text-xs font-semibold text-basalt/45 hover:text-destructive">Disconnect</button>
          </div>

          <div>
            <p className="text-sm font-semibold">Add your stays to PriceLabs</p>
            <p className="mt-1 text-xs text-basalt/55">In PriceLabs, add each stay using its Revamp calendar (iCal) link below so PriceLabs can sync availability.</p>
            {myStays.length === 0 ? (
              <p className="mt-3 text-sm text-basalt/45">You don't have any published stays yet.</p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {myStays.map((l) => {
                  const url = `${origin}/api/ical/${(l as { id: string }).id}`;
                  return (
                    <li key={l.id} className="flex items-center gap-3 border border-basalt/10 bg-chalk/40 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-basalt">{l.title}</span>
                      <code className="hidden max-w-[46%] truncate text-xs text-basalt/45 sm:block">{url}</code>
                      <button type="button" onClick={() => copy(url)} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-apricot hover:underline"><Copy className="h-3.5 w-3.5" /> Copy</button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <p className="text-xs leading-relaxed text-basalt/45">
            Note: this connects availability. Automatic import of PriceLabs' recommended prices into your Revamp calendar is coming next — for now you can enter recommended rates in each listing's calendar.
          </p>
        </div>
      )}
    </div>
  );
}
