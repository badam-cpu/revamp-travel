/**
 * Admin-only editor for site content (home hero image/headline/subcopy,
 * featured listings, announcement banner) — rendered on /admin alongside the
 * review queue. Writes the single `site_settings` row directly under the
 * admin's session; RLS (is_admin) is what actually authorizes it, not this UI.
 * Reads/refreshes through SiteSettingsContext so the change shows up live.
 */
import { useEffect, useRef, useState } from "react";
import { Minus, Plus, Save } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSiteSettings } from "@/contexts/SiteSettingsContext";
import { useListings } from "@/contexts/ListingsContext";
import { PhotoUploader, PhotoUploaderHandle } from "@/components/PhotoUploader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Addon } from "@shared/bookings";
import { toast } from "sonner";

// The four home "choose the route" cards, with their built-in defaults (used as
// placeholders so an admin sees what a blank field falls back to).
const HOME_CATS = [
  { type: "stay", name: "Stay", title: "Stay with a sense of place", label: "Homes, cabins & small hotels" },
  { type: "eat", name: "Eat", title: "Taste the landscape", label: "Tables, cellars & courtyards" },
  { type: "tour", name: "Tour", title: "Go with someone local", label: "Walks, routes & field days" },
  { type: "experience", name: "Experience", title: "Make something with your hands", label: "Classes, crafts & tastings" },
];

const HOME_REGIONS = [
  { query: "Tavush", name: "Tavush", label: "Forest & craft" },
  { query: "Gegharkunik", name: "Gegharkunik", label: "Lake & highlands" },
  { query: "Syunik", name: "Syunik", label: "Canyons & monasteries" },
];

const EMPTY_HOME = {
  categoriesIntro: "",
  editEyebrow: "",
  editTitle: "",
  regionsEyebrow: "",
  regionsTitle: "",
  regionsIntro: "",
  mapEyebrow: "",
  mapTitle: "",
  mapIntro: "",
  footerTagline: "",
  footerSubcopy: "",
};

type RegionCard = { id: string; name: string; label: string; image: string };

