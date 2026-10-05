/**
 * QR code manager — create + list + download. Used by operators (Dashboard → QR
 * codes) and admins (/admin → QR codes). Phase 1 covers the marketing types
 * (listing / instructions / custom); payment types (tip/service) arrive with the
 * payments increment. The QR image is generated client-side from the landing URL.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, QrCode, Trash2, Download, Copy, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useListings } from "@/contexts/ListingsContext";
import { listQrCodes, createQrCode, deleteQrCode, listQrPayments, qrLandingUrl, qrPngDataUrl, downloadQrPng, downloadQrSvg, QR_TYPES, type QrRow, type QrType } from "@/lib/qr";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

function QrThumb({ slug, size = 72 }: { slug: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    qrPngDataUrl(qrLandingUrl(slug), 256).then((u) => active && setSrc(u)).catch(() => {});
    return () => { active = false; };
  }, [slug]);
  return src ? <img src={src} alt="QR" width={size} height={size} className="rounded-[6px] border border-basalt/10" /> : <div style={{ width: size, height: size }} className="grid place-items-center rounded-[6px] border border-basalt/10 bg-chalk text-basalt/30"><QrCode className="h-5 w-5" /></div>;
}

export function QrManager({ scope = "operator" }: { scope?: "operator" | "admin" }) {
  const { user } = useAuth();
  const { listings } = useListings();
  const { format } = useCurrency();
  const [codes, setCodes] = useState<QrRow[] | null>(null);
  const [earnings, setEarnings] = useState<Map<string, { count: number; net: number }>>(new Map());
  const [copied, setCopied] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [type, setType] = useState<QrType>("tip");
  const [listingId, setListingId] = useState("");
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [amountDram, setAmountDram] = useState("");          // service: fixed price
  const [suggestions, setSuggestions] = useState("1000, 2000, 5000"); // tip: suggested amounts
  const [busy, setBusy] = useState(false);

  const myListings = listings.filter((l) => scope === "admin" || (l as { operatorId?: string }).operatorId === user?.id);

  const load = useCallback(async () => {
    try { setCodes(await listQrCodes()); } catch { setCodes([]); }
    try {
      const pays = await listQrPayments();
      const m = new Map<string, { count: number; net: number }>();
      for (const p of pays) {
        const cur = m.get(p.qr_code_id) ?? { count: 0, net: 0 };
        m.set(p.qr_code_id, { count: cur.count + 1, net: cur.net + p.net_cents });
      }
      setEarnings(m);
    } catch { /* table may not exist yet */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const dramListToCents = (s: string): number[] =>
    s.split(",").map((x) => Math.round(Number(x.trim()) * 100)).filter((n) => Number.isFinite(n) && n > 0);

  const submit = async () => {
    if (!user?.id) return;
    if (!name.trim()) { toast("Give it a name."); return; }
    if (type === "listing" && !listingId) { toast("Pick the listing to link."); return; }
    if (type === "custom" && !url.trim()) { toast("Add the URL."); return; }
    if (type === "instructions" && !content.trim()) { toast("Add the instructions text."); return; }
    const tipSuggestions = dramListToCents(suggestions);
    if (type === "tip" && tipSuggestions.length === 0) { toast("Add at least one suggested amount."); return; }
    const serviceCents = Math.round(Number(amountDram) * 100);
    if (type === "service" && (!Number.isFinite(serviceCents) || serviceCents <= 0)) { toast("Set the price."); return; }
    setBusy(true);
    try {
      const config =
        type === "custom" ? { url: url.trim() }
        : type === "instructions" ? { content: content.trim() }
        : type === "tip" ? { amountMode: "choose" as const, suggestionsCents: tipSuggestions }
        : type === "service" ? { amountMode: "fixed" as const, amountCents: serviceCents, description: content.trim() || undefined }
        : {};
      await createQrCode({
        ownerId: user.id,
        name,
        type,
        // Payment + info codes can carry a listing as context; listing-type requires one.
        listingId: listingId || null,
        config,
      });
      toast("QR code created.");
      setName(""); setUrl(""); setContent(""); setListingId(""); setAmountDram("");
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't create.");
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async (slug: string) => {
    try { await navigator.clipboard.writeText(qrLandingUrl(slug)); setCopied(slug); setTimeout(() => setCopied(null), 1500); } catch { /* ignore */ }
  };

  const remove = async (c: QrRow) => {
    if (!window.confirm(`Delete "${c.name}"? Any printed codes will stop working.`)) return;
    try { await deleteQrCode(c.id); setCodes((p) => (p ? p.filter((x) => x.id !== c.id) : p)); }
    catch (e) { toast(e instanceof Error ? e.message : "Couldn't delete."); }
  };

  const typeLabel = (t: QrType) => QR_TYPES.find((x) => x.value === t)?.label ?? t;

  return (
    <div>
      <div className="mb-6">
        <p className="eyebrow">QR codes</p>
        <h2 className="mt-2 font-display text-3xl tracking-[-0.03em]">Revamp QR codes.</h2>
        <p className="mt-2 max-w-xl text-sm text-basalt/55">Create a code, print it, and place it in the room or on a flyer. Every scan opens a Revamp-powered page — link guests to your listing, share house info, or point them anywhere. Payment codes (tips &amp; add-ons) are coming next.</p>
      </div>

      <div className="grid gap-3 border border-basalt/12 bg-paper p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label className="text-xs font-semibold text-basalt/60">Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Room 16 — welcome" className="h-10 rounded-none" /></div>
          <div className="grid gap-1.5"><Label className="text-xs font-semibold text-basalt/60">Type</Label>
            <select value={type} onChange={(e) => setType(e.target.value as QrType)} className="h-10 rounded-none border border-basalt/20 bg-paper px-2 text-sm">
              {QR_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {type === "listing" && (
            <div className="grid gap-1.5 sm:col-span-2"><Label className="text-xs font-semibold text-basalt/60">Listing</Label>
              <select value={listingId} onChange={(e) => setListingId(e.target.value)} className="h-10 rounded-none border border-basalt/20 bg-paper px-2 text-sm">
                <option value="">Choose a listing…</option>
                {myListings.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
              </select>
            </div>
          )}
          {type === "custom" && (
            <div className="grid gap-1.5 sm:col-span-2"><Label className="text-xs font-semibold text-basalt/60">URL</Label><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="h-10 rounded-none" /></div>
          )}
          {type === "instructions" && (
            <div className="grid gap-1.5 sm:col-span-2"><Label className="text-xs font-semibold text-basalt/60">Instructions</Label><Textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} placeholder={"Wi-Fi: …\nCheck-out: 11:00\nHeating: …"} className="rounded-none text-base" /></div>
          )}
          {(type === "tip" || type === "service") && (
            <div className="grid gap-1.5 sm:col-span-2"><Label className="text-xs font-semibold text-basalt/60">Property (optional)</Label>
              <select value={listingId} onChange={(e) => setListingId(e.target.value)} className="h-10 rounded-none border border-basalt/20 bg-paper px-2 text-sm">
                <option value="">No specific property</option>
                {myListings.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
              </select>
            </div>
          )}
          {type === "tip" && (
            <div className="grid gap-1.5 sm:col-span-2"><Label className="text-xs font-semibold text-basalt/60">Suggested amounts (֏, comma-separated)</Label>
              <Input value={suggestions} onChange={(e) => setSuggestions(e.target.value)} placeholder="1000, 2000, 5000" className="h-10 rounded-none" />
              <p className="text-xs text-basalt/45">Guests pick one or enter their own. Revamp keeps a 12.5% commission; the rest is yours.</p>
            </div>
          )}
          {type === "service" && (
            <>
              <div className="grid gap-1.5"><Label className="text-xs font-semibold text-basalt/60">Price (֏)</Label>
                <Input value={amountDram} onChange={(e) => setAmountDram(e.target.value)} placeholder="8000" inputMode="numeric" className="h-10 rounded-none" />
              </div>
              <div className="grid gap-1.5"><Label className="text-xs font-semibold text-basalt/60">What is it? (optional)</Label>
                <Input value={content} onChange={(e) => setContent(e.target.value)} placeholder="e.g. Late check-out until 3 PM" className="h-10 rounded-none" />
              </div>
            </>
          )}
        </div>
        {(type === "tip" || type === "service") && (
          <p className="text-xs text-basalt/45">Guests pay by card via PayLink — no tax added. Earnings (net of 12.5%) show below once paid.</p>
        )}
        <div className="border-t border-basalt/10 pt-4">
          <Button onClick={submit} disabled={busy} className="rounded-none bg-apricot font-semibold text-white hover:bg-apricot/90">
            {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating…</> : <><QrCode className="mr-2 h-4 w-4" /> Create QR code</>}
          </Button>
        </div>
      </div>

      <div className="mt-8">
        <p className="text-sm font-bold uppercase tracking-[0.1em] text-basalt/50">Your codes</p>
        {codes === null ? (
          <div className="grid place-items-center py-10 text-basalt/50"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : codes.length === 0 ? (
          <p className="mt-3 text-sm text-basalt/50">No QR codes yet — create your first above.</p>
        ) : (
          <ul className="mt-3 grid gap-3">
            {codes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-4 border border-basalt/12 bg-paper p-4">
                <QrThumb slug={c.slug} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-basalt">{c.name}</p>
                  <p className="mt-0.5 text-xs text-basalt/50">{typeLabel(c.type)} · <span className="font-semibold text-basalt/70">{c.scans}</span> scan{c.scans === 1 ? "" : "s"}{(c.type === "tip" || c.type === "service") && earnings.get(c.id) ? <> · <span className="font-semibold text-apricot">{earnings.get(c.id)!.count}</span> paid · <span className="font-semibold text-basalt/70">{format(earnings.get(c.id)!.net)}</span> earned</> : null}{!c.active ? " · inactive" : ""}</p>
                  <button type="button" onClick={() => copyLink(c.slug)} className="mt-1 inline-flex items-center gap-1 text-xs text-apricot hover:underline">
                    {copied === c.slug ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> {qrLandingUrl(c.slug).replace(/^https?:\/\//, "")}</>}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => downloadQrPng(qrLandingUrl(c.slug), c.name || "qr")} className="inline-flex items-center gap-1 border border-basalt/20 px-2.5 py-1.5 text-xs font-semibold hover:border-apricot hover:text-apricot"><Download className="h-3.5 w-3.5" /> PNG</button>
                  <button type="button" onClick={() => downloadQrSvg(qrLandingUrl(c.slug), c.name || "qr")} className="inline-flex items-center gap-1 border border-basalt/20 px-2.5 py-1.5 text-xs font-semibold hover:border-apricot hover:text-apricot"><Download className="h-3.5 w-3.5" /> SVG</button>
                  <button type="button" onClick={() => remove(c)} className="text-basalt/35 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
