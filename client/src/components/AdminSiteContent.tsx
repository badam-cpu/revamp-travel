/**
 * Admin-only editor for site content (home hero image/headline/subcopy,
 * featured listings, announcement banner) — rendered on /admin alongside the
 * review queue. Writes the single `site_settings` row directly under the
 * admin's session; RLS (is_admin) is what actually authorizes it, not this UI.
 * Reads/refreshes through SiteSettingsContext so the change shows up live.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Minus, Plus, Save } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useSiteSettings, DEFAULT_SERVICE_PARTNERS } from "@/contexts/SiteSettingsContext";
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
  operatorCallUrl: "",
};

type RegionCard = { id: string; name: string; label: string; image: string };

const CONTENT_TABS = [
  { key: "hero", label: "Hero & featured" },
  { key: "home", label: "Home sections" },
  { key: "pages", label: "Pages" },
  { key: "addons", label: "Add-ons" },
  { key: "global", label: "Site-wide" },
] as const;
type ContentTab = (typeof CONTENT_TABS)[number]["key"];

export function AdminSiteContent() {
  const { settings, loading, loaded, refresh } = useSiteSettings();
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
  const [faq, setFaq] = useState<{ id: string; q: string; a: string }[]>([]);
  const [partners, setPartners] = useState<{ id: string; name: string; blurb: string; url: string; logo: string }[]>([]);
  const [mediaMentions, setMediaMentions] = useState<{ id: string; name: string; url: string; logo: string }[]>([]);
  const [featuredOps, setFeaturedOps] = useState<string[]>([]);
  const [operatorOptions, setOperatorOptions] = useState<{ id: string; name: string; count: number }[]>([]);
  const regionPhotoRefs = useRef<Map<string, PhotoUploaderHandle | null>>(new Map());
  const catPhotoRefs = useRef<Map<string, PhotoUploaderHandle | null>>(new Map());
  const addonPhotoRefs = useRef<Map<string, PhotoUploaderHandle | null>>(new Map());
  const partnerPhotoRefs = useRef<Map<string, PhotoUploaderHandle | null>>(new Map());
  const mediaPhotoRefs = useRef<Map<string, PhotoUploaderHandle | null>>(new Map());
  const [addons, setAddons] = useState<Addon[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ContentTab>("hero");

  // Seed the form only after a SUCCESSFUL load (loaded), never merely when
  // loading finished — a failed load must not seed defaults into the form, or a
  // subsequent Save would overwrite real DB content with them.
  useEffect(() => {
    if (!loaded || hydrated) return;
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
      operatorCallUrl: h.operatorCallUrl ?? "",
    });
    const seedRegions = h.regionCards && h.regionCards.length ? h.regionCards : HOME_REGIONS;
    setRegionCards(seedRegions.map((r) => ({ id: crypto.randomUUID(), name: r.name ?? "", label: r.label ?? "", image: (r as { image?: string }).image ?? "" })));
    setFaq((h.faq ?? []).map((f) => ({ id: crypto.randomUUID(), q: f.q ?? "", a: f.a ?? "" })));
    setPartners((h.partners ?? DEFAULT_SERVICE_PARTNERS).map((p) => ({ id: crypto.randomUUID(), name: p.name ?? "", blurb: p.blurb ?? "", url: p.url ?? "", logo: p.logo ?? "" })));
    setMediaMentions((h.mediaMentions ?? []).map((m) => ({ id: crypto.randomUUID(), name: m.name ?? "", url: m.url ?? "", logo: m.logo ?? "" })));
    setFeaturedOps(h.featuredOperatorIds ?? []);
    setAddons(settings.addons ?? []);
    setHydrated(true);
  }, [loading, hydrated, settings]);

  const published = listings.filter((l) => l.status === "published");

  // Operator options for the "featured (big names first)" picker — distinct
  // operators with a published listing, with their business/display name.
  useEffect(() => {
    const counts = new Map<string, number>();
    for (const l of published) {
      const id = (l as { operatorId?: string }).operatorId;
      if (id && id !== "seed") counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const ids = Array.from(counts.keys());
    if (!ids.length) {
      setOperatorOptions([]);
      return;
    }
    let active = true;
    supabase
      .from("profiles")
      .select("*")
      .in("id", ids)
      .then(({ data }) => {
        if (!active || !data) return;
        const opts = ids.map((id) => {
          const p = (data as { id: string; business_name?: string | null; display_name?: string | null }[]).find((r) => r.id === id);
          return { id, name: p?.business_name || p?.display_name || "Host", count: counts.get(id) ?? 0 };
        });
        opts.sort((a, b) => a.name.localeCompare(b.name));
        setOperatorOptions(opts);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [published.length]);

  const toggleFeaturedOp = (id: string) => setFeaturedOps((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const updatePartner = (id: string, key: "name" | "blurb" | "url", val: string) => setPartners((prev) => prev.map((p) => (p.id === id ? { ...p, [key]: val } : p)));
  const removePartner = (id: string) => {
    partnerPhotoRefs.current.delete(id);
    setPartners((prev) => prev.filter((p) => p.id !== id));
  };
  const addPartner = () => setPartners((prev) => [...prev, { id: crypto.randomUUID(), name: "", blurb: "", url: "", logo: "" }]);
  const updateMedia = (id: string, key: "name" | "url", val: string) => setMediaMentions((prev) => prev.map((m) => (m.id === id ? { ...m, [key]: val } : m)));
  const removeMedia = (id: string) => { mediaPhotoRefs.current.delete(id); setMediaMentions((prev) => prev.filter((m) => m.id !== id)); };
  const addMedia = () => setMediaMentions((prev) => [...prev, { id: crypto.randomUUID(), name: "", url: "", logo: "" }]);

  const toggleFeatured = (slug: string) =>
    setFeaturedSlugs((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
  // Reorder the selected featured listings — index 0 is the large hero card.
  const moveFeatured = (index: number, dir: -1 | 1) =>
    setFeaturedSlugs((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const updateRegion = (id: string, key: "name" | "label", val: string) =>
    setRegionCards((prev) => prev.map((c) => (c.id === id ? { ...c, [key]: val } : c)));
  const removeRegion = (id: string) => {
    regionPhotoRefs.current.delete(id);
    setRegionCards((prev) => prev.filter((c) => c.id !== id));
  };
  const addRegion = () => setRegionCards((prev) => [...prev, { id: crypto.randomUUID(), name: "", label: "", image: "" }]);
  // Reorder region cards — their array order is exactly the home-page order.
  const moveRegion = (index: number, dir: -1 | 1) =>
    setRegionCards((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const updateAddon = (id: string, patch: Partial<Addon>) => setAddons((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const removeAddon = (id: string) => setAddons((prev) => prev.filter((a) => a.id !== id));
  const addAddon = () => setAddons((prev) => [...prev, { id: crypto.randomUUID(), name: "", description: "", image: "", priceCents: 0, unit: "flat", onRequest: false, enabled: true }]);

  const save = async () => {
    // Hard guard: never write when the current content wasn't successfully
    // loaded (the form would be defaults) — that's how content gets wiped.
    if (!loaded || !hydrated) {
      setError("Site content hasn't loaded yet — refresh before saving so you don't overwrite existing content.");
      return;
    }
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
            operatorCallUrl: home.operatorCallUrl.trim(),
            faq: faq.map((f) => ({ q: f.q.trim(), a: f.a.trim() })).filter((f) => f.q && f.a),
            featuredOperatorIds: featuredOps,
            partners: partners
              .map((p) => ({
                name: p.name.trim(),
                blurb: p.blurb.trim(),
                url: p.url.trim() || undefined,
                logo: partnerPhotoRefs.current.get(p.id)?.getValue()[0] ?? p.logo ?? "",
              }))
              .filter((p) => p.name && p.blurb),
            mediaMentions: mediaMentions
              .map((m) => ({
                name: m.name.trim(),
                url: m.url.trim() || undefined,
                logo: mediaPhotoRefs.current.get(m.id)?.getValue()[0] ?? m.logo ?? "",
              }))
              .filter((m) => m.name),
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

  // Per-section save bar. Every section writes the whole settings row from
  // current state, so any Save button commits all pending edits — the point is
  // that you can save without scrolling to the bottom.
  const sectionSave = () => (
    <div className="mt-1 flex items-center justify-end gap-3 border-t border-basalt/10 pt-3">
      <Button size="sm" onClick={save} disabled={saving || loading || !loaded || !hydrated} className="rounded-none bg-apricot text-white hover:bg-apricot/90">
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );

  return (
    <section className="mt-14 border-t border-basalt/10 pt-10">
      <p className="eyebrow">Site content</p>
      <h2 className="mt-2 font-display text-3xl tracking-[-0.03em]">Edit the home page.</h2>
      <p className="mt-2 max-w-xl text-sm text-basalt/55">
        Everything here is optional — leave a field blank to keep the built-in default. Changes go live immediately.
      </p>

      {/* Safety banner: if the current content couldn't be loaded, saving would
          overwrite it with defaults — block editing until a refresh succeeds. */}
      {!loading && !loaded && (
        <div className="mt-6 flex items-start gap-2 border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <span>
            Couldn't load the current site content, so editing is disabled to protect it. Don't save — click{" "}
            <button type="button" onClick={() => refresh()} className="font-semibold underline">retry</button> or reload the page first.
          </span>
        </div>
      )}

      {/* Category tabs — every section stays mounted (just hidden) so the save,
          which reads uncontrolled inputs + PhotoUploader refs, still sees them. */}
      <div className="mt-8 flex flex-wrap gap-1 border-b border-basalt/10">
        {CONTENT_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${tab === t.key ? "border-apricot text-basalt" : "border-transparent text-basalt/50 hover:text-basalt"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-8 grid max-w-3xl gap-8">
        {/* Hero */}
        <div hidden={tab !== "hero"} className="grid gap-4 border border-basalt/10 bg-paper p-5">
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
          {sectionSave()}
        </div>

        {/* Featured */}
        <div hidden={tab !== "hero"} className="grid gap-3 border border-basalt/10 bg-paper p-5">
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Featured listings</p>
          <p className="text-xs text-basalt/50">Pick which published listings appear in the home “Featured” row — up to 8 are shown (leave all unchecked for the automatic pick).</p>
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

          {/* Order of the featured row — index 0 is the large hero card. */}
          {featuredSlugs.length > 0 && (
            <div className="mt-1 grid gap-1.5 border-t border-basalt/10 pt-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-basalt/45">Order shown on the home page</p>
              {featuredSlugs.map((slug, i) => {
                const l = published.find((p) => p.slug === slug);
                return (
                  <div key={slug} className="flex items-center gap-2 text-sm">
                    <span className="w-5 shrink-0 text-center text-xs font-bold tabular-nums text-basalt/40">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {l ? l.title : slug}
                      {i === 0 && <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.1em] text-apricot">Hero</span>}
                      {!l && <span className="ml-2 text-[10px] uppercase tracking-[0.1em] text-basalt/35">(unpublished)</span>}
                    </span>
                    <button type="button" onClick={() => moveFeatured(i, -1)} disabled={i === 0} aria-label="Move up" title="Move up" className="grid h-7 w-7 place-items-center border border-basalt/15 text-basalt/60 transition-colors hover:border-apricot hover:text-apricot disabled:opacity-30 disabled:hover:border-basalt/15 disabled:hover:text-basalt/60">
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => moveFeatured(i, 1)} disabled={i === featuredSlugs.length - 1} aria-label="Move down" title="Move down" className="grid h-7 w-7 place-items-center border border-basalt/15 text-basalt/60 transition-colors hover:border-apricot hover:text-apricot disabled:opacity-30 disabled:hover:border-basalt/15 disabled:hover:text-basalt/60">
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => toggleFeatured(slug)} aria-label="Remove from featured" title="Remove" className="grid h-7 w-7 place-items-center text-basalt/45 transition-colors hover:text-destructive">
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {sectionSave()}
        </div>

        {/* Announcement */}
        <div hidden={tab !== "global"} className="grid gap-4 border border-basalt/10 bg-paper p-5">
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
          {sectionSave()}
        </div>

        {/* Display currency */}
        <div hidden={tab !== "global"} className="grid gap-2 border border-basalt/10 bg-paper p-5">
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Display currency</p>
          <p className="text-xs text-basalt/50">Prices settle in USD; this rate powers the AMD/USD switcher (display only). Set 0 to hide AMD.</p>
          <Label htmlFor="usdToAmd" className="text-sm font-semibold">AMD per 1 USD</Label>
          <Input id="usdToAmd" type="number" min={0} step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 387" className="h-11 w-48 rounded-none" />
          {sectionSave()}
        </div>

        {/* Home "choose the route" section */}
        <div hidden={tab !== "home"} className="grid gap-4 border border-basalt/10 bg-paper p-5">
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
          {sectionSave()}
        </div>

        {/* Concierge add-ons */}
        <div hidden={tab !== "addons"} className="grid gap-4 border border-basalt/10 bg-paper p-5">
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
          {sectionSave()}
        </div>

        {/* Home "the revamp. edit" (featured) section */}
        <div hidden={tab !== "home"} className="grid gap-4 border border-basalt/10 bg-paper p-5">
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Home featured section</p>
          <div className="grid gap-2">
            <Label className="text-sm font-semibold">Eyebrow</Label>
            <Input value={home.editEyebrow} onChange={(e) => setHome((p) => ({ ...p, editEyebrow: e.target.value }))} placeholder="The revamp. edit" className="h-11 rounded-none" />
          </div>
          <div className="grid gap-2">
            <Label className="text-sm font-semibold">Heading <span className="font-normal text-basalt/45">(line breaks allowed)</span></Label>
            <Textarea rows={2} value={home.editTitle} onChange={(e) => setHome((p) => ({ ...p, editTitle: e.target.value }))} placeholder="Worth taking the long way." className="rounded-none text-base" />
          </div>
          {sectionSave()}
        </div>

        {/* Home regions section */}
        <div hidden={tab !== "home"} className="grid gap-4 border border-basalt/10 bg-paper p-5">
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
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => moveRegion(i, -1)} disabled={i === 0} aria-label="Move up" title="Move up" className="grid h-7 w-7 place-items-center border border-basalt/15 text-basalt/60 transition-colors hover:border-apricot hover:text-apricot disabled:opacity-30 disabled:hover:border-basalt/15 disabled:hover:text-basalt/60">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => moveRegion(i, 1)} disabled={i === regionCards.length - 1} aria-label="Move down" title="Move down" className="grid h-7 w-7 place-items-center border border-basalt/15 text-basalt/60 transition-colors hover:border-apricot hover:text-apricot disabled:opacity-30 disabled:hover:border-basalt/15 disabled:hover:text-basalt/60">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => removeRegion(c.id)} className="ml-1 inline-flex items-center gap-1 text-xs font-semibold text-basalt/45 transition-colors hover:text-destructive">
                    <Minus className="h-3.5 w-3.5" /> Remove
                  </button>
                </div>
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
          {sectionSave()}
        </div>

        {/* Home map section */}
        <div hidden={tab !== "home"} className="grid gap-4 border border-basalt/10 bg-paper p-5">
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
          {sectionSave()}
        </div>

        {/* "Armenia in the world's press" media strip (home) */}
        <div hidden={tab !== "home"} className="grid gap-4 border border-basalt/10 bg-paper p-5">
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Armenia in the world's press <span className="font-normal normal-case tracking-normal text-basalt/45">(home logo strip)</span></p>
          <p className="text-xs text-basalt/50">Outlets that have covered <strong>Armenia</strong> — each links to the real article. This is editorial coverage of the destination, not a claim that Revamp was featured. Only upload logos you have permission to use. Leave empty to hide the whole section.</p>
          {mediaMentions.map((m) => (
            <div key={m.id} className="grid gap-2 border border-basalt/10 bg-chalk/40 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-1"><Label className="text-xs font-semibold text-basalt/60">Publication name</Label><Input value={m.name} onChange={(e) => updateMedia(m.id, "name", e.target.value)} placeholder="The New York Times" className="h-10 rounded-none" /></div>
                <div className="grid gap-1"><Label className="text-xs font-semibold text-basalt/60">Article URL</Label><Input value={m.url} onChange={(e) => updateMedia(m.id, "url", e.target.value)} placeholder="https://…" className="h-10 rounded-none" /></div>
              </div>
              <div className="grid gap-1">
                <Label className="text-xs font-semibold text-basalt/60">Logo <span className="font-normal text-basalt/45">(only upload logos you have permission to use)</span></Label>
                <PhotoUploader ref={(el) => { mediaPhotoRefs.current.set(m.id, el); }} defaultValue={m.logo ? [m.logo] : []} />
              </div>
              <div><button type="button" onClick={() => removeMedia(m.id)} className="text-xs font-semibold text-basalt/45 hover:text-destructive">Remove</button></div>
            </div>
          ))}
          <div><Button type="button" variant="outline" size="sm" onClick={addMedia} className="rounded-none border-basalt/20">+ Add publication</Button></div>
          {sectionSave()}
        </div>

        {/* Footer brand statement (site-wide) */}
        <div hidden={tab !== "home"} className="grid gap-4 border border-basalt/10 bg-paper p-5">
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Footer statement <span className="font-normal normal-case tracking-normal text-basalt/45">(shown site-wide)</span></p>
          <div className="grid gap-2">
            <Label className="text-sm font-semibold">Tagline</Label>
            <Textarea rows={2} value={home.footerTagline} onChange={(e) => setHome((p) => ({ ...p, footerTagline: e.target.value }))} placeholder="Find the Armenia that lives between the landmarks." className="rounded-none text-base" />
          </div>
          <div className="grid gap-2">
            <Label className="text-sm font-semibold">Sub-copy</Label>
            <Textarea rows={2} value={home.footerSubcopy} onChange={(e) => setHome((p) => ({ ...p, footerSubcopy: e.target.value }))} placeholder="Curated stays, tables, and local routes…" className="rounded-none text-base" />
          </div>
          <div className="grid gap-2 border-t border-basalt/10 pt-4">
            <Label className="text-sm font-semibold">Operator "Book a quick call" link</Label>
            <Input value={home.operatorCallUrl} onChange={(e) => setHome((p) => ({ ...p, operatorCallUrl: e.target.value }))} placeholder="https://calendly.com/… (shown on the /host operator pages; blank → sign-up)" className="rounded-none" />
          </div>
          {sectionSave()}
        </div>

        {/* FAQ (shown on /faq, with FAQ structured data for Google + AI) */}
        <div hidden={tab !== "pages"} className="grid gap-4 border border-basalt/10 bg-paper p-5">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">FAQ <span className="font-normal normal-case tracking-normal text-basalt/45">(shown on /faq)</span></p>
            <p className="mt-1 text-xs text-basalt/50">Questions &amp; answers about booking and Armenia travel. Leave empty to use the built-in defaults. Answer engines (Google, ChatGPT, Perplexity) quote these directly — keep them factual.</p>
          </div>
          {faq.map((item, i) => (
            <div key={item.id} className="grid gap-2 border border-basalt/10 bg-chalk p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-[0.1em] text-basalt/45">Q{i + 1}</span>
                <button type="button" onClick={() => setFaq((p) => p.filter((x) => x.id !== item.id))} className="text-xs font-semibold text-basalt/45 hover:text-destructive">Remove</button>
              </div>
              <Input value={item.q} onChange={(e) => setFaq((p) => p.map((x) => (x.id === item.id ? { ...x, q: e.target.value } : x)))} placeholder="Question" className="rounded-none" />
              <Textarea rows={3} value={item.a} onChange={(e) => setFaq((p) => p.map((x) => (x.id === item.id ? { ...x, a: e.target.value } : x)))} placeholder="Answer" className="rounded-none text-base" />
            </div>
          ))}
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => setFaq((p) => [...p, { id: crypto.randomUUID(), q: "", a: "" }])} className="rounded-none border-basalt/20">+ Add question</Button>
          </div>
          {sectionSave()}
        </div>

        {/* Partners page (/partners) — featured operators + services we use */}
        <div hidden={tab !== "pages"} className="grid gap-5 border border-basalt/10 bg-paper p-5">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.12em] text-basalt/50">Partners page <span className="font-normal normal-case tracking-normal text-basalt/45">(shown on /partners)</span></p>
            <p className="mt-1 text-xs text-basalt/50">All published operators show automatically. Pin your "big names" here to move them to the top; the rest stay alphabetical.</p>
          </div>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-basalt/45">Featured operators (pinned first)</p>
            {operatorOptions.length === 0 ? (
              <p className="text-xs text-basalt/45">No operators with published listings yet.</p>
            ) : (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {operatorOptions.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 rounded-none border border-basalt/10 bg-chalk px-3 py-2 text-sm">
                    <input type="checkbox" checked={featuredOps.includes(o.id)} onChange={() => toggleFeaturedOp(o.id)} className="h-4 w-4 accent-apricot" />
                    <span className="min-w-0 flex-1 truncate">{o.name}</span>
                    <span className="shrink-0 text-xs text-basalt/40">{o.count}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-basalt/45">Services we use</p>
            <p className="mb-3 text-xs text-basalt/50">Name + a factual line. No third-party logos unless you have permission. Leave empty to use the built-in default (PayLink).</p>
            {partners.map((p, i) => (
              <div key={p.id} className="mb-3 grid gap-2 border border-basalt/10 bg-chalk p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-[0.1em] text-basalt/45">#{i + 1}</span>
                  <button type="button" onClick={() => removePartner(p.id)} className="text-xs font-semibold text-basalt/45 hover:text-destructive">Remove</button>
                </div>
                <Input value={p.name} onChange={(e) => updatePartner(p.id, "name", e.target.value)} placeholder="Service name (e.g. PayLink)" className="rounded-none" />
                <Textarea rows={2} value={p.blurb} onChange={(e) => updatePartner(p.id, "blurb", e.target.value)} placeholder="One factual line about what they do for Revamp." className="rounded-none text-base" />
                <Input value={p.url} onChange={(e) => updatePartner(p.id, "url", e.target.value)} placeholder="https://… (optional)" className="rounded-none" />
                <div className="grid gap-1">
                  <Label className="text-xs font-semibold text-basalt/60">Logo <span className="font-normal text-basalt/45">(optional — only upload logos you have permission to use)</span></Label>
                  <PhotoUploader
                    key={hydrated ? `partner-${p.id}` : `partner-${p.id}-loading`}
                    ref={(el) => {
                      if (el) partnerPhotoRefs.current.set(p.id, el);
                      else partnerPhotoRefs.current.delete(p.id);
                    }}
                    defaultValue={p.logo ? [p.logo] : []}
                  />
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addPartner} className="rounded-none border-basalt/20">+ Add service</Button>
          </div>
          {sectionSave()}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <div>
          <Button onClick={save} disabled={saving || loading || !loaded || !hydrated} className="rounded-none bg-apricot text-white hover:bg-apricot/90">
            <Save className="mr-2 h-4 w-4" /> {saving ? "Saving…" : "Save site content"}
          </Button>
        </div>
      </div>
    </section>
  );
}