export function AdminSiteContent() {
  const { settings, loading, refresh } = useSiteSettings();
  const { listings } = useListings();
  const photosRef = useRef<PhotoUploaderHandle>(null);

  const [hydrated, setHydrated] = useState(false);
  const [headline, setHeadline] = useState("");
  const [subcopy, setSubcopy] = useState("");
  const [featuredSlugs, setFeaturedSlugs] = useState<string[]>([]);
  const [annEnabled, setAnnEnabled] = useState(false);
  const [annMessage, setAnnMessage] = useState("");
  const [annHref, setAnnHref] = useState("");
  const [rate, setRate] = useState("");
  const [catEyebrow, setCatEyebrow] = useState("");
  const [catTitle, setCatTitle] = useState("");
  const [homeCats, setHomeCats] = useState<Record<string, { title: string; label: string }>>({});
  const [home, setHome] = useState(EMPTY_HOME);
  const [regionCards, setRegionCards] = useState<RegionCard[]>([]);
  const regionPhotoRefs = useRef<Map<string, PhotoUploaderHandle | null>>(new Map());
  const catPhotoRefs = useRef<Map<string, PhotoUploaderHandle | null>>(new Map());
  const addonPhotoRefs = useRef<Map<string, PhotoUploaderHandle | null>>(new Map());
  const [addons, setAddons] = useState<Addon[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the form once the settings row has loaded.
  useEffect(() => {
    if (loading || hydrated) return;
    setHeadline(settings.heroHeadline);
    setSubcopy(settings.heroSubcopy);
    setFeaturedSlugs(settings.featuredSlugs);
    setAnnEnabled(settings.announcementEnabled);
    setAnnMessage(settings.announcementMessage);
    setAnnHref(settings.announcementHref);
    setRate(settings.usdToAmdRate ? String(settings.usdToAmdRate) : "");
    setCatEyebrow(settings.homeContent.categoriesEyebrow ?? "");
    setCatTitle(settings.homeContent.categoriesTitle ?? "");
    const hc = settings.homeContent.categories ?? {};
    setHomeCats(Object.fromEntries(HOME_CATS.map((c) => [c.type, { title: hc[c.type]?.title ?? "", label: hc[c.type]?.label ?? "" }])));
    const h = settings.homeContent;
    setHome({
      categoriesIntro: h.categoriesIntro ?? "",
      editEyebrow: h.editEyebrow ?? "",
      editTitle: h.editTitle ?? "",
      regionsEyebrow: h.regionsEyebrow ?? "",
      regionsTitle: h.regionsTitle ?? "",
      regionsIntro: h.regionsIntro ?? "",
      mapEyebrow: h.mapEyebrow ?? "",
      mapTitle: h.mapTitle ?? "",
      mapIntro: h.mapIntro ?? "",
      footerTagline: h.footerTagline ?? "",
      footerSubcopy: h.footerSubcopy ?? "",
    });
    const seedRegions = h.regionCards && h.regionCards.length ? h.regionCards : HOME_REGIONS;
    setRegionCards(seedRegions.map((r) => ({ id: crypto.randomUUID(), name: r.name ?? "", label: r.label ?? "", image: (r as { image?: string }).image ?? "" })));
    setAddons(settings.addons ?? []);
    setHydrated(true);
  }, [loading, hydrated, settings]);

  const published = listings.filter((l) => l.status === "published");

  const toggleFeatured = (slug: string) =>
    setFeaturedSlugs((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));

  const updateRegion = (id: string, key: "name" | "label", val: string) =>
    setRegionCards((prev) => prev.map((c) => (c.id === id ? { ...c, [key]: val } : c)));
  const removeRegion = (id: string) => {
    regionPhotoRefs.current.delete(id);
    setRegionCards((prev) => prev.filter((c) => c.id !== id));
  };
  const addRegion = () => setRegionCards((prev) => [...prev, { id: crypto.randomUUID(), name: "", label: "", image: "" }]);

  const updateAddon = (id: string, patch: Partial<Addon>) => setAddons((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const removeAddon = (id: string) => setAddons((prev) => prev.filter((a) => a.id !== id));
  const addAddon = () => setAddons((prev) => [...prev, { id: crypto.randomUUID(), name: "", description: "", image: "", priceCents: 0, unit: "flat", onRequest: false, enabled: true }]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const heroImages = photosRef.current?.getValue() ?? [];
      const heroImage = heroImages[0] ?? settings.heroImage;
      const { error: err } = await supabase
        .from("site_settings")
        .update({
          hero_image: heroImage || "",
          hero_images: heroImages,
          hero_headline: headline.trim(),
          hero_subcopy: subcopy.trim(),
          featured_slugs: featuredSlugs,
          announcement_enabled: annEnabled,
          announcement_message: annMessage.trim(),
          announcement_href: annHref.trim(),
          usd_to_amd_rate: Number(rate) || 0,
          addons: addons
            .map((a) => ({
              ...a,
              name: a.name.trim(),
              description: (a.description ?? "").trim(),
              image: addonPhotoRefs.current.get(a.id)?.getValue()[0] ?? a.image ?? "",
              priceCents: Math.max(0, Math.round(a.priceCents)),
            }))
            .filter((a) => a.name),
          home_content: {
            categoriesEyebrow: catEyebrow.trim(),
            categoriesTitle: catTitle.trim(),
            categoriesIntro: home.categoriesIntro.trim(),
            categories: Object.fromEntries(
              HOME_CATS.map((c) => [
                c.type,
                {
                  title: (homeCats[c.type]?.title ?? "").trim(),
                  label: (homeCats[c.type]?.label ?? "").trim(),
                  image: catPhotoRefs.current.get(c.type)?.getValue()[0] ?? settings.homeContent.categories?.[c.type]?.image ?? "",
                },
              ]),
            ),
            editEyebrow: home.editEyebrow.trim(),
            editTitle: home.editTitle.trim(),
            regionsEyebrow: home.regionsEyebrow.trim(),
            regionsTitle: home.regionsTitle.trim(),
            regionsIntro: home.regionsIntro.trim(),
            regionCards: regionCards
              .map((c) => {
                const img = regionPhotoRefs.current.get(c.id)?.getValue()[0] ?? c.image;
                return { name: c.name.trim(), label: c.label.trim(), image: img || "", query: c.name.trim() };
              })
              .filter((c) => c.name || c.label || c.image),
            mapEyebrow: home.mapEyebrow.trim(),
            mapTitle: home.mapTitle.trim(),
            mapIntro: home.mapIntro.trim(),
            footerTagline: home.footerTagline.trim(),
            footerSubcopy: home.footerSubcopy.trim(),
          },
        })
        .eq("id", 1);
      if (err) throw new Error(err.message);
      await refresh();
      toast("Site content updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save site content.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-14 border-t border-basalt/10 pt-10">
      <p className="eyebrow">Site content</p>
      <h2 className="mt-2 font-display text-3xl tracking-[-0.03em]">Edit the home page.</h2>
      <p className="mt-2 max-w-xl text-sm text-basalt/55">
        Everything here is optional — leave a field blank to keep the built-in default. Changes go live immediately.
      </p>

      <div className="mt-8 grid max-w-3xl gap-8">
        {/* Hero */}
        <div className="grid gap-4 border border-basalt/10 bg-paper p-5">
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Home hero</p>
          <div className="grid gap-2">
            <Label className="text-sm font-semibold">Hero photos <span className="font-normal text-basalt/45">(add several — they cross-fade automatically)</span></Label>
            <PhotoUploader
              key={hydrated ? "ready" : "loading"}
              ref={photosRef}
              defaultValue={settings.heroImages.length ? settings.heroImages : settings.heroImage ? [settings.heroImage] : []}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="heroHeadline" className="text-sm font-semibold">Headline <span className="font-normal text-basalt/45">(blank = “Stay. Experience. Repeat.”)</span></Label>
            <Input id="heroHeadline" value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Stay. Experience. Repeat." className="h-11 rounded-none" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="heroSubcopy" className="text-sm font-semibold">Sub-copy</Label>
            <Textarea id="heroSubcopy" rows={2} value={subcopy} onChange={(e) => setSubcopy(e.target.value)} placeholder="Exceptional stays, Armenian tables, and local routes…" className="rounded-none text-base" />
          </div>
        </div>

        {/* Featured */}
        <div className="grid gap-3 border border-basalt/10 bg-paper p-5">
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Featured listings</p>
          <p className="text-xs text-basalt/50">Pick which published listings appear in the home “Featured” row (leave all unchecked for the automatic pick).</p>
          {published.length === 0 ? (
            <p className="text-sm text-basalt/45">No published listings yet.</p>
          ) : (
            <div className="grid max-h-64 gap-1.5 overflow-y-auto">
              {published.map((l) => (
                <label key={l.id} className="flex items-center gap-3 text-sm text-basalt">
                  <Checkbox
                    checked={featuredSlugs.includes(l.slug)}
                    onCheckedChange={() => toggleFeatured(l.slug)}
                    className="rounded-[3px] border-basalt/30 data-[state=checked]:border-apricot data-[state=checked]:bg-apricot"
                  />
                  <span className="truncate">{l.title}</span>
                  <span className="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-[0.1em] text-basalt/40">{l.type}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Announcement */}
        <div className="grid gap-4 border border-basalt/10 bg-paper p-5">
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Announcement banner</p>
          <label className="flex items-center gap-3 text-sm">
            <Checkbox
              checked={annEnabled}
              onCheckedChange={(c) => setAnnEnabled(c === true)}
              className="rounded-[3px] border-basalt/30 data-[state=checked]:border-apricot data-[state=checked]:bg-apricot"
            />
            Show a site-wide banner
          </label>
          <div className="grid gap-2">
            <Label htmlFor="annMessage" className="text-sm font-semibold">Message</Label>
            <Input id="annMessage" value={annMessage} onChange={(e) => setAnnMessage(e.target.value)} placeholder="New experiences now live across Armenia" className="h-11 rounded-none" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="annHref" className="text-sm font-semibold">Link <span className="font-normal text-basalt/45">(optional — e.g. /explore/experience)</span></Label>
            <Input id="annHref" value={annHref} onChange={(e) => setAnnHref(e.target.value)} placeholder="/explore/experience" className="h-11 rounded-none" />
          </div>
        </div>

        {/* Display currency */}
        <div className="grid gap-2 border border-basalt/10 bg-paper p-5">
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Display currency</p>
          <p className="text-xs text-basalt/50">Prices settle in USD; this rate powers the AMD/USD switcher (display only). Set 0 to hide AMD.</p>
          <Label htmlFor="usdToAmd" className="text-sm font-semibold">AMD per 1 USD</Label>
          <Input id="usdToAmd" type="number" min={0} step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 387" className="h-11 w-48 rounded-none" />
        </div>

        {/* Home "choose the route" section */}
        <div className="grid gap-4 border border-basalt/10 bg-paper p-5">
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Home “choose the route” section</p>
          <div className="grid gap-2">
            <Label htmlFor="catEyebrow" className="text-sm font-semibold">Eyebrow</Label>
            <Input id="catEyebrow" value={catEyebrow} onChange={(e) => setCatEyebrow(e.target.value)} placeholder="Four ways in" className="h-11 rounded-none" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="catTitle" className="text-sm font-semibold">Heading <span className="font-normal text-basalt/45">(line breaks allowed)</span></Label>
            <Textarea id="catTitle" rows={2} value={catTitle} onChange={(e) => setCatTitle(e.target.value)} placeholder={"Let curiosity\nchoose the route."} className="rounded-none text-base" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="catIntro" className="text-sm font-semibold">Intro paragraph</Label>
            <Textarea id="catIntro" rows={2} value={home.categoriesIntro} onChange={(e) => setHome((p) => ({ ...p, categoriesIntro: e.target.value }))} placeholder="Start with a room, a table, a day in the open…" className="rounded-none text-base" />
          </div>
          {HOME_CATS.map((c) => (
            <div key={c.type} className="grid gap-2 border-t border-basalt/10 pt-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-apricot">{c.name} card</p>
              <Input
                value={homeCats[c.type]?.title ?? ""}
                onChange={(e) => setHomeCats((p) => ({ ...p, [c.type]: { ...(p[c.type] ?? { title: "", label: "" }), title: e.target.value } }))}
                placeholder={c.title}
                className="h-11 rounded-none"
              />
              <Input
                value={homeCats[c.type]?.label ?? ""}
                onChange={(e) => setHomeCats((p) => ({ ...p, [c.type]: { ...(p[c.type] ?? { title: "", label: "" }), label: e.target.value } }))}
                placeholder={c.label}
                className="h-11 rounded-none"
              />
              <p className="mt-1 text-xs text-basalt/45">Photo <span className="text-basalt/35">(optional — blank keeps the built-in illustration)</span></p>
              <PhotoUploader
                key={hydrated ? `cat-${c.type}` : `cat-${c.type}-loading`}
                ref={(el) => {
                  if (el) catPhotoRefs.current.set(c.type, el);
                  else catPhotoRefs.current.delete(c.type);
                }}
                defaultValue={settings.homeContent.categories?.[c.type]?.image ? [settings.homeContent.categories[c.type].image as string] : []}
              />
            </div>
          ))}
        </div>

        {/* Concierge add-ons */}
        <div className="grid gap-4 border border-basalt/10 bg-paper p-5">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Concierge add-ons</p>
            <p className="mt-1 text-xs text-basalt/50">Extra services guests can add at checkout on stay listings. Toggle Enabled to show one to guests (Hidden keeps it here but off the checkout page). Needs a name and a price, or mark it "On request". Prices are in AMD. "On request" items show but aren't charged online.</p>
          </div>
          {addons.map((a) => (
            <div key={a.id} className="grid gap-2 border-t border-basalt/10 pt-4">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-basalt/60">
                  <Checkbox checked={!!a.enabled} onCheckedChange={(c) => updateAddon(a.id, { enabled: c === true })} className="rounded-[3px] border-basalt/30 data-[state=checked]:border-apricot data-[state=checked]:bg-apricot" />
                  {a.enabled ? "Enabled" : "Hidden"}
                </label>
                <button type="button" onClick={() => removeAddon(a.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-basalt/45 hover:text-destructive"><Minus className="h-3.5 w-3.5" /> Remove</button>
              </div>
              <Input value={a.name} onChange={(e) => updateAddon(a.id, { name: e.target.value })} placeholder="Name (e.g. Airport pickup - Sedan)" className="h-11 rounded-none" />
              <Textarea rows={2} value={a.description ?? ""} onChange={(e) => updateAddon(a.id, { description: e.target.value })} placeholder="Short description / key terms" className="rounded-none text-base" />
              <div className="grid gap-1">
                <Label className="text-xs font-semibold text-basalt/60">Thumbnail</Label>
                <PhotoUploader
                  key={hydrated ? `addon-${a.id}` : `addon-${a.id}-loading`}
                  ref={(el) => {
                    if (el) addonPhotoRefs.current.set(a.id, el);
                    else addonPhotoRefs.current.delete(a.id);
                  }}
                  defaultValue={a.image ? [a.image] : []}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1">
                  <Label className="text-xs font-semibold text-basalt/60">Price (AMD)</Label>
                  <Input type="number" min={0} value={a.priceCents ? a.priceCents / 100 : ""} onChange={(e) => updateAddon(a.id, { priceCents: Math.round((Number(e.target.value) || 0) * 100) })} placeholder="e.g. 12000" className="h-11 rounded-none" />
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs font-semibold text-basalt/60">Charged</Label>
                  <Select value={a.unit} onValueChange={(v) => updateAddon(a.id, { unit: v as Addon["unit"] })}>
                    <SelectTrigger className="h-11 rounded-none text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="flat">Flat (once)</SelectItem>
                      <SelectItem value="per_night">Per night</SelectItem>
                      <SelectItem value="per_guest">Per guest</SelectItem>
                      <SelectItem value="per_item">Per item (qty)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs font-semibold text-basalt/60">On request</Label>
                  <label className="flex h-11 items-center gap-2 text-sm text-basalt">
                    <Checkbox checked={!!a.onRequest} onCheckedChange={(c) => updateAddon(a.id, { onRequest: c === true })} className="rounded-[3px] border-basalt/30 data-[state=checked]:border-apricot data-[state=checked]:bg-apricot" />
                    Not charged online
                  </label>
                </div>
              </div>
            </div>
          ))}
          <button type="button" onClick={addAddon} className="inline-flex items-center gap-1.5 self-start rounded-none border border-basalt/20 bg-paper px-4 py-2 text-sm font-semibold text-basalt hover:border-apricot"><Plus className="h-4 w-4" /> Add a service</button>
        </div>

        {/* Home "the revamp. edit" (featured) section */}
        <div className="grid gap-4 border border-basalt/10 bg-paper p-5">
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Home featured section</p>
          <div className="grid gap-2">
            <Label className="text-sm font-semibold">Eyebrow</Label>
            <Input value={home.editEyebrow} onChange={(e) => setHome((p) => ({ ...p, editEyebrow: e.target.value }))} placeholder="The revamp. edit" className="h-11 rounded-none" />
          </div>
          <div className="grid gap-2">
            <Label className="text-sm font-semibold">Heading <span className="font-normal text-basalt/45">(line breaks allowed)</span></Label>
            <Textarea rows={2} value={home.editTitle} onChange={(e) => setHome((p) => ({ ...p, editTitle: e.target.value }))} placeholder="Worth taking the long way." className="rounded-none text-base" />
          </div>
        </div>

        {/* Home regions section */}
        <div className="grid gap-4 border border-basalt/10 bg-paper p-5">
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Home regions section</p>
          <div className="grid gap-2">
            <Label className="text-sm font-semibold">Eyebrow</Label>
            <Input value={home.regionsEyebrow} onChange={(e) => setHome((p) => ({ ...p, regionsEyebrow: e.target.value }))} placeholder="Regions to read slowly" className="h-11 rounded-none" />
          </div>
          <div className="grid gap-2">
            <Label className="text-sm font-semibold">Heading <span className="font-normal text-basalt/45">(line breaks allowed)</span></Label>
            <Textarea rows={2} value={home.regionsTitle} onChange={(e) => setHome((p) => ({ ...p, regionsTitle: e.target.value }))} placeholder="The landscape changes the story." className="rounded-none text-base" />
          </div>
          <div className="grid gap-2">
            <Label className="text-sm font-semibold">Intro paragraph</Label>
            <Textarea rows={2} value={home.regionsIntro} onChange={(e) => setHome((p) => ({ ...p, regionsIntro: e.target.value }))} placeholder="From Tavush forest to the high blue of Sevan…" className="rounded-none text-base" />
          </div>
          {regionCards.map((c, i) => (
            <div key={c.id} className="grid gap-2 border-t border-basalt/10 pt-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-apricot">Region {i + 1}</p>
                <button type="button" onClick={() => removeRegion(c.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-basalt/45 transition-colors hover:text-destructive">
                  <Minus className="h-3.5 w-3.5" /> Remove
                </button>
              </div>
              <Input value={c.name} onChange={(e) => updateRegion(c.id, "name", e.target.value)} placeholder="Region name (e.g. Tavush)" className="h-11 rounded-none" />
              <Input value={c.label} onChange={(e) => updateRegion(c.id, "label", e.target.value)} placeholder="Short label (e.g. Forest & craft)" className="h-11 rounded-none" />
              <PhotoUploader
                ref={(el) => {
                  if (el) regionPhotoRefs.current.set(c.id, el);
                  else regionPhotoRefs.current.delete(c.id);
                }}
                defaultValue={c.image ? [c.image] : []}
              />
            </div>
          ))}
          <button type="button" onClick={addRegion} className="mt-2 inline-flex items-center gap-1.5 self-start rounded-none border border-basalt/20 bg-paper px-4 py-2 text-sm font-semibold text-basalt transition-colors hover:border-apricot">
            <Plus className="h-4 w-4" /> Add region
          </button>
        </div>

        {/* Home map section */}
        <div className="grid gap-4 border border-basalt/10 bg-paper p-5">
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Home map section</p>
          <div className="grid gap-2">
            <Label className="text-sm font-semibold">Eyebrow</Label>
            <Input value={home.mapEyebrow} onChange={(e) => setHome((p) => ({ ...p, mapEyebrow: e.target.value }))} placeholder="Move through the map" className="h-11 rounded-none" />
          </div>
          <div className="grid gap-2">
            <Label className="text-sm font-semibold">Heading <span className="font-normal text-basalt/45">(line breaks allowed)</span></Label>
            <Textarea rows={2} value={home.mapTitle} onChange={(e) => setHome((p) => ({ ...p, mapTitle: e.target.value }))} placeholder={"See what’s\naround the bend."} className="rounded-none text-base" />
          </div>
          <div className="grid gap-2">
            <Label className="text-sm font-semibold">Intro paragraph</Label>
            <Textarea rows={2} value={home.mapIntro} onChange={(e) => setHome((p) => ({ ...p, mapIntro: e.target.value }))} placeholder="Hover a place to follow it across Armenia…" className="rounded-none text-base" />
          </div>
        </div>

        {/* Footer brand statement (site-wide) */}
        <div className="grid gap-4 border border-basalt/10 bg-paper p-5">
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Footer statement <span className="font-normal normal-case tracking-normal text-basalt/45">(shown site-wide)</span></p>
          <div className="grid gap-2">
            <Label className="text-sm font-semibold">Tagline</Label>
            <Textarea rows={2} value={home.footerTagline} onChange={(e) => setHome((p) => ({ ...p, footerTagline: e.target.value }))} placeholder="Find the Armenia that lives between the landmarks." className="rounded-none text-base" />
          </div>
          <div className="grid gap-2">
            <Label className="text-sm font-semibold">Sub-copy</Label>
            <Textarea rows={2} value={home.footerSubcopy} onChange={(e) => setHome((p) => ({ ...p, footerSubcopy: e.target.value }))} placeholder="Curated stays, tables, and local routes…" className="rounded-none text-base" />
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <div>
          <Button onClick={save} disabled={saving || loading} className="rounded-none bg-apricot text-white hover:bg-apricot/90">
            <Save className="mr-2 h-4 w-4" /> {saving ? "Saving…" : "Save site content"}
          </Button>
        </div>
      </div>
    </section>
  );
}
