/**
 * PriceLabs price sync (Dashboard → Integrations). The operator enters their
 * PriceLabs API key once; it goes straight to the server (stored in a service-
 * role-only table) and is NEVER returned to the browser — the UI only ever shows
 * "connected". They map each Revamp stay to a PriceLabs listing, then Sync (also
 * runs daily) pulls PriceLabs' recommended rates into the listing's calendar.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useListings } from "@/contexts/ListingsContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Check, ExternalLink, Lock, RefreshCw, TrendingUp } from "lucide-react";
import { pricelabsConnect, pricelabsData, pricelabsDisconnect, pricelabsMap, pricelabsUnmap, pricelabsSync, ApiError, type PriceLabsListing, type PriceLabsMap, type ListingSyncSummary } from "@/lib/api";
import { useCurrency } from "@/contexts/CurrencyContext";

export function PriceLabsSync() {
  const { user } = useAuth();
  const { listings } = useListings();
  const { format } = useCurrency();
  const [summary, setSummary] = useState<ListingSyncSummary[]>([]);
  const myStays = listings.filter((l) => (l as { operatorId?: string }).operatorId === user?.id && l.type === "stay");

  const [connected, setConnected] = useState<boolean | null>(null);
  const [plListings, setPlListings] = useState<PriceLabsListing[]>([]);
  const [maps, setMaps] = useState<PriceLabsMap[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await pricelabsData();
      setConnected(d.connected);
      setPlListings(d.listings ?? []);
      setMaps(d.maps ?? []);
    } catch {
      setConnected(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const connect = async () => {
    if (apiKey.trim().length < 8) {
      toast("Paste your PriceLabs API key.");
      return;
    }
    setBusy(true);
    try {
      const r = await pricelabsConnect(apiKey.trim());
      setApiKey("");
      setConnected(true);
      setPlListings(r.listings);
      toast("PriceLabs connected.");
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't connect. Check the key.");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect PriceLabs price sync? Your current calendar prices stay as they are.")) return;
    setBusy(true);
    try {
      await pricelabsDisconnect();
      setConnected(false);
      setPlListings([]);
      setMaps([]);
    } finally {
      setBusy(false);
    }
  };

  const onMap = async (revampListingId: string, plId: string) => {
    try {
      if (!plId) {
        await pricelabsUnmap(revampListingId);
        setMaps((m) => m.filter((x) => x.revamp_listing_id !== revampListingId));
        return;
      }
      const pl = plListings.find((l) => l.id === plId);
      if (!pl) return;
      await pricelabsMap({ revampListingId, pricelabsListingId: plId, pricelabsPms: pl.pms });
      setMaps((m) => [...m.filter((x) => x.revamp_listing_id !== revampListingId), { revamp_listing_id: revampListingId, pricelabs_listing_id: plId, pricelabs_pms: pl.pms, currency: pl.currency, last_synced_at: null }]);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save the mapping.");
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await pricelabsSync();
      setSummary(r.perListing ?? []);
      if (r.synced > 0) {
        toast(`Synced ${r.synced} listing${r.synced === 1 ? "" : "s"} (${r.dates} dates).`);
      } else if (r.skipped?.includes("no_mappings")) {
        toast("Link a stay to a PriceLabs listing first (the dropdowns below), then sync.");
      } else if (r.skipped?.length) {
        toast(`Couldn't sync: ${r.skipped.join("; ")}`);
      } else {
        toast("Nothing to sync.");
      }
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  const mapFor = (id: string) => maps.find((m) => m.revamp_listing_id === id);

  return (
    <div className="grid gap-5 border border-basalt/12 bg-paper p-6">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-apricot/10 text-apricot"><TrendingUp className="h-5 w-5" /></div>
        <div>
          <p className="font-display text-lg leading-tight">PriceLabs price sync</p>
          <p className="mt-1 text-sm text-basalt/60">Pull PriceLabs' recommended nightly rates straight into your Revamp calendar — automatically, once a day.</p>
        </div>
      </div>

      {connected === null ? (
        <p className="text-sm text-basalt/45">Loading…</p>
      ) : !connected ? (
        <div className="grid gap-2">
          <p className="text-xs text-basalt/55">
            Get your key in PriceLabs → <strong>Account Settings → API Details → Get PriceLabs API Key</strong>.{" "}
            <a href="https://help.pricelabs.co/portal/en/kb/articles/pricelabs-api" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-apricot hover:underline">Guide <ExternalLink className="h-3 w-3" /></a>
          </p>
          <Label htmlFor="pl-key" className="text-sm font-semibold">PriceLabs API key</Label>
          <div className="flex items-end gap-2">
            <Input id="pl-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste your API key" className="h-11 max-w-md rounded-none font-mono text-sm" autoComplete="off" />
            <Button onClick={connect} disabled={busy} className="h-11 rounded-none bg-apricot text-white hover:bg-apricot/90">{busy ? "Connecting…" : "Connect"}</Button>
          </div>
          <p className="inline-flex items-center gap-1.5 text-[11px] text-basalt/45"><Lock className="h-3 w-3" /> Your key is stored securely on the server and never shown again.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-emerald-700"><Check className="h-3.5 w-3.5" /> Connected</span>
            <Button onClick={sync} disabled={syncing} size="sm" className="rounded-none bg-apricot text-white hover:bg-apricot/90"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "Syncing…" : "Sync prices now"}</Button>
            <button type="button" onClick={disconnect} disabled={busy} className="ml-auto text-xs font-semibold text-basalt/45 hover:text-destructive">Disconnect</button>
          </div>

          <div>
            <p className="text-sm font-semibold">Link your stays</p>
            <p className="mt-1 text-xs text-basalt/55">Match each Revamp stay to its PriceLabs listing. Prices sync into that listing's calendar.</p>
            {myStays.length === 0 ? (
              <p className="mt-3 text-sm text-basalt/45">You don't have any stays yet.</p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {myStays.map((l) => {
                  const m = mapFor((l as { id: string }).id);
                  return (
                    <li key={l.id} className="flex flex-wrap items-center gap-3 border border-basalt/10 bg-chalk/40 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-basalt">{l.title}</span>
                      <select
                        value={m?.pricelabs_listing_id ?? ""}
                        onChange={(e) => onMap((l as { id: string }).id, e.target.value)}
                        className="h-9 rounded-none border border-basalt/20 bg-paper px-2 text-sm"
                      >
                        <option value="">Not linked</option>
                        {plListings.map((pl) => <option key={`${pl.pms}:${pl.id}`} value={pl.id}>{pl.name} ({pl.pms})</option>)}
                      </select>
                      {m?.last_synced_at && <span className="shrink-0 text-[11px] text-basalt/40">synced {new Date(m.last_synced_at).toLocaleDateString()}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
            {plListings.length === 0 && <p className="mt-2 text-xs text-amber-600">No PriceLabs listings loaded — make sure your listings are active in PriceLabs.</p>}
          </div>

          {summary.length > 0 && (
            <div className="border border-basalt/10 bg-chalk/40 p-3">
              <p className="text-sm font-semibold">Last sync — coverage &amp; price range</p>
              <p className="mt-1 text-xs text-basalt/55">Any day without a synced price falls back to your base nightly rate. Set a floor in PriceLabs → Configure Prices → Minimum so no day syncs below it.</p>
              <ul className="mt-3 grid gap-2">
                {summary.map((s) => {
                  const stay = myStays.find((l) => (l as { id: string }).id === s.id);
                  return (
                    <li key={s.id} className="grid gap-1 border-t border-basalt/10 pt-2 first:border-t-0 first:pt-0">
                      <span className="truncate text-sm font-medium text-basalt">{stay?.title ?? s.id}</span>
                      <span className="text-xs text-basalt/60">
                        <strong>{s.days}</strong> day{s.days === 1 ? "" : "s"} priced ({s.firstDate} → {s.lastDate}) · low <strong>{format(s.minCents)}</strong> · high <strong>{format(s.maxCents)}</strong> · avg <strong>{format(s.avgCents)}</strong>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-basalt/45">Prices are converted to AMD (dram) using your admin rate for USD listings. Set the rate in Admin → Site content if your PriceLabs prices aren't in AMD.</p>
        </div>
      )}
    </div>
  );
}
